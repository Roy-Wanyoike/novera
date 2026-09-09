import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

/**
 * Pure crypto primitives (no Next.js request context) — shared by the
 * auth service, the API-key service and the seed importer.
 *
 * PASSWORD SCHEME — "scrypt:v1" (documented, versioned, migratable):
 *   scryptSync(password, 16-byte random salt, 64-byte key) with Node's
 *   default cost parameters (N=16384, r=8, p=1).
 *
 * The stored prefix carries the scheme name so parameters can be raised
 * later without breaking existing hashes: `verifyPassword` parses the
 * prefix, and a future `scrypt2:` prefix (OWASP recommends N=2^17 for
 * high-value interactive logins) verifies with new parameters while old
 * hashes keep verifying under `scrypt:` and rehash on next login.
 * Reference build: N=16384 keeps login latency well under 100ms on the
 * sandbox; production hardening item — raise N and rehash on login.
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
