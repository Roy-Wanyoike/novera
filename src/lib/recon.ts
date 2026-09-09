import { db } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import { RECON_CASE_TYPES, type ReconCaseType } from '@novera/domain'

/**
 * RECONCILIATION — first-class operations domain.
 *
 * Compares the Novera ledger/payments against the providers' own
 * statements (ProviderTransaction). Discrepancies become cases in the
 * operations queue. Nothing is auto-repaired silently — every resolution
 * is an explicit operator action with an audit record.
 *
 * Case types are drawn from RECON_CASE_TYPES (@novera/domain) — the
 * canonical vocabulary. The scan never writes a type outside it.
 */

export interface ReconScanSummary {
  compared: number
  matched: number
  discrepancies: number
  newCases: number
  types: Partial<Record<ReconCaseType, number>>
}

export async function runReconciliationScan(organizationId: string): Promise<ReconScanSummary> {
  const payments = await db.payment.findMany({
    where: { organizationId },
    include: { providerTransactions: true, provider: true },
  })

  const summary: ReconScanSummary = { compared: 0, matched: 0, discrepancies: 0, newCases: 0, types: {} }
  const existingCases = await db.reconciliationCase.findMany({
    where: { organizationId, status: { in: ['OPEN', 'INVESTIGATING'] } },
    select: { paymentId: true, type: true, providerTransactionId: true },
  })
  const caseKey = (p: string | null, t: string, pt: string | null) => `${p ?? '-'}|${t}|${pt ?? '-'}`.toLowerCase()
  const existing = new Set(existingCases.map((c) => caseKey(c.paymentId, c.type, c.providerTransactionId)))

  for (const payment of payments) {
    if (payment.status === 'CREATED' || payment.status === 'CANCELLED') continue
    summary.compared++

    const providerTxns = payment.providerTransactions
    if (providerTxns.length === 0) {
      if (payment.status === 'SETTLED') {
        // ledger claims settlement but provider statement has nothing
        const type = 'MISSING_AT_PROVIDER'
        summary.discrepancies++
        summary.types[type] = (summary.types[type] ?? 0) + 1
        if (!existing.has(caseKey(payment.id, type, null))) {
          await createCase(organizationId, payment.id, null, payment.providerId, type, {
            ledger: { reference: payment.reference, status: payment.status, amountMinor: payment.amountMinor.toString() },
            provider: null,
          }, 'HIGH')
          summary.newCases++
        }
      }
      continue
    }

    // duplicate provider statements for one payment
    if (providerTxns.length > 1) {
      const type: ReconCaseType = 'DUPLICATE'
      summary.discrepancies++
      summary.types[type] = (summary.types[type] ?? 0) + 1
      for (const pt of providerTxns.slice(1)) {
        if (!existing.has(caseKey(payment.id, type, pt.id))) {
          await createCase(organizationId, payment.id, pt.id, pt.providerId, type, {
            ledger: { reference: payment.reference },
            provider: { externalReference: pt.externalReference, note: 'duplicate provider statement' },
          }, 'MEDIUM')
          summary.newCases++
        }
      }
    }

    const pt = providerTxns[0]
    const diffs: { type: ReconCaseType; detail: unknown; severity: string }[] = []

    if (pt.amountMinor !== payment.amountMinor) {
      diffs.push({
        type: 'AMOUNT_MISMATCH',
        severity: 'CRITICAL',
        detail: {
          ledger: { amountMinor: payment.amountMinor.toString() },
          provider: { amountMinor: pt.amountMinor.toString(), externalReference: pt.externalReference },
        },
      })
    }
    if (pt.currency !== payment.currency) {
      diffs.push({
        type: 'CURRENCY_MISMATCH',
        severity: 'CRITICAL',
        detail: {
          ledger: { currency: payment.currency },
          provider: { currency: pt.currency, externalReference: pt.externalReference },
        },
      })
    }
    const providerSettled = pt.status === 'SETTLED'
    const ledgerSettled = payment.status === 'SETTLED'
    if (providerSettled !== ledgerSettled) {
      diffs.push({
        type: 'STATUS_MISMATCH',
        severity: 'HIGH',
        detail: {
          ledger: { status: payment.status },
          provider: { status: pt.status, externalReference: pt.externalReference },
        },
      })
    }
    if (providerSettled && ledgerSettled && pt.settledAt && payment.settledAt &&
        pt.settledAt.getTime() - payment.settledAt.getTime() > 24 * 3600 * 1000) {
      diffs.push({
        type: 'LATE_SETTLEMENT',
        severity: 'LOW',
        detail: {
          ledger: { settledAt: payment.settledAt.toISOString() },
          provider: { settledAt: pt.settledAt.toISOString(), externalReference: pt.externalReference },
        },
      })
    }

    if (diffs.length === 0) {
      summary.matched++
      if (pt.reconciliationStatus !== 'MATCHED' && pt.reconciliationStatus !== 'RESOLVED') {
        await db.providerTransaction.update({ where: { id: pt.id }, data: { reconciliationStatus: 'MATCHED' } })
      }
      continue
    }

    for (const d of diffs) {
      summary.discrepancies++
      summary.types[d.type] = (summary.types[d.type] ?? 0) + 1
      if (!existing.has(caseKey(payment.id, d.type, pt.id))) {
        await createCase(organizationId, payment.id, pt.id, pt.providerId, d.type, d.detail, d.severity)
        summary.newCases++
      }
      if (pt.reconciliationStatus === 'UNMATCHED') {
        await db.providerTransaction.update({ where: { id: pt.id }, data: { reconciliationStatus: 'DISCREPANCY', discrepancyType: d.type } })
      }
    }
  }

  // provider statements referencing unknown payments. ProviderTransaction
  // rows carry no organizationId (rail providers are global), so the org
  // scope is DERIVED: only statements from providers this organization
  // actually transacts with can be attributed to it — a scan for org A
  // must not sweep org B's orphan statements off the same rail into A's
  // operations queue.
  const orgProviders = await db.payment.findMany({
    where: { organizationId, providerId: { not: null } },
    select: { providerId: true },
    distinct: ['providerId'],
  })
  const orgProviderIds = orgProviders.map((p) => p.providerId!)
  const orphans = await db.providerTransaction.findMany({
    where: { paymentId: null, reconciliationStatus: 'UNMATCHED', providerId: { in: orgProviderIds } },
    take: 50,
  })
  for (const pt of orphans) {
    summary.discrepancies++
    summary.types['UNKNOWN_REFERENCE'] = (summary.types['UNKNOWN_REFERENCE'] ?? 0) + 1
    if (!existing.has(caseKey(null, 'UNKNOWN_REFERENCE', pt.id))) {
      await createCase(organizationId, null, pt.id, pt.providerId, 'UNKNOWN_REFERENCE', {
        provider: { externalReference: pt.externalReference, amountMinor: pt.amountMinor.toString(), currency: pt.currency },
        ledger: null,
      }, 'HIGH')
      summary.newCases++
    }
  }

  await recordAudit({
    organizationId,
    actorType: 'SYSTEM',
    action: 'reconciliation.scan',
    resourceType: 'ReconciliationCase',
    description: `Reconciliation scan: ${summary.compared} compared, ${summary.matched} matched, ${summary.discrepancies} discrepancies (${summary.newCases} new cases)`,
    severity: summary.discrepancies > 0 ? 'WARN' : 'INFO',
    metadata: { ...summary },
  })

  return summary
}

