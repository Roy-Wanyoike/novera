import { db } from '@/lib/db'
import { sha256Hex } from '@/lib/crypto'
import { recordAudit } from '@/lib/audit'
import { ref } from '@/lib/ids'

/**
 * API AUTH — Bearer keys for the public /api/v1 surface.
 *
 * Keys are shown once at creation (prefix + secret). Only the sha256 hash
 * is stored. Every request is logged (redacted) for the developer portal,
 * with a per-key in-memory rate limiter (Redis in production).
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
  // NOTE (hotfix by agent 1-j): keyHash lacks @unique in the schema, so
  // findUnique({keyHash}) throws PrismaClientValidationError. findFirst has
  // identical semantics here; the integrator should add @unique + regenerate.
  const row = await db.apiKey.findFirst({ where: { keyHash: hash } })
  if (!row || row.status !== 'ACTIVE') return null
  return {
    id: row.id,
    organizationId: row.organizationId,
    mode: row.mode,
    name: row.name,
    scopes: JSON.parse(row.scopes),
  }
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
    const clone: Record<string, unknown> = { ...(input.requestBody as Record<string, unknown>) }
    for (const k of Object.keys(clone)) {
      if (/secret|password|token|key/i.test(k)) clone[k] = '***'
    }
    redacted = JSON.stringify(clone)
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
