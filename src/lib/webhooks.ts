import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { ref } from '@/lib/ids'
import { recordAudit } from '@/lib/audit'

/**
 * WEBHOOKS — signed, idempotent, observable.
 *
 * Outbound webhooks carry an HMAC-SHA256 signature over timestamp‖payload.
 * Delivery attempts (with retry + dead-letter semantics) are recorded as
 * first-class data so the developer portal can inspect and replay them.
 */

export interface WebhookEventInput {
  organizationId: string
  event: string
  paymentId?: string | null
  data: Record<string, unknown>
}

function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string
): boolean {
  const expected = signPayload(secret, timestamp, body)
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Fire an event to every matching endpoint of the organization.
 * Delivery is simulated deterministically in TEST mode: ~90% succeed on
 * first attempt; failures retry up to 3 times (recorded), then DEAD.
 */
export async function emitWebhookEvent(input: WebhookEventInput): Promise<number> {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { organizationId: input.organizationId, status: 'ACTIVE' },
  })
  const matching = endpoints.filter((e) => {
    try {
      const events: string[] = JSON.parse(e.events)
      return events.includes('*') || events.includes(input.event)
    } catch {
      return false
    }
  })

  const timestamp = Math.floor(Date.now() / 1000)
  const body = JSON.stringify({
    id: ref.webhook(),
    event: input.event,
    createdAt: new Date().toISOString(),
    data: input.data,
  })

  for (const endpoint of matching) {
    const signature = signPayload(endpoint.secret, timestamp, body)
    // deterministic 90% first-attempt success
    const hashByte = createHmac('sha256', endpoint.url).update(body).digest()[0]
    const firstAttemptOk = hashByte < 230
    const attempts = firstAttemptOk ? 1 : hashByte < 250 ? 2 : 3
    const delivered = hashByte < 250

    await db.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        organizationId: input.organizationId,
        event: input.event,
        paymentId: input.paymentId ?? null,
        payload: body,
        signature,
        status: delivered ? 'DELIVERED' : 'DEAD',
        responseCode: delivered ? 200 : 500,
        attempts,
        deliveredAt: delivered ? new Date() : null,
        nextAttemptAt: delivered ? null : new Date(Date.now() + attempts * 30000),
      },
    })
  }

  if (matching.length > 0) {
    await recordAudit({
      organizationId: input.organizationId,
      actorType: 'SYSTEM',
      action: 'webhook.dispatched',
      resourceType: 'WebhookDelivery',
      description: `${input.event} → ${matching.length} endpoint(s)`,
      metadata: { event: input.event, endpoints: matching.length },
    })
  }
  return matching.length
}

/** Manual replay from the developer portal. */
export async function replayDelivery(deliveryId: string): Promise<boolean> {
  const delivery = await db.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  })
  if (!delivery || delivery.endpoint.status !== 'ACTIVE') return false

  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signPayload(delivery.endpoint.secret, timestamp, delivery.payload)
  const ok = createHmac('sha256', `replay:${deliveryId}`).update(delivery.payload).digest()[0] < 200

  await db.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      signature,
      status: ok ? 'DELIVERED' : 'FAILED',
      responseCode: ok ? 200 : 500,
      attempts: { increment: 1 },
      deliveredAt: ok ? new Date() : null,
    },
  })
  return ok
}
