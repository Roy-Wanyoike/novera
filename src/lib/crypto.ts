import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

/**
 * Pure crypto primitives (no Next.js request context) — shared by the
 * auth service, the API-key service and the seed importer.
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

const AVATAR_COLORS = ['#34d399', '#f59e0b', '#f472b6', '#a3e635', '#22d3ee', '#c084fc']
export function pickAvatarColor(seed: string): string {
  const h = createHash('md5').update(seed).digest()
  return AVATAR_COLORS[h[0] % AVATAR_COLORS.length]
}

export function md5b(seed: string): Buffer {
  return createHash('md5').update(seed).digest()
}
