import { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import { Money, assertCurrency } from '@novera/money'
import type { LedgerAccountType } from '@novera/domain'
import { ref } from '@/lib/ids'
import { recordAudit } from '@/lib/audit'

/**
 * FINANCIAL KERNEL — Double-entry ledger.
 *
 * Invariants enforced here (the ledger is sacred):
 *   1. Every transaction has ≥ 2 entries.
 *   2. SUM(debits) === SUM(credits), per currency, always.
 *   3. Posted transactions are immutable — corrections happen via reversal.
 *   4. Every money-changing operation accepts an idempotency key; replaying
 *      the same key returns the original posting without side effects.
 *   5. Balances are always derived from entries — never cached state.
 */

export type Direction = 'DEBIT' | 'CREDIT'

export interface LedgerEntryInput {
  accountId: string
  direction: Direction
  amountMinor: bigint
  currency: string
}

export interface PostTransactionInput {
  organizationId: string
  description: string
  source: string // LEDGER_TXN_SOURCES
  entries: LedgerEntryInput[]
  actorType?: 'USER' | 'AGENT' | 'SYSTEM' | 'SERVICE'
  actorId?: string | null
  actorLabel?: string | null
  idempotencyKey?: string | null
  metadata?: Record<string, unknown> | null
  effectiveAt?: Date
  correlationId?: string | null
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(`[ledger] ${message}`)
    this.name = 'LedgerError'
  }
}

export interface PostedTransaction {
  id: string
  reference: string
  amountMinor: bigint
  currency: string
  status: string
}

function validateEntries(entries: LedgerEntryInput[]): void {
  if (entries.length < 2) {
    throw new LedgerError('a transaction requires at least two entries')
  }
  const byCurrency = new Map<string, { debit: bigint; credit: bigint }>()
  for (const e of entries) {
    if (e.amountMinor <= 0n) throw new LedgerError('entry amounts must be positive')
    if (e.direction !== 'DEBIT' && e.direction !== 'CREDIT') {
      throw new LedgerError(`invalid direction: ${e.direction}`)
    }
    const currency = e.currency
    const bucket = byCurrency.get(currency) ?? { debit: 0n, credit: 0n }
    if (e.direction === 'DEBIT') bucket.debit += e.amountMinor
    else bucket.credit += e.amountMinor
    byCurrency.set(currency, bucket)
  }
  for (const [currency, { debit, credit }] of byCurrency) {
    if (debit !== credit) {
      throw new LedgerError(
        `unbalanced transaction in ${currency}: debits ${debit} ≠ credits ${credit}`
      )
    }
  }
}

/** Post a balanced transaction atomically. Idempotent by idempotencyKey.
 *
 * AUDIT CONTRACT — when a `tx` client is provided, this function does NOT
 * emit the `ledger.transaction.posted` audit event: the posting lives in
 * the CALLER'S uncommitted transaction, and audit appends must be strictly
 * post-commit (an append from inside an uncommitted transaction is
 * invisible to the next append's prevHash read — the chain forks on
 * commit interleaving; see src/lib/audit.ts). The caller MUST emit the
 * audit after commit via emitLedgerPostedAudit(). When no client is
 * provided, this function manages its own transaction and emits the audit
 * post-commit itself.
 */
