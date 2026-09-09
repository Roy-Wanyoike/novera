'use server'

/**
 * Agentic finance console — server actions.
 *
 * Every mutation is org-scoped (requireSession) and audited. Registering an
 * agent is the KYA moment: identity, scoped credentials (hashed — the secret
 * is shown exactly once), deterministic limits and a full trail.
 */

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { recordAudit } from '@/lib/audit'
import { ref } from '@/lib/ids'
import { sha256Hex } from '@/lib/crypto'
import { Money } from '@novera/money'
import { AGENT_ROLES, AGENT_TOOLS } from '@novera/domain'
import { ensureAgentWallet, proposeAgentIntent } from '@/lib/agents'
import { safeJson } from '@/lib/format'

export interface ActionResult {
  ok: boolean
  error?: string
}

export interface RegisterAgentResult extends ActionResult {
  agentId?: string
  agentName?: string
  /** The plaintext credential — returned exactly once, never stored. */
  credential?: string
  credentialPrefix?: string
  walletProvisioned?: boolean
}

export interface SimulatorResult extends ActionResult {
  intentId?: string
  status?: string
  policyDecision?: string | null
  policyReasons?: string[]
  ledgerTransactionId?: string | null
  ledgerReference?: string | null
  approvalRequestId?: string | null
  failureReason?: string | null
  amountMinor?: string | null
  currency?: string | null
}

function isNonEmptyDecimal(raw: string): boolean {
  return /^\d+(\.\d+)?$/.test(raw)
}

/** Parse a decimal limit input ("450", "450.50") to exact minor units. */
function parseLimitMinor(raw: string, currency: string, field: string): bigint {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error(`${field} is empty.`)
  if (!isNonEmptyDecimal(trimmed)) {
    throw new Error(`${field} must be a non-negative decimal like 450.00.`)
  }
  return Money.fromMajor(trimmed, currency).minor
}

function revalidateAgentSurfaces(agentId?: string) {
  revalidatePath('/agents')
  revalidatePath('/approvals')
  if (agentId) revalidatePath(`/agents/${agentId}`)
}

/** Register a new agent — the KYA moment. Audited, credential issued once. */
export async function registerAgent(input: {
  name: string
  role: string
  description: string
  emoji: string
  perTransactionLimitMajor: string
  dailyLimitMajor: string
  approvalAboveMajor: string
  scopes: string[]
  provisionWallet: boolean
  currency: string
}): Promise<RegisterAgentResult> {
  const session = await requireSession()
  const orgId = session.organization.id
  try {
    const name = input.name.trim()
    if (name.length < 2) return { ok: false, error: 'Give the agent a name (2+ characters).' }
    if (name.length > 60) return { ok: false, error: 'Agent name is too long (max 60 characters).' }

    const role = (AGENT_ROLES as readonly string[]).includes(input.role) ? input.role : 'CUSTOM'
    const scopes = Array.from(
      new Set(input.scopes.filter((s) => (AGENT_TOOLS as readonly string[]).includes(s)))
    )
    if (scopes.length === 0) {
      return { ok: false, error: 'Grant at least one tool scope — least privilege starts at registration.' }
    }

    let perTransactionLimitMinor: bigint | null = null
    let dailyLimitMinor: bigint | null = null
    if (input.perTransactionLimitMajor.trim()) {
      perTransactionLimitMinor = parseLimitMinor(
        input.perTransactionLimitMajor,
        input.currency,
        'Per-transaction limit'
      )
    }
    if (input.dailyLimitMajor.trim()) {
      dailyLimitMinor = parseLimitMinor(input.dailyLimitMajor, input.currency, 'Daily limit')
    }
    // Empty approval threshold = 0: every monetary intent escalates to a human.
    const requiresApprovalAboveMinor = input.approvalAboveMajor.trim()
      ? parseLimitMinor(input.approvalAboveMajor, input.currency, 'Approval threshold')
      : BigInt(0)

    if (
      perTransactionLimitMinor !== null &&
      requiresApprovalAboveMinor > perTransactionLimitMinor
    ) {
      return {
        ok: false,
        error: 'Approval threshold is above the per-transaction ceiling — nothing would ever auto-execute above it. Lower the threshold or raise the ceiling.',
      }
    }

    const existing = await db.agent.findFirst({
      where: { organizationId: orgId, name },
      select: { id: true },
    })
    if (existing) return { ok: false, error: `An agent named “${name}” is already registered here.` }

    // Credential: generated once, hash stored, prefix kept for identification.
    const credential = ref.agentCredential()
    const credentialPrefix = credential.slice(0, 16)

    const agent = await db.agent.create({
      data: {
        organizationId: orgId,
        name,
        role,
        description: input.description.trim() || null,
        avatarEmoji: input.emoji || '🤖',
        status: 'ACTIVE',
        perTransactionLimitMinor,
        dailyLimitMinor,
        requiresApprovalAboveMinor,
        scopes: JSON.stringify(scopes),
        credentialPrefix,
        credentialHash: sha256Hex(credential),
      },
    })

    await recordAudit({
      organizationId: orgId,
      actorType: 'USER',
      actorId: session.user.id,
      actorLabel: session.user.name,
      action: 'agent.registered',
      resourceType: 'Agent',
      resourceId: agent.id,
      description: `${session.user.name} registered agent ${name} (${role}) — KYA: identity, scopes and deterministic limits recorded`,
      severity: 'WARN',
      metadata: {
        role,
        scopes,
        perTransactionLimitMinor: perTransactionLimitMinor?.toString() ?? null,
        dailyLimitMinor: dailyLimitMinor?.toString() ?? null,
        requiresApprovalAboveMinor: requiresApprovalAboveMinor.toString(),
        credentialPrefix,
        walletProvisioned: input.provisionWallet,
      },
    })

    let walletProvisioned = false
    if (input.provisionWallet) {
      await ensureAgentWallet(orgId, agent.id)
      walletProvisioned = true
    }

    revalidateAgentSurfaces(agent.id)
    return {
      ok: true,
      agentId: agent.id,
      agentName: agent.name,
      credential,
      credentialPrefix,
      walletProvisioned,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to register agent.',
    }
  }
}

