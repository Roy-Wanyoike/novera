import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  Bot,
  Clock3,
  Coins,
  KeyRound,
  Scale,
  Sparkles,
  UserCheck,
} from 'lucide-react'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { MoneyText } from '@/components/novera/money-text'
import { AgentStatusBadge } from '@/components/novera/status-badge'
import { EmptyState } from '@/components/novera/empty-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { safeJson, timeAgo, pct } from '@/lib/format'
import { RegisterAgentDialog } from './register-agent-dialog'
import { AgentActions } from './agent-actions'
import { ROLE_LABELS, TOOL_SHORT_LABELS } from './labels'

export const metadata = { title: 'Agents' }

const PIPELINE = [
  { icon: Sparkles, label: 'AI proposes' },
  { icon: Scale, label: 'Policy authorizes' },
  { icon: UserCheck, label: 'Human approves' },
  { icon: BookOpenCheck, label: 'Ledger records' },
]

export default async function AgentsPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  const [agents, pendingApprovals, primaryWallet] = await Promise.all([
    db.agent.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'asc' } }),
    db.approvalRequest.count({ where: { organizationId: orgId, status: 'PENDING' } }),
    db.wallet.findFirst({
      where: { organizationId: orgId, type: 'OPERATING', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { currency: true },
    }),
  ])
  const baseCurrency = primaryWallet?.currency ?? 'KES'

  const activeCount = agents.filter((a) => a.status === 'ACTIVE').length
  const totalActions = agents.reduce((sum, a) => sum + a.totalActions, 0)
  const dailySpendMinor = agents.reduce((sum, a) => sum + a.dailySpendMinor, BigInt(0))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents — Know Your Agent"
        description="Every AI agent gets an identity, scoped credentials, deterministic policy limits and a full audit trail. AI proposes. Policy authorizes. The ledger records."
        actions={<RegisterAgentDialog baseCurrency={baseCurrency} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active agents"
          value={activeCount}
          deltaLabel={`${agents.length} registered`}
          icon={<Bot className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Agent actions"
          value={totalActions}
          deltaLabel="executed intents, lifetime"
          icon={<Activity className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Daily agent spend"
          value={<MoneyText minor={dailySpendMinor} currency={baseCurrency} />}
          deltaLabel="against deterministic ceilings"
          icon={<Coins className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Awaiting approval"
          value={pendingApprovals}
          deltaLabel="escalated by policy to a human"
          icon={<Clock3 className="h-4 w-4" aria-hidden />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">How agent money moves:</span>
        {PIPELINE.map((step, i) => (
          <span key={step.label} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden>→</span> : null}
            <span className="flex items-center gap-1.5">
              <step.icon className="h-3.5 w-3.5 text-primary" aria-hidden />
              {step.label}
            </span>
          </span>
        ))}
        <span className="ml-auto hidden text-[11px] text-muted-foreground/70 lg:block">
          The LLM never writes to the ledger — it can only propose.
        </span>
      </div>

      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot className="h-6 w-6" aria-hidden />}
          title="No agents registered"
          description="Register your first agent: it gets an identity, scoped credentials, deterministic policy limits and a full audit trail from day one."
          action={<RegisterAgentDialog baseCurrency={baseCurrency} />}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map((agent) => {
            const scopes = safeJson<string[]>(agent.scopes, [])
            const spendPct = agent.dailyLimitMinor
              ? Math.min(100, Math.max(0, pct(agent.dailySpendMinor, agent.dailyLimitMinor)))
              : null
            return (
              <Card key={agent.id} className="group transition-colors hover:border-primary/40">
                <Link href={`/agents/${agent.id}`} className="block" aria-label={`Open ${agent.name}`}>
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-2xl"
                        aria-hidden
                      >
                        {agent.avatarEmoji ?? '🤖'}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-base font-semibold leading-tight">{agent.name}</p>
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                            {ROLE_LABELS[agent.role] ?? agent.role}
                          </Badge>
                          <AgentStatusBadge status={agent.status} />
                        </div>
                        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {agent.description ?? 'No description recorded.'}
                        </p>
                      </div>
                      <ArrowRight
                        className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                        aria-hidden
                      />
                    </div>

                    {scopes.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {scopes.map((tool) => (
                          <span
                            key={tool}
                            title={tool}
                            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            {TOOL_SHORT_LABELS[tool] ?? tool}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3">
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Per-txn
                        </p>
                        {agent.perTransactionLimitMinor !== null ? (
                          <MoneyText
                            minor={agent.perTransactionLimitMinor}
                            currency={baseCurrency}
                            className="text-xs"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Daily cap
                        </p>
                        {agent.dailyLimitMinor !== null ? (
                          <MoneyText
                            minor={agent.dailyLimitMinor}
                            currency={baseCurrency}
                            className="text-xs"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Approve above
                        </p>
                        {agent.requiresApprovalAboveMinor > BigInt(0) ? (
                          <MoneyText
                            minor={agent.requiresApprovalAboveMinor}
                            currency={baseCurrency}
                            className="text-xs"
                          />
                        ) : (
                          <span className="text-xs text-warning">always</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">Daily spend</span>
                        <span className="tabular text-muted-foreground">
                          <MoneyText
                            minor={agent.dailySpendMinor}
                            currency={baseCurrency}
                            className="text-xs"
                          />
                          {agent.dailyLimitMinor !== null ? (
                            <span>
                              {' / '}
                              <MoneyText
                                minor={agent.dailyLimitMinor}
                                currency={baseCurrency}
                                muted
                                className="text-xs"
                              />
                            </span>
                          ) : (
                            <span className="text-muted-foreground/70"> · no daily cap</span>
                          )}
                        </span>
                      </div>
                      {spendPct !== null ? (
                        <Progress value={spendPct} aria-label={`${agent.name} daily spend progress`} />
                      ) : null}
                      {spendPct !== null ? (
                        <p className="text-[10px] text-muted-foreground/80">
                          {spendPct}% of daily ceiling consumed
                        </p>
                      ) : null}
                    </div>

                    <p className="text-[11px] text-muted-foreground">
                      {agent.totalActions} actions
                      {agent.lastActiveAt ? ` · last active ${timeAgo(agent.lastActiveAt)}` : ' · never active'}
                    </p>
                  </CardContent>
                </Link>

                <CardFooter className="flex flex-col gap-3 border-t bg-muted/20 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <KeyRound className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {agent.credentialPrefix ?? '—'}
                      </span>
                    </div>
                    <p className="text-[10px] leading-tight text-muted-foreground/70">
                      credentials are hashed — shown once at creation
                    </p>
                  </div>
                  <AgentActions
                    agentId={agent.id}
                    name={agent.name}
                    status={agent.status}
                    compact
                  />
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