export async function postTransaction(
  input: PostTransactionInput,
  tx?: Prisma.TransactionClient
): Promise<PostedTransaction> {
  validateEntries(input.entries)

  const run = async (prisma: Prisma.TransactionClient): Promise<PostedTransaction> => {
    if (input.idempotencyKey) {
      const existing = await prisma.ledgerTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, reference: true, amountMinor: true, currency: true, status: true },
      })
      if (existing) return existing
    }

    // Verify all accounts belong to the org
    const accountIds = [...new Set(input.entries.map((e) => e.accountId))]
    const accounts = await prisma.ledgerAccount.findMany({
      where: { id: { in: accountIds }, organizationId: input.organizationId },
      select: { id: true, code: true, currency: true },
    })
    if (accounts.length !== accountIds.length) {
      throw new LedgerError('one or more ledger accounts do not belong to this organization')
    }
    for (const e of input.entries) {
      const acct = accounts.find((a) => a.id === e.accountId)!
      if (acct.currency && acct.currency !== e.currency) {
        throw new LedgerError(`account ${acct.code} is single-currency ${acct.currency}, got ${e.currency}`)
      }
    }

    const amountMinor = input.entries
      .filter((e) => e.direction === 'DEBIT')
      .reduce((a, e) => a + e.amountMinor, 0n)

    const currency = input.entries[0].currency

    const created = await prisma.ledgerTransaction.create({
      data: {
        organizationId: input.organizationId,
        reference: ref.ledgerTxn(),
        description: input.description,
        source: input.source,
        status: 'POSTED',
        idempotencyKey: input.idempotencyKey ?? null,
        amountMinor,
        currency,
        actorType: input.actorType ?? 'SYSTEM',
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        effectiveAt: input.effectiveAt ?? new Date(),
        postedAt: new Date(),
        entries: {
          create: input.entries.map((e) => ({
            accountId: e.accountId,
            direction: e.direction,
            amountMinor: e.amountMinor,
            currency: e.currency,
          })),
        },
      },
      include: { entries: true },
    })

    return {
      id: created.id,
      reference: created.reference,
      amountMinor: created.amountMinor,
      currency: created.currency,
      status: created.status,
    }
  }

  if (tx) {
    // Caller owns the transaction (and therefore the commit boundary) —
    // the caller MUST call emitLedgerPostedAudit(input, result) after
    // commit. See the audit contract above.
    return run(tx)
  }

  const result = await db.$transaction(run)
  await emitLedgerPostedAudit(input, result)
  return result
}

/**
 * The `ledger.transaction.posted` audit event for a posting. Emitted by
 * postTransaction when it managed its own transaction, and by tx-scoped
 * callers after their transaction commits (the audit contract above).
 */
export async function emitLedgerPostedAudit(
  input: PostTransactionInput,
  result: PostedTransaction,
  correlationId?: string | null
): Promise<void> {
  await recordAudit({
    organizationId: input.organizationId,
    actorType: input.actorType ?? 'SYSTEM',
    actorId: input.actorId ?? null,
    actorLabel: input.actorLabel ?? null,
    action: 'ledger.transaction.posted',
    resourceType: 'LedgerTransaction',
    resourceId: result.id,
    description: `${input.description} (${result.reference})`,
    metadata: {
      source: input.source,
      amountMinor: result.amountMinor.toString(),
      currency: result.currency,
      entryCount: input.entries.length,
      ...(input.metadata ?? {}),
    },
    correlationId: correlationId ?? input.correlationId ?? null,
  })
}

/** Reverse a posted transaction with mirrored entries. Immutable history preserved. */
export async function reverseTransaction(
  organizationId: string,
  transactionId: string,
  reason: string,
  actor?: { type: 'USER' | 'AGENT' | 'SYSTEM' | 'SERVICE'; id?: string; label?: string }
): Promise<PostedTransaction> {
  return db.$transaction(async (prisma) => {
    const original = await prisma.ledgerTransaction.findFirst({
      where: { id: transactionId, organizationId },
      include: { entries: true, reversals: true },
    })
    if (!original) throw new LedgerError('transaction not found')
    if (original.status !== 'POSTED') {
      throw new LedgerError(`cannot reverse a transaction in status ${original.status}`)
    }
    if (original.reversals.length > 0) {
      throw new LedgerError('transaction already has a reversal')
    }

    const reversalRef = ref.ledgerTxn()
    const created = await prisma.ledgerTransaction.create({
      data: {
        organizationId,
        reference: reversalRef,
        description: `Reversal of ${original.reference}: ${reason}`,
        source: 'REVERSAL',
        status: 'POSTED',
        reversalOfId: original.id,
        amountMinor: original.amountMinor,
        currency: original.currency,
        actorType: actor?.type ?? 'SYSTEM',
        actorId: actor?.id ?? null,
        actorLabel: actor?.label ?? null,
        metadata: JSON.stringify({ reversalOf: original.reference, reason }),
        postedAt: new Date(),
        entries: {
          create: original.entries.map((e) => ({
            accountId: e.accountId,
            direction: e.direction === 'DEBIT' ? ('CREDIT' as Direction) : ('DEBIT' as Direction),
            amountMinor: e.amountMinor,
            currency: e.currency,
          })),
        },
      },
    })

    await prisma.ledgerTransaction.update({
      where: { id: original.id },
      data: { status: 'REVERSED', reversedAt: new Date() },
    })

    return {
      id: created.id,
      reference: reversalRef,
      amountMinor: created.amountMinor,
      currency: created.currency,
      status: created.status,
    }
  }).then(async (result) => {
    await recordAudit({
      organizationId,
      actorType: actor?.type ?? 'SYSTEM',
      actorId: actor?.id ?? null,
      actorLabel: actor?.label ?? null,
      action: 'ledger.transaction.reversed',
      resourceType: 'LedgerTransaction',
      resourceId: result.id,
      description: `Reversed ${transactionId}: ${reason}`,
      severity: 'WARN',
      metadata: { reversalRef: result.reference },
    })
    return result
  })
}

