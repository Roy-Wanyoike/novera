/**
 * Seed helpers — create entities through the real kernel services,
 * then backdate non-financial timestamps so 90 days of history renders
 * naturally. Financial values (amounts, entries, balances) are NEVER
 * touched after creation — only timestamps and display metadata.
 */

import type { PrismaClient } from '@prisma/client'
import { db } from '../src/lib/db'
import { createPayment, refundPayment } from '../src/lib/payments'
import { authorizeCard } from '../src/lib/cards'
import { ref } from '../src/lib/ids'

type Db = PrismaClient

export async function createInvoiceBundle(
  db: Db,
  input: {
    organizationId: string
    customerId: string
    number: string
    status: string
    items: [string, number, number][] // [description, qty, unitMinor]
    issuedAt: Date | null
    dueAt: Date
    viewedAt: Date | null
    taxRate: number
  }
) {
  const lines = input.items.map(([description, quantity, unitMinor]) => ({
    description,
    quantity,
    unitMinor: BigInt(unitMinor),
    totalMinor: BigInt(unitMinor * quantity),
  }))
  const subtotalMinor = lines.reduce((a, l) => a + l.totalMinor, 0n)
  const taxMinor = (subtotalMinor * BigInt(Math.round(input.taxRate * 100))) / 100n
  const totalMinor = subtotalMinor + taxMinor
  const amountPaidMinor =
    input.status === 'PAID' ? totalMinor :
    input.status === 'PARTIALLY_PAID' ? totalMinor / 2n :
    0n

  const invoice = await db.invoice.create({
    data: {
      organizationId: input.organizationId,
      customerId: input.customerId,
      number: input.number,
      status: input.status,
      currency: 'KES',
      subtotalMinor,
      taxMinor,
      discountMinor: 0n,
      totalMinor,
      amountPaidMinor,
      dueAt: input.dueAt,
      issuedAt: input.issuedAt,
      viewedAt: input.viewedAt,
      paidAt: input.status === 'PAID' ? new Date(input.dueAt.getTime() - 3 * 86400000) : null,
      notes: 'Thank you for your business. Bank transfer / M-Pesa / card accepted.',
      createdAt: input.issuedAt ?? new Date(Date.now() - 86400000),
    },
  })
  for (const l of lines) {
    await db.invoiceItem.create({
      data: { invoiceId: invoice.id, description: l.description, quantity: l.quantity, unitMinor: l.unitMinor, totalMinor: l.totalMinor },
    })
  }
  return invoice
}

export async function createPaymentSeeded(input: {
  organizationId: string
  method: string
  amountMinor: bigint
  currency: string
  customer: { id: string; name: string; email: string | null; riskTier: string }
  createdAt: Date
  outcome: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'REFUND' | 'DISPUTE'
  invoiceId: string | null
  description: string
  idempotencySeed: string
}) {
  const forceOutcome = input.outcome === 'FAILURE' ? 'FAILURE' : input.outcome === 'PENDING' ? 'PENDING' : 'SUCCESS'
  let payment: Awaited<ReturnType<typeof createPayment>> | null = null
  try {
    payment = await createPayment({
      organizationId: input.organizationId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      method: input.method,
      customerId: input.customer.id,
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      description: input.description,
      invoiceId: input.invoiceId,
      idempotencyKey: input.idempotencySeed,
      forceOutcome,
      actor: { type: 'SYSTEM', label: 'Seed import' },
    })
  } catch (err) {
    // risk declines etc. produce a FAILED payment — acceptable variety
    console.warn(`   seed payment ${input.idempotencySeed} → ${(err as Error).message}`)
    return null
  }

  if (!payment) return null

  // post-lifecycle outcomes
  if (input.outcome === 'REFUND') {
    const refundAmount = input.amountMinor > 10000n ? input.amountMinor / 2n : input.amountMinor
    try {
      payment = await refundPayment(input.organizationId, payment.id, refundAmount, {
        type: 'SYSTEM', label: 'Seed import',
      })
    } catch { /* keep settled */ }
  }
  if (input.outcome === 'DISPUTE') {
    await db.payment.update({ where: { id: payment.id }, data: { status: 'DISPUTED' } }).catch(() => {})
  }

  await backdatePayment(db, payment.id, input.createdAt)
  return payment
}