async function createCase(
  organizationId: string,
  paymentId: string | null,
  providerTransactionId: string | null,
  providerId: string | null,
  type: ReconCaseType,
  detail: unknown,
  severity: string
) {
  // Belt-and-braces: the type signature already restricts callers to
  // RECON_CASE_TYPES members; a runtime guard keeps any future bypass
  // (the old `'DUPLICATE' as never` pattern) from silently writing an
  // off-vocabulary case type into the operations queue.
  if (!RECON_CASE_TYPES.includes(type)) {
    throw new Error(`invalid recon case type: ${type}`)
  }
  await db.reconciliationCase.create({
    data: {
      organizationId,
      paymentId,
      providerTransactionId,
      providerId: providerId ?? 'unknown',
      type,
      detail: JSON.stringify(detail),
      severity,
      status: 'OPEN',
    },
  })
}

export async function resolveCase(
  organizationId: string,
  caseId: string,
  resolution: 'RESOLVED' | 'DISMISSED',
  note: string,
  actor: { id: string; name: string }
) {
  const c = await db.reconciliationCase.findFirst({ where: { id: caseId, organizationId } })
  if (!c) throw new Error('case not found')
  if (c.status === 'RESOLVED' || c.status === 'DISMISSED') throw new Error('case already closed')

  await db.reconciliationCase.update({
    where: { id: caseId },
    data: {
      status: resolution,
      resolutionNote: note,
      resolvedBy: actor.name,
      resolvedAt: new Date(),
    },
  })
  if (c.providerTransactionId) {
    await db.providerTransaction.update({
      where: { id: c.providerTransactionId },
      data: { reconciliationStatus: 'RESOLVED', resolution: JSON.stringify({ by: actor.name, note, at: new Date().toISOString() }) },
    })
  }
  await recordAudit({
    organizationId,
    actorType: 'USER',
    actorId: actor.id,
    actorLabel: actor.name,
    action: 'reconciliation.case.resolved',
    resourceType: 'ReconciliationCase',
    resourceId: caseId,
    description: `Case ${c.type} ${resolution.toLowerCase()}: ${note}`,
    severity: 'WARN',
  })
}
