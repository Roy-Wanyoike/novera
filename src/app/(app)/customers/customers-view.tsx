'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { METHOD_META } from '@novera/domain'
import { toast } from '@/hooks/use-toast'
import { fmtDate, initials, timeAgo } from '@/lib/format'
import { MoneyText } from '@/components/novera/money-text'
import { EmptyState } from '@/components/novera/empty-state'
import { InvoiceStatusBadge, PaymentStatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import { ChevronRight, Loader2, Mail, Phone, Search, UserPlus, Users } from 'lucide-react'
import { createCustomerAction } from './actions'

// ── serialized view types (BigInt → string at the boundary) ──

export interface CustomerInvoiceLite {
  id: string
  number: string
  displayStatus: string
  currency: string
  totalMinor: string
  amountPaidMinor: string
  dueAt: string | null
  issuedAt: string
}

export interface CustomerPaymentLite {
  id: string
  reference: string
  method: string
  status: string
  direction: string
  amountMinor: string
  currency: string
  createdAt: string
  settledAt: string | null
}

export interface CustomerRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  riskTier: string
  country: string
  createdAt: string
  openInvoices: number
  invoiceCount: number
  settledPayments: number
  lifetimePaid: { currency: string; minor: string }[]
  lastActivityAt: string
  invoices: CustomerInvoiceLite[]
  payments: CustomerPaymentLite[]
}

const RISK_TONE: Record<string, 'positive' | 'warning' | 'negative'> = {
  LOW: 'positive',
  MEDIUM: 'warning',
  HIGH: 'negative',
}

function LifetimeCell({ sums }: { sums: CustomerRow['lifetimePaid'] }) {
  if (sums.length === 0) return <span className="text-sm text-muted-foreground">—</span>
  const [first, ...rest] = sums
  return (
    <span className="flex items-baseline gap-1.5">
      <MoneyText minor={first.minor} currency={first.currency} />
      {rest.length > 0 ? (
        <span className="text-xs text-muted-foreground" title={rest.map((r) => r.currency).join(', ')}>
          +{rest.length}
        </span>
      ) : null}
    </span>
  )
}

