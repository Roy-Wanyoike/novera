import { db } from '@/lib/db'
import { Money, assertCurrency } from '@novera/money'
import { postTransaction, walletLedgerBalance, emitLedgerPostedAudit, type PostedTransaction } from '@/lib/ledger'
import { evaluateRisk, type RiskResult } from '@/lib/risk'
import { recordAudit } from '@/lib/audit'
import { emitWebhookEvent } from '@/lib/webhooks'
import type { Prisma } from '@prisma/client'

/**
 * TRANSFERS — internal wallet-to-wallet money movement.
 *
 * Internal transfers never touch external rails. The available-balance
 * check runs INSIDE the posting transaction, reading through the
 * transaction client (serialized with the posting — no TOCTOU window).
 * Transfers carry an optional idempotency key: a replay of the same key
 * returns the original posting with zero new side effects (no second
 * risk evaluation, audit event or webhook) — the balance guard never
 * sees a replay because the money already moved on the original posting.
 * The audit event is emitted post-commit; the webhook fires after the
 * money has moved.
 */

export class TransferError extends Error {
  constructor(message: string) {
    super(`[transfers] ${message}`)
    this.name = 'TransferError'
  }
}

export interface TransferInput {
  organizationId: string
  fromWalletId: string
  toWalletId: string
  amountMinor: bigint
  currency: string
  note?: string
  /** Optional idempotency key — replaying a used key returns the original posting. */
  idempotencyKey?: string | null
  actor: { type: 'USER' | 'AGENT' | 'SYSTEM'; id?: string; label?: string }
}

/**
 * Ledger-derived balance minus ACTIVE holds, optionally read through a
 * transaction client so the caller's posting decision and the check are
 * serialized inside one transaction.
 *
 * The `expiresAt` filter here is AUTHORITATIVE for money semantics: a
 * past-due ACTIVE hold no longer reserves funds even before its status
 * row is reconciled. `expireHolds()` (below) transitions the status
 * column so status-only reads agree with this filter.
 */
