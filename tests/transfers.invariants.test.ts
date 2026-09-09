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
