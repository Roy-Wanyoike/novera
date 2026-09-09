import { db } from '@/lib/db'
import { Money } from '@novera/money'
import { evaluatePolicy, buildAgentGuardrailRules, type PolicyFacts, type PolicyRule } from '@novera/policy'
import { postTransaction, walletLedgerBalance } from '@/lib/ledger'
import { recordAudit } from '@/lib/audit'
import { ref } from '@/lib/ids'
import { emitWebhookEvent } from '@/lib/webhooks'

/**
 * AGENTIC FINANCE — controlled AI financial actors.
 *
 * Pipeline (directive: LLMs propose, deterministic systems decide):
 *   AI Agent → Intent → Policy Engine → [Human Approval] → Ledger → Audit
 *
 * An LLM NEVER writes to the ledger. It can only produce an intent
 * proposal, which is validated against the agent's deterministic policy.
 * Amounts above the approval threshold create an ApprovalRequest that a
 * human decides in the console. Everything is auditable and revocable.
 */

export interface ProposeIntentInput {
  organizationId: string
  agentId: string
  tool: string
  description: string
  payload: {
    action?: string // e.g. 'payment.create' when the tool moves money
    amountMinor?: bigint
    currency?: string
    merchant?: string
    fromWalletLabel?: string
    toWalletLabel?: string
    destination?: string
    [key: string]: unknown
  }
  actorLabel?: string // e.g. "Copilot (LLM)"
}

export class AgentError extends Error {
  constructor(message: string) {
    super(`[agents] ${message}`)
    this.name = 'AgentError'
  }
}

function agentPolicyRules(agent: {
  name: string
  scopes: string
  perTransactionLimitMinor: bigint | null
  dailyLimitMinor: bigint | null
  requiresApprovalAboveMinor: bigint
}): PolicyRule[] {
  const scopes: string[] = JSON.parse(agent.scopes)
  const toolActions: Record<string, string> = {
    'payments.propose': 'payment.create',
    'transfers.propose': 'transfer.execute',
    'suppliers.compare': 'supplier.compare',
    'treasury.report': 'treasury.report',
    'balances.read': 'balances.read',
    'invoices.summarize': 'invoices.summarize',
  }
  const allowedActions = scopes
    .map((s) => toolActions[s])
    .filter((a): a is string => Boolean(a))
  return buildAgentGuardrailRules({
    agentName: agent.name,
    allowedActions,
    perTransactionLimitMinor: agent.perTransactionLimitMinor ?? undefined,
    dailyLimitMinor: agent.dailyLimitMinor ?? undefined,
    requiresApprovalAboveMinor: agent.requiresApprovalAboveMinor,
  })
}

/**
 * Step 1: an agent (LLM-driven or automated) proposes an intent.
 * The deterministic policy engine immediately classifies it:
 *   ALLOW → executes straight away (within limits)
 *   REQUIRE_APPROVAL → creates a human ApprovalRequest
 *   DECLINE → recorded as POLICY_DENIED (audit trail preserved)
 */
