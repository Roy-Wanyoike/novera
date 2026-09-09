'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { settlePayment } from '@/lib/payments'
import { recordAudit } from '@/lib/audit'
import { safeJson } from '@/lib/format'
import { canTransitionPayment } from '@novera/domain'

/**
 * RISK OPERATIONS — manual review queue resolution.
 *
 * Every queue action routes through the real kernel:
 *  - Approve → settlePayment (ledger postings + webhooks + audit, all inside the service)
 *  - Decline → legal PENDING → FAILED transition + explicit audit event
 * Nothing mutates money without an audit trail.
 */

export interface ReviewActionResult {
  ok: boolean
  message: string
}

interface TimelineEvent {
  at: string
  event: string
  detail: string
}

function revalidateRiskSurfaces() {
  revalidatePath('/risk')
  revalidatePath('/payments')
  revalidatePath('/dashboard')
  revalidatePath('/audit')
}

/** Approve a held payment: settle it through the real settlement leg. */
export async function approveReviewPayment(paymentId: string): Promise<ReviewActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const payment = await db.payment.findFirst({
    where: { id: paymentId, organizationId: orgId, riskDecision: 'REVIEW', status: 'PENDING' },
    select: { id: true, reference: true, status: true },
  })
  if (!payment) {
    return { ok: false, message: 'Payment is no longer in the review queue — refresh and try again.' }
  }
  if (!canTransitionPayment(payment.status, 'SETTLED')) {
    return { ok: false, message: `Payment ${payment.reference} cannot be settled from status ${payment.status}.` }
  }

  try {
    // settlePayment validates the state machine, posts balanced ledger entries,
    // emits webhooks and writes its own audit event — no shortcuts.
    await settlePayment(payment.id, {
      type: 'USER',
      id: session.user.id,
      label: session.user.name,
    })
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : `Settlement of ${payment.reference} failed.`,
    }
  }

  revalidateRiskSurfaces()
  return {
    ok: true,
    message: `${payment.reference} approved — settled through the ledger and rail.`,
  }
}

/** Decline a held payment: legal transition to FAILED with an explicit audit trail. */
export async function declineReviewPayment(paymentId: string): Promise<ReviewActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const payment = await db.payment.findFirst({
    where: { id: paymentId, organizationId: orgId, riskDecision: 'REVIEW', status: 'PENDING' },
    select: { id: true, reference: true, status: true, timeline: true, riskScore: true },
  })
  if (!payment) {
    return { ok: false, message: 'Payment is no longer in the review queue — refresh and try again.' }
  }
  if (!canTransitionPayment(payment.status, 'FAILED')) {
    return { ok: false, message: `Payment ${payment.reference} cannot be declined from status ${payment.status}.` }
  }

  // Keep the payment's own transparency trail in sync with the kernel's format.
  const timeline = safeJson<TimelineEvent[]>(payment.timeline, [])
  timeline.push({
    at: new Date().toISOString(),
    event: 'failed',
    detail: 'Declined in manual review',
  })

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: 'FAILED',
      failureReason: 'Declined in manual review',
      failedAt: new Date(),
      timeline: JSON.stringify(timeline),
    },
  })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'risk.review.declined',
    resourceType: 'Payment',
    resourceId: payment.id,
    description: `Payment ${payment.reference} declined in manual risk review`,
    severity: 'WARN',
    metadata: { reference: payment.reference, riskScore: payment.riskScore ?? null },
  })

  revalidateRiskSurfaces()
  return { ok: true, message: `${payment.reference} declined in manual review.` }
}
