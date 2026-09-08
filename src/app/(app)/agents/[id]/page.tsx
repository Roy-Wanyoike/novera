import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenCheck,
  CalendarDays,
  KeyRound,
  Store,
  UserCheck,
  Wallet as WalletIcon,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { walletLedgerBalance } from '@/lib/ledger'
import { PageHeader } from '@/components/novera/page-header'
import { MoneyText } from '@/components/novera/money-text'
import { AgentStatusBadge, IntentStatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { EmptyState } from '@/components/novera/empty-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { fmtDate, pct, safeJson, timeAgo, truncateMiddle } from '@/lib/format'
import { AgentActions } from '../agent-actions'
import { IntentSimulator } from './intent-simulator'
import { ROLE_LABELS, TOOL_LABELS, policyDecisionTone } from '../labels'

export const metadata = { title: 'Agent detail' }

interface PolicyTileProps {
  icon: ComponentType<{ className?: string }>
  label: string
  value: ReactNode
  hint: string
}

function PolicyTile({ icon: Icon, label, value, hint }: PolicyTileProps) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <div className="text-lg font-semibold">{value}</div>
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  )
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const orgId = session.organization.id
  const { id } = await params

  const agent = await db.agent.findFirst({
    where: { id, organizationId: orgId },
    include: { wallet: true },
  })
  if (!agent) notFound()

  const [intents, primaryWallet] = await Promise.all([
    db.agentIntent.findMany({
      where: { agentId: agent.id, organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    db.wallet.findFirst({
      where: { organizationId: orgId, type: 'OPERATING', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { currency: true },
    }),
  ])
  const baseCurrency = primaryWallet?.currency ?? 'KES'

  const ledgerIds = intents
    .map((i) => i.ledgerTransactionId)
    .filter((x): x is string => Boolean(x))
  const ledgerTxns = ledgerIds.length
    ? await db.ledgerTransaction.findMany({
        where: { id: { in: ledgerIds }, organizationId: orgId },
        select: { id: true, reference: true },
      })
    : []
  const ledgerById = new Map(ledgerTxns.map((t) => [t.id, t]))

  const walletBalanceMinor = agent.wallet ? await walletLedgerBalance(agent.wallet.id) : null
  const scopes = safeJson<string[]>(agent.scopes, [])
  const merchants = safeJson<string[]>(agent.allowedMerchants, [])
  const pendingForAgent = intents.filter((i) => i.status === 'PENDING_APPROVAL').length
  const spendPct = agent.dailyLimitMinor
    ? Math.min(100, Math.max(0, pct(agent.dailySpendMinor, agent.dailyLimitMinor)))
    : null

  return (
    <div className="space-y-6">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All agents
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="text-3xl" aria-hidden>
              {agent.avatarEmoji ?? '🤖'}
            </span>
            <span>{agent.name}</span>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              {ROLE_LABELS[agent.role] ?? agent.role}
            </Badge>
            <AgentStatusBadge status={agent.status} />
          </span>
        }
        description={agent.description ?? 'No description recorded for this agent.'}
        actions={<AgentActions agentId={agent.id} name={agent.name} status={agent.status} />}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        {/* ── Deterministic policy panel ─────────────────────────── */}
        <Card className="xl:col-span-2">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpenCheck className="h-4 w-4 text-primary" aria-hidden />
              Deterministic policy — the guardrails
            </CardTitle>
            <p className="text-xs leading-relaxed text-muted-foreground">
              These rules are deterministic — the LLM cannot override them. Every intent is evaluated
              against them before anything moves.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <PolicyTile
                icon={ArrowUpRight}
                label="Per-transaction ceiling"
                value={
                  agent.perTransactionLimitMinor !== null ? (
                    <MoneyText minor={agent.perTransactionLimitMinor} currency={baseCurrency} />
                  ) : (
                    '—'
                  )
                }
                hint="Any single intent above this is declined outright."
              />
              <PolicyTile
                icon={CalendarDays}
                label="Daily ceiling"
                value={
                  agent.dailyLimitMinor !== null ? (
                    <MoneyText minor={agent.dailyLimitMinor} currency={baseCurrency} />
                  ) : (
                    '—'
                  )
                }
                hint="Cumulative daily spend must stay under this cap."
              />
              <PolicyTile
                icon={UserCheck}
                label="Approval threshold"
                value={
                  <MoneyText minor={agent.requiresApprovalAboveMinor} currency={baseCurrency} />
                }
                hint="Intents above this escalate to a human before execution."
              />
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Allowed scopes
              </p>
              <div className="flex flex-wrap gap-2">
                {scopes.length > 0 ? (
                  scopes.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
                    >
                      <span className="text-muted-foreground">{TOOL_LABELS[tool] ?? tool}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/70">{tool}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">No scopes granted.</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Store className="h-3 w-3" aria-hidden />
                Allowed merchants
              </p>
              <div className="flex flex-wrap gap-2">
                {merchants.length > 0 ? (
                  merchants.map((m) => (
                    <span
                      key={m}
                      className="rounded-md border border-primary/25 bg-primary/10 px-2 py-1 text-xs text-primary"
                    >
                      {m}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Any merchant on the rail.</span>
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Daily spend</span>
                <span className="tabular">
                  <MoneyText minor={agent.dailySpendMinor} currency={baseCurrency} strong />
                  {agent.dailyLimitMinor !== null ? (
                    <span className="text-muted-foreground">
                      {' / '}
                      <MoneyText minor={agent.dailyLimitMinor} currency={baseCurrency} muted />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/70"> · no daily cap</span>
                  )}
                </span>
              </div>
              {spendPct !== null ? (
                <>
                  <Progress value={spendPct} aria-label={`${agent.name} daily spend progress`} />
                  <p className="text-[11px] text-muted-foreground">
                    {spendPct}% of the daily ceiling consumed
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No daily ceiling configured — the approval threshold is the only escalation gate.
                </p>
              )}
            </div>

            <p className="border-t pt-4 text-[11px] leading-relaxed text-muted-foreground">
              Pipeline: intent → policy evaluation → (human approval above threshold) → ledger
              execution → audit hash-chain. <span className="text-foreground/80">AI proposes. Policy
              authorizes. The ledger records.</span>
            </p>
          </CardContent>
        </Card>

        {/* ── KYA identity record ─────────────────────────────────── */}
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">KYA record</CardTitle>
            <p className="text-xs text-muted-foreground">Identity, credentials and activity facts.</p>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">Registered</dt>
                <dd className="text-xs">{fmtDate(agent.createdAt)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">Last active</dt>
                <dd className="text-xs">
                  {agent.lastActiveAt ? timeAgo(agent.lastActiveAt) : 'never'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">Actions executed</dt>
                <dd className="tabular text-xs font-medium">{agent.totalActions}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-muted-foreground">Pending decisions</dt>
                <dd className="text-xs">
                  {pendingForAgent > 0 ? (
                    <Link href="/approvals" className="text-warning underline-offset-2 hover:underline">
                      {pendingForAgent} awaiting human
                    </Link>
                  ) : (
                    'none'
                  )}
                </dd>
              </div>
            </dl>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-1.5">
                <KeyRound className="h-3 w-3 text-muted-foreground" aria-hidden />
                <span className="font-mono text-[11px] text-muted-foreground">
                  {agent.credentialPrefix ?? '—'}
                </span>
              </div>
              <p className="text-[10px] leading-tight text-muted-foreground/70">
                credentials are hashed (SHA-256) — the secret is shown once at creation and cannot be
                recovered
              </p>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-1.5">
                <WalletIcon className="h-3 w-3 text-muted-foreground" aria-hidden />
                {agent.wallet ? (
                  <Link
                    href={`/wallets/${agent.wallet.id}`}
                    className="text-xs underline-offset-2 hover:underline"
                  >
                    {agent.wallet.label}
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">No dedicated wallet</span>
                )}
              </div>
              {agent.wallet ? (
                <p className="text-xs tabular">
                  <MoneyText minor={walletBalanceMinor ?? BigInt(0)} currency={agent.wallet.currency} />{' '}
                  <span className="text-muted-foreground">available</span>
                </p>
              ) : (
                <p className="text-[10px] leading-tight text-muted-foreground/70">
                  Agents never share human wallets — provision one to let this agent custody funds.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Simulator ────────────────────────────────────────────── */}
      <IntentSimulator
        agentId={agent.id}
        agentName={agent.name}
        agentEmoji={agent.avatarEmoji ?? '🤖'}
        agentStatus={agent.status}
        scopes={scopes}
        baseCurrency={baseCurrency}
      />

      {/* ── Intents feed ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Intent feed</CardTitle>
          <p className="text-xs text-muted-foreground">
            Every proposal this agent has made — with the policy verdict and what actually executed.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {intents.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<BookOpenCheck className="h-6 w-6" aria-hidden />}
                title="No intents yet"
                description="This agent has not proposed anything. Use the simulator above to propose an intent and watch the policy engine decide."
              />
            </div>
          ) : (
            <ul className="divide-y">
              {intents.map((intent) => {
                const payload = safeJson<Record<string, string>>(intent.payload, {})
                const amountMinor = payload.amountMinor
                const currency = payload.currency ?? baseCurrency
                const decision =
                  intent.policyDecision ?? (intent.status === 'EXECUTED' ? 'ALLOW' : null)
                const tone = policyDecisionTone(decision)
                const reasons = safeJson<string[]>(intent.policyReasons, []).filter(Boolean)
                const ledger = intent.ledgerTransactionId
                  ? ledgerById.get(intent.ledgerTransactionId)
                  : null
                return (
                  <li key={intent.id} className="space-y-2 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {intent.tool}
                        </span>
                        <p className="min-w-0 text-sm font-medium leading-snug">
                          {intent.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <IntentStatusBadge status={intent.status} />
                        {tone ? <ToneBadge tone={tone.tone}>{tone.label}</ToneBadge> : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {amountMinor ? (
                        <span className="tabular">
                          <MoneyText minor={amountMinor} currency={currency} strong />
                        </span>
                      ) : null}
                      {payload.merchant ? <span>merchant: {payload.merchant}</span> : null}
                      {payload.toWalletLabel ? <span>→ {payload.toWalletLabel}</span> : null}
                      <span>{timeAgo(intent.createdAt)}</span>
                      {intent.executedAt ? (
                        <span className="text-success/80">executed {timeAgo(intent.executedAt)}</span>
                      ) : null}
                    </div>

                    {reasons.length > 0 ? (
                      <ul className="space-y-1 rounded-lg border bg-muted/30 p-3">
                        {reasons.map((reason, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
                          >
                            <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                            {reason}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      {ledger ? (
                        <Link
                          href={`/transactions?ref=${ledger.reference}`}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-primary underline-offset-2 hover:underline"
                        >
                          ledger {truncateMiddle(ledger.reference, 10, 6)}
                          <ArrowUpRight className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : null}
                      {intent.status === 'PENDING_APPROVAL' ? (
                        <Link
                          href="/approvals"
                          className="inline-flex items-center gap-1 text-[11px] text-warning underline-offset-2 hover:underline"
                        >
                          awaiting human decision
                          <ArrowUpRight className="h-3 w-3" aria-hidden />
                        </Link>
                      ) : null}
                      {intent.failureReason ? (
                        <span className="text-[11px] text-danger">{intent.failureReason}</span>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
