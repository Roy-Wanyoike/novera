import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  extractBearerKey,
  authenticateApiKey,
  checkRateLimit,
  logApiRequest,
} from '@/lib/api-auth'

/**
 * API v1 — shared auth middleware.
 *
 * Every key-authenticated handler runs through `withApiKey`:
 *   1. extract Bearer key  → 401 {error:{code,message}}
 *   2. authenticateApiKey  → 401 when unknown / revoked
 *   3. checkRateLimit      → 429 with reset (Retry-After header)
 *   4. scope check         → 403 INSUFFICIENT_SCOPE
 *   5. handler             → response logged via logApiRequest (org-scoped
 *                             from the key: path, status, duration, redacted body)
 *
 * 401 responses cannot be logged (the org is not resolvable from a bad key);
 * every other outcome is written to ApiRequestLog.
 */

export interface ApiKeyContext {
  id: string
  organizationId: string
  mode: string
  name: string
  scopes: string[]
  rateLimitPerMin: number
}

export const RATE_LIMIT_DEFAULT = 120

/** Success envelope: {data: ...} */
export function okJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ data }, { status })
}

/** Error envelope: {error: {code, message, ...extras}} */
export function errorJson(
  status: number,
  code: string,
  message: string,
  extras?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...extras } },
    { status, headers: { 'x-novera-error-code': code } }
  )
}

type AuthResult =
  | { ok: true; key: ApiKeyContext }
  | { ok: false; response: NextResponse }

async function authenticateRequest(req: NextRequest): Promise<AuthResult> {
  const secret = extractBearerKey(req.headers.get('authorization'))
  if (!secret) {
    return {
      ok: false,
      response: errorJson(
        401,
        'UNAUTHENTICATED',
        'Missing Authorization header. Send "Authorization: Bearer nv_test_…" — see the developer docs.'
      ),
    }
  }

  const key = await authenticateApiKey(secret)
  if (!key) {
    return {
      ok: false,
      response: errorJson(401, 'UNAUTHENTICATED', 'Invalid or revoked API key.'),
    }
  }

  const row = await db.apiKey.findUnique({
    where: { id: key.id },
    select: { rateLimitPerMin: true },
  })
  const limitPerMin = row?.rateLimitPerMin ?? RATE_LIMIT_DEFAULT

  const rl = checkRateLimit(key.id, limitPerMin)
  if (!rl.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil(rl.resetInMs / 1000))
    const resetAt = new Date(Date.now() + rl.resetInMs).toISOString()
    // 429 is attributable to a known key/org → log it.
    await logApiRequest({
      organizationId: key.organizationId,
      apiKeyId: key.id,
      method: req.method,
      path: new URL(req.url).pathname,
      status: 429,
      durationMs: 0,
      errorCode: 'RATE_LIMITED',
    })
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `Rate limit exceeded: ${limitPerMin} requests/min on this key.`,
            limitPerMin,
            retryAfterSec,
            resetAt,
          },
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSec), 'x-novera-error-code': 'RATE_LIMITED' },
        }
      ),
    }
  }

  return {
    ok: true,
    key: { ...key, rateLimitPerMin: limitPerMin },
  }
}

/**
 * Wrap an authenticated v1 handler. `scopes` is the list of scopes accepted
 * by the endpoint (ANY-of semantics — the key needs at least one of them).
 */
export async function withApiKey(
  req: NextRequest,
  scopes: string[] | null,
  handler: (key: ApiKeyContext) => Promise<NextResponse>
): Promise<NextResponse> {
  const startedAt = Date.now()
  const path = new URL(req.url).pathname

  const auth = await authenticateRequest(req)
  if (!auth.ok) return auth.response
  const key = auth.key

  // Capture the request body for POST logging (logApiRequest redacts
  // secret/password/token/key fields before persisting).
  let requestBody: unknown
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      requestBody = await req.clone().json()
    } catch {
      requestBody = undefined
    }
  }

  if (scopes && scopes.length > 0 && !scopes.some((s) => key.scopes.includes(s))) {
    const res = errorJson(
      403,
      'INSUFFICIENT_SCOPE',
      `This endpoint requires one of the following scopes: ${scopes.join(', ')}.`,
      { requiredScopes: scopes, keyScopes: key.scopes }
    )
    await logApiRequest({
      organizationId: key.organizationId,
      apiKeyId: key.id,
      method: req.method,
      path,
      status: 403,
      durationMs: Date.now() - startedAt,
      requestBody,
      errorCode: 'INSUFFICIENT_SCOPE',
    })
    return res
  }

  let res: NextResponse
  try {
    res = await handler(key)
  } catch (err) {
    console.error('[api/v1]', req.method, path, err)
    res = errorJson(500, 'INTERNAL', 'An unexpected error occurred.')
  }

  const errorCode = res.headers.get('x-novera-error-code') ?? null
  await logApiRequest({
    organizationId: key.organizationId,
    apiKeyId: key.id,
    method: req.method,
    path,
    status: res.status,
    durationMs: Date.now() - startedAt,
    requestBody,
    errorCode,
  })

  res.headers.set('X-RateLimit-Limit', String(key.rateLimitPerMin))
  return res
}

/** Safe query-int parser for list endpoints. Returns null when invalid. */
export function parseLimit(raw: string | null, fallback = 25, max = 100): number | null {
  if (raw === null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > max) return null
  return n
}
