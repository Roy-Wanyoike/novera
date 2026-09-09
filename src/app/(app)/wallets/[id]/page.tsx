import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { accountBalance } from '@/lib/ledger'
import { walletSummary, availableBalanceMinor, expireHolds } from '@/lib/transfers'
import { fmtDate, fmtDateTime, truncateMiddle } from '@/lib/format'
import { WALLET_TYPE_META, LEDGER_TXN_SOURCE_META, type StatusMeta } from '@novera/domain'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { MoneyText } from '@/components/novera/money-text'
import { EmptyState } from '@/components/novera/empty-state'
import { StatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeft, BookText, CircleCheck, Lock, History, PauseCircle } from 'lucide-react'
import { TransferDialog } from '../transfer-dialog'
import { WalletActivityChart, type ActivityPoint } from './activity-chart'

export const metadata = { title: 'Wallet · Novera' }

const HOLD_STATUS_META: Record<string, StatusMeta> = {
  ACTIVE: { label: 'Active', tone: 'warning' },
  CAPTURED: { label: 'Captured', tone: 'info' },
  RELEASED: { label: 'Released', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
}

const PAGE_SIZE = 50

/** walletSummary returns an inferred (opaque) array — this is its runtime contract. */
interface WalletSummaryRow {
  id: string
  label: string
  type: string
  currency: string
  status: string
  description: string | null
  createdAt: Date
  ledgerBalanceMinor: bigint
  availableMinor: bigint
  reservedMinor: bigint
}

export default async function WalletDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const orgId = session.organization.id
  const { id } = await params

  // IDOR protection: the wallet must belong to the session organization.
  const wallet = await db.wallet.findFirst({
    where: { id, organizationId: orgId },
    include: {
      ledgerAccount: { select: { id: true, code: true, name: true, type: true, normalBalance: true } },
    },
  })
  if (!wallet) notFound()

  // Reconcile past-due hold STATUS before listing/counting holds (one
  // updateMany). availableBalanceMinor's expiresAt filter is already
  // authoritative for the money math; this keeps the hold table below
  // from showing past-due holds as still Active/reserved.
  await expireHolds(orgId)

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const [summariesRaw, account, holds, activeHoldCount, entries, recent] = await Promise.all([
    walletSummary(orgId),
    accountBalance(wallet.ledgerAccountId),
    db.hold.findMany({
      where: { walletId: wallet.id, organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    db.hold.count({
      where: {
        walletId: wallet.id,
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }),
    db.ledgerEntry.findMany({
      where: {
        accountId: wallet.ledgerAccountId,
        transaction: { organizationId: orgId, status: 'POSTED' },
      },
      include: {
        transaction: { select: { reference: true, source: true, description: true, postedAt: true } },
      },
      orderBy: { transaction: { postedAt: 'desc' } },
      take: PAGE_SIZE,
    }),
    db.ledgerEntry.findMany({
      where: {
        accountId: wallet.ledgerAccountId,
        transaction: { status: 'POSTED', postedAt: { gte: since } },
      },
      select: { transaction: { select: { postedAt: true } } },
      take: 2000,
    }),
  ])
  const summaries = summariesRaw as WalletSummaryRow[]

  const me = summaries.find((w) => w.id === wallet.id)
  const ledgerMinor = me ? me.ledgerBalanceMinor : account.balanceMinor
  const availableMinor = me ? me.availableMinor : await availableBalanceMinor(wallet.id)
  const reservedMinor = ledgerMinor - availableMinor

  // 14-day activity histogram
  const buckets = new Map<string, number>()
  for (const e of recent) {
    const key = e.transaction.postedAt?.toISOString().slice(0, 10)
    if (!key) continue
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const activity: ActivityPoint[] = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    return {
      day: new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' }).format(d),
      entries: buckets.get(key) ?? 0,
    }
  })

  const transferOptions = summaries.map((w) => ({
    id: w.id,
    label: w.label,
    type: w.type,
    currency: w.currency,
    status: w.status,
    availableMinor: w.availableMinor.toString(),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1 px-2 text-muted-foreground">
              <Link href="/wallets" aria-label="Back to wallets">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Wallets
              </Link>
            </Button>
            <span className="text-muted-foreground/40">/</span>
            {wallet.label}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge meta={WALLET_TYPE_META} status={wallet.type} />
            <ToneBadge tone="neutral" className="font-mono">{wallet.currency}</ToneBadge>
            {wallet.status !== 'ACTIVE' ? (
              <ToneBadge tone={wallet.status === 'FROZEN' ? 'warning' : 'neutral'}>
                {wallet.status.toLowerCase()}
              </ToneBadge>
            ) : null}
            <span className="font-mono text-xs text-muted-foreground">{wallet.ledgerAccount.code}</span>
            {wallet.description ? <span className="text-xs">· {wallet.description}</span> : null}
          </span>
        }
        actions={<TransferDialog wallets={transferOptions} defaultFromId={wallet.id} size="sm" />}
      />

      <section aria-label="Balance summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Ledger balance"
          value={<MoneyText minor={ledgerMinor} currency={wallet.currency} strong />}
          hint="Posted entries, debits − credits"
          icon={<BookText className="h-4 w-4" />}
        />
        <KpiCard
          label="Available"
          value={<MoneyText minor={availableMinor} currency={wallet.currency} strong />}
          hint="Ledger minus active holds"
          icon={<CircleCheck className="h-4 w-4" />}
        />
        <KpiCard
          label="Reserved (holds)"
          value={<MoneyText minor={reservedMinor} currency={wallet.currency} strong />}
          hint={
            activeHoldCount > 0
              ? `${activeHoldCount} active hold${activeHoldCount === 1 ? '' : 's'} — not spendable`
              : 'No active holds'
          }
          icon={<Lock className="h-4 w-4" />}
        />
        <KpiCard
          label="Movements (all time)"
          value={
            <span className="flex flex-col gap-0.5 text-sm font-semibold">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Dr</span>
                <MoneyText minor={account.debitTotal} currency={wallet.currency} />
              </span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cr</span>
                <MoneyText minor={account.creditTotal} currency={wallet.currency} />
              </span>
            </span>
          }
          hint="Account totals"
          icon={<History className="h-4 w-4" />}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Ledger entries</CardTitle>
            <CardDescription>
              Latest {Math.min(entries.length, PAGE_SIZE)} posted entries on {wallet.ledgerAccount.code}.
              Dr increases and Cr decreases this balance — signed amounts sum exactly to the ledger balance.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {entries.length === 0 ? (
              <div className="px-6 pb-6">
                <EmptyState
                  icon={<BookText className="h-6 w-6" />}
                  title="No posted entries yet"
                  description="This wallet's ledger account has no posted entries. Fund it with a transfer or an opening balance."
                />
              </div>
            ) : (
              <div className="overflow-x-auto scroll-thin">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Date</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="min-w-[180px]">Description</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead className="pr-6 text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => {
                      const signed = e.direction === 'DEBIT' ? e.amountMinor : -e.amountMinor
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="pl-6 whitespace-nowrap text-muted-foreground">
                            {fmtDateTime(e.transaction.postedAt)}
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/transactions?ref=${e.transaction.reference}`}
                              className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                              title={e.transaction.reference}
                            >
                              {truncateMiddle(e.transaction.reference)}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <StatusBadge meta={LEDGER_TXN_SOURCE_META} status={e.transaction.source} />
                          </TableCell>
                          <TableCell className="max-w-[260px] truncate text-muted-foreground" title={e.transaction.description}>
                            {e.transaction.description}
                          </TableCell>
                          <TableCell>
                            <ToneBadge tone={e.direction === 'DEBIT' ? 'info' : 'neutral'} className="font-mono">
                              {e.direction === 'DEBIT' ? 'Dr' : 'Cr'}
                            </ToneBadge>
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <MoneyText minor={signed} currency={e.currency} signed />
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

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity — last 14 days</CardTitle>
              <CardDescription>Entries posted per day</CardDescription>
            </CardHeader>
            <CardContent>
              <WalletActivityChart data={activity} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Holds</CardTitle>
              <CardDescription>
                {activeHoldCount > 0
                  ? `${activeHoldCount} active — reserving funds, not spendable`
                  : 'No funds currently reserved'}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {holds.length === 0 ? (
                <div className="px-6 pb-6">
                  <EmptyState
                    icon={<PauseCircle className="h-6 w-6" />}
                    title="No holds"
                    description="Holds reserve wallet funds for card authorizations and pending operations. None exist for this wallet."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto scroll-thin">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Reference</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="pr-6 text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {holds.slice(0, 8).map((h) => (
                        <TableRow key={h.id}>
                          <TableCell className="pl-6">
                            <span className="font-mono text-xs" title={`${h.reference} · ${h.reason ?? ''}`}>
                              {h.reference}
                            </span>
                            <p className="truncate text-[11px] text-muted-foreground" title={h.reason ?? undefined}>
                              {h.reason ?? '—'} · exp {h.expiresAt ? fmtDate(h.expiresAt) : '—'}
                            </p>
                          </TableCell>
                          <TableCell>
                            <StatusBadge meta={HOLD_STATUS_META} status={h.status} />
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <MoneyText
                              minor={h.amountMinor}
                              currency={h.currency}
                              className={h.status === 'ACTIVE' ? 'text-warning' : undefined}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account</CardTitle>
              <CardDescription>Backing ledger account</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Code</dt>
                  <dd className="font-mono text-xs">{wallet.ledgerAccount.code}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>{wallet.ledgerAccount.type} · {wallet.ledgerAccount.normalBalance === 'DEBIT' ? 'Dr' : 'Cr'} normal</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="truncate text-right" title={wallet.ledgerAccount.name}>{wallet.ledgerAccount.name}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{fmtDate(wallet.createdAt)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
