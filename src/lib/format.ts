import { Money, formatMinor } from '@novera/money'
import type { StatusMeta } from '@novera/domain'

/**
 * Display helpers shared by every page. All money formatting flows
 * through @novera/money (exact BigInt → string). Dates render in the
 * organization timezone (Africa/Nairobi default) via Intl.
 */

export function fmtMoney(minor: bigint | number | string, currency: string): string {
  return formatMinor(minor, currency)
}

export function fmtMoneyPlain(minor: bigint | number | string, currency: string): string {
  return Money.fromMinor(minor, currency).formatPlain()
}

export function fmtSignedMoney(minor: bigint | number | string, currency: string): string {
  const m = Money.fromMinor(minor, currency)
  return (m.isPositive() ? '+' : '') + m.format()
}

export function fmtDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-KE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Nairobi',
  }).format(d)
}

export function fmtDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-KE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  }).format(d)
}

export function fmtTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  }).format(d)
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(d)
}

export function statusMeta(meta: Record<string, StatusMeta>, status: string): StatusMeta {
  return meta[status] ?? { label: status, tone: 'neutral' }
}

export function truncateMiddle(s: string, head = 8, tail = 6): string {
  if (s.length <= head + tail + 3) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

export function pct(numerator: bigint | number, denominator: bigint | number): number {
  const n = typeof numerator === 'bigint' ? Number(numerator) : numerator
  const d = typeof denominator === 'bigint' ? Number(denominator) : denominator
  if (d === 0) return 0
  return Math.round((n / d) * 1000) / 10
}

export function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
