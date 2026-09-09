/**
 * FINANCIAL KERNEL — double-entry ledger invariant tests (database-backed).
 *
 * Runs against the dedicated SQLite test database (db/test.db) created by
 * tests/global-setup.ts; tables are wiped between tests. The five sacred
 * invariants from src/lib/ledger.ts under test:
 *   1. every transaction has ≥ 2 entries
 *   2. SUM(debits) === SUM(credits), per currency, always
 *   3. posted transactions are immutable — corrections via reversal
 *   4. idempotency keys replay without side effects
 *   5. balances are derived from entries — never cached state
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import * as ledgerModule from '@/lib/ledger'
import { recordAudit, verifyAuditChain } from '@/lib/audit'
import {
  LedgerError,
  accountBalance,
  ensureChartOfAccounts,
  postTransaction,
  reverseTransaction,
  trialBalance,
  walletLedgerBalance,
  type LedgerEntryInput,
} from '@/lib/ledger'
import { Money } from '@novera/money'
import {
  activeSqliteFiles,
  createTestOrg,
  createWallet,
  mulberry32,
  randInt,
  resetDb,
} from './db-utils'

let org: { id: string; slug: string }
let coa: Record<string, string>
let wallet: { walletId: string; accountId: string }

beforeEach(async () => {
  await resetDb()
  org = await createTestOrg('Ledger Invariants')
  coa = await ensureChartOfAccounts(org.id)
  wallet = await createWallet(org.id, 'Operating', 'KES')
})

const debit = (accountId: string, amountMinor: bigint, currency = 'KES'): LedgerEntryInput => ({
  accountId,
  direction: 'DEBIT',
  amountMinor,
  currency,
})
const credit = (accountId: string, amountMinor: bigint, currency = 'KES'): LedgerEntryInput => ({
  accountId,
  direction: 'CREDIT',
  amountMinor,
  currency,
})

describe('ledger · test-harness isolation', () => {
  it('runs against the dedicated test database, never the dev database', async () => {
    const files = await activeSqliteFiles()
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) expect(f.endsWith('db/test.db')).toBe(true)
  })
})

describe('ledger · structural validation (fail-closed)', () => {
  it('rejects unbalanced entries (debits ≠ credits) with LedgerError', async () => {
    await expect(
      postTransaction({
        organizationId: org.id,
        description: 'unbalanced',
        source: 'ADJUSTMENT',
        entries: [debit(wallet.accountId, 100n), credit(coa['SALES'], 99n)],
      })
    ).rejects.toThrow(LedgerError)
  })

  it('rejects per-currency imbalance in multi-currency postings', async () => {
    await expect(
      postTransaction({
        organizationId: org.id,
        description: 'unbalanced USD leg',
        source: 'FX_CONVERSION',
        entries: [
          debit(wallet.accountId, 100n, 'KES'),
          credit(coa['SALES'], 100n, 'KES'),
          debit(coa['FX_CLEARING'], 50n, 'USD'),
          credit(coa['FX_CLEARING'], 40n, 'USD'),
        ],
      })
    ).rejects.toThrow(/unbalanced transaction in USD/)
  })

  it('rejects postings with fewer than two entries', async () => {
    await expect(
      postTransaction({
        organizationId: org.id,
        description: 'single entry',
        source: 'ADJUSTMENT',
        entries: [debit(wallet.accountId, 100n)],
      })
    ).rejects.toThrow(/at least two entries/)
  })

  it('rejects non-positive entry amounts', async () => {
    await expect(
      postTransaction({
        organizationId: org.id,
        description: 'zero amounts',
        source: 'ADJUSTMENT',
        entries: [debit(wallet.accountId, 0n), credit(coa['SALES'], 0n)],
      })
    ).rejects.toThrow(/positive/)

    await expect(
      postTransaction({
        organizationId: org.id,
        description: 'negative amounts',
        source: 'ADJUSTMENT',
        entries: [debit(wallet.accountId, -100n), credit(coa['SALES'], -100n)],
      })
    ).rejects.toThrow(/positive/)
  })

  it('rejects invalid directions', async () => {
    // deliberately bogus direction (typed as string, then narrowed for the API)
    const bogusDirection = 'DEBITX'
    await expect(
      postTransaction({
        organizationId: org.id,
        description: 'bad direction',
        source: 'ADJUSTMENT',
        entries: [
          {
            accountId: wallet.accountId,
            direction: bogusDirection as LedgerEntryInput['direction'],
            amountMinor: 100n,
            currency: 'KES',
          },
          credit(coa['SALES'], 100n),
        ],
      })
    ).rejects.toThrow(/invalid direction/)
  })

  it('rejects accounts that belong to another organization', async () => {
    const orgB = await createTestOrg('Foreign Org')
    const coaB = await ensureChartOfAccounts(orgB.id)
    await expect(
      postTransaction({
        organizationId: org.id, // org A posting touches org B's account
        description: 'foreign account',
        source: 'ADJUSTMENT',
        entries: [debit(wallet.accountId, 100n), credit(coaB['SALES'], 100n)],
      })
    ).rejects.toThrow(/do not belong to this organization/)
  })

  it('rejects entries in a currency the single-currency account does not hold', async () => {
    await expect(
      postTransaction({
        organizationId: org.id,
        description: 'currency mismatch on wallet',
        source: 'ADJUSTMENT',
        entries: [debit(wallet.accountId, 100n, 'USD'), credit(coa['SALES'], 100n, 'USD')],
      })
    ).rejects.toThrow(/single-currency/)
  })

  it('persists NOTHING when validation fails (atomic fail-closed writes)', async () => {
    const before = await db.ledgerTransaction.count({ where: { organizationId: org.id } })
    const entriesBefore = await db.ledgerEntry.count()
    const auditsBefore = await db.auditEvent.count()

    for (const bad of [
      [debit(wallet.accountId, 100n)], // < 2 entries
      [debit(wallet.accountId, 100n), credit(coa['SALES'], 99n)], // unbalanced
      [debit(wallet.accountId, 0n), credit(coa['SALES'], 0n)], // non-positive
    ]) {
      await expect(
        postTransaction({
          organizationId: org.id,
          description: 'must not persist',
          source: 'ADJUSTMENT',
          entries: bad,
        })
      ).rejects.toThrow(LedgerError)
    }

    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id } })).toBe(before)
    expect(await db.ledgerEntry.count()).toBe(entriesBefore)
    expect(await db.auditEvent.count()).toBe(auditsBefore)
  })
})

describe('ledger · posting invariants', () => {
  it('posts a balanced transaction: debits === credits per currency, balances derive from entries', async () => {
    const posted = await postTransaction({
      organizationId: org.id,
      description: 'collection 100',
      source: 'PAYMENT',
      idempotencyKey: 'inv-post-1',
      entries: [debit(wallet.accountId, 100n), credit(coa['SALES'], 100n)],
    })

    expect(posted.status).toBe('POSTED')
    expect(posted.amountMinor).toBe(100n)
    expect(posted.currency).toBe('KES')
    expect(posted.reference).toMatch(/^ltx_/)

    // entries persisted and balanced
    const entries = await db.ledgerEntry.findMany({ where: { transactionId: posted.id } })
    expect(entries.length).toBe(2)
    const debitSum = entries.filter((e) => e.direction === 'DEBIT').reduce((a, e) => a + e.amountMinor, 0n)
    const creditSum = entries.filter((e) => e.direction === 'CREDIT').reduce((a, e) => a + e.amountMinor, 0n)
    expect(debitSum).toBe(100n)
    expect(creditSum).toBe(100n)
    expect(debitSum).toBe(creditSum) // Σ(dr) === Σ(cr)

    // balances derive from entries (never stored)
    const walletBal = await accountBalance(wallet.accountId)
    expect(walletBal.debitTotal).toBe(100n)
    expect(walletBal.creditTotal).toBe(0n)
    expect(walletBal.balanceMinor).toBe(100n) // ASSET, normal DEBIT

    const salesBal = await accountBalance(coa['SALES'])
    expect(salesBal.creditTotal).toBe(100n)
    expect(salesBal.balanceMinor).toBe(100n) // INCOME, normal CREDIT

    expect(await walletLedgerBalance(wallet.walletId)).toBe(100n)
  })

  it('multi-leg postings stay balanced and every account derives its own slice', async () => {
    // gross 100 → wallet net 60 (Dr), fee expense 40 (Dr), sales 100 (Cr)
    await postTransaction({
      organizationId: org.id,
      description: 'collection with fee',
      source: 'PAYMENT',
      idempotencyKey: 'inv-post-multi',
      entries: [
        debit(wallet.accountId, 60n),
        debit(coa['FEE_EXPENSE'], 40n),
        credit(coa['SALES'], 100n),
      ],
    })

    expect(await accountBalance(wallet.accountId).then((b) => b.balanceMinor)).toBe(60n)
    expect(await accountBalance(coa['FEE_EXPENSE']).then((b) => b.balanceMinor)).toBe(40n)
    expect(await accountBalance(coa['SALES']).then((b) => b.balanceMinor)).toBe(100n)
  })

  it('account balance accumulates across postings (pure derivation, no cache)', async () => {
    for (const amount of [100n, 150n, 250n]) {
      await postTransaction({
        organizationId: org.id,
        description: `accumulate ${amount}`,
        source: 'ADJUSTMENT',
        entries: [debit(wallet.accountId, amount), credit(coa['SALES'], amount)],
      })
    }
    expect(await walletLedgerBalance(wallet.walletId)).toBe(500n)
  })

  it('single-currency accounts can hold multiple currencies via multi-currency system accounts', async () => {
    // FX_CLEARING is deliberately multi-currency (currency = null)
    await postTransaction({
      organizationId: org.id,
      description: 'usd leg',
      source: 'FX_CONVERSION',
      entries: [debit(coa['FX_CLEARING'], 500n, 'USD'), credit(coa['SALES'], 500n, 'USD')],
    })
    const fx = await accountBalance(coa['FX_CLEARING'])
    expect(fx.balanceMinor).toBe(500n)
    const tb = await trialBalance(org.id)
    const usd = tb.perCurrency.find((c) => c.currency === 'USD')
    expect(usd).toBeDefined()
    expect(usd?.balanced).toBe(true)
  })
})

describe('ledger · idempotency (replays have no side effects)', () => {
  it('same idempotencyKey twice → same transaction reference, entry count unchanged', async () => {
    const first = await postTransaction({
      organizationId: org.id,
      description: 'idempotent post',
      source: 'PAYMENT',
      idempotencyKey: 'inv-idem-1',
      entries: [debit(wallet.accountId, 100n), credit(coa['SALES'], 100n)],
    })

    // replay with a DIFFERENT (even larger) payload — the original wins
    const replay = await postTransaction({
      organizationId: org.id,
      description: 'idempotent replay attempt',
      source: 'PAYMENT',
      idempotencyKey: 'inv-idem-1',
      entries: [debit(wallet.accountId, 999n), credit(coa['SALES'], 999n)],
    })

    expect(replay.id).toBe(first.id)
    expect(replay.reference).toBe(first.reference)
    expect(replay.amountMinor).toBe(first.amountMinor) // 100n, not 999n

    // exactly ONE transaction carries the key
    expect(await db.ledgerTransaction.count({ where: { idempotencyKey: 'inv-idem-1' } })).toBe(1)
    // entry count unchanged by the replay
    expect(await db.ledgerEntry.count({ where: { transactionId: first.id } })).toBe(2)
    // org-wide posting count unchanged
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id } })).toBe(1)
    // and the wallet only moved once
    expect(await walletLedgerBalance(wallet.walletId)).toBe(100n)
  })
})

describe('ledger · reversal (immutable history, compensating entries)', () => {
  it('reversal mirrors the original and restores entry-derived balances to the pre-post state', async () => {
    const preWallet = await walletLedgerBalance(wallet.walletId) // 0n

    const posted = await postTransaction({
      organizationId: org.id,
      description: 'to be reversed',
      source: 'ADJUSTMENT',
      idempotencyKey: 'inv-rev-1',
      entries: [
        debit(wallet.accountId, 500n),
        debit(coa['FEE_EXPENSE'], 100n),
        credit(coa['SALES'], 600n),
      ],
    })

    const reversal = await reverseTransaction(org.id, posted.id, 'kernel invariant test')

    // original is flagged REVERSED (history preserved, never deleted)
    const original = await db.ledgerTransaction.findUniqueOrThrow({
      where: { id: posted.id },
      include: { entries: true, reversals: true },
    })
    expect(original.status).toBe('REVERSED')
    expect(original.reversedAt).not.toBeNull()
    expect(original.reversals.map((r) => r.id)).toEqual([reversal.id])

    // the reversal is itself a posted transaction
    const reversalRow = await db.ledgerTransaction.findUniqueOrThrow({
      where: { id: reversal.id },
      include: { entries: true },
    })
    expect(reversalRow.status).toBe('POSTED')
    expect(reversalRow.reversalOfId).toBe(posted.id)
    expect(reversalRow.reference).toMatch(/^ltx_/)
    expect(reversalRow.amountMinor).toBe(original.amountMinor)

    // mirror exactness: every original entry has an opposite-direction twin
    // on the same account for the same amount and currency
    const originalEntries = original.entries
    const mirrorEntries = reversalRow.entries
    expect(mirrorEntries.length).toBe(originalEntries.length)
    for (const orig of originalEntries) {
      const twin = mirrorEntries.find(
        (m) => m.accountId === orig.accountId && m.amountMinor === orig.amountMinor && m.currency === orig.currency
      )
      expect(twin, `mirror entry for account ${orig.accountId}`).toBeDefined()
      expect(twin?.direction).toBe(orig.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT')
    }

    // the ledger's ENTRY data nets to the pre-post state per account:
    // Σ(DR) − Σ(CR) over ALL entries (original + mirror, any txn status)
    const nets = await db.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { accountId: { in: [wallet.accountId, coa['FEE_EXPENSE'], coa['SALES']] } },
      _sum: { amountMinor: true },
    })
    for (const accountId of [wallet.accountId, coa['FEE_EXPENSE'], coa['SALES']]) {
      const rows = await db.ledgerEntry.findMany({ where: { accountId } })
      const net = rows.reduce(
        (a, e) => a + (e.direction === 'DEBIT' ? e.amountMinor : -e.amountMinor),
        0n
      )
      expect(net, `raw entry net for ${accountId} restores pre-post state`).toBe(0n)
    }
    expect(nets.length).toBe(3) // all three accounts were touched

    // trial balance survives the reversal
    const tb = await trialBalance(org.id)
    expect(tb.balanced).toBe(true)
    expect(tb.perCurrency.every((c) => c.balanced)).toBe(true)

    // second reversal attempt is rejected (one reversal per transaction)
    await expect(reverseTransaction(org.id, posted.id, 'double reversal')).rejects.toThrow(LedgerError)
  })

  /**
   * KNOWN KERNEL DEFECT (flagged for the integrator — src/lib/ledger.ts is
   * read-only for this task): accountBalance()/walletLedgerBalance() filter
   * entries by `transaction.status === 'POSTED'`. After a reversal the
   * original's entries drop out of the sums while the mirror's stay, so the
   * DERIVED balance flips to −amount instead of returning to the pre-post
   * value — a wallet can even display a negative balance. The raw entry
   * invariant above proves the ledger DATA is correct; this marker stays
   * `it.fails` until the kernel includes REVERSED transactions in balance
   * derivation. It will turn red the moment the fix lands — then flip it to
   * a plain it().
   */
  it('derived wallet balance returns to pre-post value after reversal', async () => {
    const posted = await postTransaction({
      organizationId: org.id,
      description: 'reversal derived-balance probe',
      source: 'ADJUSTMENT',
      idempotencyKey: 'inv-rev-defect',
      entries: [debit(wallet.accountId, 500n), credit(coa['SALES'], 500n)],
    })
    expect(await walletLedgerBalance(wallet.walletId)).toBe(500n)
    await reverseTransaction(org.id, posted.id, 'probe')
    expect(await walletLedgerBalance(wallet.walletId)).toBe(0n)
    expect(await accountBalance(coa['SALES']).then((b) => b.balanceMinor)).toBe(0n)
  })

  it('reversing an unknown transaction is rejected', async () => {
    await expect(reverseTransaction(org.id, 'nonexistent-txn-id', 'nope')).rejects.toThrow(
      LedgerError
    )
  })
})

