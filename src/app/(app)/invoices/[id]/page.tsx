import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { METHOD_META } from '@novera/domain'
import { PageHeader } from '@/components/novera/page-header'
import { MoneyText } from '@/components/novera/money-text'
import { InvoiceStatusBadge, PaymentStatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { EmptyState } from '@/components/novera/empty-state'
import { fmtDate, fmtDateTime, timeAgo, initials } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import {
  Bell,
  CalendarDays,
  CircleCheck,
  CreditCard,
  FileText,
  History,
  Mail,
  Phone,
  User,
} from 'lucide-react'
import { InvoiceActions } from './invoice-actions'
import { displayInvoiceStatus } from '../status'

export const metadata = { title: 'Invoice — Novera' }

const RISK_TIER_TONE: Record<string, 'positive' | 'warning' | 'negative'> = {
  LOW: 'positive',
  MEDIUM: 'warning',
  HIGH: 'negative',
}

/** One timeline step: dot + connector + label + date (muted while pending). */
function TimelineStep({
  label,
  date,
  icon,
  final = false,
}: {
  label: string
  date: Date | null
  icon: ReactNode
  final?: boolean
}) {
  const done = date !== null
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
            done
              ? 'border-success/40 bg-success/12 text-success'
              : 'border-dashed border-border text-muted-foreground/60'
          }`}
          aria-hidden
        >
          {icon}
        </span>
        {!final ? (
          <span
            className={`h-px flex-1 ${done ? 'bg-success/40' : 'bg-border'}`}
            aria-hidden
          />
        ) : null}
      </div>
      <div className="min-w-0">
        <p className={`text-xs font-medium ${done ? 'text-foreground' : 'text-muted-foreground'}`}>
          {label}
        </p>
        <p className={`text-xs tabular ${done ? 'text-muted-foreground' : 'text-muted-foreground/60'}`}>
          {date ? fmtDateTime(date) : 'pending'}
        </p>
      </div>
    </div>
  )
}

function Fact({
  label,
  value,
  icon,
  danger = false,
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  danger?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <span className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={`text-right text-sm font-medium tabular ${danger ? 'text-danger' : ''}`}>
        {value}
      </span>
    </div>
  )
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireSession()
  const orgId = session.organization.id
  const { id } = await params

  const invoice = await db.invoice.findFirst({
    where: { id, organizationId: orgId },
    include: {
      customer: true,
      items: { orderBy: { id: 'asc' } },
      payments: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!invoice) notFound()

  const now = new Date()
  const displayStatus = displayInvoiceStatus(invoice)
  const isOverdue = displayStatus === 'OVERDUE'
  const balanceMinor = invoice.totalMinor - invoice.amountPaidMinor
  const fullyPaid = invoice.amountPaidMinor >= invoice.totalMinor && invoice.totalMinor > 0n

  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="font-mono text-2xl tracking-tight">{invoice.number}</span>}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href="/invoices" className="underline-offset-4 hover:underline">
              Invoices
            </Link>
            <span aria-hidden>·</span>
            <span>
              billed to <strong className="font-medium">{invoice.customer.name}</strong>
            </span>
            {invoice.customer.email ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-muted-foreground">{invoice.customer.email}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          <InvoiceActions
            invoice={{
              id: invoice.id,
              number: invoice.number,
              storedStatus: invoice.status,
              displayStatus,
              currency: invoice.currency,
              totalMinor: invoice.totalMinor.toString(),
              amountPaidMinor: invoice.amountPaidMinor.toString(),
              issuedAt: invoice.issuedAt ? invoice.issuedAt.toISOString() : null,
              dueAt: invoice.dueAt ? invoice.dueAt.toISOString() : null,
              reminderCount: invoice.reminderCount,
            }}
          />
        }
      />

      {/* summary header card */}
      <Card>
        <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground"
              aria-hidden
            >
              {initials(invoice.customer.name)}
            </span>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <InvoiceStatusBadge status={displayStatus} />
                {invoice.status !== displayStatus ? (
                  <span className="text-[11px] text-muted-foreground">
                    stored: {invoice.status.toLowerCase()}
                  </span>
                ) : null}
                <ToneBadge tone="neutral">{invoice.currency}</ToneBadge>
              </div>
              <p className="text-xs text-muted-foreground">
                Created {fmtDateTime(invoice.createdAt)}
                {invoice.issuedAt ? ` · issued ${timeAgo(invoice.issuedAt)}` : ' · not issued yet'}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {fullyPaid ? 'Invoice total (paid in full)' : 'Invoice total'}
            </span>
            <MoneyText
              minor={invoice.totalMinor}
              currency={invoice.currency}
              strong
              className="text-3xl"
            />
            <span className="text-xs text-muted-foreground tabular">
              {invoice.items.length} line item{invoice.items.length === 1 ? '' : 's'}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* LEFT: line items + payments history */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Line items
              </CardTitle>
              <CardDescription>
                Quantities are integers; unit prices parsed server-side via Money.fromMajor into
                BigInt minor units.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="pr-6 text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoice.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="pl-6 max-w-[320px] truncate font-medium" title={item.description}>
                          {item.description}
                        </TableCell>
                        <TableCell className="text-right tabular">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          <MoneyText minor={item.unitMinor} currency={invoice.currency} muted />
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <MoneyText minor={item.totalMinor} currency={invoice.currency} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {invoice.notes ? (
                <>
                  <Separator />
                  <div className="px-6 py-4">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Notes</p>
                    <p className="mt-1 text-sm leading-relaxed">{invoice.notes}</p>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4 text-muted-foreground" />
                Payments
              </CardTitle>
              <CardDescription>
                Payments recorded against this invoice through the payments kernel — status shown is
                the kernel&apos;s honest state.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {invoice.payments.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={<CreditCard className="h-5 w-5" />}
                    title="No payments recorded"
                    description="Use “Record payment” to run a collection through the kernel against this invoice."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Reference</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="pr-6 text-right">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoice.payments.map((p) => (
                        <TableRow key={p.id} className="relative">
                          <TableCell className="pl-6 font-mono text-xs">
                            <Link
                              href={`/payments/${p.id}`}
                              className="absolute inset-0 z-10"
                              aria-label={`Open payment ${p.reference}`}
                            />
                            {p.reference}
                          </TableCell>
                          <TableCell>
                            {METHOD_META[p.method]?.label ?? p.method}
                          </TableCell>
                          <TableCell className="text-right">
                            <MoneyText minor={p.amountMinor} currency={p.currency} />
                          </TableCell>
                          <TableCell>
                            <PaymentStatusBadge status={p.status} />
                          </TableCell>
                          <TableCell className="pr-6 text-right text-sm text-muted-foreground tabular">
                            {fmtDate(p.settledAt ?? p.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: totals + timeline + customer */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pb-6">
              <Fact label="Subtotal" value={<MoneyText minor={invoice.subtotalMinor} currency={invoice.currency} />} />
              <Fact label="Tax" value={<MoneyText minor={invoice.taxMinor} currency={invoice.currency} />} />
              <Fact
                label="Discount"
                value={
                  invoice.discountMinor > 0n ? (
                    <MoneyText minor={invoice.discountMinor} currency={invoice.currency} signed />
                  ) : (
                    '—'
                  )
                }
              />
              <Separator className="my-2" />
              <Fact label="Total" value={<MoneyText minor={invoice.totalMinor} currency={invoice.currency} strong />} />
              <Fact
                label="Amount paid"
                value={
                  <MoneyText
                    minor={invoice.amountPaidMinor}
                    currency={invoice.currency}
                    className={fullyPaid ? 'text-success' : ''}
                  />
                }
              />
              <Separator className="my-2" />
              <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-3">
                <span className="text-xs font-medium uppercase tracking-wider text-primary">
                  Balance due
                </span>
                <MoneyText
                  minor={balanceMinor}
                  currency={invoice.currency}
                  strong
                  className={balanceMinor > 0n ? 'text-primary text-lg' : 'text-success text-lg'}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>issued → viewed → paid</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-2">
                <TimelineStep
                  label="Created"
                  date={invoice.createdAt}
                  icon={<FileText className="h-3.5 w-3.5" />}
                />
                <TimelineStep
                  label="Issued"
                  date={invoice.issuedAt}
                  icon={<Mail className="h-3.5 w-3.5" />}
                />
                <TimelineStep
                  label="Viewed"
                  date={invoice.viewedAt}
                  icon={<CircleCheck className="h-3.5 w-3.5" />}
                />
                <TimelineStep
                  label="Paid"
                  date={invoice.paidAt}
                  icon={<CircleCheck className="h-3.5 w-3.5" />}
                  final
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Bell className="h-4 w-4" />
                  Reminders sent
                </span>
                <span className="font-medium tabular">
                  {invoice.reminderCount}
                  {invoice.lastReminderAt ? (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      last {timeAgo(invoice.lastReminderAt)}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  Due
                </span>
                {invoice.dueAt ? (
                  <span className={`font-medium tabular ${isOverdue ? 'text-danger' : ''}`}>
                    {fmtDate(invoice.dueAt)}
                    {isOverdue ? (
                      <span className="ml-1.5 text-xs font-normal">
                        {Math.floor((now.getTime() - invoice.dueAt.getTime()) / 86400000)}d late
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4 text-muted-foreground" />
                Customer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pb-6">
              <Fact label="Name" value={invoice.customer.name} />
              <Fact
                label="Email"
                value={invoice.customer.email ?? <span className="text-muted-foreground">—</span>}
                icon={<Mail className="h-3.5 w-3.5" />}
              />
              <Fact
                label="Phone"
                value={invoice.customer.phone ?? <span className="text-muted-foreground">—</span>}
                icon={<Phone className="h-3.5 w-3.5" />}
              />
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Risk tier</span>
                <ToneBadge tone={RISK_TIER_TONE[invoice.customer.riskTier] ?? 'neutral'}>
                  {invoice.customer.riskTier}
                </ToneBadge>
              </div>
              <p className="pt-2 text-xs text-muted-foreground">
                <Link href="/customers" className="underline-offset-4 hover:underline">
                  View all customers →
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        TEST MODE — payments run on deterministic sandbox rails through the kernel (risk → rail →
        ledger). Balance due is derived from settled payments only; a processing payment never
        counts as paid.
      </p>
    </div>
  )
}
