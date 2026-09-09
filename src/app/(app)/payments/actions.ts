'use server'

/**
 * PAYMENTS — audited server actions.
 *
 * All money-in-motion mutations flow through the kernel services in
 * @/lib/payments (risk → rail → ledger → webhooks → audit). These actions
 * only: resolve the session, validate input, call the service, revalidate.
 * Honest status is always surfaced back to the caller — PROCESSING is never
 * presented as SETTLED.
 */

import { revalidatePath } from 'next/cache'
import { Money } from '@novera/money'
import { canTransitionPayment } from '@novera/domain'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { createPayment, refundPayment, PaymentError } from '@/lib/payments'
import { recordAudit } from '@/lib/audit'
import { safeJson } from '@/lib/format'

export type PaymentActionResult =
  | {
      ok: true
      id: string
      reference: string
      status: string
      riskDecision: string | null
      failureReason: string | null
    }
  | { ok: false; error: string }

const CURRENCIES = new Set(['KES', 'USD', 'EUR', 'GBP', 'NGN', 'TZS', 'UGX', 'ZAR', 'USDC'])
const METHODS = new Set(['MPESA', 'BANK', 'CARD', 'WALLET', 'USDC'])

const ZERO = BigInt(0)

interface TimelineEvent {
  at: string
  event: string
  detail: string
}

/** Parse a decimal amount string into minor units. Null when invalid. */
function parseAmount(raw: string, currency: string): bigint | null {
  try {
    const money = Money.fromMajor(raw, currency)
    if (!money.isPositive()) return null
    return money.minor
  } catch {
    return null
  }
}

function toResult(payment: {
  id: string
  reference: string
  status: string
  riskDecision: string | null
  failureReason: string | null
}): PaymentActionResult {
  return {
    ok: true,
    id: payment.id,
    reference: payment.reference,
    status: payment.status,
    riskDecision: payment.riskDecision ?? null,
    failureReason: payment.failureReason ?? null,
  }
}

/** Create a payment intent from the dashboard "New payment" dialog. */
export async function createPaymentAction(formData: FormData): Promise<PaymentActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const amountRaw = String(formData.get('amount') ?? '').trim()
  const currency = String(formData.get('currency') ?? 'KES').trim().toUpperCase()
  const method = String(formData.get('method') ?? '').trim()
  const customerName = String(formData.get('customerName') ?? '').trim()
  const customerEmail = String(formData.get('customerEmail') ?? '').trim().toLowerCase()
  const description = String(formData.get('description') ?? '').trim()

  if (!CURRENCIES.has(currency)) return { ok: false, error: `Unsupported currency "${currency}".` }
  if (!METHODS.has(method)) return { ok: false, error: 'Choose a payment method.' }
  const amountMinor = parseAmount(amountRaw, currency)
  if (amountMinor === null) {
    return { ok: false, error: `Enter a valid amount in ${currency} (e.g. 1500.00).` }
  }
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return { ok: false, error: 'Enter a valid customer email, or leave it empty.' }
  }

  try {
    const payment = await createPayment({
      organizationId: orgId,
      amountMinor,
      currency,
      method,
      customerName: customerName || null,
      customerEmail: customerEmail || null,
      description: description || null,
      idempotencyKey: `ui-${crypto.randomUUID()}`,
      actor: { type: 'USER', id: session.user.id, label: session.user.name },
    })
    if (!payment) return { ok: false, error: 'The payment could not be created. Nothing was charged.' }
    revalidatePath('/payments')
    revalidatePath('/dashboard')
    return toResult(payment)
  } catch (e) {
    if (e instanceof PaymentError) return { ok: false, error: e.message.replace('[payments] ', '') }
    return { ok: false, error: 'Unexpected error while processing the payment. No money moved.' }
  }
}

