/**
 * TRANSFERS — internal wallet-to-wallet invariant tests (database-backed).
 *
 * The transfer kernel's core promise: the available-balance check and the
 * posting run in ONE transaction (the read goes through the transaction
 * client), so a wallet can never be drained below zero by sequential or
 * racing transfers, and ACTIVE holds always reduce spendable funds.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ensureChartOfAccounts, postTransaction, trialBalance, walletLedgerBalance } from '@/lib/ledger'
import { TransferError, availableBalanceMinor, executeTransfer } from '@/lib/transfers'
import { createTestOrg, createWallet, resetDb } from './db-utils'

let org: { id: string; slug: string }
let coa: Record<string, string>
let from: { walletId: string; accountId: string }
let to: { walletId: string; accountId: string }
let usd: { walletId: string; accountId: string }

const ACTOR = { type: 'USER' as const, id: undefined, label: 'Transfer Invariants' }

beforeEach(async () => {
  await resetDb()
  org = await createTestOrg('Transfers Invariants')
  coa = await ensureChartOfAccounts(org.id)
  from = await createWallet(org.id, 'Source', 'KES')
  to = await createWallet(org.id, 'Destination', 'KES')
  usd = await createWallet(org.id, 'USD Operating', 'USD')
})

/** Fund a wallet through the kernel (Dr wallet asset / Cr opening equity). */
async function fund(accountId: string, amountMinor: bigint, currency = 'KES') {
  await postTransaction({
    organizationId: org.id,
    description: 'opening funds',
    source: 'ADJUSTMENT',
    idempotencyKey: `fund:${accountId}:${amountMinor.toString()}`,
    entries: [
      { accountId, direction: 'DEBIT', amountMinor, currency },
      { accountId: coa['OPENING_EQUITY'], direction: 'CREDIT', amountMinor, currency },
    ],
  })
}

describe('transfers · happy path', () => {
  it('moves money between wallets with balanced entries and a derivable trail', async () => {
    await fund(from.accountId, 1_000_000n)

    const { txn } = await executeTransfer({
      organizationId: org.id,
      fromWalletId: from.walletId,
      toWalletId: to.walletId,
      amountMinor: 400_000n,
      currency: 'KES',
      actor: ACTOR,
    })

    expect(txn.reference).toMatch(/^ltx_/)
    expect(await walletLedgerBalance(from.walletId)).toBe(600_000n)
    expect(await walletLedgerBalance(to.walletId)).toBe(400_000n)
    expect((await trialBalance(org.id)).balanced).toBe(true)

    // the posting is tagged as a TRANSFER with both wallets in metadata
    const row = await db.ledgerTransaction.findUniqueOrThrow({ where: { id: txn.id } })
    expect(row.source).toBe('TRANSFER')
  })
})

