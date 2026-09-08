'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/audit'

/**
 * Copilot mutations — audited, org-scoped.
 * (The chat itself flows through /api/copilot; this action handles history.)
 */
export async function clearCopilotHistory(): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession()
  const organizationId = session.organization.id

  const deleted = await db.copilotMessage.deleteMany({ where: { organizationId } })

  await recordAudit({
    organizationId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'copilot.history.cleared',
    resourceType: 'CopilotMessage',
    description: `Cleared copilot conversation history (${deleted.count} messages)`,
    metadata: { deletedMessages: deleted.count },
  })

  revalidatePath('/copilot')
  return { ok: true }
}
