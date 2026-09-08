import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { MoneyText } from '@/components/novera/money-text'
import { Users } from 'lucide-react'
import { AlertTriangle, FileStack, Wallet } from 'lucide-react'
import { CustomersView, type CustomerRow } from './customers-view'
import { displayInvoiceStatus, isOpenInvoiceStatus, sumByCurrency } from '../invoices/status'

export const metadata = { title: 'Customers — Novera' }

export default async function CustomersPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  const [customers, invoices, payments] = await Promise.all([
    db.customer.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
    }),
    db.invoice.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        number: true,
        status: true,
        dueAt: true,
        issuedAt: true,
        createdAt: true,
        customerId: true,
        currency: true,
        totalMinor: true,
        amountPaidMinor: true,
      },
    }),
    db.payment.findMany({
      where: { organizationId: orgId, customerId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reference: true,
        method: true,
        status: true,
        direction: true,
        amountMinor: true,
        refundedMinor: true,
        currency: true,
        customerId: true,
        invoiceId: true,
        createdAt: true,
        settledAt: true,
      },
    }),
  ])

  const openInvoicesByCustomer = new Map<string, { open: number; total: number }>()
  for (const inv of invoices) {
    const display = displayInvoiceStatus(inv)
    const agg = openInvoicesByCustomer.get(inv.customerId) ?? { open: 0, total: 0 }
    if (isOpenInvoiceStatus(display)) agg.open += 1
    agg.total += 1
    openInvoicesByCustomer.set(inv.customerId, agg)
  }

  // lifetime collected = settled inbound payments net of refunds, per currency
  const lifetimeByCustomer = new Map<string, Map<string, bigint>>()
  const settledCountByCustomer = new Map<string, number>()
  for (const p of payments) {
    if (p.customerId === null) continue
    if (p.direction !== 'IN' || p.status !== 'SETTLED') continue
    const net = p.amountMinor - p.refundedMinor
    if (net <= 0n) continue
    const per = lifetimeByCustomer.get(p.customerId) ?? new Map<string, bigint>()
    per.set(p.currency, (per.get(p.currency) ?? 0n) + net)
    lifetimeByCustomer.set(p.customerId, per)
    settledCountByCustomer.set(p.customerId, (settledCountByCustomer.get(p.customerId) ?? 0) + 1)
  }

  const rows: CustomerRow[] = customers.map((c) => {
    const invoiceAgg = openInvoicesByCustomer.get(c.id) ?? { open: 0, total: 0 }
    const customerInvoices = invoices.filter((inv) => inv.customerId === c.id)
    const customerPayments = payments.filter((p) => p.customerId === c.id)

    const activityDates: number[] = [c.updatedAt.getTime()]
    for (const inv of customerInvoices) {
      activityDates.push((inv.issuedAt ?? inv.createdAt).getTime())
    }
    for (const p of customerPayments) activityDates.push(p.createdAt.getTime())
    const lastActivityAt = new Date(Math.max(...activityDates))

    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      riskTier: c.riskTier,
      country: c.country,
      createdAt: c.createdAt.toISOString(),
      openInvoices: invoiceAgg.open,
      invoiceCount: invoiceAgg.total,
      settledPayments: settledCountByCustomer.get(c.id) ?? 0,
      lifetimePaid: [...(lifetimeByCustomer.get(c.id) ?? new Map<string, bigint>()).entries()].map(
        ([currency, minor]) => ({ currency, minor: minor.toString() })
      ),
      lastActivityAt: lastActivityAt.toISOString(),
      invoices: customerInvoices.slice(0, 12).map((inv) => ({
        id: inv.id,
        number: inv.number,
        displayStatus: displayInvoiceStatus(inv),
        currency: inv.currency,
        totalMinor: inv.totalMinor.toString(),
        amountPaidMinor: inv.amountPaidMinor.toString(),
        dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
        issuedAt: (inv.issuedAt ?? inv.createdAt).toISOString(),
      })),
      payments: customerPayments.slice(0, 12).map((p) => ({
        id: p.id,
        reference: p.reference,
        method: p.method,
        status: p.status,
        direction: p.direction,
        amountMinor: p.amountMinor.toString(),
        currency: p.currency,
        createdAt: p.createdAt.toISOString(),
        settledAt: p.settledAt ? p.settledAt.toISOString() : null,
      })),
    }
  })

  // org-level KPIs (server-computed, honest)
  const totalOpen = rows.reduce((a, r) => a + r.openInvoices, 0)
  const lifetimeSums = sumByCurrency(
    payments.filter((p) => p.direction === 'IN' && p.status === 'SETTLED'),
    (p) => ({ currency: p.currency, minor: p.amountMinor - p.refundedMinor })
  )
  const highRisk = rows.filter((r) => r.riskTier === 'HIGH').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Payer profiles with risk tiers, lifetime collections and open receivables. Lifetime paid counts settled inbound payments only — net of refunds."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Customers"
          value={rows.length}
          deltaLabel={`${rows.filter((r) => r.email).length} with email`}
          hint="org-scoped"
          icon={<Users className="h-4 w-4" />}
        />
        <KpiCard
          label="Open invoices"
          value={totalOpen}
          deltaLabel={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'} total`}
          hint="issued · viewed · partial · overdue"
          icon={<FileStack className="h-4 w-4" />}
        />
        <KpiCard
          label="Lifetime collected"
          value={
            lifetimeSums.size === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {[...lifetimeSums.entries()].map(([currency, minor]) => (
                  <MoneyText key={currency} minor={minor} currency={currency} />
                ))}
              </span>
            )
          }
          deltaLabel="settled inbound, net of refunds"
          icon={<Wallet className="h-4 w-4" />}
        />
        <KpiCard
          label="High-risk payers"
          value={highRisk}
          deltaLabel={
            highRisk > 0 ? 'payments auto-route to review' : 'no HIGH tier customers'
          }
          hint="risk engine tiers"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      <CustomersView rows={rows} />
    </div>
  )
}
