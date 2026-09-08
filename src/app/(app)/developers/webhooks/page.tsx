import { createHmac } from 'crypto'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { safeJson } from '@/lib/format'
import { PageHeader } from '@/components/novera/page-header'
import { WebhooksClient, type EndpointRow, type DeliveryRow } from './_components/webhooks-client'

export const metadata = { title: 'Webhooks' }

/** Build a self-consistent example quadruple so the verifier demo starts green. */
function buildDemoSignature() {
  const secret = 'nvwhsec_demo_0000signing'
  const timestamp = Math.floor(Date.now() / 1000)
  const payload = JSON.stringify(
    {
      id: 'wh_demo0001',
      event: 'payment.settled',
      createdAt: new Date().toISOString(),
      data: { reference: 'pay_mtswo0a2r90epbxnx', amountMinor: '125000', currency: 'KES' },
    },
    null,
    2
  )
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return { secret, timestamp: String(timestamp), payload, signature }
}

export default async function WebhooksPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  const [endpoints, deliveries] = await Promise.all([
    db.webhookEndpoint.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
    }),
    db.webhookDelivery.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { endpoint: { select: { url: true } } },
    }),
  ])

  const endpointRows: EndpointRow[] = endpoints.map((e) => ({
    id: e.id,
    url: e.url,
    description: e.description,
    events: safeJson<string[]>(e.events, []),
    status: e.status,
    secret: e.secret,
    createdAt: e.createdAt.toISOString(),
  }))

  const deliveryRows: DeliveryRow[] = deliveries.map((d) => ({
    id: d.id,
    event: d.event,
    endpointUrl: d.endpoint.url,
    status: d.status,
    attempts: d.attempts,
    responseCode: d.responseCode,
    payload: d.payload,
    signature: d.signature,
    nextAttemptAt: d.nextAttemptAt ? d.nextAttemptAt.toISOString() : null,
    deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Signed outbound events. Every delivery is HMAC-SHA256 signed over timestamp.body — verify before trusting. Failed deliveries retry, then dead-letter; any delivery can be replayed."
      />
      <WebhooksClient
        endpoints={endpointRows}
        deliveries={deliveryRows}
        demoSignature={buildDemoSignature()}
      />
    </div>
  )
}
