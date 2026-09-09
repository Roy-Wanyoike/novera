/**
 * RECON — case-type vocabulary + orphan org-scoping invariant tests
 * (database-backed, minimal fixtures).
 *
 * Every case the scan writes must come from the canonical RECON_CASE_TYPES
 * vocabulary (@novera/domain) — the old code smuggled 'DUPLICATE' past the
 * type system with `as never`. Orphan provider statements are org-scoped:
 * only statements from providers the organization actually transacts with
 * may become its cases.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { runReconciliationScan, resolveCase } from '@/lib/recon'
import { RECON_CASE_TYPES } from '@novera/domain'
import { createTestOrg, resetDb, seedTestProvider } from './db-utils'

let org: { id: string; slug: string }
let providerId: string

beforeEach(async () => {
  await resetDb()
  org = await createTestOrg('Recon Invariants')
  await seedTestProvider('MPESA_V1')
  providerId = (await db.railProvider.findUniqueOrThrow({ where: { code: 'MPESA_V1' } })).id
})

async function seedProvider(code: string): Promise<string> {
  await seedTestProvider(code)
  return (await db.railProvider.findUniqueOrThrow({ where: { code } })).id
}

async function createSettledPayment(
  organizationId: string,
  pid: string,
  amountMinor: bigint,
  reference: string
) {
  return db.payment.create({
    data: {
      organizationId,
      reference,
      amountMinor,
      currency: 'KES',
      method: 'MPESA',
      status: 'SETTLED',
      providerId: pid,
      settledAt: new Date(),
    },
  })
}

async function createStatement(opts: {
  providerId: string
  paymentId?: string | null
  externalReference: string
  amountMinor?: bigint
}) {
  return db.providerTransaction.create({
    data: {
      providerId: opts.providerId,
      paymentId: opts.paymentId ?? null,
      externalReference: opts.externalReference,
      amountMinor: opts.amountMinor ?? 250_000n,
      currency: 'KES',
      status: 'SETTLED',
      settledAt: new Date(),
    },
  })
}

describe('recon · case types stay inside the canonical vocabulary', () => {
  it('duplicate provider statements file a DUPLICATE case from RECON_CASE_TYPES', async () => {
    const payment = await createSettledPayment(org.id, providerId, 250_000n, 'pay_recon_dup')
    await createStatement({ providerId, paymentId: payment.id, externalReference: 'ptx_recon_dup_1' })
    await createStatement({ providerId, paymentId: payment.id, externalReference: 'ptx_recon_dup_2' })

    const summary = await runReconciliationScan(org.id)

    expect(summary.types.DUPLICATE).toBe(1)
    const cases = await db.reconciliationCase.findMany({
      where: { organizationId: org.id, type: 'DUPLICATE' },
    })
    expect(cases.length).toBe(1)
    expect((RECON_CASE_TYPES as readonly string[]).includes(cases[0].type)).toBe(true)

    // every case the scan wrote is a valid vocabulary member
    const all = await db.reconciliationCase.findMany({ where: { organizationId: org.id } })
    for (const c of all) {
      expect((RECON_CASE_TYPES as readonly string[]).includes(c.type)).toBe(true)
    }
  })

  it('amount mismatches still file AMOUNT_MISMATCH and resolveCase closes them with an audit event', async () => {
    const payment = await createSettledPayment(org.id, providerId, 250_000n, 'pay_recon_resolve')
    await createStatement({
      providerId,
      paymentId: payment.id,
      externalReference: 'ptx_recon_resolve',
      amountMinor: 250_100n,
    })

    const summary = await runReconciliationScan(org.id)
    expect(summary.types.AMOUNT_MISMATCH).toBe(1)

    const c = await db.reconciliationCase.findFirstOrThrow({ where: { organizationId: org.id } })
    await resolveCase(org.id, c.id, 'RESOLVED', 'provider confirmed the fee', {
      id: 'user_ops_1',
      name: 'Ops Engineer',
    })
    const resolved = await db.reconciliationCase.findUniqueOrThrow({ where: { id: c.id } })
    expect(resolved.status).toBe('RESOLVED')
    expect(await db.auditEvent.count({ where: { action: 'reconciliation.case.resolved' } })).toBe(1)
  })
})

describe('recon · orphan statements are org-scoped', () => {
  it('an orphan statement from a provider the org uses becomes the org’s UNKNOWN_REFERENCE case', async () => {
    const payment = await createSettledPayment(org.id, providerId, 250_000n, 'pay_recon_mine')
    await createStatement({ providerId, paymentId: payment.id, externalReference: 'ptx_recon_mine' })
    await createStatement({ providerId, paymentId: null, externalReference: 'ptx_own_orphan' })

    const summary = await runReconciliationScan(org.id)
    expect(summary.types.UNKNOWN_REFERENCE).toBe(1)
    expect(
      await db.reconciliationCase.count({
        where: { organizationId: org.id, type: 'UNKNOWN_REFERENCE' },
      })
    ).toBe(1)
  })

  it('an orphan statement from a provider the org never used is not attributed to it', async () => {
    // org has activity only on its own provider
    const payment = await createSettledPayment(org.id, providerId, 250_000n, 'pay_recon_scope')
    await createStatement({ providerId, paymentId: payment.id, externalReference: 'ptx_recon_scope' })

    // a DIFFERENT provider (another org's rail) has an orphan statement
    const otherProviderId = await seedProvider('MPESA_V2')
    await createStatement({ providerId: otherProviderId, paymentId: null, externalReference: 'ptx_foreign_orphan' })

    const summary = await runReconciliationScan(org.id)
    expect(summary.types.UNKNOWN_REFERENCE ?? 0).toBe(0)
    expect(await db.reconciliationCase.count({ where: { organizationId: org.id } })).toBe(0)
  })
})
