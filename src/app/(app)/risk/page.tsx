import Link from 'next/link'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { safeJson, titleCase, fmtDateTime, timeAgo } from '@/lib/format'
import { Money } from '@novera/money'
import {
  RISK_DECISION_META,
  RISK_DECISIONS,
  METHOD_META,
  type RiskDecision,
} from '@novera/domain'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { EmptyState } from '@/components/novera/empty-state'
import { MoneyText } from '@/components/novera/money-text'
import { StatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { Activity, BookLock, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { ReviewQueue, type ReviewQueueRow } from './review-queue'

export const metadata = { title: 'Risk' }

const TABLE_EDGE = '[&_th:first-child]:pl-6 [&_td:first-child]:pl-6 [&_th:last-child]:pr-6 [&_td:last-child]:pr-6'

// ── condition rendering (field op value → human-readable) ────────────

interface RuleCondition {
  field: string
  op?: string
  operator?: string
  value: unknown
}

const OP_SYMBOL: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
  in: 'in',
  not_in: 'not in',
  contains: 'contains',
}

const FIELD_LABEL: Record<string, string> = {
  amountMinor: 'amount',
  customerEmail: 'customer email',
  mcc: 'MCC',
}

function describeCondition(c: RuleCondition, currencyHint: string): string {
  const field = FIELD_LABEL[c.field] ?? titleCase(c.field)
  const op = c.op ?? c.operator ?? 'eq'
  const symbol = OP_SYMBOL[op] ?? op
  let value: string
  if (c.field === 'amountMinor') {
    try {
      value = Money.fromMinor(String(c.value ?? '0'), currencyHint).toString()
    } catch {
      value = String(c.value ?? '')
    }
  } else if (Array.isArray(c.value)) {
    value = c.value.length === 0 ? '—' : c.value.map((v) => String(v)).join(', ')
  } else {
    value = String(c.value ?? '')
  }
  return `${field} ${symbol} ${value}`
}

// ── page ─────────────────────────────────────────────────────────────

export default async function RiskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSession()
  const orgId = session.organization.id
  const params = await searchParams
  const decisionFilter =
    typeof params.decision === 'string' && (RISK_DECISIONS as readonly string[]).includes(params.decision)
      ? (params.decision as RiskDecision)
      : null

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)

  // ── KPIs: evaluation split, avg review score, distinct rules hit ──
  const recentEvaluations = await db.riskEvaluation.findMany({
    where: { organizationId: orgId, createdAt: { gte: since } },
    select: { decision: true, score: true, ruleHits: true },
  })
  const split: Record<RiskDecision, number> = { ALLOW: 0, REVIEW: 0, DECLINE: 0 }
  let reviewScoreSum = 0
  const ruleNamesHit = new Set<string>()
  for (const e of recentEvaluations) {
    if (e.decision === 'ALLOW' || e.decision === 'REVIEW' || e.decision === 'DECLINE') {
      split[e.decision]++
    }
    if (e.decision === 'REVIEW') reviewScoreSum += e.score
    for (const hit of safeJson<string[]>(e.ruleHits, [])) ruleNamesHit.add(hit)
  }
  const totalEvaluations = recentEvaluations.length
  const avgReviewScore =
    split.REVIEW > 0 ? Math.round((reviewScoreSum / split.REVIEW) * 10) / 10 : null

  // ── Review queue: PENDING payments held at REVIEW ──
  const heldPayments = await db.payment.findMany({
    where: { organizationId: orgId, riskDecision: 'REVIEW', status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
  const heldIds = heldPayments.map((p) => p.id)
  const heldEvaluations = heldIds.length
    ? await db.riskEvaluation.findMany({
        where: { organizationId: orgId, paymentId: { in: heldIds } },
        orderBy: { createdAt: 'desc' },
        select: { paymentId: true, reasons: true },
      })
    : []
  const reasonsByPayment = new Map<string, string[]>()
  for (const e of heldEvaluations) {
    if (e.paymentId && !reasonsByPayment.has(e.paymentId)) {
      reasonsByPayment.set(e.paymentId, safeJson<string[]>(e.reasons, []))
    }
  }
  const queueRows: ReviewQueueRow[] = heldPayments.map((p) => ({
    id: p.id,
    reference: p.reference,
    customerName: p.customerName ?? p.customerEmail ?? '—',
    amountMinor: p.amountMinor.toString(),
    currency: p.currency,
    method: METHOD_META[p.method]?.label ?? p.method,
    riskScore: p.riskScore,
    reasons: reasonsByPayment.get(p.id) ?? ['Held for manual review'],
    createdAt: timeAgo(p.createdAt),
  }))

  // ── Rules: org rules + platform defaults ──
  const rules = await db.riskRule.findMany({
    where: { OR: [{ organizationId: null }, { organizationId: orgId }] },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  })

  // ── Recent evaluations (filterable by decision) ──
  const evaluations = await db.riskEvaluation.findMany({
    where: { organizationId: orgId, ...(decisionFilter ? { decision: decisionFilter } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: { payment: { select: { id: true, reference: true } } },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk"
        description="Deterministic real-time decisioning. Every evaluation is persisted with explainable reasons — no black boxes in the money path. AI proposes, policy authorizes, the ledger records."
        actions={
          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/25 font-medium">
            <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {queueRows.length > 0 ? `${queueRows.length} awaiting review` : 'Queue clear'}
          </Badge>
        }
      />

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Evaluations · 30d"
          value={totalEvaluations}
          hint={`${split.ALLOW} allow · ${split.REVIEW} review · ${split.DECLINE} decline`}
          icon={<Activity className="h-4 w-4" />}
        />
        <KpiCard
          label="Average review score"
          value={avgReviewScore !== null ? avgReviewScore : '—'}
          hint="across REVIEW decisions"
          icon={<ShieldQuestion className="h-4 w-4" />}
        />
        <KpiCard
          label="Distinct rules hit"
          value={ruleNamesHit.size}
          hint="unique rules in 30d evaluations"
          icon={<BookLock className="h-4 w-4" />}
        />
        <KpiCard
          label="Awaiting manual review"
          value={queueRows.length}
          hint="PENDING payments held at REVIEW"
          icon={<ShieldCheck className="h-4 w-4" />}
        />
      </div>

      {/* Review queue — the operational core */}
      <Card>
        <CardHeader>
          <CardTitle>Manual review queue</CardTitle>
          <CardDescription>
            Payments held at REVIEW are settled only by an explicit operator decision. Approvals run the
            full settlement leg (ledger + webhooks); declines are audited. Nothing moves silently.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          <ReviewQueue rows={queueRows} />
        </CardContent>
      </Card>

      {/* Rules */}
      <Card>
        <CardHeader>
          <CardTitle>Risk rules</CardTitle>
          <CardDescription>
            Evaluated in priority order — the first matching DECLINE or REVIEW rule wins. Platform
            defaults apply to every organization; org rules layer on top.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {rules.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                icon={<BookLock className="h-5 w-5" />}
                title="No risk rules configured"
                description="Every payment will evaluate to ALLOW with the baseline score until rules exist."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className={TABLE_EDGE}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Conditions</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">Priority</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => {
                    const conditions = safeJson<RuleCondition[]>(rule.conditions, [])
                    const currencyHint =
                      (conditions.find((c) => c.field === 'currency' && typeof c.value === 'string')?.value as string) ?? 'KES'
                    return (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div className="text-sm font-medium leading-snug">{rule.name}</div>
                          {rule.description ? (
                            <div className="max-w-xs text-xs leading-snug text-muted-foreground">
                              {rule.description}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {rule.organizationId === null ? (
                            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/25 font-medium">
                              Platform default
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted text-muted-foreground border-border font-medium">
                              Organization
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-sm whitespace-normal">
                          {conditions.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {conditions.map((c, i) => (
                                <li key={i} className="font-mono text-xs text-muted-foreground">
                                  {describeCondition(c, currencyHint)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge meta={RISK_DECISION_META} status={rule.action} />
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="tabular text-sm font-medium">{rule.priority}</span>
                        </TableCell>
                        <TableCell>
                          {rule.status === 'ACTIVE' ? (
                            <ToneBadge tone="positive">Active</ToneBadge>
                          ) : (
                            <ToneBadge tone="neutral">Archived</ToneBadge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent evaluations */}
      <Card>
        <CardHeader>
          <CardTitle>Recent evaluations</CardTitle>
          <CardDescription>
            Every risk decision is persisted with its score and reasons — this is the explainability log.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="text-xs text-muted-foreground">Filter:</span>
            {([null, ...RISK_DECISIONS] as const).map((d) => {
              const active = d === null ? decisionFilter === null : decisionFilter === d
              return (
                <Link
                  key={d ?? 'all'}
                  href={d === null ? '/risk' : `/risk?decision=${d}`}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  {d === null ? 'All' : d.charAt(0) + d.slice(1).toLowerCase()}
                </Link>
              )
            })}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {evaluations.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                icon={<Activity className="h-5 w-5" />}
                title="No evaluations yet"
                description="Risk evaluations appear here as payments, card authorizations and transfers are created."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className={TABLE_EDGE}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Reasons</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {evaluations.map((e) => {
                    const reasons = safeJson<string[]>(e.reasons, [])
                    const firstReason = reasons[0] ?? '—'
                    return (
                      <TableRow key={e.id}>
                        <TableCell>
                          <div className="text-sm font-medium">{titleCase(e.subject)}</div>
                          {e.payment ? (
                            <Link
                              href={`/payments/${e.payment.id}`}
                              className="font-mono text-xs text-primary hover:underline"
                            >
                              {e.payment.reference}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">no payment linked</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge meta={RISK_DECISION_META} status={e.decision} />
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="tabular text-sm font-semibold">{e.score}</span>
                        </TableCell>
                        <TableCell className="max-w-md whitespace-normal">
                          <span className="text-xs leading-snug text-muted-foreground" title={reasons.join(' · ')}>
                            {firstReason.length > 90 ? firstReason.slice(0, 90) + '…' : firstReason}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {fmtDateTime(e.createdAt)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
