/**
 * Shared helpers for the DB-backed invariant suites.
 * Everything here is deterministic: the PRNG is seeded, factories take
 * explicit values — no unseeded Math.random anywhere in the suite.
 */
import { db } from '@/lib/db'

/** Deterministic seeded PRNG (mulberry32) — reproducible randomized tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Random integer in [min, max] from a seeded PRNG. */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/**
 * Wipe every table between tests. Order is FK-safe: children before
 * parents, reversal transactions (self-FK children) before originals.
 */
export async function resetDb(): Promise<void> {
  await db.webhookDelivery.deleteMany({})
  await db.reconciliationCase.deleteMany({})
  await db.providerTransaction.deleteMany({})
  await db.riskEvaluation.deleteMany({})
  await db.splitRuleExecution.deleteMany({})
  await db.copilotMessage.deleteMany({})
  await db.apiRequestLog.deleteMany({})
  await db.apiKey.deleteMany({})
  await db.cardAuthorization.deleteMany({})
  await db.card.deleteMany({})
  await db.agentIntent.deleteMany({})
  await db.approvalRequest.deleteMany({})
  await db.agent.deleteMany({})
  await db.hold.deleteMany({})
  await db.payment.deleteMany({})
  await db.paymentLink.deleteMany({})
  await db.invoiceItem.deleteMany({})
  await db.invoice.deleteMany({})
  await db.customer.deleteMany({})
  await db.fxQuote.deleteMany({})
  await db.policy.deleteMany({})
  await db.riskRule.deleteMany({})
  await db.settlementAccount.deleteMany({})
  await db.ledgerEntry.deleteMany({})
  // reversal rows reference their original (self-FK) — delete them first
  await db.ledgerTransaction.deleteMany({ where: { reversalOfId: { not: null } } })
  await db.ledgerTransaction.deleteMany({})
  await db.webhookEndpoint.deleteMany({})
  await db.wallet.deleteMany({})
  await db.ledgerAccount.deleteMany({})
  await db.splitRule.deleteMany({})
  await db.auditEvent.deleteMany({})
  await db.organization.deleteMany({})
  await db.session.deleteMany({})
  await db.membership.deleteMany({})
  await db.user.deleteMany({})
  await db.railProvider.deleteMany({})
}

let orgSeq = 0

/** A fresh organization per test (unique slug via monotonic counter). */
export async function createTestOrg(name = 'Kernel Test Org'): Promise<{ id: string; slug: string }> {
  orgSeq += 1
  const slug = `kernel-test-${orgSeq}-${Date.now().toString(36)}`
  const org = await db.organization.create({
    data: { name: `${name} ${orgSeq}`, slug },
    select: { id: true, slug: true },
  })
  return org
}

/** Wallet backed by its own single-currency ASSET ledger account. */
export async function createWallet(
  organizationId: string,
  label: string,
  currency: string,
  type = 'OPERATING'
): Promise<{ walletId: string; accountId: string }> {
  const code = `WALLET:${currency}:${label}`
  const account = await db.ledgerAccount.create({
    data: {
      organizationId,
      code,
      name: `Wallet ${label}`,
      type: 'ASSET',
      normalBalance: 'DEBIT',
      currency,
    },
    select: { id: true },
  })
  const wallet = await db.wallet.create({
    data: {
      organizationId,
      label,
      type,
      currency,
      ledgerAccountId: account.id,
    },
    select: { id: true },
  })
  return { walletId: wallet.id, accountId: account.id }
}

/** Deterministic TEST rail provider (fees make the ledger legs observable). */
export async function seedTestProvider(
  code = 'MPESA_V1',
  opts: { feeBps?: number; fixedFeeMinor?: bigint } = {}
): Promise<void> {
  await db.railProvider.create({
    data: {
      code,
      name: `${code} deterministic test rail`,
      railType: code.startsWith('USDC') ? 'CRYPTO' : 'MOBILE_MONEY',
      mode: 'TEST',
      status: 'OPERATIONAL',
      successRateBps: 9890,
      latencyMsAvg: 300,
      feeBps: opts.feeBps ?? 150,
      fixedFeeMinor: opts.fixedFeeMinor ?? 100n,
      currency: 'KES',
    },
  })
}

/** Which SQLite file is the client actually attached to? (safety guard) */
export async function activeSqliteFiles(): Promise<string[]> {
  const rows = (await db.$queryRawUnsafe('PRAGMA database_list')) as { file?: string }[]
  return rows.map((r) => r.file ?? '').filter((f) => f.length > 0)
}
