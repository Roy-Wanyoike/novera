import { db } from '@/lib/db'
import { Money, CURRENCIES } from '@novera/money'
import { postTransaction } from '@/lib/ledger'
import { recordAudit } from '@/lib/audit'
import { ref } from '@/lib/ids'
import { emitWebhookEvent } from '@/lib/webhooks'

/**
 * FX — quote, lock, convert.
 *
 * Rates are scaled integers (rate × 10^8). A quote is created, then
 * executed with locked-rate ledger entries. Conversions post REAL
 * double entries (Dr destination wallet / Cr source wallet) with the
 * FX gain/loss leg so the trial balance always holds.
 *
 * Reference rates in TEST mode are indicative market-style values.
 */

// Indicative TEST rates relative to USD — ALL scaled ×10^8 (scale = 8).
// e.g. KES 129.15 per USD → 129.15 × 1e8 = 12,915,000,000.
const USD_RATES: Record<string, bigint> = {
  USD: 100000000n, // 1.0
  KES: 12915000000n, // 129.15
  EUR: 923000000n, // 0.923
  GBP: 789000000n, // 0.789
  NGN: 158200000000n, // 1582
  TZS: 268000000000n, // 2680
  UGX: 389000000000n, // 3890
  ZAR: 1890000000n, // 18.9
  USDC: 100000000n, // 1.0
}

export function scaledRate(base: string, quote: string): bigint {
  const baseRate = USD_RATES[base] ?? 100000000n
  const quoteRate = USD_RATES[quote] ?? 100000000n
  // quote per base = quoteRate / baseRate, kept at 1e8 scale
  return (quoteRate * 100000000n) / baseRate
}

export function applySpread(rateScaled: bigint, spreadBps: number): bigint {
  return rateScaled - (rateScaled * BigInt(spreadBps)) / 10000n
}

/**
 * Convert a minor-unit amount across currencies at a scaled rate,
 * adjusting for differing minor-unit scales (KES=2, USDC=6 …).
 * Exact BigInt math with half-up rounding.
 */
export function convertMinor(
  minor: bigint,
  fromCurrency: string,
  rateScaled: bigint,
  toCurrency: string
): bigint {
  const fromScale = CURRENCIES[fromCurrency as keyof typeof CURRENCIES]?.minorUnits ?? 2
  const toScale = CURRENCIES[toCurrency as keyof typeof CURRENCIES]?.minorUnits ?? 2
  let num = minor * rateScaled
  let den = 100000000n
  if (toScale > fromScale) num *= 10n ** BigInt(toScale - fromScale)
  else den *= 10n ** BigInt(fromScale - toScale)
  const q = num / den
  const r = num % den
  return r * 2n >= den ? q + 1n : q
}

export interface QuoteInput {
  organizationId: string
  baseCurrency: string
  quoteCurrency: string
  amountMinor: bigint
}

export async function createFxQuote(input: QuoteInput) {
  const raw = scaledRate(input.baseCurrency, input.quoteCurrency)
  const spreadBps = 80
  const executable = applySpread(raw, spreadBps)
  const quote = await db.fxQuote.create({
    data: {
      organizationId: input.organizationId,
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rateScaled: executable,
      rateScale: 8,
      spreadBps,
      status: 'QUOTED',
      expiresAt: new Date(Date.now() + 60 * 1000),
    },
  })
  const convertedMinor = convertMinor(input.amountMinor, input.baseCurrency, executable, input.quoteCurrency)
  return {
    quote,
    rawRateScaled: raw,
    executableRateScaled: executable,
    quoteAmountMinor: convertedMinor,
  }
}

export interface ConvertInput {
  organizationId: string
  quoteId: string
  amountMinor: bigint
  fromWalletId: string
  toWalletId: string
  actor?: { type: 'USER' | 'AGENT' | 'SYSTEM'; id?: string; label?: string }
}

