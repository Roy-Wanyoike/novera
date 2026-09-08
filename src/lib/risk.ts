import { db } from '@/lib/db'
import { RISK_DECISIONS, type RiskDecision } from '@novera/domain'

/**
 * RISK ENGINE — deterministic real-time decisioning.
 *
 * Pipeline: rules → velocity → composite score → decision.
 * Decisions are exactly ALLOW / REVIEW / DECLINE and every evaluation is
 * persisted with explainable reasons (no black boxes in the money path).
 */

export interface RiskContext {
  organizationId: string
  subject: 'PAYMENT_CREATE' | 'CARD_AUTH' | 'WITHDRAWAL' | 'TRANSFER'
  amountMinor: bigint
  currency: string
  method?: string
  customerId?: string | null
  customerEmail?: string | null
  country?: string
  merchant?: string
  mcc?: string
  channel?: string
  paymentId?: string | null
}

export interface RiskResult {
  decision: RiskDecision
  score: number
  reasons: string[]
  ruleHits: string[]
}

interface CompiledRule {
  id: string
  name: string
  action: RiskDecision
  priority: number
  conditions: { field: string; op: string; value: unknown }[]
}

function matchRiskCondition(field: string, op: string, value: unknown, ctx: RiskContext): boolean {
  const resolve = (): unknown => {
    switch (field) {
      case 'amountMinor': return ctx.amountMinor
      case 'currency': return ctx.currency
      case 'method': return ctx.method
      case 'country': return ctx.country
      case 'merchant': return ctx.merchant
      case 'mcc': return ctx.mcc
      case 'channel': return ctx.channel
      case 'customerEmail': return ctx.customerEmail
      default: return undefined
    }
  }
  const fact = resolve()
  if (fact === undefined || fact === null) return false

  if (field === 'amountMinor') {
    const f = fact as bigint
    const v = BigInt(value as string)
    switch (op) {
      case 'gt': return f > v
      case 'gte': return f >= v
      case 'lt': return f < v
      case 'lte': return f <= v
      default: return false
    }
  }

  const s = String(fact).toLowerCase()
  const raw = Array.isArray(value) ? value.map((x) => String(x).toLowerCase()) : [String(value).toLowerCase()]
  switch (op) {
    case 'eq': return s === raw[0]
    case 'neq': return s !== raw[0]
    case 'in': return raw.includes(s)
    case 'not_in': return !raw.includes(s)
    case 'contains': return raw.some((r) => s.includes(r))
    default: return false
  }
}

export async function evaluateRisk(ctx: RiskContext): Promise<RiskResult> {
  const ruleRows = await db.riskRule.findMany({
    where: { status: 'ACTIVE', OR: [{ organizationId: null }, { organizationId: ctx.organizationId }] },
    orderBy: { priority: 'asc' },
  })
  const rules: CompiledRule[] = ruleRows.map((r) => ({
    id: r.id,
    name: r.name,
    action: r.action as RiskDecision,
    priority: r.priority,
    conditions: JSON.parse(r.conditions),
  }))

  const reasons: string[] = []
  const ruleHits: string[] = []
  let score = 0

  // 1) Rule pass (ordered) — first DECLINE/REVIEW hit wins per its action
  let decision: RiskDecision = 'ALLOW'
  for (const rule of rules) {
    const matched = rule.conditions.every((c) => matchRiskCondition(c.field, c.op, c.value, ctx))
    if (matched) {
      ruleHits.push(rule.name)
      if (rule.action === 'DECLINE') {
        reasons.push(`Rule "${rule.name}" matched → DECLINE`)
        decision = 'DECLINE'
        score = Math.max(score, 95)
        break
      }
      if (rule.action === 'REVIEW' && decision === 'ALLOW') {
        reasons.push(`Rule "${rule.name}" matched → REVIEW`)
        decision = 'REVIEW'
        score = Math.max(score, 60)
      }
    }
  }

  // 2) Velocity: same customer, settled+pending, last 24h
  if (decision !== 'DECLINE' && ctx.customerEmail) {
    const since = new Date(Date.now() - 24 * 3600 * 1000)
    const recent = await db.payment.count({
      where: {
        organizationId: ctx.organizationId,
        customerEmail: ctx.customerEmail,
        createdAt: { gte: since },
        status: { in: ['AUTHORIZED', 'PROCESSING', 'PENDING', 'SETTLED'] },
      },
    })
    if (recent >= 8) {
      reasons.push(`Velocity: ${recent} transactions from this customer in 24h`)
      decision = 'DECLINE'
      score = Math.max(score, 92)
      ruleHits.push('velocity:24h')
    } else if (recent >= 5) {
      reasons.push(`Velocity watch: ${recent} transactions in 24h`)
      if (decision === 'ALLOW') decision = 'REVIEW'
      score = Math.max(score, 55)
      ruleHits.push('velocity:24h')
    }
  }

  // 3) Composite scoring for context
  if (decision === 'ALLOW') score = Math.max(score, 8)

  if (reasons.length === 0) reasons.push('No risk rules matched; baseline score assigned')

  // 4) Persist evaluation (audit + analytics)
  await db.riskEvaluation.create({
    data: {
      organizationId: ctx.organizationId,
      paymentId: ctx.paymentId ?? null,
      subject: ctx.subject,
      score,
      decision,
      reasons: JSON.stringify(reasons),
      ruleHits: JSON.stringify(ruleHits),
    },
  })

  return { decision, score, reasons, ruleHits }
}

export function isRiskDecision(v: string): v is RiskDecision {
  return (RISK_DECISIONS as readonly string[]).includes(v)
}
