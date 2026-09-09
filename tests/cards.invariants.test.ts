/**
 * CARDS — authorization/capture invariant tests (database-backed).
 *
 * Authorization is funded: an auth against an empty (or hold-encumbered)
 * wallet is DECLINED, never "approved on hope". Capture re-checks the
 * wallet balance inside the posting transaction — a capture that would
 * drive the wallet asset negative throws CardError and posts nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ensureChartOfAccounts, postTransaction, walletLedgerBalance } from '@/lib/ledger'
import { CardError, authorizeCard, captureAuthorization } from '@/lib/cards'
import { createTestOrg, createWallet, resetDb } from './db-utils'

let org: { id: string; slug: string }
let coa: Record<string, string>
let wallet: { walletId: string; accountId: string }
let cardId: string

beforeEach(async () => {
  await resetDb()
  org = await createTestOrg('Cards Invariants')
  coa = await ensureChartOfAccounts(org.id)
  wallet = await createWallet(org.id, 'Operating', 'KES')
  const card = await db.card.create({
    data: {
      organizationId: org.id,
      label: 'Virtual card',
      type: 'VIRTUAL',
      last4: '4242',
      expiryMonth: 12,
      expiryYear: 2030,
      currency: 'KES',
      holderName: 'Card Invariants',
      perTxnLimitMinor: 100_000n,
      dailyLimitMinor: 1_000_000n,
      walletId: wallet.walletId,
    },
  })
  cardId = card.id
})

async function fund(amountMinor: bigint) {
  await postTransaction({
    organizationId: org.id,
    description: 'opening funds',
    source: 'ADJUSTMENT',
    idempotencyKey: `fund-cards:${amountMinor.toString()}`,
    entries: [
      { accountId: wallet.accountId, direction: 'DEBIT', amountMinor, currency: 'KES' },
      { accountId: coa['OPENING_EQUITY'], direction: 'CREDIT', amountMinor, currency: 'KES' },
    ],
  })
}

describe('cards · authorization is funded (no approving hope)', () => {
  it('auth against an empty wallet is DECLINED with an explicit funds reason', async () => {
    const result = await authorizeCard({
      cardId,
      merchantName: 'Naivas Supermarket',
      mcc: '5411',
      amountMinor: 50_000n,
      currency: 'KES',
      channel: 'POS',
    })
    expect(result.decision).toBe('DECLINED')
    expect(result.reason).toContain('insufficient available funds')
    // nothing reserved, nothing posted
    expect(await db.hold.count({ where: { walletId: wallet.walletId } })).toBe(0)
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id } })).toBe(0)
  })

  it('auth against a funded wallet APPROVES, holds, and captures in one phase', async () => {
    await fund(200_000n)
    const result = await authorizeCard({
      cardId,
      merchantName: 'Naivas Supermarket',
      mcc: '5411',
      amountMinor: 50_000n,
      currency: 'KES',
      channel: 'POS',
    })
    expect(result.decision).toBe('APPROVED')

    // capture posted: wallet asset down by the auth amount
    expect(await walletLedgerBalance(wallet.walletId)).toBe(150_000n)
    const auth = await db.cardAuthorization.findUniqueOrThrow({ where: { id: result.authId } })
    expect(auth.ledgerTransactionId).not.toBeNull()
    const txn = await db.ledgerTransaction.findUniqueOrThrow({
      where: { id: auth.ledgerTransactionId! },
    })
    expect(txn.source).toBe('CARD_AUTH')
    // the hold was consumed by the capture
    const hold = await db.hold.findUniqueOrThrow({ where: { reference: `cardauth_${auth.id}` } })
    expect(hold.status).toBe('CAPTURED')
  })
})

describe('cards · capture guard (fail-closed)', () => {
  it('capture exceeding wallet funds throws CardError and posts nothing — the hold survives', async () => {
    await fund(20_000n)
    // an approved auth for more than the wallet holds (created directly to
    // isolate the CAPTURE path from the auth-time funds check)
    const auth = await db.cardAuthorization.create({
      data: {
        cardId,
        merchantName: 'Big Purchase Ltd',
        mcc: '5411',
        amountMinor: 50_000n,
        currency: 'KES',
        channel: 'POS',
        decision: 'APPROVED',
      },
    })
    await db.hold.create({
      data: {
        organizationId: org.id,
        walletId: wallet.walletId,
        reference: `cardauth_${auth.id}`,
        amountMinor: 50_000n,
        currency: 'KES',
        reason: 'Card authorization Big Purchase Ltd',
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    })

    await expect(captureAuthorization(auth.id)).rejects.toThrow(CardError)
    await expect(captureAuthorization(auth.id)).rejects.toThrow(/insufficient wallet funds/)

    // nothing posted; the auth is not marked captured; the hold stays ACTIVE
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id, source: 'CARD_AUTH' } })).toBe(0)
    const unchanged = await db.cardAuthorization.findUniqueOrThrow({ where: { id: auth.id } })
    expect(unchanged.ledgerTransactionId).toBeNull()
    const hold = await db.hold.findUniqueOrThrow({ where: { reference: `cardauth_${auth.id}` } })
    expect(hold.status).toBe('ACTIVE')
    expect(await walletLedgerBalance(wallet.walletId)).toBe(20_000n)
  })

  it('capture succeeds once funds exist and is idempotent', async () => {
    await fund(200_000n)
    const auth = await db.cardAuthorization.create({
      data: {
        cardId,
        merchantName: 'Later Merchant',
        mcc: '5411',
        amountMinor: 50_000n,
        currency: 'KES',
        channel: 'POS',
        decision: 'APPROVED',
      },
    })
    await db.hold.create({
      data: {
        organizationId: org.id,
        walletId: wallet.walletId,
        reference: `cardauth_${auth.id}`,
        amountMinor: 50_000n,
        currency: 'KES',
        reason: 'Card authorization Later Merchant',
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    })

    const first = await captureAuthorization(auth.id)
    expect(first.posted).toBe(true)
    expect(await walletLedgerBalance(wallet.walletId)).toBe(150_000n)

    // second capture is a no-op (already captured)
    const second = await captureAuthorization(auth.id)
    expect(second.posted).toBe(false)
    expect(await walletLedgerBalance(wallet.walletId)).toBe(150_000n)
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id, source: 'CARD_AUTH' } })).toBe(1)
  })
})