export interface AccountBalance {
  accountId: string
  code: string
  name: string
  type: string
  normalBalance: 'DEBIT' | 'CREDIT'
  currency: string | null
  debitTotal: bigint
  creditTotal: bigint
  /** Signed balance: positive when the account is in its normal balance side. */
  balanceMinor: bigint
}

/** Balance is always derived from entries (authoritative), never stored.
 * Accepts an optional transaction client so balance guards can run INSIDE
 * the posting transaction (serialized with the write — no TOCTOU window). */
export async function accountBalance(
  accountId: string,
  tx?: Prisma.TransactionClient
): Promise<AccountBalance> {
  const prisma = tx ?? db
  const account = await prisma.ledgerAccount.findUnique({
    where: { id: accountId },
    include: {
      _count: { select: { entries: true } },
    },
  })
  if (!account) throw new LedgerError('account not found')

  const grouped = await prisma.ledgerEntry.groupBy({
    by: ['direction'],
    where: { accountId, transaction: { status: { in: ['POSTED', 'REVERSED'] } } },
    _sum: { amountMinor: true },
  })

  const debitTotal = grouped.find((g) => g.direction === 'DEBIT')?._sum.amountMinor ?? 0n
  const creditTotal = grouped.find((g) => g.direction === 'CREDIT')?._sum.amountMinor ?? 0n

  const balanceMinor =
    account.normalBalance === 'DEBIT' ? debitTotal - creditTotal : creditTotal - debitTotal

  return {
    accountId: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    normalBalance: account.normalBalance as 'DEBIT' | 'CREDIT',
    currency: account.currency,
    debitTotal,
    creditTotal,
    balanceMinor,
  }
}

export async function walletLedgerBalance(
  walletId: string,
  tx?: Prisma.TransactionClient
): Promise<bigint> {
  const prisma = tx ?? db
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { ledgerAccountId: true },
  })
  if (!wallet) throw new LedgerError('wallet not found')
  const bal = await accountBalance(wallet.ledgerAccountId, tx)
  return bal.balanceMinor
}

/**
 * Trial balance: the global double-entry proof, evaluated per currency.
 * Every transaction balances per currency, so the sum of all posted
 * debits must equal the sum of all posted credits for each currency.
 */
