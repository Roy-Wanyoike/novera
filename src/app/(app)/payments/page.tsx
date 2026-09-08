import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import {
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  METHOD_META,
  type PaymentStatus,
  type PaymentMethod,
} from '@novera/domain'
import { Money } from '@novera/money'
import { pct, fmtDateTime, timeAgo, titleCase } from '@/lib/format'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { MoneyText } from '@/components/novera/money-text'
import { EmptyState } from '@/components/novera/empty-state'
import { PaymentStatusBadge } from '@/components/novera/status-badge'
import { PaymentsFilters } from './payments-filters'
import { NewPaymentDialog } from './new-payment-dialog'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Inbox, Plus } from 'lucide-react'

export const metadata = { title: 'Payments' }

const PER_PAGE = 25
const ZERO = BigInt(0)

/** Risk decision → dot color for the table's risk column. */
const RISK_DOT: Record<string, string> = {
  ALLOW: 'bg-success',
  REVIEW: 'bg-warning',
  DECLINE: 'bg-danger',
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSession()
  const orgId = session.organization.id

  const sp = await searchParams
  const status = typeof sp.status === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(sp.status)
    ? (sp.status as PaymentStatus)
    : ''
  const method = typeof sp.method === 'string' && (PAYMENT_METHODS as readonly string[]).includes(sp.method)
    ? (sp.method as PaymentMethod)
    : ''
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 80) : ''
  const page = Math.max(1, Number.parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1)

  // ── KPI window: last 30 days, collections (direction IN) ──
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const settledFilter = { organizationId: orgId, direction: 'IN', status: 'SETTLED' as const, settledAt: { gte: since30 } }

  const [volumeByCurrency, feeByCurrency, settledish30, failed30, reviewCount] = await Promise.all([
    db.payment.groupBy({ by: ['currency'], where: settledFilter, _sum: { amountMinor: true } }),
    db.payment.groupBy({ by: ['currency'], where: settledFilter, _sum: { feeMinor: true }, _count: { _all: true } }),
    db.payment.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: since30 },
        status: { in: ['SETTLED', 'REFUNDED', 'DISPUTED'] },
      },
    }),
    db.payment.count({ where: { organizationId: orgId, createdAt: { gte: since30 }, status: 'FAILED' } }),
    db.payment.count({ where: { organizationId: orgId, status: 'PENDING' } }),
  ])

  // Largest currency first for the headline number; others become the hint.
  const volumes = volumeByCurrency
    .map((v) => ({ currency: v.currency, minor: v._sum.amountMinor ?? ZERO }))
    .filter((v) => v.minor > ZERO)
    .sort((a, b) => (a.minor > b.minor ? -1 : 1))
  const primaryVolume = volumes[0]
  const otherVolumes = volumes.slice(1)

  const fees = feeByCurrency
    .map((f) => ({
      currency: f.currency,
      avgMinor: f._count._all > 0 ? (f._sum.feeMinor ?? ZERO) / BigInt(f._count._all) : ZERO,
    }))
    .filter((f) => f.avgMinor > ZERO)
    .sort((a, b) => (a.avgMinor > b.avgMinor ? -1 : 1))
  const primaryFee = fees[0]
  const otherFees = fees.slice(1)

  const terminal30 = settledish30 + failed30
  const successRate = terminal30 > 0 ? pct(settledish30, terminal30) : null

  // ── Filtered table query (always org-scoped) ──
  const where: Prisma.PaymentWhereInput = { organizationId: orgId }
  if (status) where.status = status
  if (method) where.method = method
  if (q) {
    where.OR = [
      { reference: { contains: q } },
      { customerName: { contains: q } },
      { customerEmail: { contains: q } },
      { description: { contains: q } },
      { providerReference: { contains: q } },
    ]
  }

  const [total, payments] = await Promise.all([
    db.payment.count({ where }),
    db.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const filtersActive = Boolean(status || method || q)

  const pageHref = (p: number) => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (method) params.set('method', method)
    if (q) params.set('q', q)
    if (p > 1) params.set('page', String(p))
    const s = params.toString()
    return s ? `/payments?${s}` : '/payments'
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every payment intent across M-Pesa, card, bank and USDC rails — risk-checked, rail-dispatched and ledger-settled. Status is always shown as it truly is: processing is not settled."
        actions={<NewPaymentDialog />}
      />

      {/* ── KPI row ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Settled volume · 30d"
          value={primaryVolume ? <MoneyText minor={primaryVolume.minor} currency={primaryVolume.currency} strong /> : '—'}
          hint={
            otherVolumes.length > 0
              ? `+ ${otherVolumes.map((v) => Money.fromMinor(v.minor, v.currency).format()).join(' · ')}`
              : 'collections only'
          }
        />
        <KpiCard
          label="Success rate · 30d"
          value={successRate === null ? '—' : `${successRate.toFixed(1)}%`}
          hint={`${settledish30} settled / ${failed30} failed outcomes`}
        />
        <KpiCard
          label="Avg processing fee · 30d"
          value={primaryFee ? <MoneyText minor={primaryFee.avgMinor} currency={primaryFee.currency} strong /> : '—'}
          hint={otherFees.length > 0 ? `+ ${otherFees.map((f) => Money.fromMinor(f.avgMinor, f.currency).format()).join(' · ')}` : 'per settled payment'}
        />
        <KpiCard
          label="In manual review"
          value={String(reviewCount)}
          hint={reviewCount > 0 ? 'held by risk rules — needs a decision' : 'nothing waiting on you'}
        />
      </div>

      {/* ── Filters + table ── */}
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>All payments</CardTitle>
              <CardDescription>
                {filtersActive ? `${total.toLocaleString()} matching` : `${total.toLocaleString()} total`} · newest first
              </CardDescription>
            </div>
            <PaymentsFilters status={status} method={method} q={q} />
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {payments.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                icon={<Inbox className="h-5 w-5" />}
                title={filtersActive ? 'No payments match these filters' : 'No payments yet'}
                description={
                  filtersActive
                    ? 'Try clearing the filters or widening your search.'
                    : 'Create your first payment intent — risk, rails and the ledger will handle the rest.'
                }
                action={
                  filtersActive ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href="/payments">Clear filters</Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm">
                      <Link href="/payment-links">
                        <Plus className="h-4 w-4" /> Share a payment link instead
                      </Link>
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Reference</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead className="pr-6 text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => {
                      const riskDot = p.riskDecision ? RISK_DOT[p.riskDecision] : null
                      return (
                        <TableRow key={p.id} className="relative">
                          <TableCell className="pl-6 font-medium">
                            {/* Stretched link makes the whole row clickable, accessibly. */}
                            <Link
                              href={`/payments/${p.id}`}
                              className="font-mono text-xs after:absolute after:inset-0 after:content-['']"
                            >
                              {p.reference}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-52">
                              <p className="truncate text-sm font-medium">{p.customerName ?? '—'}</p>
                              {p.customerEmail ? (
                                <p className="truncate text-xs text-muted-foreground">{p.customerEmail}</p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-medium">
                              {METHOD_META[p.method]?.label ?? titleCase(p.method)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <MoneyText minor={p.amountMinor} currency={p.currency} strong />
                            {p.feeMinor > ZERO ? (
                              <div className="text-xs">
                                <MoneyText minor={p.feeMinor} currency={p.currency} muted className="text-[11px]" />
                                <span className="text-muted-foreground"> fee</span>
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <PaymentStatusBadge status={p.status} />
                          </TableCell>
                          <TableCell>
                            {p.riskDecision ? (
                              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className={`h-1.5 w-1.5 rounded-full ${riskDot ?? 'bg-muted-foreground'}`} aria-hidden />
                                {p.riskScore ?? '—'}
                                <span className="sr-only">risk {p.riskDecision}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <p className="text-xs text-muted-foreground" title={fmtDateTime(p.createdAt)}>
                              {timeAgo(p.createdAt)}
                            </p>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* ── Pagination ── */}
              <div className="flex items-center justify-between border-t px-6 py-4">
                <p className="text-xs text-muted-foreground">
                  Showing {(page - 1) * PER_PAGE + 1}–{(page - 1) * PER_PAGE + payments.length} of {total.toLocaleString()}
                </p>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm" disabled={page <= 1}>
                    <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1}>
                      <ChevronLeft className="h-4 w-4" />
                      <span className="hidden sm:inline">Previous</span>
                    </Link>
                  </Button>
                  <span className="text-xs text-muted-foreground tabular">
                    {page} / {totalPages}
                  </span>
                  <Button asChild variant="outline" size="sm" disabled={page >= totalPages}>
                    <Link href={pageHref(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages}>
                      <span className="hidden sm:inline">Next</span>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