/** Retry a FAILED payment — a fresh intent with the same details. */
export async function retryPaymentAction(paymentId: string): Promise<PaymentActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const original = await db.payment.findFirst({ where: { id: paymentId, organizationId: orgId } })
  if (!original) return { ok: false, error: 'Payment not found in this organization.' }
  if (original.status !== 'FAILED') {
    return { ok: false, error: `Only failed payments can be retried (this one is ${original.status}).` }
  }

  try {
    const payment = await createPayment({
      organizationId: orgId,
      amountMinor: original.amountMinor,
      currency: original.currency,
      method: original.method,
      customerId: original.customerId,
      customerName: original.customerName,
      customerEmail: original.customerEmail,
      description: original.description,
      invoiceId: original.invoiceId,
      idempotencyKey: `retry-${crypto.randomUUID()}`,
      actor: { type: 'USER', id: session.user.id, label: `${session.user.name} (retry)` },
    })
    if (!payment) return { ok: false, error: 'The retry could not be created. Nothing was charged.' }
    revalidatePath(`/payments/${paymentId}`)
    revalidatePath('/payments')
    return toResult(payment)
  } catch (e) {
    if (e instanceof PaymentError) return { ok: false, error: e.message.replace('[payments] ', '') }
    return { ok: false, error: 'Unexpected error while retrying. No money moved.' }
  }
}

/** Refund a SETTLED payment (full or partial) — compensating ledger entries. */
export async function refundPaymentAction(paymentId: string, formData: FormData): Promise<PaymentActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const payment = await db.payment.findFirst({ where: { id: paymentId, organizationId: orgId } })
  if (!payment) return { ok: false, error: 'Payment not found in this organization.' }
  if (payment.status !== 'SETTLED') {
    return { ok: false, error: `Only settled payments can be refunded (this one is ${payment.status}).` }
  }

  const remaining = payment.amountMinor - payment.refundedMinor
  const amountRaw = String(formData.get('amount') ?? '').trim()
  const amountMinor = amountRaw === '' ? remaining : parseAmount(amountRaw, payment.currency)
  const remainingText = Money.fromMinor(remaining, payment.currency).format()
  if (amountMinor === null || amountMinor <= ZERO) {
    return { ok: false, error: `Enter a valid refund amount (up to ${remainingText} remains).` }
  }
  if (amountMinor > remaining) {
    return { ok: false, error: `Refund exceeds the remaining refundable ${remainingText}.` }
  }

  try {
    const updated = await refundPayment(orgId, paymentId, amountMinor, {
      type: 'USER',
      id: session.user.id,
      label: session.user.name,
    })
    revalidatePath(`/payments/${paymentId}`)
    revalidatePath('/payments')
    return {
      ok: true,
      id: updated.id,
      reference: updated.reference,
      status: updated.status,
      riskDecision: updated.riskDecision ?? null,
      failureReason: updated.failureReason ?? null,
    }
  } catch (e) {
    if (e instanceof PaymentError) return { ok: false, error: e.message.replace('[payments] ', '') }
    return { ok: false, error: 'Unexpected error while refunding. The ledger was left untouched.' }
  }
}

/** Mark a SETTLED payment as disputed — legal state transition + audit. */
export async function markDisputedAction(paymentId: string, note: string): Promise<PaymentActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const payment = await db.payment.findFirst({ where: { id: paymentId, organizationId: orgId } })
  if (!payment) return { ok: false, error: 'Payment not found in this organization.' }
  if (payment.status !== 'SETTLED') {
    return { ok: false, error: `Only settled payments can be marked as disputed (this one is ${payment.status}).` }
  }
  if (!canTransitionPayment(payment.status, 'DISPUTED')) {
    return { ok: false, error: 'This payment cannot legally move to DISPUTED from its current state.' }
  }

  const cleanNote = note.trim()
  const timeline = safeJson<TimelineEvent[]>(payment.timeline, [])
  timeline.push({
    at: new Date().toISOString(),
    event: 'disputed',
    detail: cleanNote ? `Dispute recorded: ${cleanNote}` : 'Marked as disputed by operator',
  })

  const updated = await db.payment.update({
    where: { id: payment.id },
    data: { status: 'DISPUTED', timeline: JSON.stringify(timeline) },
  })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'payment.disputed',
    resourceType: 'Payment',
    resourceId: payment.id,
    description: `Payment ${payment.reference} marked as disputed${cleanNote ? ` — ${cleanNote}` : ''}`,
    severity: 'WARN',
    metadata: { note: cleanNote || null, previousStatus: payment.status },
  })

  revalidatePath(`/payments/${paymentId}`)
  revalidatePath('/payments')
  return toResult(updated)
}
