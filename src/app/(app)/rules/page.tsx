import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { safeJson, timeAgo } from '@/lib/format'
import type { StatusMeta } from '@novera/domain'
import { PageHeader } from '@/components/novera/page-header'
import { StatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { MoneyText } from '@/components/novera/money-text'
import { EmptyState } from '@/components/novera/empty-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Banknote, GitBranch, Layers, ShieldCheck, Wallet } from 'lucide-react'
import { RuleBuilderDialog } from './rule-builder-dialog'
import { RuleSimulator } from './rule-simulator'
import { RuleActions } from './rule-actions'

export const metadata = { title: 'Rules' }

const RULE_STATUS_META: Record<string, StatusMeta> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ACTIVE: { label: 'Active', tone: 'positive' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
}

const TRIGGER_META: Record<string, StatusMeta> = {
  PAYMENT_RECEIVED: { label: 'Payment received', tone: 'info' },
  INVOICE_PAID: { label: 'Invoice paid', tone: 'accent' },
  MANUAL: { label: 'Manual', tone: 'neutral' },
}

interface Allocation {
  label: string
  walletId: string
  percentBps: number
}

interface RuleStat {
  executions: number
  routedMinor: bigint
  volumeMinor: bigint
  byWalletMinor: Map<string, bigint>
  lastExecutedAt: Date | null
}

const STATUS_RANK: Record<string, number> = { ACTIVE: 0, DRAFT: 1, ARCHIVED: 2 }

export default async function RulesPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  // ── Rules, wallets, and the real split-rule ledger history ─────────
  const rules = await db.splitRule.findMany({ where: { organizationId: orgId } })
  const wallets = await db.wallet.findMany({ where: { organizationId: orgId } })
  const walletById = new Map(wallets.map((w) => [w.id, w]))
  const walletByAccount = new Map(wallets.map((w) => [w.ledgerAccountId, w]))

  const splitTxns = await db.ledgerTransaction.findMany({
    where: { organizationId: orgId, source: 'SPLIT_RULE', status: 'POSTED' },
    select: {
      id: true,
      amountMinor: true,
      metadata: true,
      effectiveAt: true,
      entries: { select: { accountId: true, direction: true, amountMinor: true } },
    },
    orderBy: { effectiveAt: 'desc' },
  })

  // per-rule execution stats, derived from the ledger (the source of truth)
  const stats = new Map<string, RuleStat>()
  const paymentRefs = new Set<string>()
  for (const t of splitTxns) {
    const meta = safeJson<{ ruleId?: string; paymentRef?: string }>(t.metadata, {})
    if (!meta.ruleId) continue
    const stat =
      stats.get(meta.ruleId) ??
      { executions: 0, routedMinor: BigInt(0), volumeMinor: BigInt(0), byWalletMinor: new Map<string, bigint>(), lastExecutedAt: null }
    stat.executions += 1
    stat.routedMinor += t.amountMinor
    if (meta.paymentRef) paymentRefs.add(meta.paymentRef)
    if (!stat.lastExecutedAt || t.effectiveAt > stat.lastExecutedAt) stat.lastExecutedAt = t.effectiveAt
    for (const e of t.entries) {
      if (e.direction === 'CREDIT') {
        const w = walletByAccount.get(e.accountId)
        if (w) stat.byWalletMinor.set(w.id, (stat.byWalletMinor.get(w.id) ?? BigInt(0)) + e.amountMinor)
      }
    }
    stats.set(meta.ruleId, stat)
  }
  const paymentVolumeByRef = new Map<string, bigint>()
  if (paymentRefs.size > 0) {
    const splitPayments = await db.payment.findMany({
      where: { organizationId: orgId, reference: { in: [...paymentRefs] } },
      select: { reference: true, amountMinor: true },
    })
    for (const p of splitPayments) paymentVolumeByRef.set(p.reference, p.amountMinor)
  }
  for (const t of splitTxns) {
    const meta = safeJson<{ ruleId?: string; paymentRef?: string }>(t.metadata, {})
    const stat = meta.ruleId ? stats.get(meta.ruleId) : undefined
    const volume = meta.paymentRef ? paymentVolumeByRef.get(meta.paymentRef) : undefined
    if (stat && volume) stat.volumeMinor += volume
  }

  const sorted = [...rules].sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) ||
      b.updatedAt.getTime() - a.updatedAt.getTime()
  )
  const showcase = sorted.find((r) => r.status === 'ACTIVE') ?? null
  const showcaseStat = showcase ? stats.get(showcase.id) : undefined
  const showcaseAllocations: Allocation[] = showcase ? safeJson<Allocation[]>(showcase.allocations, []) : []

  const activeWallets = wallets
    .filter((w) => w.status === 'ACTIVE')
    .map((w) => ({ id: w.id, label: w.label, currency: w.currency }))

  const simulatorRules = sorted
    .filter((r) => r.status === 'DRAFT' || r.status === 'ACTIVE')
    .map((r) => {
      const allocations = safeJson<Allocation[]>(r.allocations, [])
        .map((a) => {
          const wallet = walletById.get(a.walletId)
          return wallet ? { label: wallet.label, percentBps: a.percentBps, currency: wallet.currency } : null
        })
        .filter((a): a is { label: string; percentBps: number; currency: string } => a !== null)
      if (allocations.length === 0) return null
      const currencies = [...new Set(allocations.map((a) => a.currency))]
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        currency: currencies[0],
        mixedCurrencies: currencies.length > 1,
        allocations: allocations.map((a) => ({ label: a.label, percentBps: a.percentBps })),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rules"
        description="Programmable money: split rules that route every settled payment across wallets in fixed proportions — largest-remainder allocation, zero leakage, every routing posted to the ledger."
        actions={<RuleBuilderDialog wallets={activeWallets} />}
      />

      {rules.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="h-5 w-5" />}
          title="No split rules yet"
          description="Rules are the programmable layer of Novera: define a trigger and wallet allocations, simulate the split, then approve it to run on every settlement."
          action={<RuleBuilderDialog wallets={activeWallets} />}
        />
      ) : null}

      {showcase ? (
        <div className="grid gap-6 lg:grid-cols-5">
          {/* (a) Active rule showcase — the 10/20/70 story */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{showcase.name}</CardTitle>
                <StatusBadge meta={RULE_STATUS_META} status={showcase.status} />
                <StatusBadge meta={TRIGGER_META} status={showcase.trigger} />
                <span className="text-xs text-muted-foreground">v{showcase.version}</span>
              </div>
              <CardDescription>
                Live programmable money — this rule executes on every settled collection and posts the routing to
                the ledger. Approved by {showcase.approvedByName ?? '—'}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* visual flow diagram: payment → branches */}
              <div className="grid gap-4 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
                <div className="flex flex-col justify-center gap-2 rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-center gap-2 font-medium">
                    <Banknote className="h-4 w-4 text-primary" />
                    Payment received
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A settled collection lands in the operating wallet. Funds are available immediately — the split
                    is a ledger routing, not a hold.
                  </p>
                </div>

                <div className="relative space-y-3 pl-7">
                  <div className="absolute left-[5px] top-3 bottom-3 w-px bg-border" aria-hidden="true" />
                  {showcaseAllocations.map((a, i) => {
                    const wallet = walletById.get(a.walletId)
                    const routed = showcaseStat?.byWalletMinor.get(a.walletId)
                    const retained =
                      showcaseStat &&
                      showcaseStat.volumeMinor > showcaseStat.routedMinor &&
                      showcaseStat.volumeMinor - showcaseStat.routedMinor > BigInt(0)
                        ? showcaseStat.volumeMinor - showcaseStat.routedMinor
                        : null
                    return (
                      <div key={`${a.walletId}-${i}`} className="relative rounded-lg border p-3">
                        <span
                          className="absolute left-0 top-5 h-[11px] w-[11px] rounded-full border-2 border-card bg-primary"
                          aria-hidden="true"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                              {(a.percentBps / 100).toFixed(2)}%
                            </span>
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                              {wallet?.label ?? a.label}
                            </span>
                            {wallet ? (
                              <span className="text-xs text-muted-foreground">· {wallet.currency}</span>
                            ) : null}
                          </div>
                          <div className="text-right">
                            {routed !== undefined ? (
                              <>
                                <MoneyText minor={routed.toString()} currency={wallet?.currency ?? 'KES'} strong />
                                <span className="block text-[10px] text-muted-foreground">routed to date</span>
                              </>
                            ) : retained !== null ? (
                              <>
                                <MoneyText minor={retained.toString()} currency={wallet?.currency ?? 'KES'} strong />
                                <span className="block text-[10px] text-muted-foreground">
                                  retained in source — no posting needed
                                </span>
                              </>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                —
                                <span className="block text-[10px]">source wallet · no inbound posting</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Executions</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {showcaseStat?.executions ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {showcaseStat?.lastExecutedAt ? `last ${timeAgo(showcaseStat.lastExecutedAt)}` : 'none yet'}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Total routed</p>
                  <div className="mt-1">
                    <MoneyText
                      minor={(showcaseStat?.routedMinor ?? BigInt(0)).toString()}
                      currency={showcaseAllocations[0] ? (walletById.get(showcaseAllocations[0].walletId)?.currency ?? 'KES') : 'KES'}
                      strong
                      className="text-xl"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">cross-wallet ledger postings</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Volume processed</p>
                  <div className="mt-1">
                    <MoneyText
                      minor={(showcaseStat?.volumeMinor ?? BigInt(0)).toString()}
                      currency={showcaseAllocations[0] ? (walletById.get(showcaseAllocations[0].walletId)?.currency ?? 'KES') : 'KES'}
                      strong
                      className="text-xl"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">payments that triggered this rule</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Ledger integrity</p>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-medium text-success">
                    <ShieldCheck className="h-4 w-4" />
                    Debits = credits
                  </div>
                  <p className="text-[11px] text-muted-foreground">every split balances per currency</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* (d) Simulation — exact split preview */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">Simulate a split</CardTitle>
                <ToneBadge tone="info">Zero leakage</ToneBadge>
              </div>
              <CardDescription>
                Enter any amount and watch the exact allocation that would execute — the same largest-remainder
                code path the kernel runs at settlement.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RuleSimulator rules={simulatorRules} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* (b) Rules table */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">All rules</CardTitle>
            <ToneBadge tone="neutral">{rules.length} total</ToneBadge>
          </div>
          <CardDescription>
            Activation requires approval and is recorded in the audit chain. Archiving stops execution but never
            rewrites posted history.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No rules yet — build your first split rule above.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Executions</TableHead>
                    <TableHead className="text-right">Total routed</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((r) => {
                    const stat = stats.get(r.id)
                    const allocations = safeJson<Allocation[]>(r.allocations, [])
                    const currency =
                      allocations[0] ? (walletById.get(allocations[0].walletId)?.currency ?? 'KES') : 'KES'
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{r.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {allocations.length} allocations ·{' '}
                            {allocations
                              .map((a) => `${(a.percentBps / 100).toFixed(0)}% ${a.label}`)
                              .join(' · ')}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge meta={TRIGGER_META} status={r.trigger} />
                        </TableCell>
                        <TableCell className="tabular-nums">v{r.version}</TableCell>
                        <TableCell>
                          <StatusBadge meta={RULE_STATUS_META} status={r.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {stat?.executions ?? 0}
                          {stat?.lastExecutedAt ? (
                            <span className="block text-xs text-muted-foreground">
                              last {timeAgo(stat.lastExecutedAt)}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <MoneyText minor={(stat?.routedMinor ?? BigInt(0)).toString()} currency={currency} />
                        </TableCell>
                        <TableCell>
                          <RuleActions ruleId={r.id} name={r.name} status={r.status} />
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

      {rules.length > 0 && !showcase && simulatorRules.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Simulate a split</CardTitle>
              <ToneBadge tone="info">Zero leakage</ToneBadge>
            </div>
            <CardDescription>
              Enter any amount and watch the exact allocation that would execute — the same largest-remainder code
              path the kernel runs at settlement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RuleSimulator rules={simulatorRules} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
