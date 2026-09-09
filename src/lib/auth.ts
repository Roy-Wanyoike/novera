import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import { hashPassword, verifyPassword, sha256Hex, pickAvatarColor } from '@/lib/crypto'

export { hashPassword, verifyPassword, sha256Hex, pickAvatarColor }

/**
 * AUTHENTICATION — server-side only.
 *
 * Directive: never trust the frontend. Every server action / route
 * handler resolves the session from the httpOnly cookie and enforces
 * organization scoping on every query. Passwords use scrypt with
 * per-user salts; sessions are opaque tokens with expiry + revocation.
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
      token,
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
    await db.session.updateMany({ where: { token }, data: { revokedAt: new Date() } })
  }
  store.delete(SESSION_COOKIE)
}

/** Resolve the current session user + active organization. Null when logged out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await db.session.findUnique({
    where: { token },
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

export async function registerUser(input: {
  name: string
  email: string
  password: string
  organizationName: string
}) {
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

  const user = await db.user.create({
    data: {
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: hashPassword(input.password),
      avatarColor: pickAvatarColor(input.email),
    },
  })
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

export async function loginUser(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await recordAudit({
      actorType: 'SYSTEM',
      action: 'auth.login.failed',
      resourceType: 'User',
      description: `Failed login attempt for ${email}`,
      severity: 'WARN',
    })
    throw new Error('Invalid email or password')
  }
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

const AVATAR_UNUSED = 0
void AVATAR_UNUSED
