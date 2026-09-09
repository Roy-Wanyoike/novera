/**
 * PAYMENTS — money-movement invariant tests (database-backed).
 *
 * Runs against the dedicated SQLite test database (db/test.db). Verifies
 * the lifecycle contract end-to-end through the real kernel: risk → rail
 * → ledger → webhook fanout bookkeeping. A payment that is not SETTLED
 * never moves the wallet; refunds post compensating entries that keep the
 * trial balance exact.
 *
 * Deterministic: TEST rail providers are seeded explicitly (no outcome
 * randomness — forceOutcome pins the rail result).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { PaymentError, createPayment, refundPayment } from '@/lib/payments'
import { ensureChartOfAccounts, trialBalance, walletLedgerBalance } from '@/lib/ledger'
import { createTestOrg, createWallet, resetDb, seedTestProvider } from './db-utils'

let org: { id: string; slug: string }
let coa: Record<string, string>
let wallet: { walletId: string; accountId: string }

beforeEach(async () => {
  await resetDb()
  org = await createTestOrg('Payments Invariants')
  coa = await ensureChartOfAccounts(org.id)
  wallet = await createWallet(org.id, 'Operating', 'KES')
  // deterministic TEST rail: fee = 1.5% + KSh 1.00 fixed
  await seedTestProvider('MPESA_V1', { feeBps: 150, fixedFeeMinor: 100n })
})

const GROSS = 100_000n // KSh 1,000.00
const FEE = (GROSS * 150n) / 10_000n + 100n // 1_600n
const NET = GROSS - FEE // 98_400n

const settleFixture = async (idempotencyKey: string) => {
  const payment = await createPayment({
    organizationId: org.id,
    amountMinor: GROSS,
    currency: 'KES',
    method: 'MPESA',
    forceOutcome: 'SUCCESS',
    idempotencyKey,
    description: 'kernel invariant fixture',
  })
  if (!payment) throw new Error('fixture payment was not returned')
  return payment
}

describe('payments · settlement posts balanced entries and moves the wallet by net', () => {
  it('forceOutcome SUCCESS → SETTLED, ledger balanced, wallet +net, rail + risk recorded', async () => {
    const payment = await settleFixture('pay-inv-settle')
    expect(payment.status).toBe('SETTLED')
    expect(payment.settledAt).not.toBeNull()
    expect(payment.reference).toMatch(/^pay_/)
    expect(payment.feeMinor).toBe(FEE)
    expect(payment.ledgerTransactionId).not.toBeNull()

    // ── ledger leg: Dr wallet(net) + Dr fee expense(fee) / Cr sales(gross) ──
    const entries = await db.ledgerEntry.findMany({
      where: { transactionId: payment.ledgerTransactionId! },
    })
    expect(entries.length).toBe(3)
    const debitSum = entries.filter((e) => e.direction === 'DEBIT').reduce((a, e) => a + e.amountMinor, 0n)
    const creditSum = entries.filter((e) => e.direction === 'CREDIT').reduce((a, e) => a + e.amountMinor, 0n)
    expect(debitSum).toBe(GROSS)
    expect(creditSum).toBe(GROSS)
    expect(debitSum).toBe(creditSum) // Σ(dr) === Σ(cr)

    const walletLeg = entries.find((e) => e.accountId === wallet.accountId)
    expect(walletLeg?.direction).toBe('DEBIT')
    expect(walletLeg?.amountMinor).toBe(NET)
    const feeLeg = entries.find((e) => e.accountId === coa['FEE_EXPENSE'])
    expect(feeLeg?.direction).toBe('DEBIT')
    expect(feeLeg?.amountMinor).toBe(FEE)
    const salesLeg = entries.find((e) => e.accountId === coa['SALES'])
    expect(salesLeg?.direction).toBe('CREDIT')
    expect(salesLeg?.amountMinor).toBe(GROSS)

    // wallet increased by NET, derived from entries
    expect(await walletLedgerBalance(wallet.walletId)).toBe(NET)

    // the rail recorded its own statement (reconciliation source of truth)
    const providerTxns = await db.providerTransaction.findMany({ where: { paymentId: payment.id } })
    expect(providerTxns.length).toBe(1)
    expect(providerTxns[0].status).toBe('SETTLED')
    expect(providerTxns[0].externalReference).toBe(payment.providerReference)
    expect(providerTxns[0].amountMinor).toBe(GROSS)

    // risk ran BEFORE the rail and was persisted
    expect(payment.riskDecision).toBe('ALLOW')
    const risk = await db.riskEvaluation.findFirst({ where: { paymentId: payment.id } })
    expect(risk?.decision).toBe('ALLOW')

    // timeline tells the full story including settlement
    const timeline = JSON.parse(payment.timeline ?? '[]') as { event: string }[]
    expect(timeline.map((t) => t.event)).toContain('settled')

    // no webhook endpoints configured → zero deliveries, no crash
    expect(await db.webhookDelivery.count({ where: { organizationId: org.id } })).toBe(0)

    // trial balance holds after settlement
    expect((await trialBalance(org.id)).balanced).toBe(true)
  })
})

describe('payments · honesty (a payment that is not SETTLED moves nothing)', () => {
  it('forceOutcome FAILURE → FAILED, no ledger transaction, wallet untouched', async () => {
    const payment = await createPayment({
      organizationId: org.id,
      amountMinor: GROSS,
      currency: 'KES',
      method: 'MPESA',
      forceOutcome: 'FAILURE',
      idempotencyKey: 'pay-inv-fail',
    })
    expect(payment?.status).toBe('FAILED')
    expect(payment?.failureReason).not.toBeNull()
    expect(payment?.ledgerTransactionId).toBeNull()
    expect(await walletLedgerBalance(wallet.walletId)).toBe(0n)
    expect((await trialBalance(org.id)).balanced).toBe(true)

    // the rail still reported its failure — recon can compare both sides
    const providerTxn = await db.providerTransaction.findFirst({ where: { paymentId: payment!.id } })
    expect(providerTxn?.status).toBe('FAILED')
  })

  it('forceOutcome PENDING → PENDING (held for review), no ledger transaction', async () => {
    const payment = await createPayment({
      organizationId: org.id,
      amountMinor: GROSS,
      currency: 'KES',
      method: 'MPESA',
      forceOutcome: 'PENDING',
      idempotencyKey: 'pay-inv-pending',
    })
    expect(payment?.status).toBe('PENDING')
    expect(payment?.ledgerTransactionId).toBeNull()
    expect(await walletLedgerBalance(wallet.walletId)).toBe(0n)
  })
})

describe('payments · idempotency (replays never double-charge)', () => {
  it('same idempotencyKey → exactly one payment, one rail dispatch, one ledger posting', async () => {
    const first = await settleFixture('pay-inv-idem')
    expect(first.status).toBe('SETTLED')
    const walletAfterFirst = await walletLedgerBalance(wallet.walletId)
    const entriesAfterFirst = await db.ledgerEntry.count({
      where: { transactionId: first.ledgerTransactionId! },
    })

    // replay the same intent (same key) with a different payload
    const replay = await createPayment({
      organizationId: org.id,
      amountMinor: GROSS * 10n,
      currency: 'KES',
      method: 'MPESA',
      forceOutcome: 'SUCCESS',
      idempotencyKey: 'pay-inv-idem',
    })

    expect(replay?.id).toBe(first.id)
    expect(replay?.reference).toBe(first.reference)
    expect(replay?.amountMinor).toBe(GROSS) // original amount, not 10×

    expect(await db.payment.count({ where: { idempotencyKey: 'pay-inv-idem' } })).toBe(1)
    expect(await db.payment.count({ where: { organizationId: org.id } })).toBe(1)
    // the rail was NOT dispatched a second time
    expect(await db.providerTransaction.count({ where: { paymentId: first.id } })).toBe(1)
    // the ledger was NOT posted a second time
    expect(
      await db.ledgerEntry.count({ where: { transactionId: first.ledgerTransactionId! } })
    ).toBe(entriesAfterFirst)
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id } })).toBe(1)
    // wallet unchanged by the replay
    expect(await walletLedgerBalance(wallet.walletId)).toBe(walletAfterFirst)
  })
})

describe('payments · refunds (compensating entries, balance always exact)', () => {
  it('partial refund reduces the wallet by amount−feeShare and keeps the trial balance balanced', async () => {
    const payment = await settleFixture('pay-inv-refund')
    expect(await walletLedgerBalance(wallet.walletId)).toBe(NET) // 98_400

    const REFUND = 40_000n
    // kernel formula: feeShare = fee × refund / gross (integer division)
    const FEE_SHARE = (FEE * REFUND) / GROSS // 640n
    const WALLET_LEG = REFUND - FEE_SHARE // 39_360n

    const partial = await refundPayment(org.id, payment.id, REFUND)
    expect(partial.status).toBe('SETTLED') // still settled (partial refund)
    expect(partial.refundedMinor).toBe(REFUND)

    // wallet reduced by exactly the refund's wallet leg
    expect(await walletLedgerBalance(wallet.walletId)).toBe(NET - WALLET_LEG)

    // refund posted a balanced compensating transaction:
    // Dr SALES(refund) / Cr wallet(net part) / Cr FEE_EXPENSE(fee share)
    const refundTxn = await db.ledgerTransaction.findFirst({
      where: { idempotencyKey: `refund:${payment.id}:${REFUND.toString()}` },
      include: { entries: true },
    })
    expect(refundTxn).not.toBeNull()
    const debitSum = refundTxn!.entries.filter((e) => e.direction === 'DEBIT').reduce((a, e) => a + e.amountMinor, 0n)
    const creditSum = refundTxn!.entries.filter((e) => e.direction === 'CREDIT').reduce((a, e) => a + e.amountMinor, 0n)
    expect(debitSum).toBe(REFUND)
    expect(creditSum).toBe(REFUND)
    expect(refundTxn!.entries.find((e) => e.accountId === coa['SALES'])?.direction).toBe('DEBIT')
    expect(refundTxn!.entries.find((e) => e.accountId === wallet.accountId)?.amountMinor).toBe(WALLET_LEG)
    expect(refundTxn!.entries.find((e) => e.accountId === coa['FEE_EXPENSE'])?.amountMinor).toBe(FEE_SHARE)

    expect((await trialBalance(org.id)).balanced).toBe(true)
  })

  it('full refund returns the wallet to its pre-payment state and flags REFUNDED', async () => {
    const payment = await settleFixture('pay-inv-full-refund')

    await refundPayment(org.id, payment.id, 40_000n) // partial first
    const final = await refundPayment(org.id, payment.id, 60_000n) // then the rest

    expect(final.status).toBe('REFUNDED')
    expect(final.refundedMinor).toBe(GROSS)
    // net wallet effect of the whole lifecycle is exactly zero
    expect(await walletLedgerBalance(wallet.walletId)).toBe(0n)
    expect((await trialBalance(org.id)).balanced).toBe(true)
  })

  it('rejects invalid refunds (over-refund, zero, non-settled payment)', async () => {
    const settled = await settleFixture('pay-inv-badrefund')
    await expect(refundPayment(org.id, settled.id, GROSS + 1n)).rejects.toThrow(PaymentError)
    await expect(refundPayment(org.id, settled.id, 0n)).rejects.toThrow(/refund amount invalid/)

    const failed = await createPayment({
      organizationId: org.id,
      amountMinor: GROSS,
      currency: 'KES',
      method: 'MPESA',
      forceOutcome: 'FAILURE',
      idempotencyKey: 'pay-inv-failed-refund',
    })
    await expect(refundPayment(org.id, failed!.id, 1n)).rejects.toThrow(
      /only settled payments can be refunded/
    )
    // cross-org refund is refused
    const otherOrg = await createTestOrg('Other Org')
    await expect(refundPayment(otherOrg.id, settled.id, 1n)).rejects.toThrow(/payment not found/)
  })
})