describe('ledger · trial balance after 20 randomized (seeded) postings', () => {
  it('Σ(debits) === Σ(credits) per currency across randomized multi-leg postings', async () => {
    const usdWallet = await createWallet(org.id, 'USD Operating', 'USD')
    const rng = mulberry32(777)

    const kesPool = [wallet.accountId, coa['FX_CLEARING'], coa['SALES'], coa['FEE_EXPENSE'], coa['MPESA_CLEARING']]
    const usdPool = [usdWallet.accountId, coa['FX_CLEARING'], coa['SALES'], coa['FEE_EXPENSE'], coa['MPESA_CLEARING']]
    const shuffle = <T,>(arr: T[]): T[] => {
      const a = [...arr]
      for (let i = a.length - 1; i > 0; i--) {
        const j = randInt(rng, 0, i)
        ;[a[i], a[j]] = [a[j], a[i]]
      }
      return a
    }

    for (let i = 0; i < 20; i++) {
      const currency = rng() < 0.6 ? 'KES' : 'USD'
      const pool = currency === 'KES' ? kesPool : usdPool
      const amount = BigInt(randInt(rng, 1, 999_999_999))
      const money = Money.fromMinor(amount, currency)

      const accounts = shuffle(pool)
      const debitLegs = rng() < 0.35 ? 2 : 1
      const creditLegs = rng() < 0.35 ? 2 : 1

      // split the amount with the kernel's own lossless allocator
      const debitAmounts =
        debitLegs === 1
          ? [amount]
          : money.allocateBps([randInt(rng, 1000, 9000), randInt(rng, 1000, 9000)]).map((p) => p.minor)
      const creditAmounts =
        creditLegs === 1
          ? [amount]
          : money.allocateBps([randInt(rng, 1000, 9000), randInt(rng, 1000, 9000)]).map((p) => p.minor)

      const entries: LedgerEntryInput[] = [
        ...debitAmounts.map((amt, k) => ({
          accountId: accounts[k],
          direction: 'DEBIT' as const,
          amountMinor: amt,
          currency,
        })),
        ...creditAmounts.map((amt, k) => ({
          accountId: accounts[debitLegs + k],
          direction: 'CREDIT' as const,
          amountMinor: amt,
          currency,
        })),
      ]

      const posted = await postTransaction({
        organizationId: org.id,
        description: `randomized posting ${i}`,
        source: 'ADJUSTMENT',
        idempotencyKey: `tb-seed-${i}`,
        entries,
      })
      expect(posted.status).toBe('POSTED')
      expect(posted.amountMinor).toBe(amount)
    }

    const tb = await trialBalance(org.id)
    expect(tb.balanced).toBe(true)
    expect(tb.totalDebits).toBe(tb.totalCredits)
    expect(tb.totalDebits).toBeGreaterThan(0n)
    // both randomized currencies are represented and each balances exactly
    expect(tb.perCurrency.length).toBe(2)
    for (const c of tb.perCurrency) {
      expect(c.balanced, `${c.currency} balances`).toBe(true)
      expect(c.debits).toBe(c.credits)
      expect(c.debits).toBeGreaterThan(0n)
    }

    // per-currency totals equal the posted amounts per currency
    const byCurrency = new Map<string, bigint>()
    const txns = await db.ledgerTransaction.findMany({ where: { organizationId: org.id } })
    for (const t of txns) byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0n) + t.amountMinor)
    for (const c of tb.perCurrency) {
      expect(c.debits).toBe(byCurrency.get(c.currency))
    }
    expect(txns.length).toBe(20)
  })
})

