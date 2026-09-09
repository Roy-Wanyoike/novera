import { db } from '@/lib/db'
import { sha256Hex } from '@/lib/crypto'
import { recordAudit } from '@/lib/audit'
import { ref } from '@/lib/ids'

/**
 * API AUTH — Bearer keys for the public /api/v1 surface.
 *
 * Keys are shown once at creation (prefix + secret). Only the sha256 hash
 * is stored (keyHash is @unique — lookups are indexed and race-free).
 * Every request is logged (deep-redacted) for the developer portal, with
 * a per-key in-memory rate limiter (Redis in production). Failed key
 * authentication is appended to the audit trail.
 */

export interface AuthenticatedKey {
  apiKey: { id: string; organizationId: string; mode: string; name: string; scopes: string[] }
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>()

export function checkRateLimit(apiKeyId: string, limitPerMin: number): { allowed: boolean; resetInMs: number } {
  const now = Date.now()
  const bucket = rateBuckets.get(apiKeyId)
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(apiKeyId, { count: 1, resetAt: now + 60000 })
    return { allowed: true, resetInMs: 60000 }
  }
  bucket.count++
  return { allowed: bucket.count <= limitPerMin, resetInMs: bucket.resetAt - now }
}

export function extractBearerKey(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

export async function authenticateApiKey(secret: string): Promise<AuthenticatedKey['apiKey'] | null> {
  const hash = sha256Hex(secret)
  const row = await db.apiKey.findUnique({ where: { keyHash: hash } })
  if (!row || row.status !== 'ACTIVE') return null
  return {
    id: row.id,
    organizationId: row.organizationId,
    mode: row.mode,
    name: row.name,
    scopes: JSON.parse(row.scopes),
  }
}

const SENSITIVE_KEY_RE = /secret|password|token|key|authorization|credential|cvv|pan/i
const MAX_REDACT_DEPTH = 4

/**
 * Deep redaction: secret-ish keys are masked at EVERY nesting level (up to
 * MAX_REDACT_DEPTH), not just the top level — a request body like
 * {payment: {metadata: {idempotencyKey: ...}}} must not leak into
 * ApiRequestLog. Arrays redact element-wise; unknown types are dropped.
 */
function redactDeep(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACT_DEPTH) return '[truncated]'
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '***' : redactDeep(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 512) return value.slice(0, 512) + '…'
  return value
}

export async function logApiRequest(input: {
  organizationId: string
  apiKeyId?: string | null
  method: string
  path: string
  status: number
  durationMs: number
  requestBody?: unknown
  errorCode?: string | null
}) {
  let redacted: string | null = null
  if (input.requestBody !== undefined) {
    try {
      redacted = JSON.stringify(redactDeep(input.requestBody, 0))
    } catch {
      redacted = null
    }
  }
  await db.apiRequestLog.create({
    data: {
      organizationId: input.organizationId,
      apiKeyId: input.apiKeyId ?? null,
      method: input.method,
      path: input.path,
      status: input.status,
      durationMs: input.durationMs,
      requestBody: redacted,
      errorCode: input.errorCode ?? null,
    },
  })
  if (input.apiKeyId) {
    await db.apiKey.update({
      where: { id: input.apiKeyId },
      data: { lastUsedAt: new Date(), requestCount: { increment: 1 } },
    })
  }
}

export interface CreatedKey {
  id: string
  name: string
  mode: 'TEST' | 'LIVE'
  secret: string // shown exactly once
  prefix: string
  scopes: string[]
}

export async function createApiKey(
  organizationId: string,
  name: string,
  mode: 'TEST' | 'LIVE',
  scopes: string[],
  actor: { id: string; name: string }
): Promise<CreatedKey> {
  const secret = ref.apiKey(mode)
  const row = await db.apiKey.create({
    data: {
      organizationId,
      name,
      mode,
      prefix: secret.slice(0, 17),
      keyHash: sha256Hex(secret),
      lastFour: secret.slice(-4),
      scopes: JSON.stringify(scopes),
    },
  })
  await recordAudit({
    organizationId,
    actorType: 'USER',
    actorId: actor.id,
    actorLabel: actor.name,
    action: 'apikey.created',
    resourceType: 'ApiKey',
    resourceId: row.id,
    description: `API key "${name}" created (${mode})`,
    metadata: { scopes },
  })
  return { id: row.id, name, mode, secret, prefix: row.prefix, scopes }
}

export async function revokeApiKey(organizationId: string, keyId: string, actor: { id: string; name: string }) {
  const key = await db.apiKey.findFirst({ where: { id: keyId, organizationId } })
  if (!key) throw new Error('key not found')
  await db.apiKey.update({ where: { id: keyId }, data: { status: 'REVOKED' } })
  await recordAudit({
    organizationId,
    actorType: 'USER',
    actorId: actor.id,
    actorLabel: actor.name,
    action: 'apikey.revoked',
    resourceType: 'ApiKey',
    resourceId: keyId,
    description: `API key "${key.name}" revoked`,
    severity: 'WARN',
  })
}
