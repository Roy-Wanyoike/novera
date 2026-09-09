/**
 * Demo data: route three payments through the REAL kernel so they land in the
 * manual risk review queue (risk REVIEW → status PENDING). No direct writes —
 * createPayment runs the risk engine, state machine and audit trail.
 */
import { db } from '@/lib/db'
import { createPayment } from '@/lib/payments'

async function main() {
  const org = await db.organization.findFirst({ where: { name: 'Acme Kenya Ltd' } })
  if (!org) throw new Error('org not found')

  const customers = await db.customer.findMany({ where: { organizationId: org.id } })
  const pick = (email: string) => customers.find((c) => c.email === email)

  const specs: {
    amountMinor: bigint
    currency: string
    method: string
    customerId: string | null
    customerName: string | null
    customerEmail: string | null
    description: string
  }[] = [
    {
      amountMinor: 12_500_000n,
      currency: 'KES',
      method: 'CARD',
      customerId: pick('billing@ndc.co.ke')?.id ?? null,
      customerName: 'Nairobi Dental Clinic',
      customerEmail: 'billing@ndc.co.ke',
      description: 'Annual equipment financing instalment (card)',
    },
    {
      amountMinor: 9_400_000n,
      currency: 'KES',
      method: 'CARD',
      customerId: pick('pendo@interiors.co.ke')?.id ?? null,
      customerName: 'Pendo Interiors',
      customerEmail: 'pendo@interiors.co.ke',
      description: 'Bulk materials order — flagged for manual review',
    },
    {
      amountMinor: 240_000_000n,
      currency: 'KES',
      method: 'BANK',
      customerId: pick('orders@mbfresh.co.ke')?.id ?? null,
      customerName: 'Mombasa Fresh Foods',
      customerEmail: 'orders@mbfresh.co.ke',
      description: 'Quarterly supply prepayment over large-transaction threshold',
    },
  ]

  for (const spec of specs) {
    const payment = await createPayment({
      organizationId: org.id,
      ...spec,
      actor: { type: 'USER', label: 'Risk ops demo' },
    })
    console.log(
      `created ${payment?.reference}: status=${payment?.status} risk=${payment?.riskDecision} score=${payment?.riskScore}`
    )
  }

  await db.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
