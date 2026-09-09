'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { ref } from '@/lib/ids'
import { recordAudit } from '@/lib/audit'
import { replayDelivery, verifyWebhookSignature } from '@/lib/webhooks'
import { EVENT_NAMES } from '@novera/events'

const VALID_EVENTS = new Set<string>(['*', ...EVENT_NAMES])

export interface EndpointRowInput {
  url: string
  description: string
  events: string[]
}

export interface AddEndpointResult {
  ok: boolean
  error?: string
  endpoint?: {
    id: string
    url: string
    events: string[]
    secret: string // shown exactly once
  }
}

export async function addEndpointAction(input: EndpointRowInput): Promise<AddEndpointResult> {
  const session = await requireSession()
  const url = input.url.trim()
  const description = input.description.trim() || ''
  const events = input.events.filter((e) => VALID_EVENTS.has(e))

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'Enter a valid absolute URL.' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Webhook URLs must use HTTPS.' }
  }
  if (events.length === 0) {
    return { ok: false, error: 'Select at least one event.' }
  }
  if (description.length > 200) {
    return { ok: false, error: 'Description must be at most 200 characters.' }
  }

  // duplicate guard (same org + url)
  const dupe = await db.webhookEndpoint.findFirst({
    where: { organizationId: session.organization.id, url },
  })
  if (dupe) {
    return { ok: false, error: 'An endpoint with this URL already exists.' }
  }

  const secret = ref.webhookSecret()
  const endpoint = await db.webhookEndpoint.create({
    data: {
      organizationId: session.organization.id,
      url,
      description: description || null,
      events: JSON.stringify(events),
      secret,
    },
  })
  await recordAudit({
    organizationId: session.organization.id,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'webhook.endpoint.created',
    resourceType: 'WebhookEndpoint',
    resourceId: endpoint.id,
    description: `Webhook endpoint ${url} registered for ${events.length} event(s)`,
    metadata: { url, events },
  })
  revalidatePath('/developers/webhooks')
  return { ok: true, endpoint: { id: endpoint.id, url, events, secret } }
}

export async function setEndpointStatusAction(
  endpointId: string,
  status: 'ACTIVE' | 'PAUSED'
): Promise<{ ok: boolean; error?: string; status?: string }> {
  const session = await requireSession()
  const orgId = session.organization.id

  // IDOR guard: the endpoint must belong to this org before mutating.
  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id: endpointId, organizationId: orgId },
    select: { id: true, url: true, status: true, description: true },
  })
  if (!endpoint) {
    return { ok: false, error: 'Endpoint not found in this organization.' }
  }
  if (endpoint.status === status) {
    return { ok: true, status } // idempotent no-op
  }

  await db.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { status },
  })
  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: status === 'PAUSED' ? 'webhook.endpoint.disabled' : 'webhook.endpoint.enabled',
    resourceType: 'WebhookEndpoint',
    resourceId: endpoint.id,
    description: `Webhook endpoint ${endpoint.url} ${status === 'PAUSED' ? 'paused' : 'resumed'} by ${session.user.name}`,
    severity: status === 'PAUSED' ? 'WARN' : 'INFO',
    metadata: { url: endpoint.url, from: endpoint.status, to: status, via: 'webhooks-ui' },
  })
  revalidatePath('/developers/webhooks')
  return { ok: true, status }
}

export async function deleteEndpointAction(
  endpointId: string
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession()
  const orgId = session.organization.id

  // IDOR guard: the endpoint must belong to this org before deleting.
  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id: endpointId, organizationId: orgId },
    select: { id: true, url: true, status: true },
  })
  if (!endpoint) {
    return { ok: false, error: 'Endpoint not found in this organization.' }
  }

  // Deliveries cascade at the schema level (onDelete: Cascade), but they
  // are removed explicitly first so the guarantee holds even where FK
  // enforcement is relaxed, and so the count can be audited.
  const removed = await db.webhookDelivery.deleteMany({
    where: { endpointId: endpoint.id, organizationId: orgId },
  })
  await db.webhookEndpoint.delete({ where: { id: endpoint.id } })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'webhook.endpoint.deleted',
    resourceType: 'WebhookEndpoint',
    resourceId: endpoint.id,
    description: `Webhook endpoint ${endpoint.url} deleted by ${session.user.name} (${removed.count} delivery record${removed.count === 1 ? '' : 's'} removed)`,
    severity: 'WARN',
    metadata: { url: endpoint.url, wasStatus: endpoint.status, deliveriesRemoved: removed.count, via: 'webhooks-ui' },
  })
  revalidatePath('/developers/webhooks')
  revalidatePath('/developers')
  return { ok: true }
}

export async function replayDeliveryAction(
  deliveryId: string
): Promise<{ ok: boolean; delivered?: boolean; error?: string }> {
  const session = await requireSession()
  const orgId = session.organization.id

  // IDOR guard: the delivery must belong to this org before replaying.
  const delivery = await db.webhookDelivery.findFirst({
    where: { id: deliveryId, organizationId: orgId },
    select: { id: true, event: true, status: true },
  })
  if (!delivery) {
    return { ok: false, error: 'Delivery not found in this organization.' }
  }

  const delivered = await replayDelivery(deliveryId)
  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'webhook.replayed',
    resourceType: 'WebhookDelivery',
    resourceId: deliveryId,
    description: `Manual replay of ${delivery.event} (was ${delivery.status})`,
    metadata: { event: delivery.event, delivered },
  })
  revalidatePath('/developers/webhooks')
  return { ok: true, delivered }
}

export async function verifySignatureAction(input: {
  secret: string
  timestamp: string
  payload: string
  signature: string
}): Promise<{ valid: boolean; error?: string }> {
  await requireSession()

  const secret = input.secret.trim()
  const ts = Number(input.timestamp)
  if (!secret || !input.signature.trim()) {
    return { valid: false, error: 'Secret and signature are required.' }
  }
  if (!Number.isFinite(ts) || !Number.isInteger(ts)) {
    return { valid: false, error: 'Timestamp must be an integer (unix seconds).' }
  }

  const valid = verifyWebhookSignature(secret, ts, input.payload, input.signature.trim())
  return { valid }
}
