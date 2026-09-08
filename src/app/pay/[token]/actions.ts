'use server'

/**
 * PUBLIC CHECKOUT ACTION — no session required (hosted checkout).
 *
 * Security posture:
 *  - The link token is resolved server-side; the organization is taken from
 *    the link row, never from the client.
 *  - For FIXED links the amount is the server-stored amount — client input
 *    for amount is only accepted for CUSTOM/DONATION/TIP links.
 *  - Everything runs through createPayment (risk → rail → ledger → webhooks
 *    → audit) — this action adds no money logic of its own.
 */

import { createPayment, PaymentError } from '@/lib/payments'
import { db } from '@/lib/db'
import { safeJson } from '@/lib/format'
import { Money } from '@novera/money'

export type CheckoutTimelineEvent = { at: string; event: string; detail: string }

export type CheckoutResult =
  | {
      ok: true
      reference: string
      status: string
      amountMinor: string
      currency: string
      method: string
      providerName: string | null
      providerMode: string | null
      timeline: CheckoutTimelineEvent[]
      failureReason: string | null
    }
  | { ok: false; error: string }

const METHODS = new Set(['MPESA', 'BANK', 'CARD', 'USDC'])

export async function payLinkAction(token: string, formData: FormData): Promise<CheckoutResult> {
  const link = await db.paymentLink.findUnique({ where: { token } })
  if (!link) return { ok: false, error: 'This payment link no longer exists.' }
  if (link.status !== 'ACTIVE') return { ok: false, error: 'This payment link has been archived.' }

  const name = String(formData.get('name') ?? '').trim().slice(0, 80)
  const email = String(formData.get('email') ?? '').trim().toLowerCase().slice(0, 120)
  const method = String(formData.get('method') ?? '').trim()
  const amountRaw = String(formData.get('amount') ?? '').trim()
  const simulateFailure = formData.get('simulateFailure') === 'on'

  if (!name) return { ok: false, error: 'Enter your name.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' }
  if (!METHODS.has(method)) return { ok: false, error: 'Choose a payment method.' }

  // Amount: server-stored truth for FIXED links; client-entered otherwise.
  let amountMinor: bigint
  if (link.amountMinor !== null) {
    amountMinor = link.amountMinor
  } else {
    try {
      const money = Money.fromMajor(amountRaw, link.currency)
      if (!money.isPositive()) throw new Error('not positive')
      amountMinor = money.minor
    } catch {
      return {
        ok: false,
        error: `Enter a valid amount in ${link.currency} (up to 6 decimals for USDC, 2 otherwise).`,
      }
    }
  }

  try {
    const payment = await createPayment({
      organizationId: link.organizationId,
      amountMinor,
      currency: link.currency,
      method,
      customerName: name,
      customerEmail: email,
      description: `${link.label} — payment link`,
      paymentLinkId: link.id,
      idempotencyKey: `checkout-${crypto.randomUUID()}`,
      forceOutcome: simulateFailure ? 'FAILURE' : 'SUCCESS',
      actor: { type: 'SERVICE', label: 'Hosted checkout' },
    })
    if (!payment) return { ok: false, error: 'The payment could not be processed. Nothing was charged.' }

    const provider = payment.providerId
      ? await db.railProvider.findUnique({
          where: { id: payment.providerId },
          select: { name: true, mode: true },
        })
      : null

    return {
      ok: true,
      reference: payment.reference,
      status: payment.status,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      method: payment.method,
      providerName: provider?.name ?? null,
      providerMode: provider?.mode ?? null,
      timeline: safeJson<CheckoutTimelineEvent[]>(payment.timeline, []),
      failureReason: payment.failureReason ?? null,
    }
  } catch (e) {
    if (e instanceof PaymentError) return { ok: false, error: e.message.replace('[payments] ', '') }
    return { ok: false, error: 'Unexpected error while processing the payment. Nothing was charged.' }
  }
}
