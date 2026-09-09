import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import { withApiKey, okJson, errorJson } from '../../../_lib/auth'
import { serializeWebhookEndpoint } from '../../../_lib/serialize'

/**
 * Webhook endpoint management by id.
 *   DELETE /api/v1/webhooks/endpoints/{id} — remove an endpoint (and its
 *     delivery history) permanently.
 *   PATCH  /api/v1/webhooks/endpoints/{id} — set status ACTIVE | PAUSED.
 * Both are org-scoped through the API key and audited as SERVICE actions.
 * Scope: webhooks:manage
 */

const ENDPOINT_STATUSES = new Set(['ACTIVE', 'PAUSED'])

interface PatchEndpointBody {
  status?: unknown
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiKey(req, ['webhooks:manage'], async (key) => {
    const { id } = await ctx.params
    if (!id || id.length > 64) {
      return errorJson(400, 'INVALID_ARGUMENT', 'Invalid endpoint identifier.')
    }

    const endpoint = await db.webhookEndpoint.findFirst({
      where: { id, organizationId: key.organizationId },
    })
    if (!endpoint) {
      return errorJson(404, 'NOT_FOUND', `No webhook endpoint found for id "${id}" in this organization.`)
    }

    // Deliveries cascade at the schema level (onDelete: Cascade); they are
    // removed explicitly first so the guarantee holds even where FK
    // enforcement is relaxed, and so the count can be audited.
    const removed = await db.webhookDelivery.deleteMany({
      where: { endpointId: endpoint.id, organizationId: key.organizationId },
    })
    await db.webhookEndpoint.delete({ where: { id: endpoint.id } })

    await recordAudit({
      organizationId: key.organizationId,
      actorType: 'SERVICE',
      actorId: key.id,
      actorLabel: `apikey:${key.name}`,
      action: 'webhook.endpoint.deleted',
      resourceType: 'WebhookEndpoint',
      resourceId: endpoint.id,
      description: `Webhook endpoint ${endpoint.url} deleted via API (${removed.count} delivery record${removed.count === 1 ? '' : 's'} removed)`,
      severity: 'WARN',
      metadata: { url: endpoint.url, wasStatus: endpoint.status, deliveriesRemoved: removed.count, via: 'api-v1' },
    })

    return okJson({ id: endpoint.id, deleted: true, deliveriesRemoved: removed.count })
  })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiKey(req, ['webhooks:manage'], async (key) => {
    const { id } = await ctx.params
    if (!id || id.length > 64) {
      return errorJson(400, 'INVALID_ARGUMENT', 'Invalid endpoint identifier.')
    }

    let body: PatchEndpointBody
    try {
      body = (await req.json()) as PatchEndpointBody
    } catch {
      return errorJson(400, 'INVALID_ARGUMENT', 'Request body must be valid JSON.')
    }

    const status = typeof body.status === 'string' ? body.status.toUpperCase() : ''
    if (!ENDPOINT_STATUSES.has(status)) {
      return errorJson(400, 'INVALID_ARGUMENT', '"status" must be "ACTIVE" or "PAUSED".')
    }

    const endpoint = await db.webhookEndpoint.findFirst({
      where: { id, organizationId: key.organizationId },
    })
    if (!endpoint) {
      return errorJson(404, 'NOT_FOUND', `No webhook endpoint found for id "${id}" in this organization.`)
    }

    if (endpoint.status === status) {
      return okJson(serializeWebhookEndpoint(endpoint)) // idempotent no-op
    }

    const updated = await db.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { status },
    })

    await recordAudit({
      organizationId: key.organizationId,
      actorType: 'SERVICE',
      actorId: key.id,
      actorLabel: `apikey:${key.name}`,
      action: status === 'PAUSED' ? 'webhook.endpoint.disabled' : 'webhook.endpoint.enabled',
      resourceType: 'WebhookEndpoint',
      resourceId: endpoint.id,
      description: `Webhook endpoint ${endpoint.url} set to ${status} via API`,
      severity: status === 'PAUSED' ? 'WARN' : 'INFO',
      metadata: { url: endpoint.url, from: endpoint.status, to: status, via: 'api-v1' },
    })

    return okJson(serializeWebhookEndpoint(updated))
  })
}