/** Shift the non-financial timestamps of a payment's whole footprint. */
async function backdatePayment(db: Db, paymentId: string, createdAt: Date) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { ledgerTransaction: true, providerTransactions: true, riskEvaluations: true, webhookDeliveries: true },
  })
  if (!payment) return

  const delta = createdAt.getTime() - payment.createdAt.getTime()
  if (Math.abs(delta) < 60000) return

  // shift timeline JSON
  try {
    const timeline = payment.timeline ? JSON.parse(payment.timeline) : []
    for (const t of timeline) t.at = new Date(new Date(t.at).getTime() + delta).toISOString()
    await db.payment.update({
      where: { id: paymentId },
      data: {
        createdAt,
        settledAt: shift(payment.settledAt, delta),
        failedAt: shift(payment.failedAt, delta),
        timeline: JSON.stringify(timeline),
      },
    })
  } catch {
    await db.payment.update({ where: { id: paymentId }, data: { createdAt } })
  }

  if (payment.ledgerTransaction) {
    await db.ledgerTransaction.update({
      where: { id: payment.ledgerTransaction.id },
      data: { createdAt, effectiveAt: createdAt, postedAt: payment.ledgerTransaction.postedAt ? shift(payment.ledgerTransaction.postedAt, delta) : createdAt },
    }).catch(() => {})
    await db.ledgerEntry.updateMany({
      where: { transactionId: payment.ledgerTransaction.id },
      data: {},
    }).catch(() => {})
  }
  for (const pt of payment.providerTransactions) {
    await db.providerTransaction.update({
      where: { id: pt.id },
      data: { createdAt, settledAt: shift(pt.settledAt, delta) },
    }).catch(() => {})
  }
  for (const re of payment.riskEvaluations) {
    await db.riskEvaluation.update({ where: { id: re.id }, data: { createdAt } }).catch(() => {})
  }
  for (const wd of payment.webhookDeliveries) {
    await db.webhookDelivery.update({
      where: { id: wd.id },
      data: { createdAt, deliveredAt: shift(wd.deliveredAt, delta) },
    }).catch(() => {})
  }
  // split rule executions that reference this payment
  const execs = await db.splitRuleExecution.findMany({ where: { paymentId } })
  for (const ex of execs) {
    await db.splitRuleExecution.update({ where: { id: ex.id }, data: { createdAt } }).catch(() => {})
    if (ex.ledgerTransactionId) {
      await db.ledgerTransaction.update({
        where: { id: ex.ledgerTransactionId },
        data: { createdAt, effectiveAt: createdAt },
      }).catch(() => {})
    }
  }
}

function shift(d: Date | null, delta: number): Date | null {
  return d ? new Date(d.getTime() + delta) : null
}

export async function issueCard(
  db: Db,
  input: {
    organizationId: string
    label: string
    type: string
    currency: string
    holderName: string
    last4: string
    perTxn?: bigint
    daily?: bigint
    monthly?: bigint
    walletId: string
    mcc?: string
    allowInternational?: boolean
  }
) {
  const now = new Date()
  return db.card.create({
    data: {
      organizationId: input.organizationId,
      label: input.label,
      type: input.type,
      status: 'ACTIVE',
      brand: 'VISA',
      last4: input.last4,
      expiryMonth: 12,
      expiryYear: now.getFullYear() + 3,
      currency: input.currency,
      holderName: input.holderName,
      perTxnLimitMinor: input.perTxn ?? null,
      dailyLimitMinor: input.daily ?? null,
      monthlyLimitMinor: input.monthly ?? null,
      mccAllowlist: input.mcc ?? null,
      walletId: input.walletId,
      allowInternational: input.allowInternational ?? false,
      createdAt: new Date(now.getTime() - 45 * 86400000),
    },
  })
}

export async function authorizeCardSeeded(input: {
  cardId: string
  merchantName: string
  mcc: string
  amountMinor: bigint
  currency: string
  channel: 'ONLINE' | 'POS' | 'ATM' | 'CONTACTLESS'
  createdAt: Date
}) {
  const db = (await import('../src/lib/db')).db
  try {
    const result = await authorizeCard({
      cardId: input.cardId,
      merchantName: input.merchantName,
      mcc: input.mcc,
      amountMinor: input.amountMinor,
      currency: input.currency,
      channel: input.channel,
    })
    await db.cardAuthorization.update({
      where: { id: result.authId },
      data: { createdAt: input.createdAt },
    }).catch(() => {})
    return result
  } catch (err) {
    console.warn(`   card auth seed failed: ${(err as Error).message}`)
    return null
  }
}

/** Inject controlled discrepancies for the reconciliation operations queue. */
export async function injectReconAnomalies(db: Db, organizationId: string) {
  const settled = await db.payment.findMany({
    where: { organizationId, status: 'SETTLED' },
    include: { providerTransactions: true, provider: true },
    orderBy: { createdAt: 'asc' },
  })

  // 1. duplicate provider statement on a settled payment
  if (settled.length > 10) {
    const p = settled[10]
    await db.providerTransaction.create({
      data: {
        providerId: p.providerId!,
        paymentId: p.id,
        externalReference: ref.providerTxn('MPESA_V1'),
        amountMinor: p.amountMinor,
        currency: p.currency,
        status: 'SETTLED',
        settledAt: p.settledAt,
        rawPayload: JSON.stringify({ simulated: true, anomaly: 'duplicate statement', paymentRef: p.reference }),
      },
    })
  }

  // 2. amount mismatch: mutate a provider statement's amount
  if (settled.length > 20) {
    const p = settled[20]
    if (p.providerTransactions[0]) {
      await db.providerTransaction.update({
        where: { id: p.providerTransactions[0].id },
        data: {
          amountMinor: p.amountMinor + 2500n,
          rawPayload: JSON.stringify({ simulated: true, anomaly: 'amount mismatch', ledgerMinor: p.amountMinor.toString() }),
        },
      })
    }
  }

  // 3. missing at provider: remove the statement from a settled payment
  if (settled.length > 30) {
    const p = settled[30]
    if (p.providerTransactions[0]) {
      await db.providerTransaction.delete({ where: { id: p.providerTransactions[0].id } })
    }
  }

  // 4. orphan: provider statement with no matching payment
  await db.providerTransaction.create({
    data: {
      providerId: (await db.railProvider.findUnique({ where: { code: 'MPESA_V1' } }))!.id,
      paymentId: null,
      externalReference: ref.providerTxn('MPESA_V1'),
      amountMinor: 18_500n,
      currency: 'KES',
      status: 'SETTLED',
      settledAt: new Date(Date.now() - 2 * 86400000),
      rawPayload: JSON.stringify({ simulated: true, anomaly: 'unknown reference — no matching payment' }),
    },
  })
}
