/**
 * HOLDS — expiry transition invariant tests (database-backed).
 *
 * availableBalanceMinor's expiresAt filter is AUTHORITATIVE for money
 * semantics — a past-due ACTIVE hold never reserves funds. expireHolds()
 * reconciles the STATUS column (single updateMany) so status-only reads
 * (dashboards, hold counts) agree with that filter instead of inflating
 * reserved funds forever.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ensureChartOfAccounts, postTransaction, walletLedgerBalance } from '@/lib/ledger'
import { availableBalanceMinor, expireHolds } from '@/lib/transfers'
import { createTestOrg, createWallet, resetDb } from './db-utils'

let org: { id: string; slug: string }
let coa: Record<string, string>
let wallet: { walletId: string; accountId: string }

beforeEach(async () => {
  await resetDb()
  org = await createTestOrg('Holds Invariants')
  coa = await ensureChartOfAccounts(org.id)
  wallet = await createWallet(org.id, 'Operating', 'KES')
})

async function fund(amountMinor: bigint) {
  await postTransaction({
    organizationId: org.id,
    description: 'opening funds',
    source: 'ADJUSTMENT',
    idempotencyKey: `fund-holds:${amountMinor.toString()}`,
    entries: [
      { accountId: wallet.accountId, direction: 'DEBIT', amountMinor, currency: 'KES' },
      { accountId: coa['OPENING_EQUITY'], direction: 'CREDIT', amountMinor, currency: 'KES' },
    ],
  })
}

async function createHold(
  organizationId: string,
  walletId: string,
  reference: string,
  opts: { amountMinor?: bigint; status?: string; expiresAt?: Date | null } = {}
) {
  return db.hold.create({
    data: {
      organizationId,
      walletId,
      reference,
      amountMinor: opts.amountMinor ?? 100_000n,
      currency: 'KES',
      reason: 'hold fixture',
      status: opts.status ?? 'ACTIVE',
      expiresAt:
        opts.expiresAt === undefined ? new Date(Date.now() + 3600_000) : opts.expiresAt,
    },
  })
}

describe('holds · expireHolds transitions', () => {
  it('past-due ACTIVE holds become EXPIRED; future, open-ended and terminal holds are untouched', async () => {
    const pastDue = await createHold(org.id, wallet.walletId, 'hld_past_due', {
      expiresAt: new Date(Date.now() - 1000),
    })
    const future = await createHold(org.id, wallet.walletId, 'hld_future', {
      expiresAt: new Date(Date.now() + 3600_000),
    })
    const openEnded = await createHold(org.id, wallet.walletId, 'hld_open_ended', {
      expiresAt: null,
    })
    const capturedPastDue = await createHold(org.id, wallet.walletId, 'hld_captured', {
      status: 'CAPTURED',
      expiresAt: new Date(Date.now() - 1000),
    })
    const releasedPastDue = await createHold(org.id, wallet.walletId, 'hld_released', {
      status: 'RELEASED',
      expiresAt: new Date(Date.now() - 1000),
    })

    expect(await expireHolds(org.id)).toBe(1)

    expect((await db.hold.findUniqueOrThrow({ where: { id: pastDue.id } })).status).toBe('EXPIRED')
    expect((await db.hold.findUniqueOrThrow({ where: { id: future.id } })).status).toBe('ACTIVE')
    expect((await db.hold.findUniqueOrThrow({ where: { id: openEnded.id } })).status).toBe('ACTIVE')
    expect((await db.hold.findUniqueOrThrow({ where: { id: capturedPastDue.id } })).status).toBe('CAPTURED')
    expect((await db.hold.findUniqueOrThrow({ where: { id: releasedPastDue.id } })).status).toBe('RELEASED')
  })

  it('a batch that transitions holds emits exactly one hold.batch.expired audit event carrying the count', async () => {
    await createHold(org.id, wallet.walletId, 'hld_audit_1', { expiresAt: new Date(Date.now() - 1000) })
    await createHold(org.id, wallet.walletId, 'hld_audit_2', { expiresAt: new Date(Date.now() - 1000) })

    expect(await expireHolds(org.id)).toBe(2)

    const events = await db.auditEvent.findMany({ where: { action: 'hold.batch.expired' } })
    expect(events.length).toBe(1)
    expect(JSON.parse(events[0].metadata!)).toEqual({ count: 2 })
    expect(events[0].organizationId).toBe(org.id)
  })

  it('a no-op batch (nothing past due) writes no audit event', async () => {
    await createHold(org.id, wallet.walletId, 'hld_alive', {
      expiresAt: new Date(Date.now() + 3600_000),
    })
    expect(await expireHolds(org.id)).toBe(0)
    expect(await db.auditEvent.count({ where: { action: 'hold.batch.expired' } })).toBe(0)
  })

  it('org-scoped expiry never touches another organization’s holds; the unscoped call sweeps all orgs', async () => {
    const foreign = await createTestOrg('Foreign Holds Org')
    const foreignWallet = await createWallet(foreign.id, 'Foreign', 'KES')
    await createHold(org.id, wallet.walletId, 'hld_mine', { expiresAt: new Date(Date.now() - 1000) })
    await createHold(foreign.id, foreignWallet.walletId, 'hld_theirs', {
      expiresAt: new Date(Date.now() - 1000),
    })

    expect(await expireHolds(org.id)).toBe(1)
    expect((await db.hold.findUniqueOrThrow({ where: { reference: 'hld_theirs' } })).status).toBe('ACTIVE')

    expect(await expireHolds()).toBe(1)
    expect((await db.hold.findUniqueOrThrow({ where: { reference: 'hld_theirs' } })).status).toBe('EXPIRED')
  })
})

describe('holds · expiry status agrees with the money filter', () => {
  it('after expireHolds, status-only counts match the authoritative available-balance filter', async () => {
    await fund(1_000_000n)
    await createHold(org.id, wallet.walletId, 'hld_stale', {
      amountMinor: 400_000n,
      expiresAt: new Date(Date.now() - 1000),
    })

    // money semantics were already correct — the filter ignores past-due holds
    expect(await walletLedgerBalance(wallet.walletId)).toBe(1_000_000n)
    expect(await availableBalanceMinor(wallet.walletId)).toBe(1_000_000n)
    // but the status-only read still counted the stale hold as reserved
    expect(await db.hold.count({ where: { walletId: wallet.walletId, status: 'ACTIVE' } })).toBe(1)

    await expireHolds(org.id)

    expect(await db.hold.count({ where: { walletId: wallet.walletId, status: 'ACTIVE' } })).toBe(0)
    // and the money math is unchanged — the filter was always authoritative
    expect(await availableBalanceMinor(wallet.walletId)).toBe(1_000_000n)
  })
})
