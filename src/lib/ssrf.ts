import { lookup } from 'dns/promises'
import { isIP } from 'net'

/**
 * SSRF GUARD — outbound webhook URLs must point at public HTTPS endpoints.
 *
 * Webhook registration accepts a user-supplied URL. Without a guard, a
 * malicious registrant can point Novera's (future) delivery worker at
 * internal infrastructure: cloud metadata endpoints (169.254.169.254),
 * loopback services, RFC1918 hosts, or a public hostname that resolves
 * into a private range. Delivery is simulated in the reference build (no
 * HTTP egress yet) — the guard is enforced NOW so the contract is already
 * in place when real delivery lands.
 *
 * Fail-closed: unresolvable hostnames are rejected.
 */

export interface UrlGuardResult {
  ok: boolean
  reason?: string
}

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true
  const [a, b] = parts
  // loopback 127/8, RFC1918 (10/8, 172.16/12, 192.168/16),
  // link-local 169.254/16, CGNAT 100.64/10, this-network 0/8
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

function ipv6IsPrivate(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === '::1' || normalized === '::') return true
  // IPv4-mapped ::ffff:a.b.c.d
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return ipv4IsPrivate(mapped[1])
  // unique-local fc00::/7, link-local fe80::/10
  if (/^f[cd]/.test(normalized)) return true
  if (/^fe[89ab]/.test(normalized)) return true
  return false
}

function ipLiteralIsPrivate(host: string): boolean {
  const family = isIP(host)
  if (family === 4) return ipv4IsPrivate(host)
  if (family === 6) return ipv6IsPrivate(host)
  return false
}

/**
 * Validate a webhook endpoint URL. Checks, in order:
 *   1. parses as an absolute URL
 *   2. HTTPS only
 *   3. sane length and no userinfo
 *   4. hostname is not localhost / *.localhost / 0.0.0.0
 *   5. IP-literal hosts are not private/loopback/link-local/CGNAT
 *   6. DNS-resolvable hostnames do NOT resolve into any private range
 *      (checked for every A/AAAA record; unresolvable → rejected)
 */
export async function assertSafeWebhookUrl(raw: string): Promise<UrlGuardResult> {
  const url = raw.trim()
  if (url.length === 0 || url.length > 2048) {
    return { ok: false, reason: 'URL must be between 1 and 2048 characters.' }
  }
  if (url.includes('@')) {
    return { ok: false, reason: 'URL must not contain credentials (user:pass@host).' }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'URL must be a valid absolute URL.' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Webhook URLs must use HTTPS.' }
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, reason: 'Loopback hostnames are not allowed.' }
  }
  if (host === '0.0.0.0' || host === '[::]' || host === '::') {
    return { ok: false, reason: 'Unspecified addresses are not allowed.' }
  }

  if (isIP(host) !== 0) {
    if (ipLiteralIsPrivate(host)) {
      return { ok: false, reason: 'Private, loopback, link-local and CGNAT addresses are not allowed.' }
    }
    return { ok: true }
  }

  // Hostname: resolve and check every address (a public name that resolves
  // into a private range is the classic DNS-rebinding SSRF vector).
  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    return { ok: false, reason: 'Hostname could not be resolved (fail-closed).' }
  }
  if (addresses.length === 0) {
    return { ok: false, reason: 'Hostname resolved to no addresses (fail-closed).' }
  }
  for (const { address } of addresses) {
    if (ipLiteralIsPrivate(address)) {
      return { ok: false, reason: 'Hostname resolves into a private address range — not allowed.' }
    }
  }
  return { ok: true }
}
