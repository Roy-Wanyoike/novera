'use server'

import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { Money } from '@novera/money'
import { createFxQuote, executeConversion } from '@/lib/fx'
import { availableBalanceMinor } from '@/lib/transfers'
import { revalidatePath } from 'next/cache'

/**
 * FX desk mutations — thin, org-scoped wrappers around the kernel:
 * quote (createFxQuote) → confirm (executeConversion). All money moves
 * through the kernel; these actions only validate inputs and serialize
 * results for the client (BigInt → string).
 */

export interface FxQuoteView {
  ok: true
  quoteId: string
  fromCurrency: string
  toCurrency: string
  amountMinor: string
  rateScaled: string
  rawRateScaled: string
  spreadBps: number
  convertedMinor: string
  expiresAt: string
}

export interface FxExecutionView {
  ok: true
  refA: string
  refB: string
  fromCurrency: string
  toCurrency: string
  sourceFormatted: string
  targetFormatted: string
}

export type FxError = { ok: false; error: string }

function friendly(error: string): string {
  if (error.includes('quote expired')) {
    return 'Quote expired — quotes live 60 seconds. Request a fresh one and confirm within the window.'
  }
  if (error.includes('quote amount mismatch')) {
    return 'The quoted amount changed — quotes settle exactly what was quoted. Request a fresh quote.'
  }
  if (error.includes('insufficient available funds')) {
    return 'Insufficient available funds in the source wallet for this conversion.'
  }
  if (error.includes('wallet currencies do not match')) {
    return 'The selected wallets no longer match the quote direction. Request a new quote.'
  }
  if (error.includes('quote is')) {
    return 'This quote has already been used or expired. Request a new quote.'
  }
  return error
}

async function loadWallets(orgId: string, fromWalletId: string, toWalletId: string) {
  const [from, to] = await Promise.all([
    db.wallet.findFirst({ where: { id: fromWalletId, organizationId: orgId } }),
    db.wallet.findFirst({ where: { id: toWalletId, organizationId: orgId } }),
  ])
  return { from, to }
}

export async function requestFxQuote(input: {
  fromWalletId: string
  toWalletId: string
  amountMajor: string
}): Promise<FxQuoteView | FxError> {
  try {
    const session = await requireSession()
    const orgId = session.organization.id
    const { from, to } = await loadWallets(orgId, input.fromWalletId, input.toWalletId)
    if (!from || !to) return { ok: false, error: 'Wallet not found in this organization.' }
    if (from.id === to.id) return { ok: false, error: 'Choose two different wallets.' }
    if (from.currency === to.currency) {
      return {
        ok: false,
        error: `Both wallets hold ${from.currency}. FX converts between currencies — use a transfer for same-currency moves.`,
      }
    }
    if (from.status !== 'ACTIVE' || to.status !== 'ACTIVE') {
      return { ok: false, error: 'Both wallets must be active.' }
    }

    let amount: Money
    try {
      amount = Money.fromMajor(input.amountMajor, from.currency)
    } catch {
      return { ok: false, error: `Enter a valid ${from.currency} amount, e.g. 1000.50.` }
    }
    if (!amount.isPositive()) return { ok: false, error: 'Amount must be greater than zero.' }

    const available = await availableBalanceMinor(from.id)
    if (available < amount.minor) {
      return {
        ok: false,
        error: `Insufficient available funds — ${Money.fromMinor(available, from.currency).format()} available in ${from.label}.`,
      }
    }

    const { quote, rawRateScaled, quoteAmountMinor } = await createFxQuote({
      organizationId: orgId,
      baseCurrency: from.currency,
      quoteCurrency: to.currency,
      amountMinor: amount.minor,
    })

    return {
      ok: true,
      quoteId: quote.id,
      fromCurrency: from.currency,
      toCurrency: to.currency,
      amountMinor: amount.minor.toString(),
      rateScaled: quote.rateScaled.toString(),
      rawRateScaled: rawRateScaled.toString(),
      spreadBps: quote.spreadBps,
      convertedMinor: quoteAmountMinor.toString(),
      expiresAt: (quote.expiresAt ?? new Date(Date.now() + 60_000)).toISOString(),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error while quoting.' }
  }
}

export async function executeFxConversion(input: {
  quoteId: string
  fromWalletId: string
  toWalletId: string
  amountMajor: string
}): Promise<FxExecutionView | FxError> {
  try {
    const session = await requireSession()
    const orgId = session.organization.id
    const { from, to } = await loadWallets(orgId, input.fromWalletId, input.toWalletId)
    if (!from || !to) return { ok: false, error: 'Wallet not found in this organization.' }

    let amount: Money
    try {
      amount = Money.fromMajor(input.amountMajor, from.currency)
    } catch {
      return { ok: false, error: 'Amount could not be re-parsed — request a new quote.' }
    }

    const available = await availableBalanceMinor(from.id)
    if (available < amount.minor) {
      return {
        ok: false,
        error: `Insufficient available funds — ${Money.fromMinor(available, from.currency).format()} available in ${from.label}.`,
      }
    }

    // Kernel validates quote status/expiry and that wallet currencies match
    // the quote direction; it posts both legs and emits audit + webhook.
    const { txn, txnB, source, target } = await executeConversion({
      organizationId: orgId,
      quoteId: input.quoteId,
      amountMinor: amount.minor,
      fromWalletId: from.id,
      toWalletId: to.id,
      actor: { type: 'USER', id: session.user.id, label: session.user.name },
    })

    revalidatePath('/fx')
    revalidatePath('/treasury')
    revalidatePath('/wallets')
    revalidatePath('/transactions')

    return {
      ok: true,
      refA: txn.reference,
      refB: txnB.reference,
      fromCurrency: from.currency,
      toCurrency: to.currency,
      // label the received amount in the destination currency — the kernel
      // returns the converted minor units in quote-currency scale
      sourceFormatted: source.format(),
      targetFormatted: Money.fromMinor(target.minor, to.currency).format(),
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected error executing conversion.'
    return { ok: false, error: friendly(message) }
  }
}