describe('transfers · balance guard (fail-closed, in-transaction)', () => {
  it('sequential double-spend: two transfers totalling more than the balance → second throws, ledger untouched', async () => {
    await fund(from.accountId, 1_000_000n)

    const first = await executeTransfer({
      organizationId: org.id,
      fromWalletId: from.walletId,
      toWalletId: to.walletId,
      amountMinor: 600_000n,
      currency: 'KES',
      actor: ACTOR,
    })
    expect(first.txn.status).toBe('POSTED')

    const txnsBefore = await db.ledgerTransaction.count({ where: { organizationId: org.id } })
    const entriesBefore = await db.ledgerEntry.count()

    await expect(
      executeTransfer({
        organizationId: org.id,
        fromWalletId: from.walletId,
        toWalletId: to.walletId,
        amountMinor: 600_000n, // 400_000 left — this must fail
        currency: 'KES',
        actor: ACTOR,
      })
    ).rejects.toThrow(TransferError)

    // nothing was posted by the failed attempt
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id } })).toBe(txnsBefore)
    expect(await db.ledgerEntry.count()).toBe(entriesBefore)
    expect(await walletLedgerBalance(from.walletId)).toBe(400_000n)
    expect(await walletLedgerBalance(to.walletId)).toBe(600_000n)
  })

  it('transfer exceeding the balance from the start → throws, nothing posted', async () => {
    await expect(
      executeTransfer({
        organizationId: org.id,
        fromWalletId: from.walletId,
        toWalletId: to.walletId,
        amountMinor: 1n,
        currency: 'KES',
        actor: ACTOR,
      })
    ).rejects.toThrow(/insufficient available funds/)

    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id } })).toBe(0)
    expect(await db.ledgerEntry.count()).toBe(0)
  })

  it('ACTIVE holds reduce available funds — a transfer that ignores holds is refused', async () => {
    await fund(from.accountId, 1_000_000n)
    await db.hold.create({
      data: {
        organizationId: org.id,
        walletId: from.walletId,
        reference: 'hld_test_hold_1',
        amountMinor: 400_000n,
        currency: 'KES',
        reason: 'test hold',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    // ledger 1_000_000, holds 400_000 → available 600_000
    expect(await availableBalanceMinor(from.walletId)).toBe(600_000n)

    await expect(
      executeTransfer({
        organizationId: org.id,
        fromWalletId: from.walletId,
        toWalletId: to.walletId,
        amountMinor: 600_001n,
        currency: 'KES',
        actor: ACTOR,
      })
    ).rejects.toThrow(/insufficient available funds/)

    // 600_000 still fits
    const ok = await executeTransfer({
      organizationId: org.id,
      fromWalletId: from.walletId,
      toWalletId: to.walletId,
      amountMinor: 600_000n,
      currency: 'KES',
      actor: ACTOR,
    })
    expect(ok.txn.status).toBe('POSTED')
  })
})

describe('transfers · idempotency keys', () => {
  it('same key + same input twice → ONE posting: the replay returns the original with zero new side effects', async () => {
    await fund(from.accountId, 1_000_000n)
    const input = {
      organizationId: org.id,
      fromWalletId: from.walletId,
      toWalletId: to.walletId,
      amountMinor: 400_000n,
      currency: 'KES',
      actor: ACTOR,
      idempotencyKey: 'transfer-replay-1',
    }
    const first = await executeTransfer(input)
    expect(first.replayed).toBe(false)
    expect(first.risk).not.toBeNull()

    const second = await executeTransfer(input)
    expect(second.replayed).toBe(true)
    expect(second.txn.id).toBe(first.txn.id)
    expect(second.txn.reference).toBe(first.txn.reference)
    expect(second.risk).toBeNull() // no second risk evaluation

    // one posting, one pair of entries — money moved exactly once
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id, source: 'TRANSFER' } })).toBe(1)
    expect(await db.ledgerEntry.count()).toBe(4) // funding (2) + transfer (2)
    expect(await walletLedgerBalance(from.walletId)).toBe(600_000n)
    expect(await walletLedgerBalance(to.walletId)).toBe(400_000n)

    // one risk evaluation, one posting audit — the replay duplicated nothing
    expect(await db.riskEvaluation.count({ where: { subject: 'TRANSFER' } })).toBe(1)
    expect(await db.auditEvent.count({ where: { action: 'ledger.transaction.posted' } })).toBe(2)
  })

  it('a replay short-circuits BEFORE the balance guard — even after the wallet is drained', async () => {
    await fund(from.accountId, 1_000_000n)
    const base = {
      organizationId: org.id,
      fromWalletId: from.walletId,
      toWalletId: to.walletId,
      currency: 'KES',
      actor: ACTOR,
    }
    const first = await executeTransfer({ ...base, amountMinor: 600_000n, idempotencyKey: 'replay-before-guard' })
    // drain the remaining funds with a different key
    await executeTransfer({ ...base, amountMinor: 400_000n, idempotencyKey: 'drain-after' })

    // retry of the ORIGINAL submission: available is now 0 — the guard
    // would throw, but a replay must never be rejected by it
    const replay = await executeTransfer({ ...base, amountMinor: 600_000n, idempotencyKey: 'replay-before-guard' })
    expect(replay.replayed).toBe(true)
    expect(replay.txn.id).toBe(first.txn.id)
    expect(await walletLedgerBalance(to.walletId)).toBe(1_000_000n) // moved once, not twice
  })

  it('different keys → distinct postings', async () => {
    await fund(from.accountId, 1_000_000n)
    const base = {
      organizationId: org.id,
      fromWalletId: from.walletId,
      toWalletId: to.walletId,
      amountMinor: 100_000n,
      currency: 'KES',
      actor: ACTOR,
    }
    const a = await executeTransfer({ ...base, idempotencyKey: 'key-a' })
    const b = await executeTransfer({ ...base, idempotencyKey: 'key-b' })
    expect(a.txn.id).not.toBe(b.txn.id)
    expect(await walletLedgerBalance(from.walletId)).toBe(800_000n)
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id, source: 'TRANSFER' } })).toBe(2)
  })

  it('a key already used by another organization is refused, never replayed cross-tenant', async () => {
    await fund(from.accountId, 1_000_000n)
    const foreign = await createTestOrg('Foreign Idem Org')
    const foreignWallet = await createWallet(foreign.id, 'Foreign', 'KES')
    const foreignCoa = await ensureChartOfAccounts(foreign.id)
    await postTransaction({
      organizationId: foreign.id,
      description: 'foreign posting',
      source: 'TRANSFER',
      idempotencyKey: 'stolen-key',
      entries: [
        { accountId: foreignWallet.accountId, direction: 'DEBIT', amountMinor: 100n, currency: 'KES' },
        { accountId: foreignCoa['OPENING_EQUITY'], direction: 'CREDIT', amountMinor: 100n, currency: 'KES' },
      ],
    })

    await expect(
      executeTransfer({
        organizationId: org.id,
        fromWalletId: from.walletId,
        toWalletId: to.walletId,
        amountMinor: 100n,
        currency: 'KES',
        actor: ACTOR,
        idempotencyKey: 'stolen-key',
      })
    ).rejects.toThrow(/already in use/)

    // nothing was posted for this organization by the refused attempt
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id, source: 'TRANSFER' } })).toBe(0)
    expect(await walletLedgerBalance(from.walletId)).toBe(1_000_000n)
  })
})