export async function proposeAgentIntent(input: ProposeIntentInput) {
  const agent = await db.agent.findFirst({
    where: { id: input.agentId, organizationId: input.organizationId },
  })
  if (!agent) throw new AgentError('agent not found')
  if (agent.status !== 'ACTIVE') throw new AgentError(`agent is ${agent.status.toLowerCase()}`)

  const intent = await db.agentIntent.create({
    data: {
      organizationId: input.organizationId,
      agentId: agent.id,
      tool: input.tool,
      description: input.description,
      payload: JSON.stringify({
        ...input.payload,
        amountMinor: input.payload.amountMinor?.toString(),
      }),
      status: 'PROPOSED',
    },
  })

  await recordAudit({
    organizationId: input.organizationId,
    actorType: 'AGENT',
    actorId: agent.id,
    actorLabel: `${agent.name} (agent)`,
    action: 'agent.intent.proposed',
    resourceType: 'AgentIntent',
    resourceId: intent.id,
    description: `${agent.name} proposed: ${input.description}`,
    metadata: { tool: input.tool, amountMinor: input.payload.amountMinor?.toString() },
  })

  // ── deterministic policy gate ──
  const action =
    input.payload.action ??
    (input.tool === 'payments.propose'
      ? 'payment.create'
      : input.tool === 'transfers.propose'
        ? 'transfer.execute'
        : input.tool)

  const facts: PolicyFacts = {
    action,
    subjectType: 'AGENT',
    subjectId: agent.id,
    scopes: JSON.parse(agent.scopes),
    amountMinor: input.payload.amountMinor ?? undefined,
    currency: input.payload.currency ?? undefined,
    merchant: input.payload.merchant ?? undefined,
    dailySpendMinor: agent.dailySpendMinor,
    perTransactionLimitMinor: agent.perTransactionLimitMinor ?? undefined,
    dailyLimitMinor: agent.dailyLimitMinor ?? undefined,
    requiresApprovalAboveMinor: agent.requiresApprovalAboveMinor,
  }

  const decision = evaluatePolicy(agentPolicyRules(agent), facts)

  if (decision.decision === 'DECLINE') {
    const denied = await db.agentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'POLICY_DENIED',
        policyDecision: 'DECLINE',
        policyReasons: JSON.stringify(decision.reasons),
      },
    })
    await recordAudit({
      organizationId: input.organizationId,
      actorType: 'SYSTEM',
      action: 'policy.evaluated',
      resourceType: 'AgentIntent',
      resourceId: intent.id,
      description: `Policy DENIED intent ${intent.id}: ${decision.reasons[0]}`,
      severity: 'WARN',
      metadata: { decision: 'DECLINE', reasons: decision.reasons },
    })
    return denied
  }

  if (decision.decision === 'REQUIRE_APPROVAL') {
    const approval = await db.approvalRequest.create({
      data: {
        organizationId: input.organizationId,
        requesterType: 'AGENT',
        requesterId: agent.id,
        requesterLabel: `${agent.name} (agent)`,
        action: 'AGENT_PAYMENT',
        payload: JSON.stringify({ intentId: intent.id, tool: input.tool, ...input.payload, amountMinor: input.payload.amountMinor?.toString() }),
        amountMinor: input.payload.amountMinor ?? null,
        currency: input.payload.currency ?? null,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      },
    })
    const pending = await db.agentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'PENDING_APPROVAL',
        policyDecision: 'REQUIRE_APPROVAL',
        policyReasons: JSON.stringify(decision.reasons),
        approvalRequestId: approval.id,
      },
    })
    await emitWebhookEvent({
      organizationId: input.organizationId,
      event: 'approval.requested',
      data: { approvalId: approval.id, action: approval.action, amountMinor: approval.amountMinor?.toString() },
    })
    await recordAudit({
      organizationId: input.organizationId,
      actorType: 'SYSTEM',
      action: 'approval.requested',
      resourceType: 'ApprovalRequest',
      resourceId: approval.id,
      description: `Human approval requested: ${input.description}`,
      severity: 'WARN',
      metadata: { amountMinor: input.payload.amountMinor?.toString() },
    })
    return pending
  }

  // ALLOW → execute immediately
  return executeAgentIntent(intent.id)
}

/**
 * Execute a policy-approved intent on the ledger.
 * Only reachable via policy ALLOW or human approval — never directly
 * from an LLM.
 */
export async function executeAgentIntent(intentId: string) {
  const intent = await db.agentIntent.findUnique({
    where: { id: intentId },
    include: { agent: true },
  })
  if (!intent) throw new AgentError('intent not found')
  if (intent.status === 'EXECUTED') return intent
  if (intent.status !== 'PROPOSED' && intent.status !== 'APPROVED') {
    throw new AgentError(`intent in status ${intent.status} cannot execute`)
  }

  const payload = JSON.parse(intent.payload) as {
    amountMinor?: string
    currency?: string
    fromWalletLabel?: string
    toWalletLabel?: string
    destination?: string
    merchant?: string
  }

  try {
    let ledgerTransactionId: string | null = null

    if (payload.amountMinor && payload.currency) {
      const amount = Money.fromMinor(payload.amountMinor, payload.currency)
      const wallets = await db.wallet.findMany({
        where: { organizationId: intent.organizationId, status: 'ACTIVE' },
      })
      const fromWallet =
        wallets.find((w) => w.label === (payload.fromWalletLabel ?? 'Operating')) ??
        wallets.find((w) => w.type === 'OPERATING' && w.currency === amount.currency) ??
        wallets.find((w) => w.type === 'OPERATING')
      const toWallet =
        wallets.find((w) => w.label === payload.toWalletLabel) ??
        wallets.find((w) => w.type === 'SUPPLIER' && w.currency === amount.currency)

      if (fromWallet && toWallet) {
        const available = await walletLedgerBalance(fromWallet.id)
        if (available < amount.minor) {
          throw new AgentError(
            `insufficient funds in ${fromWallet.label}: available ${available}, requested ${amount.minor}`
          )
        }
        const txn = await postTransaction({
          organizationId: intent.organizationId,
          description: `${intent.agent.name}: ${intent.description}`,
          source: 'AGENT',
          idempotencyKey: `agent-intent:${intent.id}`,
          actorType: 'AGENT',
          actorId: intent.agent.id,
          actorLabel: `${intent.agent.name} (agent)`,
          entries: [
            // destination wallet UP (DEBIT), source wallet DOWN (CREDIT)
            { accountId: toWallet.ledgerAccountId, direction: 'DEBIT', amountMinor: amount.minor, currency: amount.currency },
            { accountId: fromWallet.ledgerAccountId, direction: 'CREDIT', amountMinor: amount.minor, currency: amount.currency },
          ],
          metadata: { intentId: intent.id, tool: intent.tool },
        })
        ledgerTransactionId = txn.id
      } else {
        // read-only intents (reports, comparisons) execute without ledger legs
        await recordAudit({
          organizationId: intent.organizationId,
          actorType: 'AGENT',
          actorId: intent.agent.id,
          actorLabel: `${intent.agent.name} (agent)`,
          action: 'agent.action.completed',
          resourceType: 'AgentIntent',
          resourceId: intent.id,
          description: `Non-monetary action executed: ${intent.description}`,
        })
      }
    }

    const executed = await db.agentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'EXECUTED',
        executedAt: new Date(),
        ledgerTransactionId,
      },
    })

    await db.agent.update({
      where: { id: intent.agentId },
      data: {
        dailySpendMinor: payload.amountMinor
          ? { increment: BigInt(payload.amountMinor) }
          : undefined,
        totalActions: { increment: 1 },
        lastActiveAt: new Date(),
      },
    })

    await recordAudit({
      organizationId: intent.organizationId,
      actorType: 'AGENT',
      actorId: intent.agent.id,
      actorLabel: `${intent.agent.name} (agent)`,
      action: 'agent.intent.executed',
      resourceType: 'AgentIntent',
      resourceId: intent.id,
      description: `Intent executed: ${intent.description}`,
      metadata: { ledgerTransactionId, amountMinor: payload.amountMinor },
    })

    await emitWebhookEvent({
      organizationId: intent.organizationId,
      event: 'agent.intent.executed',
      data: { agentId: intent.agentId, intentId: intent.id, ledgerTransactionId },
    })

    return executed
  } catch (err) {
    const failed = await db.agentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'EXECUTION_FAILED',
        failureReason: err instanceof Error ? err.message : 'unknown execution error',
      },
    })
    return failed
  }
}

