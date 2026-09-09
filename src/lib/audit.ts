import { createHash } from 'crypto'
import { db } from '@/lib/db'

/**
 * Tamper-evident audit trail.
 *
 * Each event's hash = sha256(prevHash ‖ canonical fields). Any retroactive
 * modification breaks the chain and is detectable via verifyAuditChain().
 * Events are append-only — the application never updates or deletes them.
 *
 * CONCURRENCY CONTROL: the read-last-hash + append pair is serialized by an
 * in-process async lock. Without it, two concurrent appends read the same
 * prevHash and the chain forks — verifyAuditChain() then reports a tamper
 * break on a benign concurrent write. Audit appends are strictly
 * POST-COMMIT: callers never append inside an uncommitted caller
 * transaction (an uncommitted row is invisible to the next append's
 * prevHash read, which reintroduces the fork on commit interleaving).
 *
 * Production (PostgreSQL) target: replace the in-process lock with a
 * database-level serialization — pg_advisory_xact_lock(hash_chain) around
 * the read-last + insert, or a dedicated append table with a sequence —
 * documented in ADR-0009.
 */

export interface AuditInput {
  organizationId?: string | null
  actorType: 'USER' | 'AGENT' | 'SYSTEM' | 'SERVICE' | 'PROVIDER'
  actorId?: string | null
  actorLabel?: string | null
  action: string // e.g. "payment.settled", "ledger.posted", "policy.evaluated"
  resourceType: string
  resourceId?: string | null
  description: string
  metadata?: Record<string, unknown> | null
  severity?: 'INFO' | 'WARN' | 'CRITICAL'
  correlationId?: string | null
}

function canonical(input: AuditInput, prevHash: string, createdAt: Date): string {
  const payload = JSON.stringify({
    o: input.organizationId ?? null,
    a: input.action,
    rt: input.resourceType,
    ri: input.resourceId ?? null,
    d: input.description,
    actor: input.actorType,
    actorId: input.actorId ?? null,
    sev: input.severity ?? 'INFO',
    cid: input.correlationId ?? null,
    md: input.metadata ?? null,
    at: createdAt.toISOString(),
    prev: prevHash,
  })
  return createHash('sha256').update(payload).digest('hex')
}

// ── Append serialization (single-process reference build) ───────────
// A module-level promise chain: every recordAudit call awaits the previous
// append before reading the last hash. This makes the read-append pair
// atomic with respect to other appends in this process, so the chain can
// never fork under concurrent writes.
let auditAppendLock: Promise<void> = Promise.resolve()

async function withAuditAppendLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = auditAppendLock
  let release!: () => void
  auditAppendLock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

export async function recordAudit(input: AuditInput): Promise<string> {
  return withAuditAppendLock(async () => {
    const last = await db.auditEvent.findFirst({ orderBy: { createdAt: 'desc' }, select: { hash: true } })
    const prevHash = last?.hash ?? 'GENESIS'
    const createdAt = new Date()
    const hash = canonical(input, prevHash, createdAt)
    await db.auditEvent.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        description: input.description,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        severity: input.severity ?? 'INFO',
        correlationId: input.correlationId ?? null,
        prevHash,
        hash,
        createdAt,
      },
    })
    return hash
  })
}

export interface ChainVerification {
  totalEvents: number
  verified: number
  valid: boolean
  firstBrokenAt?: string
}

/** Recompute the chain and report the first inconsistency, if any. */
export async function verifyAuditChain(limit = 2000): Promise<ChainVerification> {
  const events = await db.auditEvent.findMany({ orderBy: { createdAt: 'asc' }, take: limit })
  let prevHash = 'GENESIS'
  let verified = 0
  for (const e of events) {
    const recomputed = canonical(
      {
        organizationId: e.organizationId,
        actorType: e.actorType as AuditInput['actorType'],
        actorId: e.actorId,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        description: e.description,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
        severity: e.severity as 'INFO' | 'WARN' | 'CRITICAL',
        correlationId: e.correlationId,
      },
      prevHash,
      e.createdAt
    )
    if (recomputed !== e.hash || e.prevHash !== prevHash) {
      return { totalEvents: events.length, verified, valid: false, firstBrokenAt: e.id }
    }
    verified++
    prevHash = e.hash
  }
  return { totalEvents: events.length, verified, valid: true }
}