export function CustomersView({ rows }: { rows: CustomerRow[] }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return rows
    return rows.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.email ?? '').toLowerCase().includes(q)
    )
  }, [rows, query])

  const selected = rows.find((r) => r.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      {/* toolbar: search + new customer */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search customers by name or email"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {filtered.length} of {rows.length} customer{rows.length === 1 ? '' : 's'}
          </span>
          <NewCustomerDialog />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title="No customers yet"
                description="Add a customer to start invoicing — every customer is org-scoped and audited on creation."
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Search className="h-5 w-5" />}
                title="No matches"
                description={`No customer matches “${query.trim()}”. Try a different name or email.`}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Customer</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Risk tier</TableHead>
                    <TableHead className="text-right">Lifetime paid</TableHead>
                    <TableHead className="text-center">Open invoices</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead className="w-12 pr-4" aria-label="Open details" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="pl-6">
                        {/* Accessible target: the row click is a pointer
                            convenience only — keyboard users open the sheet
                            through this real button. */}
                        <button
                          type="button"
                          className="flex items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          aria-label={`View details for ${c.name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedId(c.id)
                          }}
                        >
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                            aria-hidden
                          >
                            {initials(c.name)}
                          </span>
                          <div className="font-medium">{c.name}</div>
                        </button>
                      </TableCell>
                      <TableCell>
                        {c.email ? (
                          <span className="text-sm">{c.email}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.phone ? (
                          <span className="text-sm tabular">{c.phone}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ToneBadge tone={RISK_TONE[c.riskTier] ?? 'neutral'}>{c.riskTier}</ToneBadge>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <LifetimeCell sums={c.lifetimePaid} />
                      </TableCell>
                      <TableCell className="pr-6 text-center">
                        {c.openInvoices > 0 ? (
                          <ToneBadge tone="warning">{c.openInvoices}</ToneBadge>
                        ) : (
                          <span className="text-sm text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {timeAgo(c.lastActivityAt)}
                        </span>
                      </TableCell>
                      <TableCell className="pr-4">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CustomerSheet customer={selected} onClose={() => setSelectedId(null)} />
    </div>
  )
}

function CustomerSheet({ customer, onClose }: { customer: CustomerRow | null; onClose: () => void }) {
  return (
    <Sheet open={customer !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md scroll-thin">
        {customer ? <CustomerSheetBody customer={customer} /> : null}
      </SheetContent>
    </Sheet>
  )
}

function CustomerSheetBody({ customer }: { customer: CustomerRow }) {
  const lifetime = customer.lifetimePaid
  const lifetimeNode =
    lifetime.length === 0 ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span className="flex flex-wrap items-baseline gap-x-2">
        {lifetime.map((m) => (
          <MoneyText key={m.currency} minor={m.minor} currency={m.currency} />
        ))}
      </span>
    )

  return (
    <>
      <SheetHeader className="space-y-3 border-b p-6">
        <div className="flex items-center gap-3">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground"
            aria-hidden
          >
            {initials(customer.name)}
          </span>
          <div className="min-w-0">
            <SheetTitle className="truncate text-lg">{customer.name}</SheetTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <ToneBadge tone={RISK_TONE[customer.riskTier] ?? 'neutral'}>
                {customer.riskTier} risk
              </ToneBadge>
              <span className="text-xs text-muted-foreground">
                customer since {fmtDate(customer.createdAt)}
              </span>
            </div>
          </div>
        </div>
        <SheetDescription className="sr-only">
          Invoices and payments for {customer.name}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 p-6">
        {/* contact */}
        <div className="space-y-2 text-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Contact
          </p>
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
            {customer.email ? (
              <a href={`mailto:${customer.email}`} className="underline-offset-4 hover:underline">
                {customer.email}
              </a>
            ) : (
              <span className="text-muted-foreground">no email on file</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-muted-foreground" aria-hidden />
            {customer.phone ? (
              <span className="tabular">{customer.phone}</span>
            ) : (
              <span className="text-muted-foreground">no phone on file</span>
            )}
          </div>
        </div>

        <Separator />

        {/* summary facts */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Lifetime paid
            </p>
            <p className="mt-1 text-base font-semibold">{lifetimeNode}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {customer.settledPayments} settled payment{customer.settledPayments === 1 ? '' : 's'}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Open invoices
            </p>
            <p className="mt-1 text-base font-semibold tabular">
              {customer.openInvoices}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                of {customer.invoiceCount} total
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              last activity {timeAgo(customer.lastActivityAt)}
            </p>
          </div>
        </div>

        {/* invoices */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Invoices
            </p>
            <span className="text-xs text-muted-foreground tabular">
              {customer.invoiceCount} total
            </span>
          </div>
          {customer.invoices.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              No invoices for this customer yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              {customer.invoices.map((inv) => {
                const balance = BigInt(inv.totalMinor) - BigInt(inv.amountPaidMinor)
                return (
                  <Link
                    key={inv.id}
                    href={`/invoices/${inv.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium">{inv.number}</span>
                        <InvoiceStatusBadge status={inv.displayStatus} />
                      </div>
                      <p className="text-xs text-muted-foreground tabular">
                        issued {fmtDate(inv.issuedAt)}
                        {inv.dueAt ? ` · due ${fmtDate(inv.dueAt)}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <MoneyText minor={inv.totalMinor} currency={inv.currency} />
                      {balance > 0n ? (
                        <p className="text-xs text-muted-foreground tabular">
                          <MoneyText minor={balance} currency={inv.currency} muted /> due
                        </p>
                      ) : null}
                    </div>
                  </Link>
                )
              })}
              {customer.invoiceCount > customer.invoices.length ? (
                <p className="pt-1 text-center text-xs text-muted-foreground">
                  +{customer.invoiceCount - customer.invoices.length} older invoice
                  {customer.invoiceCount - customer.invoices.length === 1 ? '' : 's'} —{' '}
                  <Link href="/invoices" className="underline-offset-4 hover:underline">
                    view all invoices
                  </Link>
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* payments */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Recent payments
            </p>
            <span className="text-xs text-muted-foreground tabular">
              latest {customer.payments.length}
            </span>
          </div>
          {customer.payments.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              No payments recorded for this customer yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              {customer.payments.map((p) => (
                <Link
                  key={p.id}
                  href={`/payments/${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{p.reference}</span>
                      <PaymentStatusBadge status={p.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {METHOD_META[p.method]?.label ?? p.method} ·{' '}
                      {fmtDate(p.settledAt ?? p.createdAt)}
                    </p>
                  </div>
                  <MoneyText
                    minor={p.amountMinor}
                    currency={p.currency}
                    className={p.status === 'SETTLED' ? 'text-success' : ''}
                  />
                </Link>
              ))}
            </div>
          )}
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Lifetime paid sums settled inbound payments net of refunds. Payments in PROCESSING or
          PENDING are listed but never counted as collected.
        </p>
      </div>
    </>
  )
}

function NewCustomerDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  function submit() {
    startTransition(async () => {
      const result = await createCustomerAction({ name, email, phone })
      if (!result.ok) {
        toast({ title: 'Customer not created', description: result.error ?? 'Unexpected error', variant: 'destructive' })
        return
      }
      setOpen(false)
      setName('')
      setEmail('')
      setPhone('')
      toast({
        title: 'Customer created',
        description: `${name.trim()} is available to invoice — the creation is on the audit chain.`,
      })
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9">
          <UserPlus className="h-4 w-4" />
          New customer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>
            Creates an org-scoped payer profile (baseline LOW risk tier) and records the creation
            on the audit hash chain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer-name">Name</Label>
            <Input
              id="customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Baraka Retail Ltd"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-email">Email (optional)</Label>
            <Input
              id="customer-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="billing@customer.co.ke"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-phone">Phone (optional)</Label>
            <Input
              id="customer-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+254 7…"
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || name.trim().length < 2}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
