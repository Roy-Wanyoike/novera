'use server'

/**
 * Approvals — human-in-the-loop decisions on escalated agent intents.
 * Every decision flows through decideApproval in the agents kernel:
 * APPROVED executes the intent on the ledger, DECLINED kills it.
 */

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { decideApproval } from '@/lib/agents'

export interface DecisionResult {
  ok: boolean
  error?: string
}

export async function decideApprovalAction(
  approvalId: string,
  decision: 'APPROVED' | 'DECLINED',
  note: string
): Promise<DecisionResult> {
  const session = await requireSession()
  const orgId = session.organization.id
  try {
    const approval = await db.approvalRequest.findFirst({
      where: { id: approvalId, organizationId: orgId },
      select: { requesterType: true, requesterId: true },
    })
    if (!approval) return { ok: false, error: 'Approval request not found.' }

    await decideApproval(
      orgId,
      approvalId,
      decision,
      { id: session.user.id, name: session.user.name },
      note.trim() || undefined
    )

    revalidatePath('/approvals')
    revalidatePath('/agents')
    revalidatePath('/transactions')
    revalidatePath('/dashboard')
    if (approval.requesterType === 'AGENT' && approval.requesterId) {
      revalidatePath(`/agents/${approval.requesterId}`)
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message.replace(/^\[agents\]\s*/, '')
          : 'Failed to record decision.',
    }
  }
}
