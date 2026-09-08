import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { walletSummary } from '@/lib/transfers'
import { METHOD_META, WALLET_TYPE_META } from '@novera/domain'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { MoneyText } from '@/components/novera/money-text'
import { StatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { EmptyState } from '@/components/novera/empty-state'
import { fmtDateTime } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Landmark,
  DollarSign,
  Coins,
  CalendarClock,
  Banknote,
  TrendingUp,
  ArrowLeftRight,
  Info,
} from 'lucide-react'
import { CollectionsChart } from './collections-chart'
import { ProjectionChart } from './projection-chart'

export const metadata = { title: 'Treasury' }

const DAY_MS = 24 * 60 * 60 * 1000
const OPEN_INVOICE_STATUSES = ['ISSUED', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE']

/**
 * Local view of walletSummary() rows. The shared helper infers its return
 * as never[] under this repo's tsc target (it builds fine through the
 * Next compiler); the assertion keeps the canonical data with an
 * explicit, honest shape.
 */
interface WalletRow {
  id: string
  label: string
  type: string
  currency: string
  status: string
  ledgerBalanceMinor: bigint
  availableMinor: bigint
  reservedMinor: bigint
}
const BUCKETS = ['overdue', 'thisWeek', 'thisMonth', 'later'] as const
type Bucket = (typeof BUCKETS)[number]
const BUCKET_LABELS: Record<Bucket, string> = {
  overdue: 'Overdue',
  thisWeek: 'This week',
  thisMonth: 'This month',
  later: 'Later',
}

function bucketFor(dueAt: Date | null, now: Date): Bucket {
  if (!dueAt) return 'later'
  if (dueAt < now) return 'overdue'
  if (dueAt.getTime() <= now.getTime() + 7 * DAY_MS) return 'thisWeek'
  if (dueAt.getTime() <= now.getTime() + 30 * DAY_MS) return 'thisMonth'
  return 'later'
}

export default async function TreasuryPage() {
  const session = await requireSession()
  const orgId = session.organization.id
  const now = new Date()

  // ── Cash position (org-scoped, ledger-derived) ─────────────────────
  const wallets = (await walletSummary(orgId)) as WalletRow[]
  const currencyOrder = (c: string) => (c === 'KES' ? 0 : 1)
  const byCurrency = new Map<string, { totalMinor: bigint; walletCount: number }>()
  for (const w of wallets) {
    const entry = byCurrency.get(w.currency) ?? { totalMinor: BigInt(0), walletCount: 0 }
    entry.totalMinor += w.ledgerBalanceMinor
    entry.walletCount += 1
    byCurrency.set(w.currency, entry)
  }
  const currencyRows = [...byCurrency.entries()].sort(
    (a, b) => currencyOrder(a[0]) - currencyOrder(b[0]) || a[0].localeCompare(b[0])
  )
  const kesTotal = byCurrency.get('KES')?.totalMinor ?? BigInt(0)
  const nonKes = currencyRows.filter(([c]) => c !== 'KES')

  // ── Expected collections: open invoices by due-date bucket ─────────
  const openInvoices = await db.invoice.findMany({
    where: { organizationId: orgId, status: { in: OPEN_INVOICE_STATUSES } },
    select: { currency: true, totalMinor: true, amountPaidMinor: true, dueAt: true },
  })
  const collectionsByCurrency = new Map<
    string,
    { total: bigint; count: number; buckets: Record<Bucket, { minor: bigint; count: number }> }
  >()
  for (const inv of openInvoices) {
    const balanceDue = inv.totalMinor - inv.amountPaidMinor
    if (balanceDue <= BigInt(0)) continue
    const bucket = bucketFor(inv.dueAt, now)
    const entry =
      collectionsByCurrency.get(inv.currency) ??
      {
        total: BigInt(0),
        count: 0,
        buckets: {
          overdue: { minor: BigInt(0), count: 0 },
          thisWeek: { minor: BigInt(0), count: 0 },
          thisMonth: { minor: BigInt(0), count: 0 },
          later: { minor: BigInt(0), count: 0 },
        },
      }
    entry.total += balanceDue
    entry.count += 1
    entry.buckets[bucket].minor += balanceDue
    entry.buckets[bucket].count += 1
    collectionsByCurrency.set(inv.currency, entry)
  }
  const collectionRows = [...collectionsByCurrency.entries()].sort(
    (a, b) => currencyOrder(a[0]) - currencyOrder(b[0])
  )
  const kesCollections = collectionsByCurrency.get('KES')
  const hasNonKesCollections = collectionRows.some(([c]) => c !== 'KES')
  const openCount = openInvoices.filter((i) => i.totalMinor - i.amountPaidMinor > BigInt(0)).length
  const totalReserved = wallets.reduce((a, w) => a + w.reservedMinor, BigInt(0))

  // ── Recent payouts (money out), last 30 days ───────────────────────
  const d30 = new Date(now.getTime() - 30 * DAY_MS)
  const payouts = await db.payment.findMany({
    where: { organizationId: orgId, direction: 'OUT', createdAt: { gte: d30 } },
    select: { method: true, currency: true, status: true, amountMinor: true },
  })
  const payoutAgg = new Map<
    string,
    {
      method: string
      currency: string
      settledMinor: bigint
      settledCount: number
      inflightMinor: bigint
      inflightCount: number
    }
  >()
  for (const p of payouts) {
    const key = `${p.method}:${p.currency}`
    const row =
      payoutAgg.get(key) ?? {
        method: p.method,
        currency: p.currency,
        settledMinor: BigInt(0),
        settledCount: 0,
        inflightMinor: BigInt(0),
        inflightCount: 0,
      }
    if (p.status === 'SETTLED') {
      row.settledMinor += p.amountMinor
      row.settledCount += 1
    } else {
      row.inflightMinor += p.amountMinor
      row.inflightCount += 1
    }
    payoutAgg.set(key, row)
  }
  const payoutRows = [...payoutAgg.values()].sort((a, b) =>
    b.settledMinor > a.settledMinor ? 1 : b.settledMinor < a.settledMinor ? -1 : 0
  )

  // ── Forecast: trailing 60-day net flow (settled IN − payouts OUT) ──
  const d60 = new Date(now.getTime() - 60 * DAY_MS)
  const flows = await db.payment.groupBy({
    by: ['direction'],
    where: {
      organizationId: orgId,
      status: 'SETTLED',
      currency: 'KES',
      settledAt: { gte: d60 },
    },
    _sum: { amountMinor: true, feeMinor: true },
    _count: true,
  })
  const inFlow = flows.find((f) => f.direction === 'IN')
  const outFlow = flows.find((f) => f.direction === 'OUT')
  // settled collections net of provider fees; payouts post at face value
  const netInMinor = (inFlow?._sum.amountMinor ?? BigInt(0)) - (inFlow?._sum.feeMinor ?? BigInt(0))
  const netOutMinor = outFlow?._sum.amountMinor ?? BigInt(0)
  const trailingNetMinor = netInMinor - netOutMinor
  const dailyAvgMinor = trailingNetMinor / BigInt(60)
  // chart coordinates only — every underlying value computed in BigInt minor
  // units; Number conversion is for positioning recharts points (display only)
  const projectionPoints: { label: string; value: number }[] = []
  for (let d = 0; d <= 30; d++) {
    const projectedMinor = kesTotal + dailyAvgMinor * BigInt(d)
    projectionPoints.push({
      label: d === 0 ? 'Today' : `+${d}d`,
      value: Number(projectedMinor) / 100,
    })
  }
  const kesChartBuckets = {
    overdue: Number(kesCollections?.buckets.overdue.minor ?? BigInt(0)) / 100,
    thisWeek: Number(kesCollections?.buckets.thisWeek.minor ?? BigInt(0)) / 100,
    thisMonth: Number(kesCollections?.buckets.thisMonth.minor ?? BigInt(0)) / 100,
    later: Number(kesCollections?.buckets.later.minor ?? BigInt(0)) / 100,
  }

  // ── Currency exposure: FX desk activity ─────────────────────────────
  const fxByStatus = await db.fxQuote.groupBy({
    by: ['status'],
    where: { organizationId: orgId },
    _count: true,
  })
  const lastExecuted = await db.fxQuote.findFirst({
    where: { organizationId: orgId, status: 'EXECUTED' },
    orderBy: { executedAt: 'desc' },
    select: { baseCurrency: true, quoteCurrency: true, executedAt: true },
  })
  const executedQuotes = fxByStatus.find((f) => f.status === 'EXECUTED')?._count ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Treasury"
        description="Cash position, liquidity and forward projection for the finance desk. Every figure is derived from posted ledger entries — pending funds are never counted as cash."
        actions={
          <>
            <ToneBadge tone="warning">TEST data</ToneBadge>
            <ToneBadge tone="info">Ledger-derived</ToneBadge>
          </>
        }
      />

      {/* (a) Cash position by currency */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {currencyRows.slice(0, 3).map(([currency, row]) => (
          <KpiCard
            key={currency}
            label={currency === 'KES' ? `Total cash — ${currency} (primary)` : `Total cash — ${currency}`}
            value={<MoneyText minor={row.totalMinor.toString()} currency={currency} strong />}
            hint={`${row.walletCount} wallet${row.walletCount === 1 ? '' : 's'}`}
            icon={
              currency === 'KES' ? (
                <Landmark className="h-4 w-4" />
              ) : currency === 'USDC' ? (
                <Coins className="h-4 w-4" />
              ) : (
                <DollarSign className="h-4 w-4" />
              )
            }
          />
        ))}
        <KpiCard
          label="Expected collections"
          value={
            collectionRows.length > 0 ? (
              <MoneyText minor={(kesCollections?.total ?? BigInt(0)).toString()} currency="KES" strong />
            ) : (
              '—'
            )
          }
          hint={
            collectionRows.length > 0
              ? `${openCount} open invoice${openCount === 1 ? '' : 's'}${
                  hasNonKesCollections ? ' · incl. non-KES rows below' : ''
                }`
              : 'no open invoices'
          }
          icon={<CalendarClock className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* (c) Expected collections by bucket */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Expected collections</CardTitle>
            <CardDescription>
              Balance due on open invoices (issued, viewed, partially paid, overdue), bucketed by due date.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {collectionRows.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="h-5 w-5" />}
                title="No open invoices"
                description="Nothing is currently awaiting collection. Issued invoices will appear here bucketed by due date."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bucket</TableHead>
                        <TableHead className="text-right">Invoices</TableHead>
                        <TableHead className="text-right">Balance due</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {collectionRows.map(([currency, row]) =>
                        BUCKETS.map((bucket) => (
                          <TableRow key={`${currency}-${bucket}`}>
                            <TableCell className="font-medium">
                              {BUCKET_LABELS[bucket]}
                              {currency !== 'KES' ? (
                                <span className="ml-2 text-xs text-muted-foreground">({currency})</span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{row.buckets[bucket].count}</TableCell>
                            <TableCell className="text-right">
                              <MoneyText minor={row.buckets[bucket].minor.toString()} currency={currency} />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                      {collectionRows.map(([currency, row]) => (
                        <TableRow key={`${currency}-total`} className="font-medium">
                          <TableCell>Total open{currency !== 'KES' ? ` (${currency})` : ''}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                          <TableCell className="text-right">
                            <MoneyText minor={row.total.toString()} currency={currency} strong />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {kesCollections ? (
                  <div className="space-y-2">
                    <CollectionsChart buckets={kesChartBuckets} />
                    <p className="text-xs text-muted-foreground">
                      Buckets: overdue &lt; today · this week ≤ 7 days · this month ≤ 30 days · later &gt; 30 days or
                      undated. Chart shows KES (primary)
                      {hasNonKesCollections ? '; other currencies listed in the table' : ''}.
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        {/* (b) Liquidity breakdown per wallet */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Liquidity breakdown</CardTitle>
            <CardDescription>
              Available = ledger balance − active holds, per wallet. Pending settlement is never available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {wallets.length === 0 ? (
              <EmptyState
                icon={<Landmark className="h-5 w-5" />}
                title="No wallets"
                description="Provision a wallet to start tracking liquidity."
              />
            ) : (
              <>
                <div className="max-h-[420px] overflow-y-auto overflow-x-auto scroll-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wallet</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Reserved</TableHead>
                        <TableHead className="text-right">Available</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {wallets.map((w) => (
                        <TableRow key={w.id}>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium">{w.label}</span>
                              <StatusBadge meta={WALLET_TYPE_META} status={w.type} />
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {w.currency}
                              {w.status !== 'ACTIVE' ? ` · ${w.status.toLowerCase()}` : ''}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <MoneyText minor={w.ledgerBalanceMinor.toString()} currency={w.currency} />
                          </TableCell>
                          <TableCell className="text-right">
                            <MoneyText
                              minor={w.reservedMinor.toString()}
                              currency={w.currency}
                              muted={w.reservedMinor === BigInt(0)}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <MoneyText minor={w.availableMinor.toString()} currency={w.currency} strong />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {totalReserved === BigInt(0)
                    ? 'No active holds — available equals total across every wallet.'
                    : 'Reserved funds are held by card authorizations and pending captures; they release or settle automatically.'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* (e) Forecast — clearly an estimate */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Cash projection — KES</CardTitle>
              <ToneBadge tone="warning">Estimated</ToneBadge>
            </div>
            <CardDescription>
              Projection — assumes trailing 60-day net flow (settled inflows net of fees, minus payouts) continues at
              its average. Not a commitment.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProjectionChart points={projectionPoints} />
            <div className="grid gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  <span className="text-foreground font-medium">Assumptions:</span> starts at today&apos;s
                  ledger-derived KES total (
                  <MoneyText minor={kesTotal.toString()} currency="KES" className="text-foreground" />) and adds the
                  trailing 60-day average of{' '}
                  <MoneyText minor={dailyAvgMinor.toString()} currency="KES" className="text-foreground" /> per day.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  Trailing 60-day net flow:{' '}
                  <MoneyText
                    minor={trailingNetMinor.toString()}
                    currency="KES"
                    signed
                    className="text-foreground"
                  />{' '}
                  across {inFlow?._count ?? 0} settled collections and {outFlow?._count ?? 0} payouts. Excludes
                  internal transfers, split routing (net-zero across KES wallets) and FX legs.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* (d) Recent payouts — money out */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent payouts — money out</CardTitle>
            <CardDescription>
              Outbound payment volume by rail over the last 30 days. Bills payable are not yet modeled; payouts are
              the observable obligations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {payoutRows.length === 0 ? (
              <EmptyState
                icon={<Banknote className="h-5 w-5" />}
                title="No payouts in the last 30 days"
                description="Outbound settlement volume will appear here the moment payouts execute on any rail. Nothing is inferred or estimated in its place."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rail</TableHead>
                    <TableHead className="text-right">Settled</TableHead>
                    <TableHead className="text-right">In flight</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payoutRows.map((row) => (
                    <TableRow key={`${row.method}-${row.currency}`}>
                      <TableCell>
                        <span className="font-medium">{METHOD_META[row.method]?.label ?? row.method}</span>
                        <span className="block text-xs text-muted-foreground">{row.currency}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.settledCount > 0 ? (
                          <>
                            <MoneyText minor={row.settledMinor.toString()} currency={row.currency} />
                            <span className="block text-xs text-muted-foreground">{row.settledCount} payments</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.inflightCount > 0 ? (
                          <>
                            <MoneyText minor={row.inflightMinor.toString()} currency={row.currency} muted />
                            <span className="block text-xs text-warning">{row.inflightCount} processing</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* (f) Currency exposure */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Currency exposure</CardTitle>
            {nonKes.length > 0 ? <ToneBadge tone="info">{nonKes.length} non-KES currencies</ToneBadge> : null}
          </div>
          <CardDescription>
            Balances held outside the primary operating currency. KES is the operating base; USD and USDC balances
            carry FX exposure until converted.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            {nonKes.length === 0 ? (
              <EmptyState
                icon={<Coins className="h-5 w-5" />}
                title="Single-currency exposure"
                description="All wallet balances are held in KES — no open FX exposure."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Currency</TableHead>
                      <TableHead>Wallets</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nonKes.map(([currency, row]) => (
                      <TableRow key={currency}>
                        <TableCell className="font-medium">{currency}</TableCell>
                        <TableCell>
                          {wallets
                            .filter((w) => w.currency === currency)
                            .map((w) => w.label)
                            .join(', ')}
                          <span className="block text-xs text-muted-foreground">
                            {row.walletCount} wallet{row.walletCount === 1 ? '' : 's'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <MoneyText minor={row.totalMinor.toString()} currency={currency} strong />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
          <div className="space-y-3 rounded-lg border p-4 text-sm lg:col-span-2">
            <div className="flex items-center gap-2 font-medium">
              <ArrowLeftRight className="h-4 w-4 text-primary" />
              FX desk activity
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Open USD/USDC exposure: balances above move with the KES ↔ USD rate until converted. Every conversion
              posts two single-currency entries through FX clearing, so per-currency invariants hold — the exposure
              is always exactly what the ledger says.
            </p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-md bg-muted/60 p-3">
                <p className="text-muted-foreground">Quotes executed</p>
                <p className="mt-1 text-base font-semibold tabular-nums">{executedQuotes}</p>
              </div>
              <div className="rounded-md bg-muted/60 p-3">
                <p className="text-muted-foreground">Last conversion</p>
                <p className="mt-1 text-sm font-medium">
                  {lastExecuted ? `${lastExecuted.baseCurrency} → ${lastExecuted.quoteCurrency}` : '—'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {lastExecuted ? fmtDateTime(lastExecuted.executedAt) : 'no conversions yet'}
                </p>
              </div>
            </div>
            <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              {currencyRows.map(([currency, row]) => (
                <span key={currency}>
                  <MoneyText minor={row.totalMinor.toString()} currency={currency} />
                </span>
              ))}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
