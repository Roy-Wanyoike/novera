import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { INVOICE_STATUS_META } from '@novera/domain'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { MoneyText } from '@/components/novera/money-text'
import { InvoiceStatusBadge } from '@/components/novera/status-badge'
import { EmptyState } from '@/components/novera/empty-state'
import { fmtDate } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AlertTriangle, CalendarClock, CheckCircle2, FileStack, Wallet } from 'lucide-react'
import { NewInvoiceDialog } from './new-invoice-dialog'
import { displayInvoiceStatus, isOpenInvoiceStatus, sumByCurrency } from './status'

export const metadata = { title: 'Invoices — Novera' }

const TAB_STATUSES = [
  'ALL',
  'DRAFT',
  'ISSUED',
  'VIEWED',
  'PARTIALLY_PAID',
  'OVERDUE',
  'PAID',
  'CANCELLED',
] as const

type TabStatus = (typeof TAB_STATUSES)[number]

/** KPI value: one MoneyText per currency — money never blends currencies. */
function MoneyList({ sums }: { sums: Map<string, bigint> }) {
  if (sums.size === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {[...sums.entries()].map(([currency, minor]) => (
        <MoneyText key={currency} minor={minor} currency={currency} />
      ))}
    </span>
  )
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const session = await requireSession()
  const orgId = session.organization.id

  const params = await searchParams
  const requested = typeof params.status === 'string' ? params.status.toUpperCase() : 'ALL'
  const activeTab: TabStatus = (TAB_STATUSES as readonly string[]).includes(requested)
    ? (requested as TabStatus)
    : 'ALL'

  const [invoices, customers] = await Promise.all([
    db.invoice.findMany({
      where: { organizationId: orgId },
      include: { customer: { select: { id: true, name: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }],
    }),
    db.customer.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ])

  const now = new Date()

  // ── honest display status (derived per request, never persisted) ──
  const rows = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    customer: inv.customer,
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
    currency: inv.currency,
    totalMinor: inv.totalMinor,
    amountPaidMinor: inv.amountPaidMinor,
    balanceMinor: inv.totalMinor - inv.amountPaidMinor,
    status: displayInvoiceStatus(inv),
    storedStatus: inv.status,
    fullyPaid: inv.amountPaidMinor >= inv.totalMinor && inv.totalMinor > 0n,
  }))

  // ── KPI row ──
  const open = rows.filter((r) => isOpenInvoiceStatus(r.status))
  const outstanding = sumByCurrency(open, (r) => ({ currency: r.currency, minor: r.balanceMinor }))

  const overdueRows = rows.filter((r) => r.status === 'OVERDUE')
  const overdueTotal = sumByCurrency(overdueRows, (r) => ({ currency: r.currency, minor: r.balanceMinor }))

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const paidThisMonthRows = invoices.filter(
    (inv) => inv.status === 'PAID' && inv.paidAt !== null && inv.paidAt >= monthStart
  )
  const paidThisMonthSums = sumByCurrency(paidThisMonthRows, (inv) => ({
    currency: inv.currency,
    minor: inv.totalMinor,
  }))

  const paidWithCycle = invoices.filter(
    (inv) => inv.status === 'PAID' && inv.issuedAt !== null && inv.paidAt !== null
  )
  const avgDaysToPay =
    paidWithCycle.length > 0
      ? paidWithCycle.reduce(
          (acc, inv) =>
            acc + (inv.paidAt!.getTime() - inv.issuedAt!.getTime()) / (1000 * 60 * 60 * 24),
          0
        ) / paidWithCycle.length
      : null

  // ── per-status counts for the tabs ──
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)

  const filtered = activeTab === 'ALL' ? rows : rows.filter((r) => r.status === activeTab)
  const lastCreated = invoices[0]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Receivables lifecycle — draft, issue, collect, reconcile. Amounts are ledger-derived and computed in exact minor units; a payment that has not settled never shows as paid."
        actions={
          <NewInvoiceDialog customers={customers.map((c) => ({ id: c.id, name: c.name, email: c.email }))} />
        }
      />

      {/* KPI ROW */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Outstanding"
          value={<MoneyList sums={outstanding} />}
          deltaLabel={`${open.length} open invoice${open.length === 1 ? '' : 's'}`}
          hint="issued · viewed · partial · overdue"
          icon={<Wallet className="h-4 w-4" />}
        />
        <KpiCard
          label="Overdue"
          value={<MoneyList sums={overdueTotal} />}
          deltaLabel={`${overdueRows.length} past due`}
          hint={overdueRows.length > 0 ? 'payment reminders advised' : 'nothing past due'}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <KpiCard
          label="Paid this month"
          value={<MoneyList sums={paidThisMonthSums} />}
          deltaLabel={`${paidThisMonthRows.length} settled`}
          hint={monthStart.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <KpiCard
          label="Avg days to pay"
          value={
            avgDaysToPay === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span>
                {avgDaysToPay.toFixed(1)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">days</span>
              </span>
            )
          }
          deltaLabel={paidWithCycle.length > 0 ? `${paidWithCycle.length} paid invoices` : 'no paid invoices yet'}
          hint="issued → paid"
          icon={<CalendarClock className="h-4 w-4" />}
        />
      </div>

      {/* STATUS FILTER TABS */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-1 scroll-thin"
        role="tablist"
        aria-label="Filter invoices by status"
      >
        {TAB_STATUSES.map((status) => {
          const isActive = status === activeTab
          const count = status === 'ALL' ? rows.length : (counts.get(status) ?? 0)
          const label = status === 'ALL' ? 'All' : (INVOICE_STATUS_META[status]?.label ?? status)
          return (
            <Link
              key={status}
              role="tab"
              aria-selected={isActive}
              href={status === 'ALL' ? '/invoices' : `/invoices?status=${status}`}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                isActive
                  ? 'bg-background text-foreground border-border shadow-sm'
                  : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              {label}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] leading-none tabular text-muted-foreground">
                {count}
              </span>
            </Link>
          )
        })}
      </div>

      {/* INVOICE TABLE */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileStack className="h-4 w-4 text-muted-foreground" />
            {activeTab === 'ALL' ? 'All invoices' : (INVOICE_STATUS_META[activeTab]?.label ?? activeTab)}
          </CardTitle>
          <CardDescription>
            {filtered.length} of {rows.length} invoice{rows.length === 1 ? '' : 's'} · TEST MODE · deterministic
            sandbox rails
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<FileStack className="h-5 w-5" />}
                title={rows.length === 0 ? 'No invoices yet' : 'No invoices in this status'}
                description={
                  rows.length === 0
                    ? 'Create your first invoice — line items, tax and totals are computed in exact minor units.'
                    : 'Try a different status filter, or create a new invoice.'
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Number</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="pr-6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => {
                    const isOverdue = inv.status === 'OVERDUE'
                    return (
                      <TableRow key={inv.id} className="relative">
                        <TableCell className="pl-6 font-mono text-xs">
                          {/* stretched link: the whole row navigates, keyboard reachable */}
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="absolute inset-0 z-10"
                            aria-label={`Open invoice ${inv.number} for ${inv.customer.name}`}
                          />
                          <span className="text-foreground/90">{inv.number}</span>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{inv.customer.name}</div>
                          {inv.customer.email ? (
                            <div className="text-xs text-muted-foreground">{inv.customer.email}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {inv.issuedAt ? (
                            <span className="text-sm">{fmtDate(inv.issuedAt)}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">not issued</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {inv.dueAt ? (
                            <span className={`text-sm ${isOverdue ? 'font-medium text-danger' : ''}`}>
                              {fmtDate(inv.dueAt)}
                              {isOverdue ? (
                                <span className="ml-1 text-xs">
                                  ({Math.floor((now.getTime() - inv.dueAt.getTime()) / 86400000)}d late)
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <MoneyText minor={inv.totalMinor} currency={inv.currency} />
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <MoneyText
                            minor={inv.amountPaidMinor}
                            currency={inv.currency}
                            muted={inv.amountPaidMinor === 0n}
                            className={inv.fullyPaid ? 'text-success' : ''}
                          />
                        </TableCell>
                        <TableCell className="pr-6">
                          <InvoiceStatusBadge status={inv.status} />
                          {inv.storedStatus !== inv.status ? (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              stored: {inv.storedStatus.toLowerCase()}
                            </div>
                          ) : null}
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

      <p className="text-xs text-muted-foreground">
        Outstanding and overdue totals are derived per currency from stored, ledger-backed invoice
        balances. Overdue is a display derivation — stored statuses are never rewritten.
        {lastCreated ? ` Last created ${fmtDate(lastCreated.createdAt)}.` : ''}
      </p>
      <span className="sr-only" aria-live="polite">
        {filtered.length} invoices shown
      </span>
    </div>
  )
}
