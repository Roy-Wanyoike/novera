import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ref } from '@/lib/ids'
import { recordAudit } from '@/lib/audit'
import { assertSafeWebhookUrl } from '@/lib/ssrf'
import { EVENT_NAMES } from '@novera/events'
import { withApiKey, okJson, errorJson } from '../../_lib/auth'
import { serializeWebhookEndpoint } from '../../_lib/serialize'

/**
 * Webhook endpoints — GET lists (never returns secrets), POST registers a
 * new endpoint and returns the signing secret exactly once.
 *
 * SSRF guard: registered URLs must be public HTTPS endpoints — loopback,
 * link-local (169.254/16 — cloud metadata), RFC1918, CGNAT, unique-local
 * IPv6 and hostnames that RESOLVE into private ranges are rejected, and
 * unresolvable hostnames are rejected fail-closed. Enforced now so the
 * contract is in place before real HTTP delivery lands.
 * Scope: webhooks:manage
 */

const EVENT_NAMES_SET = new Set<string>(['*', ...EVENT_NAMES])

export async function GET(req: NextRequest) {
  return withApiKey(req, ['webhooks:manage'], async (key) => {
    const endpoints = await db.webhookEndpoint.findMany({
      where: { organizationId: key.organizationId },
      orderBy: { createdAt: 'asc' },
    })
    return okJson({
      endpoints: endpoints.map((e) => serializeWebhookEndpoint(e)),
      count: endpoints.length,
    })
  })
}

interface CreateEndpointBody {
  url?: unknown
  events?: unknown
  description?: unknown
}

export async function POST(req: NextRequest) {
  return withApiKey(req, ['webhooks:manage'], async (key) => {
    let body: CreateEndpointBody
    try {
      body = (await req.json()) as CreateEndpointBody
    } catch {
      return errorJson(400, 'INVALID_ARGUMENT', 'Request body must be valid JSON.')
    }

    const url = typeof body.url === 'string' ? body.url.trim() : ''
    const description = typeof body.description === 'string' ? body.description.trim() : null
    const events = Array.isArray(body.events) ? body.events.filter((e): e is string => typeof e === 'string') : null

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return errorJson(400, 'INVALID_ARGUMENT', '"url" must be a valid absolute URL.')
    }
    if (parsed.protocol !== 'https:') {
      return errorJson(400, 'INVALID_ARGUMENT', '"url" must use HTTPS.')
    }
    if (!events || events.length === 0) {
      return errorJson(400, 'INVALID_ARGUMENT', '"events" must be a non-empty array of event names (use "*" for all).')
    }
    if (events.length > 20) {
      return errorJson(400, 'INVALID_ARGUMENT', '"events" must contain at most 20 entries (use "*" for all events).')
    }
    const unknown = events.filter((e) => !EVENT_NAMES_SET.has(e))
    if (unknown.length > 0) {
      return errorJson(
        400,
        'INVALID_ARGUMENT',
        `Unknown event(s): ${unknown.join(', ')}. See the event catalog in /developers/docs.`
      )
    }
    if (description && description.length > 200) {
      return errorJson(400, 'INVALID_ARGUMENT', '"description" must be at most 200 characters.')
    }

    // SSRF guard — reject private/loopback/link-local targets fail-closed
    const ssrf = await assertSafeWebhookUrl(url)
    if (!ssrf.ok) {
      return errorJson(422, 'SSRF_GUARD', `Webhook URL rejected: ${ssrf.reason}`)
    }

    const secret = ref.webhookSecret()
    const endpoint = await db.webhookEndpoint.create({
      data: {
        organizationId: key.organizationId,
        url,
        description,
        events: JSON.stringify(events),
        secret,
      },
    })
    await recordAudit({
      organizationId: key.organizationId,
      actorType: 'SERVICE',
      actorId: key.id,
      actorLabel: `apikey:${key.name}`,
      action: 'webhook.endpoint.created',
      resourceType: 'WebhookEndpoint',
      resourceId: endpoint.id,
      description: `Webhook endpoint ${url} registered for ${events.length} event(s)`,
      metadata: { url, events },
    })

    return okJson(serializeWebhookEndpoint(endpoint, secret), 201)
  })
}