/** Human decision on an approval request. */
export async function decideApproval(
  organizationId: string,
  approvalId: string,
  decision: 'APPROVED' | 'DECLINED',
  decidedBy: { id: string; name: string },
  note?: string
) {
  const approval = await db.approvalRequest.findFirst({
    where: { id: approvalId, organizationId },
    include: { intent: true },
  })
  if (!approval) throw new AgentError('approval request not found')
  if (approval.status !== 'PENDING') throw new AgentError('approval already decided')

  const updated = await db.approvalRequest.update({
    where: { id: approval.id },
    data: {
      status: decision,
      decidedBy: decidedBy.id,
      decidedByName: decidedBy.name,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    },
  })

  if (approval.intent) {
    if (decision === 'APPROVED') {
      await db.agentIntent.update({
        where: { id: approval.intent.id },
        data: { status: 'APPROVED' },
      })
      await executeAgentIntent(approval.intent.id)
    } else {
      await db.agentIntent.update({
        where: { id: approval.intent.id },
        data: { status: 'REJECTED' },
      })
    }
  }

  await recordAudit({
    organizationId,
    actorType: 'USER',
    actorId: decidedBy.id,
    actorLabel: decidedBy.name,
    action: 'approval.decided',
    resourceType: 'ApprovalRequest',
    resourceId: approval.id,
    description: `${decidedBy.name} ${decision.toLowerCase()} the request: ${approval.action}`,
    severity: 'WARN',
    metadata: { decision, note: note ?? null },
  })

  await emitWebhookEvent({
    organizationId,
    event: 'approval.decided',
    data: { approvalId: approval.id, decision, decidedBy: decidedBy.name },
  })

  return updated
}

/** Provision a wallet for an agent (agents never share human wallets). */
export async function ensureAgentWallet(organizationId: string, agentId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId } })
  if (!agent || agent.organizationId !== organizationId) throw new AgentError('agent not found')
  if (agent.walletId) return agent.walletId

  const org = await db.organization.findUnique({ where: { id: organizationId } })
  const wallets = await db.wallet.findMany({ where: { organizationId } })
  const currency = wallets[0]?.currency ?? 'KES'

  const ledgerAccount = await db.ledgerAccount.create({
    data: {
      organizationId,
      code: `WALLET:${currency}:AGENT-${ref.agent()}`,
      name: `${agent.name} wallet`,
      type: 'ASSET',
      normalBalance: 'DEBIT',
      currency,
    },
  })
  const wallet = await db.wallet.create({
    data: {
      organizationId,
      label: `${agent.name} Wallet`,
      type: 'AGENT',
      currency,
      ledgerAccountId: ledgerAccount.id,
      description: `Controlled wallet for AI agent ${agent.name}`,
    },
  })
  await db.agent.update({ where: { id: agentId }, data: { walletId: wallet.id } })
  return wallet.id
}