export async function trialBalance(organizationId: string) {
  const accounts = await db.ledgerAccount.findMany({
    where: { organizationId },
    select: { id: true, code: true, name: true, type: true, normalBalance: true },
  })
  const results: AccountBalance[] = []
  for (const a of accounts) {
    const grouped = await db.ledgerEntry.groupBy({
      by: ['direction'],
      where: { accountId: a.id, transaction: { status: { in: ['POSTED', 'REVERSED'] } } },
      _sum: { amountMinor: true },
    })
    const debitTotal = grouped.find((g) => g.direction === 'DEBIT')?._sum.amountMinor ?? 0n
    const creditTotal = grouped.find((g) => g.direction === 'CREDIT')?._sum.amountMinor ?? 0n
    results.push({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      normalBalance: a.normalBalance as 'DEBIT' | 'CREDIT',
      currency: null,
      debitTotal,
      creditTotal,
      balanceMinor:
        a.normalBalance === 'DEBIT' ? debitTotal - creditTotal : creditTotal - debitTotal,
    })
  }
  const entryCurrencyTotals = await db.ledgerEntry.groupBy({
    by: ['currency'],
    where: { account: { organizationId }, transaction: { status: { in: ['POSTED', 'REVERSED'] } } },
    _sum: { amountMinor: true },
  })
  // per-currency proof via raw aggregation of directions
  const perCurrency: { currency: string; debits: bigint; credits: bigint; balanced: boolean }[] = []
  const currencies = [...new Set((await db.ledgerEntry.findMany({
    where: { account: { organizationId }, transaction: { status: { in: ['POSTED', 'REVERSED'] } } },
    select: { currency: true },
    distinct: ['currency'],
  })).map((e) => e.currency))]
  for (const currency of currencies) {
    const dirTotals = await db.ledgerEntry.groupBy({
      by: ['direction'],
      where: { account: { organizationId }, transaction: { status: { in: ['POSTED', 'REVERSED'] } }, currency },
      _sum: { amountMinor: true },
    })
    const debits = dirTotals.find((g) => g.direction === 'DEBIT')?._sum.amountMinor ?? 0n
    const credits = dirTotals.find((g) => g.direction === 'CREDIT')?._sum.amountMinor ?? 0n
    perCurrency.push({ currency, debits, credits, balanced: debits === credits })
  }
  const totalDebits = results.reduce((a, r) => a + r.debitTotal, 0n)
  const totalCredits = results.reduce((a, r) => a + r.creditTotal, 0n)
  return {
    accounts: results,
    totalDebits,
    totalCredits,
    perCurrency,
    balanced: perCurrency.every((c) => c.balanced) && totalDebits === totalCredits,
  }
}

// ── Chart of accounts ────────────────────────────────────────────────

export const SYSTEM_ACCOUNTS: {
  code: string
  name: string
  type: LedgerAccountType
  normalBalance: 'DEBIT' | 'CREDIT'
}[] = [
  { code: 'MPESA_CLEARING', name: 'M-Pesa clearing (asset)', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: 'BANK_CLEARING', name: 'Bank clearing (asset)', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: 'CARD_CLEARING', name: 'Card clearing (asset)', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: 'CRYPTO_CLEARING', name: 'Crypto clearing (asset)', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: 'INTERNAL_CLEARING', name: 'Internal wallet clearing', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: 'FX_CLEARING', name: 'FX clearing (multi-currency)', type: 'ASSET', normalBalance: 'DEBIT' },
  { code: 'FEE_INCOME', name: 'Fee income (platform)', type: 'INCOME', normalBalance: 'CREDIT' },
  { code: 'FEE_EXPENSE', name: 'Payment processing fees', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: 'PAYOUT_EXPENSE', name: 'Payouts & disbursements', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: 'CARD_EXPENSE', name: 'Card spend', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: 'SALES', name: 'Sales revenue', type: 'INCOME', normalBalance: 'CREDIT' },
  { code: 'FX_GAIN', name: 'FX gain/loss', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: 'CHARGEBACK_EXPENSE', name: 'Chargebacks & disputes', type: 'EXPENSE', normalBalance: 'DEBIT' },
  { code: 'OPENING_EQUITY', name: 'Opening equity', type: 'EQUITY', normalBalance: 'CREDIT' },
]

export async function ensureChartOfAccounts(
  organizationId: string,
  tx?: Prisma.TransactionClient
): Promise<Record<string, string>> {
  const prisma = tx ?? db
  const map: Record<string, string> = {}
  for (const acct of SYSTEM_ACCOUNTS) {
    const existing = await prisma.ledgerAccount.findFirst({
      where: { organizationId, code: acct.code },
      select: { id: true },
    })
    const row = existing
      ? { id: existing.id }
      : await prisma.ledgerAccount.create({
          data: {
            organizationId,
            code: acct.code,
            name: acct.name,
            type: acct.type,
            normalBalance: acct.normalBalance,
            isSystemAccount: true,
          },
          select: { id: true },
        })
    map[acct.code] = row.id
  }
  return map
}

export function clearingAccountForMethod(method: string): string {
  switch (method) {
    case 'MPESA': return 'MPESA_CLEARING'
    case 'BANK': return 'BANK_CLEARING'
    case 'CARD': return 'CARD_CLEARING'
    case 'USDC': return 'CRYPTO_CLEARING'
    case 'WALLET': return 'INTERNAL_CLEARING'
    default: return 'MPESA_CLEARING'
  }
}

export { Money, assertCurrency }
export type { PrismaClient }