describe('transfers · input guards', () => {
  it('rejects same-wallet, currency mismatch and zero amounts', async () => {
    await fund(from.accountId, 1_000_000n)
    await expect(
      executeTransfer({
        organizationId: org.id,
        fromWalletId: from.walletId,
        toWalletId: from.walletId,
        amountMinor: 100n,
        currency: 'KES',
        actor: ACTOR,
      })
    ).rejects.toThrow(/same wallet/)
    await expect(
      executeTransfer({
        organizationId: org.id,
        fromWalletId: from.walletId,
        toWalletId: usd.walletId,
        amountMinor: 100n,
        currency: 'KES',
        actor: ACTOR,
      })
    ).rejects.toThrow(/currency mismatch/)
    await expect(
      executeTransfer({
        organizationId: org.id,
        fromWalletId: from.walletId,
        toWalletId: to.walletId,
        amountMinor: 0n,
        currency: 'KES',
        actor: ACTOR,
      })
    ).rejects.toThrow(/positive/)
  })

  it('rejects wallets from another organization', async () => {
    await fund(from.accountId, 1_000_000n)
    const foreign = await createTestOrg('Foreign Transfer Org')
    const foreignWallet = await createWallet(foreign.id, 'Foreign', 'KES')
    await expect(
      executeTransfer({
        organizationId: org.id,
        fromWalletId: from.walletId,
        toWalletId: foreignWallet.walletId,
        amountMinor: 100n,
        currency: 'KES',
        actor: ACTOR,
      })
    ).rejects.toThrow(/not found in this organization/)
  })
})