describe('ledger · audit chain integrity (concurrent appends never fork)', () => {
  it('12 concurrent recordAudit calls → one unbroken chain, no fork', async () => {
    const N = 12
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        recordAudit({
          organizationId: org.id,
          actorType: 'SYSTEM',
          action: 'test.concurrent.append',
          resourceType: 'TestEvent',
          resourceId: `evt-${i}`,
          description: `concurrent append probe ${i}`,
        })
      )
    )

    const chain = await verifyAuditChain()
    expect(chain.totalEvents).toBe(N)
    expect(chain.verified).toBe(N)
    expect(chain.valid).toBe(true)
  })

  it('every audit row carries the hash of its predecessor — the chain is a linked list', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAudit({
        organizationId: org.id,
        actorType: 'SYSTEM',
        action: 'test.sequential.append',
        resourceType: 'TestEvent',
        resourceId: `seq-${i}`,
        description: `sequential append probe ${i}`,
      })
    }
    const events = await db.auditEvent.findMany({ orderBy: { createdAt: 'asc' } })
    expect(events.length).toBe(5)
    expect(events[0].prevHash).toBe('GENESIS')
    for (let i = 1; i < events.length; i++) {
      expect(events[i].prevHash).toBe(events[i - 1].hash)
    }
  })

  it('kernel postings append their ledger.transaction.posted events post-commit and the chain stays valid', async () => {
    for (let i = 0; i < 3; i++) {
      await postTransaction({
        organizationId: org.id,
        description: `audit-chain probe ${i}`,
        source: 'ADJUSTMENT',
        idempotencyKey: `audit-chain-${i}`,
        entries: [debit(wallet.accountId, 100n), credit(coa['SALES'], 100n)],
      })
    }
    const posted = await db.auditEvent.count({ where: { action: 'ledger.transaction.posted' } })
    expect(posted).toBe(3)
    const chain = await verifyAuditChain()
    expect(chain.valid).toBe(true)
    expect(chain.totalEvents).toBe(3)
  })
})

