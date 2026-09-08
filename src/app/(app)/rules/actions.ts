'use server'

import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import { SPLIT_TRIGGERS } from '@novera/domain'
import { revalidatePath } from 'next/cache'

/**
 * Programmable money — split rule lifecycle.
 *
 *   DRAFT ──activate (requires approval)──▶ ACTIVE ──▶ ARCHIVED
 *
 * Percent allocations are stored as integer basis points
 * (percentBps = Math.round(percent × 100)); a rule only ever saves when
 * they sum to exactly 10,000 bps. Execution itself belongs to the
 * payments kernel (splits run on settlement, largest-remainder).
 */

export interface RuleAllocationInput {
  label: string
  walletId: string
  percentBps: number
}

export type RuleActionResult = { ok: true; ruleId: string } | { ok: false; error: string }

const MAX_ALLOCATIONS = 10

export async function createRule(input: {
  name: string
  trigger: string
  allocations: RuleAllocationInput[]
}): Promise<RuleActionResult> {
  try {
    const session = await requireSession()
    const orgId = session.organization.id

    const name = input.name.trim()
    if (name.length < 1 || name.length > 80) {
      return { ok: false, error: 'Give the rule a name (1–80 characters).' }
    }
    if (!SPLIT_TRIGGERS.includes(input.trigger as (typeof SPLIT_TRIGGERS)[number])) {
      return { ok: false, error: 'Unknown trigger.' }
    }
    if (input.allocations.length < 1 || input.allocations.length > MAX_ALLOCATIONS) {
      return { ok: false, error: `A rule needs between 1 and ${MAX_ALLOCATIONS} allocations.` }
    }

    const walletIds = [...new Set(input.allocations.map((a) => a.walletId))]
    const wallets = await db.wallet.findMany({
      where: { organizationId: orgId, id: { in: walletIds } },
      select: { id: true, label: true, status: true, currency: true },
    })
    if (wallets.length !== walletIds.length) {
      return { ok: false, error: 'One or more wallets do not belong to this organization.' }
    }
    if (wallets.some((w) => w.status !== 'ACTIVE')) {
      return { ok: false, error: 'All allocation wallets must be active.' }
    }

    const allocations = input.allocations.map((a) => {
      const wallet = wallets.find((w) => w.id === a.walletId)!
      return {
        // label is derived server-side from the wallet — never trusted from the client
        label: wallet.label,
        walletId: wallet.id,
        percentBps: a.percentBps,
      }
    })

    for (const a of allocations) {
      if (!Number.isInteger(a.percentBps) || a.percentBps < 1 || a.percentBps > 10_000) {
        return { ok: false, error: 'Each allocation must be between 0.01% and 100%.' }
      }
    }
    const totalBps = allocations.reduce((sum, a) => sum + a.percentBps, 0)
    if (totalBps !== 10_000) {
      return {
        ok: false,
        error: `Allocations must sum to exactly 100% — currently ${(totalBps / 100).toFixed(2)}%.`,
      }
    }

    const rule = await db.splitRule.create({
      data: {
        organizationId: orgId,
        name,
        trigger: input.trigger,
        allocations: JSON.stringify(allocations),
        totalAllocatedBps: totalBps,
        version: 1,
        status: 'DRAFT',
      },
      select: { id: true },
    })

    await recordAudit({
      organizationId: orgId,
      actorType: 'USER',
      actorId: session.user.id,
      actorLabel: session.user.name,
      action: 'rule.created',
      resourceType: 'SplitRule',
      resourceId: rule.id,
      description: `Split rule "${name}" created as DRAFT (${input.trigger}, ${allocations.length} allocations)`,
      metadata: { trigger: input.trigger, allocations, totalAllocatedBps: totalBps },
    })

    revalidatePath('/rules')
    return { ok: true, ruleId: rule.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error creating the rule.' }
  }
}

export async function activateRule(ruleId: string): Promise<RuleActionResult> {
  try {
    const session = await requireSession()
    const orgId = session.organization.id
    const rule = await db.splitRule.findFirst({ where: { id: ruleId, organizationId: orgId } })
    if (!rule) return { ok: false, error: 'Rule not found in this organization.' }
    if (rule.status !== 'DRAFT') {
      return { ok: false, error: `Only DRAFT rules can be activated — this one is ${rule.status.toLowerCase()}.` }
    }

    const allocations = safeAllocations(rule.allocations)
    const totalBps = allocations.reduce((s, a) => s + a.percentBps, 0)
    if (totalBps !== 10_000) {
      return { ok: false, error: 'Allocations no longer sum to 100% — fix the rule before activating.' }
    }

    await db.splitRule.update({
      where: { id: rule.id },
      data: { status: 'ACTIVE', approvedByName: session.user.name },
    })

    await recordAudit({
      organizationId: orgId,
      actorType: 'USER',
      actorId: session.user.id,
      actorLabel: session.user.name,
      action: 'rule.activated',
      resourceType: 'SplitRule',
      resourceId: rule.id,
      description: `Split rule "${rule.name}" approved by ${session.user.name} and activated — it now executes on matching settlements`,
      severity: 'WARN',
      metadata: { approvedByName: session.user.name, trigger: rule.trigger, totalAllocatedBps: totalBps },
    })

    revalidatePath('/rules')
    return { ok: true, ruleId: rule.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error activating the rule.' }
  }
}

export async function archiveRule(ruleId: string): Promise<RuleActionResult> {
  try {
    const session = await requireSession()
    const orgId = session.organization.id
    const rule = await db.splitRule.findFirst({ where: { id: ruleId, organizationId: orgId } })
    if (!rule) return { ok: false, error: 'Rule not found in this organization.' }
    if (rule.status === 'ARCHIVED') {
      return { ok: false, error: 'Rule is already archived.' }
    }

    await db.splitRule.update({ where: { id: rule.id }, data: { status: 'ARCHIVED' } })

    await recordAudit({
      organizationId: orgId,
      actorType: 'USER',
      actorId: session.user.id,
      actorLabel: session.user.name,
      action: 'rule.archived',
      resourceType: 'SplitRule',
      resourceId: rule.id,
      description: `Split rule "${rule.name}" archived — it will no longer execute`,
      metadata: { previousStatus: rule.status },
    })

    revalidatePath('/rules')
    return { ok: true, ruleId: rule.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error archiving the rule.' }
  }
}

function safeAllocations(raw: string): RuleAllocationInput[] {
  try {
    const parsed = JSON.parse(raw) as RuleAllocationInput[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
