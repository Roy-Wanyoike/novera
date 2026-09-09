import { db } from '@/lib/db'
import { Money, assertCurrency } from '@novera/money'
import { postTransaction, walletLedgerBalance, emitLedgerPostedAudit } from '@/lib/ledger'
import { evaluateRisk } from '@/lib/risk'
import { recordAudit } from '@/lib/audit'
import { emitWebhookEvent } from '@/lib/webhooks'
import type { Prisma } from '@prisma/client'

/**
 * TRANSFERS — internal wallet-to-wallet money movement.
 *
 * Internal transfers never touch external rails. The available-balance
 * check runs INSIDE the posting transaction, reading through the
 * transaction client (serialized with the posting — no TOCTOU window).
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
  actor: { type: 'USER' | 'AGENT' | 'SYSTEM'; id?: string; label?: string }
}

/**
 * Ledger-derived balance minus ACTIVE holds, optionally read through a
 * transaction client so the caller's posting decision and the check are
 * serialized inside one transaction.
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

export async function executeTransfer(input: TransferInput) {
  assertCurrency(input.currency)
  if (input.amountMinor <= 0n) throw new TransferError('amount must be positive')
  if (input.fromWalletId === input.toWalletId) throw new TransferError('cannot transfer to the same wallet')

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
    idempotencyKey: null as string | null,
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
  const txn = await db.$transaction(
    async (prisma) => {
      const available = await availableBalanceMinor(from.id, prisma)
      if (available < input.amountMinor) {
        throw new TransferError(
          `insufficient available funds: ${available} < ${input.amountMinor} ${input.currency}`
        )
      }
      return postTransaction(postingInput, prisma)
    },
    { timeout: 30_000 }
  )

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

  return { txn, risk }
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
