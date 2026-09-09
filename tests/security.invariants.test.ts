/**
 * SECURITY — auth hardening, API-key redaction, webhook replay scoping and
 * rate-limiter semantics (database-backed where needed).
 *
 * Covers the security wave: session tokens stored as sha256 hashes only,
 * login throttling (5 failures / 15 min per email), timing-equalized
 * unknown-email logins, registration validation, deep request-body
 * redaction, org-scoped webhook replay with signature preservation, and
 * the shared fixed-window limiter.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { hashPassword, sha256Hex } from '@/lib/crypto'
import { registerUser, loginUser } from '@/lib/auth'
import { createApiKey, logApiRequest } from '@/lib/api-auth'
import { emitWebhookEvent, replayDelivery } from '@/lib/webhooks'
import { FixedWindowRateLimiter } from '@/lib/rate-limit'
import { createTestOrg, resetDb } from './db-utils'

beforeEach(async () => {
  await resetDb()
})

describe('security · session tokens are stored hashed, never raw', () => {
  it('a session row is looked up by sha256(token) — the raw token is not a column', async () => {
    const user = await db.user.create({
      data: { email: 'session-test@novera.test', name: 'S', passwordHash: hashPassword('password123') },
    })
    const rawToken = 'a'.repeat(64)
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(rawToken),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })

    const byHash = await db.session.findUnique({ where: { tokenHash: sha256Hex(rawToken) } })
    expect(byHash).not.toBeNull()
    expect(byHash?.userId).toBe(user.id)

    // a DIFFERENT token hash does not resolve
    const other = await db.session.findUnique({ where: { tokenHash: sha256Hex('b'.repeat(64)) } })
    expect(other).toBeNull()

    // no column named `token` exists in the model at all (compile-time guarantee
    // — the schema exposes only tokenHash)
    expect('token' in byHash!).toBe(false)
  })
})

describe('security · login throttle (5 failures / 15 min per email)', () => {
  it('the 6th consecutive failed login for an email is refused with a throttle message', async () => {
    const email = `locked-${Date.now()}@novera.test`
    for (let i = 0; i < 5; i++) {
      await expect(loginUser(email, 'wrong-password')).rejects.toThrow(/Invalid email or password/)
    }
    await expect(loginUser(email, 'wrong-password')).rejects.toThrow(/Too many failed sign-in attempts/)

    // failed attempts are audited
    const failures = await db.auditEvent.count({ where: { action: 'auth.login.failed' } })
    expect(failures).toBe(5)
  })

  it('a successful login clears the email throttle window', async () => {
    const email = `unlock-${Date.now()}@novera.test`
    await db.user.create({
      data: { email, name: 'U', passwordHash: hashPassword('correct-password') },
    })
    // four failures stay under the limit
    for (let i = 0; i < 4; i++) {
      await expect(loginUser(email, 'wrong-password')).rejects.toThrow(/Invalid email or password/)
    }
    // the correct password succeeds (failures-only throttle: success is not a strike)
    const user = await loginUser(email, 'correct-password')
    expect(user.email).toBe(email)
    // the window was reset: five fresh failures are needed before the next block
    for (let i = 0; i < 5; i++) {
      await expect(loginUser(email, 'wrong-password')).rejects.toThrow(/Invalid email or password/)
    }
    await expect(loginUser(email, 'wrong-password')).rejects.toThrow(/Too many failed sign-in attempts/)
  })

  it('unknown emails fail closed with the same error text (no enumeration signal)', async () => {
    await expect(loginUser('does-not-exist@novera.test', 'whatever')).rejects.toThrow(
      /Invalid email or password/
    )
  })
})

describe('security · registration validation', () => {
  it('rejects malformed emails server-side', async () => {
    await expect(
      registerUser({ name: 'X', email: 'not-an-email', password: 'longenough1', organizationName: 'X Org' })
    ).rejects.toThrow(/valid email/)
  })

  it('rejects duplicate emails with a friendly error', async () => {
    const email = `dupe-${Date.now()}@novera.test`
    await registerUser({ name: 'A', email, password: 'longenough1', organizationName: 'A Org' })
    await expect(
      registerUser({ name: 'B', email, password: 'longenough1', organizationName: 'B Org' })
    ).rejects.toThrow(/already exists/)
  })
})

describe('security · API request logging redacts secrets at every depth', () => {
  it('nested secret-ish keys are masked, not just top-level', async () => {
    const org = await createTestOrg('Redaction Org')
    await logApiRequest({
      organizationId: org.id,
      method: 'POST',
      path: '/api/v1/payments',
      status: 200,
      durationMs: 5,
      requestBody: {
        amount: '100.00',
        customerEmail: 'a@b.c',
        payment: {
          metadata: {
            idempotencyKey: 'super-secret-key',
            nested: { password: 'hunter2', safe: 'visible' },
          },
        },
        items: [{ token: 'tok_1' }, { label: 'kept' }],
      },
    })
    const log = await db.apiRequestLog.findFirstOrThrow({ where: { organizationId: org.id } })
    const body = JSON.parse(log.requestBody ?? '{}')

    expect(body.amount).toBe('100.00')
    expect(body.payment.metadata.idempotencyKey).toBe('***')
    expect(body.payment.metadata.nested.password).toBe('***')
    expect(body.payment.metadata.nested.safe).toBe('visible')
    expect(body.items[0].token).toBe('***')
    expect(body.items[1].label).toBe('kept')
  })
})

describe('security · webhook replay is org-scoped and preserves the original signature', () => {
  it('another org cannot replay a delivery it does not own; replay never rewrites the stored signature', async () => {
    const orgA = await createTestOrg('Webhook Org A')
    const orgB = await createTestOrg('Webhook Org B')
    const endpoint = await db.webhookEndpoint.create({
      data: { organizationId: orgA.id, url: 'https://example.com/hook', events: '["*"]', secret: 'whsec_t' },
    })
    await emitWebhookEvent({ organizationId: orgA.id, event: 'payment.settled', data: { x: 1 } })
    const delivery = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: endpoint.id } })
    const originalSignature = delivery.signature

    // cross-org replay is refused — nothing changes
    expect(await replayDelivery(orgB.id, delivery.id)).toBe(false)
    const untouched = await db.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
    expect(untouched.attempts).toBe(delivery.attempts)

    // legitimate replay: outcome is hash-determined (DELIVERED or FAILED —
    // both are honest simulated results), but in BOTH cases the original
    // signature is preserved and the attempt is recorded
    await replayDelivery(orgA.id, delivery.id)
    const after = await db.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
    expect(after.signature).toBe(originalSignature)
    expect(after.attempts).toBe(delivery.attempts + 1)
    expect(['DELIVERED', 'FAILED']).toContain(after.status)
  })
})

describe('security · FixedWindowRateLimiter semantics', () => {
  it('allows up to the limit inside the window, refuses after, resets per key', () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000)
    expect(limiter.check('k').allowed).toBe(true)
    expect(limiter.check('k').allowed).toBe(true)
    expect(limiter.check('k').allowed).toBe(true)
    const blocked = limiter.check('k')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryInMs).toBeGreaterThan(0)
    // other keys are unaffected
    expect(limiter.check('other').allowed).toBe(true)
    // reset clears the window
    limiter.reset('k')
    expect(limiter.check('k').allowed).toBe(true)
  })
})

describe('security · API keys authenticate by unique hash', () => {
  it('authenticateApiKey resolves by keyHash and rejects unknown keys', async () => {
    const { authenticateApiKey } = await import('@/lib/api-auth')
    const org = await createTestOrg('ApiKey Org')
    const created = await createApiKey(org.id, 'test-key', 'TEST', ['payments:write'], {
      id: 'u1',
      name: 'T',
    })
    const resolved = await authenticateApiKey(created.secret)
    expect(resolved?.organizationId).toBe(org.id)
    expect(resolved?.scopes).toContain('payments:write')

    const rejected = await authenticateApiKey('nv_test_wrongsecret')
    expect(rejected).toBeNull()
  })
})
