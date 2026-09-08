/**
 * @novera/policy — Deterministic authorization policy engine.
 *
 * The intelligence plane (LLMs, copilots, agents) may PROPOSE actions.
 * This engine DECIDES them. It is pure, deterministic, and fail-closed:
 * when no rule explicitly allows an action, the decision is DECLINE.
 * An LLM can never override a policy decision — by design.
 */

export type PolicyEffect = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DECLINE'

export interface PolicyFacts {
  action: string
  subjectType: 'AGENT' | 'USER' | 'ROLE' | 'API_KEY'
  subjectId?: string
  scopes: string[]
  amountMinor?: bigint
  currency?: string
  merchant?: string
  country?: string
  channel?: string
  dailySpendMinor?: bigint
  perTransactionLimitMinor?: bigint
  dailyLimitMinor?: bigint
  requiresApprovalAboveMinor?: bigint
}

export type ComparisonOp = 'eq' | 'neq' | 'in' | 'not_in' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'

export interface PolicyCondition {
  field: string // action | scope | amountMinor | currency | merchant | country | channel | dailySpendMinor
  op: ComparisonOp
  value: string | number | string[]
}

export interface PolicyRule {
  id?: string
  name: string
  description?: string
  priority?: number // lower runs first; default 100
  effect: PolicyEffect
  conditions: PolicyCondition[] // ALL must match (AND)
}

export interface PolicyDecisionResult {
  decision: PolicyEffect
  reasons: string[]
  matchedRule?: string
  evaluatedAt: string
}

function toBig(v: string | number): bigint {
  return BigInt(v)
}

function matchCondition(cond: PolicyCondition, facts: PolicyFacts): boolean {
  const { field, op, value } = cond

  const resolve = (): unknown => {
    switch (field) {
      case 'action': return facts.action
      case 'subjectType': return facts.subjectType
      case 'currency': return facts.currency
      case 'merchant': return facts.merchant
      case 'country': return facts.country
      case 'channel': return facts.channel
      case 'amountMinor': return facts.amountMinor
      case 'dailySpendMinor': return facts.dailySpendMinor
      case 'perTransactionLimitMinor': return facts.perTransactionLimitMinor
      case 'dailyLimitMinor': return facts.dailyLimitMinor
      case 'requiresApprovalAboveMinor': return facts.requiresApprovalAboveMinor
      default: return undefined
    }
  }

  const factValue = resolve()

  // scope: has / not has semantics against the scopes array
  if (field === 'scope') {
    const scopeName = String(value)
    const has = facts.scopes.includes(scopeName)
    return op === 'eq' || op === 'in' ? has : op === 'neq' || op === 'not_in' ? !has : false
  }

  if (factValue === undefined || factValue === null) return false

  // numeric comparisons
  if (['amountMinor', 'dailySpendMinor', 'perTransactionLimitMinor', 'dailyLimitMinor', 'requiresApprovalAboveMinor'].includes(field)) {
    const f = factValue as bigint
    const v = toBig(value as string | number)
    switch (op) {
      case 'lt': return f < v
      case 'lte': return f <= v
      case 'gt': return f > v
      case 'gte': return f >= v
      case 'eq': return f === v
      case 'neq': return f !== v
      default: return false
    }
  }

  // string / set comparisons
  const s = String(factValue)
  const valArr = Array.isArray(value) ? value.map(String) : [String(value)]
  switch (op) {
    case 'eq': return s === String(value)
    case 'neq': return s !== String(value)
    case 'in': return valArr.includes(s)
    case 'not_in': return !valArr.includes(s)
    case 'contains': return valArr.some((v) => s.toLowerCase().includes(v.toLowerCase()))
    case 'lt': return s < String(value)
    case 'lte': return s <= String(value)
    case 'gt': return s > String(value)
    case 'gte': return s >= String(value)
    default: return false
  }
}

/**
 * Evaluate an ordered rule set against the facts.
 * Rules are sorted by priority (ascending). First rule whose conditions
 * ALL match produces the decision. No match → DECLINE (fail closed).
 */
export function evaluatePolicy(rules: PolicyRule[], facts: PolicyFacts): PolicyDecisionResult {
  const ordered = [...rules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
  const reasons: string[] = []

  for (const rule of ordered) {
    const matched = rule.conditions.every((c) => matchCondition(c, facts))
    if (rule.description) reasons.push(`[${rule.effect}] ${rule.name}: ${rule.description}`)
    if (matched) {
      return {
        decision: rule.effect,
        reasons: [`Matched policy rule "${rule.name}"`, ...reasons],
        matchedRule: rule.name,
        evaluatedAt: new Date().toISOString(),
      }
    }
  }

  return {
    decision: 'DECLINE',
    reasons: ['No policy rule matched — fail-closed default DECLINE (least privilege).'],
    evaluatedAt: new Date().toISOString(),
  }
}

/**
 * Convenience builder for agent guardrail policies:
 *  - actions within per-txn + daily limits and scope → ALLOW
 *  - actions above approval threshold but within limits → REQUIRE_APPROVAL
 *  - anything else → DECLINE
 */
export function buildAgentGuardrailRules(opts: {
  agentName: string
  allowedActions: string[]
  perTransactionLimitMinor?: bigint
  dailyLimitMinor?: bigint
  requiresApprovalAboveMinor?: bigint
}): PolicyRule[] {
  const rules: PolicyRule[] = []
  if (opts.perTransactionLimitMinor !== undefined) {
    rules.push({
      name: `${opts.agentName}: per-transaction ceiling`,
      description: `Amount must not exceed per-transaction limit`,
      priority: 10,
      effect: 'DECLINE',
      conditions: [{ field: 'amountMinor', op: 'gt', value: opts.perTransactionLimitMinor.toString() }],
    })
  }
  if (opts.dailyLimitMinor !== undefined) {
    rules.push({
      name: `${opts.agentName}: daily spend ceiling`,
      description: `Cumulative daily spend must stay under the daily limit`,
      priority: 11,
      effect: 'DECLINE',
      conditions: [{ field: 'dailySpendMinor', op: 'gte', value: opts.dailyLimitMinor.toString() }],
    })
  }
  if (opts.requiresApprovalAboveMinor !== undefined) {
    rules.push({
      name: `${opts.agentName}: human approval gate`,
      description: `Amounts above the threshold require human approval`,
      priority: 20,
      effect: 'REQUIRE_APPROVAL',
      conditions: [{ field: 'amountMinor', op: 'gt', value: opts.requiresApprovalAboveMinor.toString() }],
    })
  }
  rules.push({
    name: `${opts.agentName}: allow scoped actions`,
    description: `Permits the agent's scoped tools`,
    priority: 100,
    effect: 'ALLOW',
    conditions: [
      { field: 'action', op: 'in', value: opts.allowedActions },
    ],
  })
  return rules
}
