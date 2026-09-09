import type { Metadata } from 'next'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Coins,
  CreditCard,
  Landmark,
  ScanSearch,
  ShieldAlert,
  ShieldQuestion,
  Smartphone,
  Wallet as WalletIcon,
  Webhook,
  XCircle,
} from 'lucide-react'

import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { walletLedgerBalance } from '@/lib/ledger'
import { availableBalanceMinor } from '@/lib/transfers'
import { formatMinor } from '@novera/money'
import { METHOD_META, WALLET_TYPE_META } from '@novera/domain'
import { timeAgo, titleCase, truncateMiddle } from '@/lib/format'
import { cn } from '@/lib/utils'

import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { MoneyText } from '@/components/novera/money-text'
import { EmptyState } from '@/components/novera/empty-state'
import {
  IntentStatusBadge,
  PaymentStatusBadge,
  StatusBadge,
  ToneBadge,
} from '@/components/novera/status-badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { VolumeChart, type VolumePoint } from './charts'

export const metadata: Metadata = {
  title: 'Overview',
  description:
    'Cash position, settled volume and live operational activity for your organization. AI proposes. Policy authorizes. The ledger records.',
}

const DAY_MS = 86_400_000
/** BigInt(0) instead of a 0n literal — the repo tsconfig targets ES2017, where BigInt literal syntax is unavailable to tsc (the dev compiler handles it fine). */
const ZERO_MINOR = BigInt(0)
/** The organization renders in Africa/Nairobi (org timezone default in the kernel). */
const ORG_TZ = 'Africa/Nairobi'
const nairobiDayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: ORG_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** YYYY-MM-DD in the org timezone — chart buckets and day labels share this. */
function dayKey(d: Date): string {
  return nairobiDayKey.format(d)
}

/** KES-denominated methods stacked in the volume chart (USDC settles in USDC). */
const KES_CHART_METHODS = ['MPESA', 'CARD', 'BANK', 'WALLET'] as const
type KesChartMethod = (typeof KES_CHART_METHODS)[number]

/** Per-wallet cash row derived from the canonical ledger + hold functions. */
interface WalletRow {
  id: string
  label: string
  type: string
  currency: string
  ledgerBalanceMinor: bigint
  availableMinor: bigint
  reservedMinor: bigint
}

const METHOD_ICON: Record<string, LucideIcon> = {
  MPESA: Smartphone,
  CARD: CreditCard,
  BANK: Landmark,
  WALLET: WalletIcon,
  USDC: Coins,
}

function MethodBadge({ method }: { method: string }) {
  const meta = METHOD_META[method]
  const label = meta?.label ?? titleCase(method)
  const Icon = METHOD_ICON[method]
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {Icon ? <Icon className="h-3 w-3" aria-hidden /> : null}
      {label}
    </span>
  )
}

const ROW_LINK_CLASSES =
  '-mx-1 flex items-start gap-3 rounded-md px-1 py-2.5 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring'