/** Pause or resume an agent (policy gate stays deterministic either way). */
export async function setAgentStatus(
  agentId: string,
  next: 'ACTIVE' | 'PAUSED'
): Promise<ActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id
  try {
    const agent = await db.agent.findFirst({ where: { id: agentId, organizationId: orgId } })
    if (!agent) return { ok: false, error: 'Agent not found.' }
    if (agent.status === 'REVOKED') {
      return { ok: false, error: 'This agent is revoked — revocation is terminal. Register a new agent instead.' }
    }
    if (agent.status === next) return { ok: true }

    await db.agent.update({ where: { id: agent.id }, data: { status: next } })
    await recordAudit({
      organizationId: orgId,
      actorType: 'USER',
      actorId: session.user.id,
      actorLabel: session.user.name,
      action: next === 'PAUSED' ? 'agent.paused' : 'agent.resumed',
      resourceType: 'Agent',
      resourceId: agent.id,
      description: `${session.user.name} ${next === 'PAUSED' ? 'paused' : 'resumed'} agent ${agent.name}`,
      severity: next === 'PAUSED' ? 'WARN' : 'INFO',
      metadata: { from: agent.status, to: next },
    })

    revalidateAgentSurfaces(agent.id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to update agent status.' }
  }
}

/** Revoke an agent — terminal. Credentials are dead the moment this lands. */
export async function revokeAgent(agentId: string): Promise<ActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id
  try {
    const agent = await db.agent.findFirst({ where: { id: agentId, organizationId: orgId } })
    if (!agent) return { ok: false, error: 'Agent not found.' }
    if (agent.status === 'REVOKED') return { ok: true }

    await db.agent.update({ where: { id: agent.id }, data: { status: 'REVOKED' } })
    await recordAudit({
      organizationId: orgId,
      actorType: 'USER',
      actorId: session.user.id,
      actorLabel: session.user.name,
      action: 'agent.revoked',
      resourceType: 'Agent',
      resourceId: agent.id,
      description: `${session.user.name} revoked agent ${agent.name} — credentials invalidated, further intents rejected`,
      severity: 'CRITICAL',
      metadata: { from: agent.status, to: 'REVOKED' },
    })

    revalidateAgentSurfaces(agent.id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to revoke agent.' }
  }
}

/**
 * Simulator: propose an intent as the agent, straight through the real
 * deterministic policy engine. Actor is always labeled as a human at the
 * console — the audit trail never confuses simulation with autonomy.
 */
export async function simulateAgentIntent(
  agentId: string,
  input: {
    tool: string
    description: string
    amountMajor: string
    merchant: string
    currency: string
  }
): Promise<SimulatorResult> {
  const session = await requireSession()
  const orgId = session.organization.id
  try {
    const tool = input.tool
    if (!(AGENT_TOOLS as readonly string[]).includes(tool)) {
      return { ok: false, error: 'Unknown tool.' }
    }
    const description = input.description.trim()
    if (description.length < 3) {
      return { ok: false, error: 'Describe the intent (3+ characters) — this is what auditors will read.' }
    }

    let amountMinor: bigint | undefined
    if (input.amountMajor.trim()) {
      const raw = input.amountMajor.trim()
      if (!isNonEmptyDecimal(raw)) {
        return { ok: false, error: 'Amount must be a non-negative decimal like 38500.00.' }
      }
      amountMinor = Money.fromMajor(raw, input.currency).minor
    }

    const intent = await proposeAgentIntent({
      organizationId: orgId,
      agentId,
      tool,
      description,
      payload: {
        amountMinor,
        currency: amountMinor !== undefined ? input.currency : undefined,
        merchant: input.merchant.trim() || undefined,
        action: undefined,
      },
      actorLabel: 'Console (human simulating agent)',
    })

    const ledgerTxn = intent.ledgerTransactionId
      ? await db.ledgerTransaction.findUnique({
          where: { id: intent.ledgerTransactionId },
          select: { reference: true },
        })
      : null

    revalidateAgentSurfaces(agentId)
    revalidatePath('/transactions')
    revalidatePath('/dashboard')

    return {
      ok: true,
      intentId: intent.id,
      status: intent.status,
      policyDecision: intent.policyDecision,
      policyReasons: safeJson<string[]>(intent.policyReasons, []),
      ledgerTransactionId: intent.ledgerTransactionId,
      ledgerReference: ledgerTxn?.reference ?? null,
      approvalRequestId: intent.approvalRequestId,
      failureReason: intent.failureReason,
      amountMinor: amountMinor?.toString() ?? null,
      currency: input.currency,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message.replace(/^\[agents\]\s*/, '') : 'Simulation failed.',
    }
  }
}
