import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import { hashPassword, verifyPassword, sha256Hex, pickAvatarColor } from '@/lib/crypto'
import { FixedWindowRateLimiter } from '@/lib/rate-limit'

export { hashPassword, verifyPassword, sha256Hex, pickAvatarColor }

/**
 * AUTHENTICATION — server-side only.
 *
 * Directive: never trust the frontend. Every server action / route
 * handler resolves the session from the httpOnly cookie and enforces
 * organization scoping on every query. Passwords use scrypt with
 * per-user salts; sessions are opaque tokens whose sha256 hash is the
 * only stored form (a read-only DB leak yields no replayable sessions).
 *
 * Login is throttled per email (5 failures / 15 min, in-memory fixed
 * window) and timing-equalized: an unknown email still runs a full
 * scrypt verification against a dummy hash so response latency does not
 * reveal which emails are registered.
 */

const SESSION_COOKIE = 'novera_session'
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000

export function hashPasswordLocal(password: string): string {
  return hashPassword(password)
}

export interface SessionUser {
  user: { id: string; email: string; name: string; avatarColor: string }
  organization: {
    id: string
    name: string
    slug: string
    mode: string
    type: string
    country: string
    role: string
  }
  sessionId: string
}

export async function createSession(userId: string, activeOrganizationId?: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const membership = activeOrganizationId
    ? await db.membership.findFirst({ where: { userId, organizationId: activeOrganizationId } })
    : await db.membership.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } })
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      activeOrganizationId: membership?.organizationId ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
  return token
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) {
    await db.session.updateMany({ where: { tokenHash: sha256Hex(token) }, data: { revokedAt: new Date() } })
  }
  store.delete(SESSION_COOKIE)
}

/** Resolve the current session user + active organization. Null when logged out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await db.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: {
      user: {
        select: { id: true, email: true, name: true, avatarColor: true, status: true },
      },
    },
  })
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
    return null
  }

  const orgId = session.activeOrganizationId
  let membership = orgId
    ? await db.membership.findFirst({
        where: { userId: session.userId, organizationId: orgId },
        include: { organization: true },
      })
    : null
  if (!membership) {
    membership = await db.membership.findFirst({
      where: { userId: session.userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    })
  }
  if (!membership) return null

  return {
    user: session.user,
    organization: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      mode: membership.organization.mode,
      type: membership.organization.type,
      country: membership.organization.country,
      role: membership.role,
    },
    sessionId: session.id,
  }
}

export async function switchOrganization(sessionId: string, organizationId: string, userId: string): Promise<boolean> {
  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  })
  if (!membership) return false
  await db.session.update({ where: { id: sessionId }, data: { activeOrganizationId: organizationId } })
  return true
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function registerUser(input: {
  name: string
  email: string
  password: string
  organizationName: string
}) {
  if (!EMAIL_RE.test(input.email)) {
    throw new Error('Enter a valid email address.')
  }
  const existing = await db.user.findUnique({ where: { email: input.email.toLowerCase() } })
  if (existing) throw new Error('An account with this email already exists')

  const slugBase = input.organizationName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24)
  let slug = slugBase || 'org'
  while (await db.organization.findUnique({ where: { slug } })) {
    slug = `${slugBase}-${randomBytes(3).toString('hex')}`
  }

  let user
  try {
    user = await db.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: hashPassword(input.password),
        avatarColor: pickAvatarColor(input.email),
      },
    })
  } catch (err) {
    // concurrent registration race on the unique email — friendly error
    if ((err as { code?: string }).code === 'P2002') {
      throw new Error('An account with this email already exists')
    }
    throw err
  }
  const organization = await db.organization.create({
    data: {
      name: input.organizationName,
      slug,
      type: 'BUSINESS',
      mode: 'TEST',
    },
  })
  await db.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
  })
  await recordAudit({
    organizationId: organization.id,
    actorType: 'USER',
    actorId: user.id,
    actorLabel: user.name,
    action: 'auth.registered',
    resourceType: 'User',
    resourceId: user.id,
    description: `${user.email} registered and created organization ${organization.name}`,
  })
  return { user, organization }
}

// ── Login hardening ─────────────────────────────────────────────────

/** 5 failed attempts per email per 15 minutes (in-memory fixed window). */
const loginThrottle = new FixedWindowRateLimiter(5, 15 * 60_000)

/** Computed once — unknown emails are verified against this hash so the
 * login path burns the same scrypt work as a real check (anti-enumeration). */
let dummyHash: string | null = null

export async function loginUser(email: string, password: string): Promise<{
  id: string
  email: string
  name: string
}> {
  const normalized = email.trim().toLowerCase()
  const throttleKey = `login:${normalized}`
  // failures-only throttle: peek at entry, record on failure, reset on
  // success — a correct password is never itself counted as a strike
  const throttle = loginThrottle.peek(throttleKey)
  if (!throttle.allowed) {
    const minutes = Math.max(1, Math.ceil(throttle.retryInMs / 60_000))
    throw new Error(`Too many failed sign-in attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`)
  }

  const user = await db.user.findUnique({ where: { email: normalized } })
  if (!user) {
    // timing-equalization: full scrypt verification against a dummy hash
    dummyHash ??= hashPassword('novera-dummy-verification-value')
    verifyPassword(password, dummyHash)
    loginThrottle.record(throttleKey)
    await recordAudit({
      actorType: 'SYSTEM',
      action: 'auth.login.failed',
      resourceType: 'User',
      description: `Failed login attempt for ${normalized}`,
      severity: 'WARN',
    })
    throw new Error('Invalid email or password')
  }
  if (!verifyPassword(password, user.passwordHash)) {
    loginThrottle.record(throttleKey)
    await recordAudit({
      actorType: 'SYSTEM',
      action: 'auth.login.failed',
      resourceType: 'User',
      resourceId: user.id,
      description: `Failed login attempt for ${normalized}`,
      severity: 'WARN',
    })
    throw new Error('Invalid email or password')
  }

  // successful login clears the email's throttle window
  loginThrottle.reset(throttleKey)
  await recordAudit({
    actorType: 'USER',
    actorId: user.id,
    actorLabel: user.name,
    action: 'auth.login',
    resourceType: 'User',
    resourceId: user.id,
    description: `${user.email} signed in`,
  })
  return user
}

/** Test seam: clear the in-memory login throttle window for one email. */
export function __resetLoginThrottleForTests(email: string): void {
  loginThrottle.reset(`login:${email.trim().toLowerCase()}`)
}