export async function availableBalanceMinor(
  walletId: string,
  tx?: Prisma.TransactionClient
): Promise<bigint> {
  const prisma = tx ?? db
  const ledgerBalance = await walletLedgerBalance(walletId, tx)
  const holds = await prisma.hold.findMany({
    where: { walletId, status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { amountMinor: true },
  })
  const reserved = holds.reduce((a, h) => a + h.amountMinor, 0n)
  return ledgerBalance - reserved
}

/**
 * Transition past-due ACTIVE holds to EXPIRED (single updateMany, no
 * per-row loop), with one batched audit event when anything actually
 * transitioned.
 *
 * Hold EXPIRY is already honored authoritatively by the
 * `availableBalanceMinor` filter, so money semantics never depend on
 * this call — it reconciles the STATUS column that status-only reads
 * (admin dashboards, hold counts) render. Hold-listing surfaces call it
 * once before querying; it must NOT be called from every balance read
 * (that would write on every read).
 */
export async function expireHolds(organizationId?: string): Promise<number> {
  const where: Prisma.HoldWhereInput = {
    status: 'ACTIVE',
    expiresAt: { lt: new Date() },
  }
  if (organizationId) where.organizationId = organizationId
  const expired = await db.hold.updateMany({ where, data: { status: 'EXPIRED' } })
  if (expired.count > 0) {
    await recordAudit({
      organizationId: organizationId ?? null,
      actorType: 'SYSTEM',
      action: 'hold.batch.expired',
      resourceType: 'Hold',
      description: `Expired ${expired.count} past-due hold${expired.count === 1 ? '' : 's'}`,
      metadata: { count: expired.count },
    })
  }
  return expired.count
}

/** The ledger posting fields needed to return a replayed transfer. */
const REPLAY_SELECT = {
  id: true,
  reference: true,
  amountMinor: true,
  currency: true,
  status: true,
  organizationId: true,
} as const

/** Resolve an idempotency key to an existing posting, or null.
 * Keys are globally unique: a key owned by another organization is
 * refused (fail-closed) rather than replayed cross-tenant. */
async function findReplay(
  prisma: Prisma.TransactionClient,
  organizationId: string,
  idempotencyKey: string
): Promise<PostedTransaction | null> {
  const existing = await prisma.ledgerTransaction.findUnique({
    where: { idempotencyKey },
    select: REPLAY_SELECT,
  })
  if (!existing) return null
  if (existing.organizationId !== organizationId) {
    throw new TransferError('idempotency key already in use by another resource')
  }
  return existing
}

export async function executeTransfer(
  input: TransferInput
): Promise<{ txn: PostedTransaction; risk: RiskResult | null; replayed: boolean }> {
  assertCurrency(input.currency)
  if (input.amountMinor <= 0n) throw new TransferError('amount must be positive')
  if (input.fromWalletId === input.toWalletId) throw new TransferError('cannot transfer to the same wallet')

  // Idempotent replay — resolved BEFORE the wallet checks, risk gate and
  // the in-transaction balance guard. The original posting already moved
  // the money (its guard would spuriously fail on the reduced balance),
  // so a known key returns the original posting with ZERO new side
  // effects: no risk-evaluation row, no audit event, no webhook.
  if (input.idempotencyKey) {
    const replay = await findReplay(db, input.organizationId, input.idempotencyKey)
    if (replay) return { txn: replay, risk: null, replayed: true }
  }

  const [from, to] = await Promise.all([
    db.wallet.findFirst({ where: { id: input.fromWalletId, organizationId: input.organizationId } }),
    db.wallet.findFirst({ where: { id: input.toWalletId, organizationId: input.organizationId } }),
  ])
  if (!from || !to) throw new TransferError('wallet not found in this organization')
  if (from.status !== 'ACTIVE' || to.status !== 'ACTIVE') throw new TransferError('wallet is not active')
  if (from.currency !== input.currency || to.currency !== input.currency) {
    throw new TransferError(
      `currency mismatch: from wallet is ${from.currency}, to wallet is ${to.currency}, requested ${input.currency}`
    )
  }

  // risk gate for transfers
  const risk = await evaluateRisk({
    organizationId: input.organizationId,
    subject: 'TRANSFER',
    amountMinor: input.amountMinor,
    currency: input.currency,
  })
  if (risk.decision === 'DECLINE') {
    throw new TransferError(`risk declined: ${risk.reasons[0]}`)
  }

  const postingInput = {
    organizationId: input.organizationId,
    description: input.note || `Transfer ${from.label} → ${to.label}`,
    source: 'TRANSFER' as const,
    idempotencyKey: input.idempotencyKey ?? null,
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    actorLabel: input.actor.label ?? null,
    entries: [
      // destination wallet asset UP (DEBIT), source wallet asset DOWN (CREDIT)
      { accountId: to.ledgerAccountId, direction: 'DEBIT' as const, amountMinor: input.amountMinor, currency: input.currency },
      { accountId: from.ledgerAccountId, direction: 'CREDIT' as const, amountMinor: input.amountMinor, currency: input.currency },
    ],
    metadata: { fromWallet: from.label, toWallet: to.label },
  }

  // Balance check + posting in ONE transaction: the available-balance read
  // goes through the transaction client, so it is serialized with the
  // posting itself — the classic double-spend race is closed.
  const { txn, replayed } = await db.$transaction(
    async (prisma) => {
      // Same-key race serialization: a concurrent submission with this
      // key may have committed between the pre-check above and this
      // transaction. Resolve the key INSIDE the transaction, BEFORE the
      // balance guard — a replay must never be rejected (or double-
      // audited) by the guard that follows.
      if (input.idempotencyKey) {
        const raced = await findReplay(prisma, input.organizationId, input.idempotencyKey)
        if (raced) return { txn: raced, replayed: true }
      }
      const available = await availableBalanceMinor(from.id, prisma)
      if (available < input.amountMinor) {
        throw new TransferError(
          `insufficient available funds: ${available} < ${input.amountMinor} ${input.currency}`
        )
      }
      const posted = await postTransaction(postingInput, prisma)
      return { txn: posted, replayed: false }
    },
    { timeout: 30_000 }
  )

  if (replayed) {
    // The original posting already emitted its audit event and webhook —
    // a replay returns the original result with zero new side effects.
    return { txn, risk, replayed: true }
  }

  // Audit fires post-commit (chain-integrity contract; see audit.ts).
  await emitLedgerPostedAudit(postingInput, txn)

  await emitWebhookEvent({
    organizationId: input.organizationId,
    event: 'transfer.executed',
    data: {
      transactionRef: txn.reference,
      fromWalletId: from.id,
      toWalletId: to.id,
      amountMinor: input.amountMinor.toString(),
      currency: input.currency,
    },
  })

  return { txn, risk, replayed: false }
}

export async function walletSummary(organizationId: string) {
  const wallets = await db.wallet.findMany({
    where: { organizationId },
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
  })
  const out: {
    id: string
    label: string
    type: string
    currency: string
    status: string
    description: string | null
    ledgerAccountId: string
    ledgerBalanceMinor: bigint
    availableMinor: bigint
    reservedMinor: bigint
    formatted: string
    createdAt: Date
    updatedAt: Date
  }[] = []
  for (const w of wallets) {
    const ledger = await walletLedgerBalance(w.id)
    const available = await availableBalanceMinor(w.id)
    out.push({
      ...w,
      ledgerBalanceMinor: ledger,
      availableMinor: available,
      reservedMinor: ledger - available,
      formatted: Money.fromMinor(ledger, w.currency).format(),
    })
  }
  return out
}