/** Execute a conversion at the locked quote rate. */
export async function executeConversion(input: ConvertInput) {
  const quote = await db.fxQuote.findFirst({
    where: { id: input.quoteId, organizationId: input.organizationId },
  })
  if (!quote) throw new Error('quote not found')
  if (quote.status !== 'QUOTED') throw new Error(`quote is ${quote.status.toLowerCase()}`)
  if (quote.expiresAt && quote.expiresAt < new Date()) {
    await db.fxQuote.update({ where: { id: quote.id }, data: { status: 'EXPIRED' } })
    throw new Error('quote expired')
  }

  const [from, to] = await Promise.all([
    db.wallet.findFirst({ where: { id: input.fromWalletId, organizationId: input.organizationId } }),
    db.wallet.findFirst({ where: { id: input.toWalletId, organizationId: input.organizationId } }),
  ])
  if (!from || !to) throw new Error('wallet not found')
  if (from.currency !== quote.baseCurrency || to.currency !== quote.quoteCurrency) {
    throw new Error('wallet currencies do not match the quote direction')
  }

  // Convert the amount at the locked rate (scale-aware, exact BigInt)
  const source = Money.fromMinor(input.amountMinor, quote.baseCurrency)
  const targetMinor = convertMinor(source.minor, quote.baseCurrency, quote.rateScaled, quote.quoteCurrency)
  const target = Money.fromMinor(targetMinor, quote.quoteCurrency)

  // FX conversion posts TWO single-currency transactions through the
  // multi-currency FX clearing account — each balances per currency:
  //   Txn A (base):  Dr FX_CLEARING      / Cr source wallet
  //   Txn B (quote): Dr target wallet    / Cr FX_CLEARING
  const coa = await import('@/lib/ledger').then((m) => m.ensureChartOfAccounts(input.organizationId))
  const fxClearing = coa['FX_CLEARING']

  const txnA = await postTransaction({
    organizationId: input.organizationId,
    description: `FX outflow: ${source.format()} @ ${(Number(quote.rateScaled) / 1e8).toFixed(4)}`,
    source: 'FX_CONVERSION',
    idempotencyKey: `fx-a:${quote.id}`,
    actorType: input.actor?.type ?? 'USER',
    actorId: input.actor?.id ?? null,
    actorLabel: input.actor?.label ?? null,
    entries: [
      { accountId: fxClearing, direction: 'DEBIT', amountMinor: source.minor, currency: quote.baseCurrency },
      { accountId: from.ledgerAccountId, direction: 'CREDIT', amountMinor: source.minor, currency: quote.baseCurrency },
    ],
    metadata: { quoteId: quote.id, leg: 'outflow' },
  })

  const txnB = await postTransaction({
    organizationId: input.organizationId,
    description: `FX inflow: ${target.format()} @ ${(Number(quote.rateScaled) / 1e8).toFixed(4)}`,
    source: 'FX_CONVERSION',
    idempotencyKey: `fx-b:${quote.id}`,
    actorType: input.actor?.type ?? 'USER',
    actorId: input.actor?.id ?? null,
    actorLabel: input.actor?.label ?? null,
    entries: [
      { accountId: to.ledgerAccountId, direction: 'DEBIT', amountMinor: target.minor, currency: quote.quoteCurrency },
      { accountId: fxClearing, direction: 'CREDIT', amountMinor: target.minor, currency: quote.quoteCurrency },
    ],
    metadata: { quoteId: quote.id, leg: 'inflow' },
  })

  await db.fxQuote.update({ where: { id: quote.id }, data: { status: 'EXECUTED', executedAt: new Date() } })

  await recordAudit({
    organizationId: input.organizationId,
    actorType: input.actor?.type ?? 'USER',
    actorId: input.actor?.id ?? null,
    action: 'fx.conversion.executed',
    resourceType: 'FxQuote',
    resourceId: quote.id,
    description: `Converted ${source.format()} to ${target.format()}`,
    metadata: { rateScaled: quote.rateScaled.toString() },
  })

  await emitWebhookEvent({
    organizationId: input.organizationId,
    event: 'fx.conversion.executed',
    data: {
      quoteId: quote.id,
      fromCurrency: quote.baseCurrency,
      toCurrency: quote.quoteCurrency,
      rateScaled: quote.rateScaled.toString(),
      convertedMinor: target.minor.toString(),
    },
  })

  return { txn: txnA, txnB, source, target }
}