export default async function DashboardPage() {
  const session = await requireSession()
  const orgId = session.organization.id
  const now = new Date()
  const d30 = new Date(now.getTime() - 30 * DAY_MS)
  const d60 = new Date(now.getTime() - 60 * DAY_MS)

  const [
    settled60,
    failedCurrent,
    failedPrior,
    pendingApprovals,
    walletBase,
    recentPayments,
    recentIntents,
    reconOpen,
    reviewQueue,
    webhookFailures,
  ] = await Promise.all([
    // 60 days of settled inbound payments — powers the 30d KPI, the
    // prior-period delta and the daily chart buckets in one pass.
    db.payment.findMany({
      where: {
        organizationId: orgId,
        status: 'SETTLED',
        direction: 'IN',
        settledAt: { gte: d60 },
      },
      select: { method: true, currency: true, amountMinor: true, settledAt: true },
    }),
    db.payment.count({
      where: { organizationId: orgId, direction: 'IN', status: 'FAILED', failedAt: { gte: d30 } },
    }),
    db.payment.count({
      where: {
        organizationId: orgId,
        direction: 'IN',
        status: 'FAILED',
        failedAt: { gte: d60, lt: d30 },
      },
    }),
    db.approvalRequest.findMany({
      where: { organizationId: orgId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: {
        requesterLabel: true,
        action: true,
        amountMinor: true,
        currency: true,
        expiresAt: true,
      },
    }),
    // Wallet list — enriched from the canonical ledger + hold functions below.
    db.wallet.findMany({
      where: { organizationId: orgId },
      orderBy: [{ type: 'asc' }, { label: 'asc' }],
      select: { id: true, label: true, type: true, currency: true },
    }),
    db.payment.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        reference: true,
        customerName: true,
        customerEmail: true,
        amountMinor: true,
        currency: true,
        method: true,
        status: true,
        createdAt: true,
      },
    }),
    db.agentIntent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        description: true,
        status: true,
        createdAt: true,
        agent: { select: { name: true, avatarEmoji: true } },
      },
    }),
    db.reconciliationCase.count({
      where: { organizationId: orgId, status: { in: ['OPEN', 'INVESTIGATING'] } },
    }),
    db.payment.count({
      where: { organizationId: orgId, riskDecision: 'REVIEW', status: 'PENDING' },
    }),
    db.webhookDelivery.count({
      where: { organizationId: orgId, status: { in: ['FAILED', 'DEAD'] } },
    }),
  ])

  // ── Cash position: canonical ledger balance minus active holds, per wallet ─
  const wallets: WalletRow[] = await Promise.all(
    walletBase.map(async (w): Promise<WalletRow> => {
      const [ledgerBalanceMinor, available] = await Promise.all([
        walletLedgerBalance(w.id),
        availableBalanceMinor(w.id),
      ])
      return {
        id: w.id,
        label: w.label,
        type: w.type,
        currency: w.currency,
        ledgerBalanceMinor,
        availableMinor: available,
        reservedMinor: ledgerBalanceMinor - available,
      }
    })
  )

  // ── Settled volume: KPI totals + daily buckets (server-side JS) ─────────
  let kes30 = ZERO_MINOR
  let kesPrev = ZERO_MINOR
  let count30 = 0
  let countPrev = 0
  const settledOtherByCurrency = new Map<string, bigint>()

  const byDay = new Map<string, VolumePoint>()
  const dayKeys: string[] = []
  for (let i = 29; i >= 0; i--) {
    const key = dayKey(new Date(now.getTime() - i * DAY_MS))
    dayKeys.push(key)
    byDay.set(key, { date: key, MPESA: 0, CARD: 0, BANK: 0, WALLET: 0 })
  }

  for (const p of settled60) {
    if (!p.settledAt) continue
    const inCurrent = p.settledAt >= d30
    if (inCurrent) count30 += 1
    else countPrev += 1
    if (p.currency === 'KES') {
      if (inCurrent) {
        kes30 += p.amountMinor
        if ((KES_CHART_METHODS as readonly string[]).includes(p.method)) {
          const point = byDay.get(dayKey(p.settledAt))
          if (point) {
            point[p.method as KesChartMethod] += Number(p.amountMinor) // exact: < 2^53
          }
        }
      } else {
        kesPrev += p.amountMinor
      }
    } else if (inCurrent) {
      // USDC-denominated settlements stay in their native unit — never
      // mixed into the KES axis (product honesty rule).
      const acc = settledOtherByCurrency.get(p.currency) ?? ZERO_MINOR
      settledOtherByCurrency.set(p.currency, acc + p.amountMinor)
    }
  }

  const chartData = dayKeys.map((key) => byDay.get(key)!)
  const usdc30 = settledOtherByCurrency.get('USDC') ?? ZERO_MINOR
  const otherSettledNote = [...settledOtherByCurrency.entries()]
    .map(([cur, minor]) => formatMinor(minor, cur)) // formatMinor carries the unit (e.g. "28.740000 USDC")
    .join(' · ')

  const volumeDeltaPct =
    kesPrev > ZERO_MINOR
      ? Math.round((Number(kes30 - kesPrev) / Number(kesPrev)) * 1000) / 10
      : undefined

  // ── Cash position: group canonical wallet summaries by currency ────────
  const cashByCurrency = new Map<string, { ledger: bigint; available: bigint; count: number }>()
  for (const w of wallets) {
    const entry = cashByCurrency.get(w.currency) ?? {
      ledger: ZERO_MINOR,
      available: ZERO_MINOR,
      count: 0,
    }
    entry.ledger += w.ledgerBalanceMinor
    entry.available += w.availableMinor
    entry.count += 1
    cashByCurrency.set(w.currency, entry)
  }
  const currencyRank = ['KES', 'USD', 'USDC']
  const cashCurrencies = [...cashByCurrency.keys()].sort((a, b) => {
    const ra = currencyRank.indexOf(a)
    const rb = currencyRank.indexOf(b)
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb)
  })
  const kesCash = cashByCurrency.get('KES')
  const cashHint = cashCurrencies
    .filter((cur) => cur !== 'KES')
    .map((cur) => {
      const amount = formatMinor(cashByCurrency.get(cur)!.available, cur)
      // formatMinor already carries the unit for symbol-suffixed codes (USDC);
      // USD renders as "$ 10,874.74" so the code is appended for clarity.
      return cur === 'USD' ? `+ ${amount} USD` : `+ ${amount}`
    })
    .join(' · ')

  const failedDiff = failedCurrent - failedPrior
  const failedDelta =
    failedDiff === 0
      ? 'even with prior 30d'
      : `${failedDiff > 0 ? '+' : '−'}${Math.abs(failedDiff)} vs ${failedPrior} prior 30d`

  const nextApproval = pendingApprovals[0]
  const approvalDelta = nextApproval
    ? nextApproval.amountMinor != null
      ? `${nextApproval.requesterLabel ?? 'Request'} · ${formatMinor(nextApproval.amountMinor, nextApproval.currency ?? 'KES')}`
      : (nextApproval.requesterLabel ?? 'Awaiting decision')
    : 'control-plane queue is clear'

  const hasVolume = count30 + countPrev > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={`Cash position, settled volume and control-plane activity for ${session.organization.name}. AI proposes. Policy authorizes. The ledger records.`}
        actions={
          <>
            {session.organization.mode === 'TEST' ? (
              <ToneBadge tone="warning" className="hidden sm:inline-flex">
                TEST MODE
              </ToneBadge>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link href="/payments">All payments</Link>
            </Button>
            {pendingApprovals.length > 0 ? (
              <Button size="sm" asChild>
                <Link href="/approvals">
                  Review {pendingApprovals.length} approval{pendingApprovals.length > 1 ? 's' : ''}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Settled volume (30d)"
          value={<MoneyText minor={kes30.toString()} currency="KES" />}
          deltaPct={volumeDeltaPct}
          deltaLabel={`${count30} payments vs ${countPrev} prior 30d`}
          hint={usdc30 > ZERO_MINOR ? `+ ${formatMinor(usdc30, 'USDC')}` : undefined}
          icon={<Banknote className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Available cash"
          value={<MoneyText minor={(kesCash?.available ?? ZERO_MINOR).toString()} currency="KES" />}
          deltaLabel={`across ${wallets.length} wallets`}
          hint={cashHint || undefined}
          icon={<WalletIcon className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Failed payments (30d)"
          value={failedCurrent}
          deltaLabel={failedDelta}
          icon={<XCircle className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Pending approvals"
          value={pendingApprovals.length}
          deltaLabel={approvalDelta}
          icon={<ShieldQuestion className="h-4 w-4" aria-hidden />}
        />
      </section>

      {/* ── Main area: volume chart (2/3) + cash position (1/3) ─────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Settled volume</CardTitle>
            <CardDescription>
              Daily settled KES volume by payment method · last 30 days
            </CardDescription>
            {otherSettledNote ? (
              <CardAction>
                <span className="hidden rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground md:inline-block">
                  {otherSettledNote} settled natively
                </span>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            {hasVolume ? (
              <>
                <VolumeChart data={chartData} />
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Ledger-derived from SETTLED inbound payments only — processing
                  and pending funds are never counted as volume.
                  {otherSettledNote
                    ? ' Non-KES settlements are kept in their native unit and never mixed into the KES axis.'
                    : ''}
                </p>
              </>
            ) : (
              <EmptyState
                icon={<ArrowDownLeft className="h-5 w-5" aria-hidden />}
                title="No settled volume yet"
                description="Settled payments from the last 30 days will chart here, stacked by payment method."
                action={
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/payments">View payments</Link>
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cash position</CardTitle>
            <CardDescription>
              Available = ledger balance − active holds, per wallet
            </CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild className="text-primary">
                <Link href="/wallets">
                  Wallets <ArrowUpRight aria-hidden />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 sm:grid-cols-3"
              aria-label="Available cash by currency"
            >
              {cashCurrencies.map((cur) => {
                const entry = cashByCurrency.get(cur)!
                return (
                  <div key={cur} className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {cur} available
                    </p>
                    <MoneyText
                      minor={entry.available.toString()}
                      currency={cur}
                      strong
                      className="mt-0.5 block truncate text-sm"
                    />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {entry.count} wallet{entry.count > 1 ? 's' : ''}
                    </p>
                  </div>
                )
              })}
            </div>
            <ScrollArea className="max-h-[23rem]">
              <div className="divide-y">
                {wallets.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{w.label}</span>
                        <span className="rounded bg-muted px-1 py-px font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {w.currency}
                        </span>
                      </p>
                      <StatusBadge
                        meta={WALLET_TYPE_META}
                        status={w.type}
                        className="mt-1 px-1.5 py-0 text-[10px]"
                      />
                    </div>
                    <div className="shrink-0 text-right">
                      <MoneyText minor={w.availableMinor.toString()} currency={w.currency} strong className="text-sm" />
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        ledger{' '}
                        <MoneyText
                          minor={w.ledgerBalanceMinor.toString()}
                          currency={w.currency}
                          muted
                          className="text-[11px]"
                        />
                      </p>
                      <p className="text-[11px]">
                        {w.reservedMinor > ZERO_MINOR ? (
                          <span className="text-warning">
                            reserved{' '}
                            <MoneyText
                              minor={w.reservedMinor.toString()}
                              currency={w.currency}
                              className="text-[11px]"
                            />
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">no active holds</span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* ── Activity feed (3/5) + agentic activity (2/5) ────────────────── */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Last 10 payments across every rail</CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild className="text-primary">
                <Link href="/payments">
                  View all <ArrowUpRight aria-hidden />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {recentPayments.length === 0 ? (
              <EmptyState
                icon={<ArrowDownLeft className="h-5 w-5" aria-hidden />}
                title="No payments yet"
                description="Payments created through any rail will appear here the moment the ledger records them."
              />
            ) : (
              <ScrollArea className="max-h-[26rem]">
                <div className="divide-y">
                  {recentPayments.map((p) => (
                    <Link key={p.id} href={`/payments/${p.id}`} className={ROW_LINK_CLASSES}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {p.customerName || p.customerEmail || 'Unattributed payment'}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <MethodBadge method={p.method} />
                          <span className="font-mono">{truncateMiddle(p.reference, 8, 4)}</span>
                          <span aria-hidden>·</span>
                          <time dateTime={p.createdAt.toISOString()}>{timeAgo(p.createdAt)}</time>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <MoneyText
                          minor={p.amountMinor.toString()}
                          currency={p.currency}
                          strong
                          className="text-sm"
                        />
                        <PaymentStatusBadge status={p.status} className="px-1.5 py-0 text-[10px]" />
                      </div>
                    </Link>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Agentic activity</CardTitle>
            <CardDescription>
              Agent intents — proposals gated by policy and approvals
            </CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild className="text-primary">
                <Link href="/agents">
                  View all <ArrowUpRight aria-hidden />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {recentIntents.length === 0 ? (
              <EmptyState
                icon={<ShieldAlert className="h-5 w-5" aria-hidden />}
                title="No agent activity yet"
                description="Agents propose intents; policy allows or rejects, and the ledger only records what executed."
              />
            ) : (
              <ScrollArea className="max-h-[26rem]">
                <div className="divide-y">
                  {recentIntents.map((intent) => (
                    <Link key={intent.id} href="/agents" className={ROW_LINK_CLASSES}>
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-base"
                        aria-hidden
                      >
                        {intent.agent.avatarEmoji ?? '🤖'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium">{intent.agent.name}</p>
                          <time
                            className="shrink-0 text-[11px] text-muted-foreground"
                            dateTime={intent.createdAt.toISOString()}
                          >
                            {timeAgo(intent.createdAt)}
                          </time>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {intent.description}
                        </p>
                        <div className="mt-1.5">
                          <IntentStatusBadge status={intent.status} className="px-1.5 py-0 text-[10px]" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Ops health glance ───────────────────────────────────────────── */}
      <section aria-label="Operational health" className="grid gap-4 sm:grid-cols-3">
        <OpsCard
          href="/reconciliation"
          icon={ScanSearch}
          label="Reconciliation"
          count={reconOpen}
          countTone={reconOpen > 0 ? 'text-warning' : 'text-success'}
          detail="Open and investigating cases — ledger vs provider statements"
        />
        <OpsCard
          href="/payments"
          icon={ShieldAlert}
          label="Risk review queue"
          count={reviewQueue}
          countTone={reviewQueue > 0 ? 'text-warning' : 'text-success'}
          detail="Payments held for review (risk decision REVIEW, status pending)"
        />
        <OpsCard
          href="/developers"
          icon={Webhook}
          label="Webhook failures"
          count={webhookFailures}
          countTone={webhookFailures > 0 ? 'text-danger' : 'text-success'}
          detail="Deliveries failed or dead — retry or replay from the developer console"
        />
      </section>
    </div>
  )
}

function OpsCard({
  href,
  icon: Icon,
  label,
  count,
  countTone,
  detail,
}: {
  href: string
  icon: LucideIcon
  label: string
  count: number
  countTone: string
  detail: string
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border bg-card p-5 shadow-sm outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
          <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
        </div>
        <ArrowUpRight
          className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>
      <p className={cn('mt-3 text-2xl font-semibold tabular', countTone)}>{count}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </Link>
  )
}
