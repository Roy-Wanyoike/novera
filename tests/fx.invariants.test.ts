/**
 * FX — quote-binding and execution invariant tests (database-backed).
 *
 * A locked quote is a CONTRACT: rate + amount + expiry. Execution must
 * settle exactly the quoted source amount, atomically claim the quote
 * (one execution per quote), and prove available funds for the source
 * wallet inside the posting transaction — failures roll everything back
 * (the quote returns to QUOTED, nothing is posted).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ensureChartOfAccounts, postTransaction, trialBalance, walletLedgerBalance } from '@/lib/ledger'
import { convertMinor, createFxQuote, executeConversion } from '@/lib/fx'
import { createTestOrg, createWallet, resetDb } from './db-utils'

let org: { id: string; slug: string }
let coa: Record<string, string>
let kes: { walletId: string; accountId: string }
let usd: { walletId: string; accountId: string }

const ACTOR = { type: 'USER' as const, id: undefined, label: 'FX Invariants' }

beforeEach(async () => {
  await resetDb()
  org = await createTestOrg('FX Invariants')
  coa = await ensureChartOfAccounts(org.id)
  kes = await createWallet(org.id, 'KES Operating', 'KES')
  usd = await createWallet(org.id, 'USD Operating', 'USD')
})

async function fund(accountId: string, amountMinor: bigint, currency: string) {
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

const convert = (amountMinor: bigint, base: string, quote: string, rateScaled: bigint) =>
  convertMinor(amountMinor, base, rateScaled, quote)

describe('fx · quote is a contract (rate + amount + expiry persisted)', () => {
  it('createFxQuote persists the quoted source amount', async () => {
    const { quote } = await createFxQuote({
      organizationId: org.id,
      baseCurrency: 'KES',
      quoteCurrency: 'USD',
      amountMinor: 20_000_000n,
    })
    expect(quote.amountMinor).toBe(20_000_000n)
    expect(quote.baseCurrency).toBe('KES')
    expect(quote.quoteCurrency).toBe('USD')
    expect(quote.status).toBe('QUOTED')
  })
})

describe('fx · execution (quote-bound, guarded, atomic)', () => {
  it('executes the quoted amount: both legs posted, wallets move, quote EXECUTED', async () => {
    await fund(kes.accountId, 100_000_000n, 'KES')

    const { quote } = await createFxQuote({
      organizationId: org.id,
      baseCurrency: 'KES',
      quoteCurrency: 'USD',
      amountMinor: 20_000_000n,
    })

    const result = await executeConversion({
      organizationId: org.id,
      quoteId: quote.id,
      amountMinor: 20_000_000n,
      fromWalletId: kes.walletId,
      toWalletId: usd.walletId,
      actor: ACTOR,
    })

    const expectedUsd = convert(20_000_000n, 'KES', 'USD', quote.rateScaled)
    expect(result.target.minor).toBe(expectedUsd)
    expect(await walletLedgerBalance(kes.walletId)).toBe(80_000_000n)
    expect(await walletLedgerBalance(usd.walletId)).toBe(expectedUsd)

    // exactly two postings, both through the FX clearing account
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id, source: 'FX_CONVERSION' } })).toBe(2)
    expect((await trialBalance(org.id)).balanced).toBe(true)

    const after = await db.fxQuote.findUniqueOrThrow({ where: { id: quote.id } })
    expect(after.status).toBe('EXECUTED')
  })

  it('execution with a different amount than quoted is refused — nothing posted, quote intact', async () => {
    await fund(kes.accountId, 100_000_000n, 'KES')
    const { quote } = await createFxQuote({
      organizationId: org.id,
      baseCurrency: 'KES',
      quoteCurrency: 'USD',
      amountMinor: 50_000n,
    })

    await expect(
      executeConversion({
        organizationId: org.id,
        quoteId: quote.id,
        amountMinor: 60_000n, // NOT the quoted amount
        fromWalletId: kes.walletId,
        toWalletId: usd.walletId,
        actor: ACTOR,
      })
    ).rejects.toThrow(/quote amount mismatch/)

    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id } })).toBe(1) // funding only
    expect(await db.ledgerEntry.count()).toBe(2)
    expect((await db.fxQuote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('QUOTED')
    expect(await walletLedgerBalance(kes.walletId)).toBe(100_000_000n)
  })

  it('execution without sufficient source funds is refused — full rollback, quote returns to QUOTED', async () => {
    await fund(kes.accountId, 10_000n, 'KES') // far less than the quote
    const { quote } = await createFxQuote({
      organizationId: org.id,
      baseCurrency: 'KES',
      quoteCurrency: 'USD',
      amountMinor: 20_000_000n,
    })

    await expect(
      executeConversion({
        organizationId: org.id,
        quoteId: quote.id,
        amountMinor: 20_000_000n,
        fromWalletId: kes.walletId,
        toWalletId: usd.walletId,
        actor: ACTOR,
      })
    ).rejects.toThrow(/insufficient available funds/)

    // claim + postings all rolled back
    expect((await db.fxQuote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('QUOTED')
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id, source: 'FX_CONVERSION' } })).toBe(0)
    expect(await walletLedgerBalance(kes.walletId)).toBe(10_000n)
    expect(await walletLedgerBalance(usd.walletId)).toBe(0n)
  })

  it('a quote can only be executed once — second execution is refused', async () => {
    await fund(kes.accountId, 100_000_000n, 'KES')
    const { quote } = await createFxQuote({
      organizationId: org.id,
      baseCurrency: 'KES',
      quoteCurrency: 'USD',
      amountMinor: 20_000n,
    })
    await executeConversion({
      organizationId: org.id,
      quoteId: quote.id,
      amountMinor: 20_000n,
      fromWalletId: kes.walletId,
      toWalletId: usd.walletId,
      actor: ACTOR,
    })

    await expect(
      executeConversion({
        organizationId: org.id,
        quoteId: quote.id,
        amountMinor: 20_000n,
        fromWalletId: kes.walletId,
        toWalletId: usd.walletId,
        actor: ACTOR,
      })
    ).rejects.toThrow(/quote is/)

    // still exactly two FX postings
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id, source: 'FX_CONVERSION' } })).toBe(2)
  })

  it('wallets not matching the quote direction are refused', async () => {
    await fund(kes.accountId, 100_000_000n, 'KES')
    const { quote } = await createFxQuote({
      organizationId: org.id,
      baseCurrency: 'KES',
      quoteCurrency: 'USD',
      amountMinor: 10_000n,
    })
    // from wallet is USD — quote direction is KES → USD
    await expect(
      executeConversion({
        organizationId: org.id,
        quoteId: quote.id,
        amountMinor: 10_000n,
        fromWalletId: usd.walletId,
        toWalletId: kes.walletId,
        actor: ACTOR,
      })
    ).rejects.toThrow(/wallet currencies do not match/)
  })
})