describe('ledger · posted records are immutable (correction = reversal only)', () => {
  it('the ledger module exposes NO update/patch/delete path — writes are post + reverse only', () => {
    const exports = Object.keys(ledgerModule)
    const mutatorNames = exports.filter((name) =>
      /update|patch|delete|remove|amend|edit|void|mutate|drain|overwrite/i.test(name)
    )
    expect(mutatorNames, `mutator-like exports: ${mutatorNames.join(', ')}`).toEqual([])

    // the only two write paths are posting and reversal
    expect(exports).toContain('postTransaction')
    expect(exports).toContain('reverseTransaction')
    expect(typeof ledgerModule.postTransaction).toBe('function')
    expect(typeof ledgerModule.reverseTransaction).toBe('function')
    // read paths stay read-only
    expect(exports).toContain('accountBalance')
    expect(exports).toContain('walletLedgerBalance')
    expect(exports).toContain('trialBalance')
  })

  it('correction of a posted transaction requires a reversal — the original row is never rewritten', async () => {
    const posted = await postTransaction({
      organizationId: org.id,
      description: 'immutable original',
      source: 'ADJUSTMENT',
      idempotencyKey: 'inv-immutable-1',
      entries: [debit(wallet.accountId, 200n), credit(coa['SALES'], 200n)],
    })

    const reversal = await reverseTransaction(org.id, posted.id, 'correction')

    // the original row persists untouched (same reference, entries, amounts)
    const original = await db.ledgerTransaction.findUniqueOrThrow({
      where: { id: posted.id },
      include: { entries: true },
    })
    expect(original.reference).toBe(posted.reference)
    expect(original.entries.map((e) => e.amountMinor).sort()).toEqual([200n, 200n])
    expect(original.status).toBe('REVERSED') // status flag only — the entries stand
    // correction happened via a NEW transaction, not a mutation
    expect(reversal.id).not.toBe(original.id)
    expect(await db.ledgerTransaction.count({ where: { organizationId: org.id } })).toBe(2)
  })
})
