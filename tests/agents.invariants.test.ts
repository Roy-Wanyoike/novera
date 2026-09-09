/**
 * AGENTS — daily-limit window + hold-aware funds invariant tests (database-backed).
 *
 * The agent daily ceiling is a per-UTC-day WINDOW derived from ledger
 * entries (the lifetime `dailySpendMinor` counter never resets — it must
 * not gate the limit, or "daily" becomes "lifetime"), and the
 * intent-execution funds check honors ACTIVE holds (financial-kernel.md
 * §6): reserved money is not spendable by agents.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { ensureChartOfAccounts, postTransaction, walletLedgerBalance } from '@/lib/ledger'
import { proposeAgentIntent, executeAgentIntent, agentSpendToday } from '@/lib/agents'
import { ref } from '@/lib/ids'
import { createTestOrg, createWallet, resetDb } from './db-utils'

let org: { id: string; slug: string }
let coa: Record<string, string>
let from: { walletId: string; accountId: string }
let to: { walletId: string; accountId: string }
let agentId: string

beforeEach(async () => {
  await resetDb()
  org = await createTestOrg('Agents Invariants')
  coa = await ensureChartOfAccounts(org.id)
  from = await createWallet(org.id, 'Operating', 'KES')
  to = await createWallet(org.id, 'Suppliers', 'KES', 'SUPPLIER')
  const agent = await db.agent.create({
    data: {
      organizationId: org.id,
      name: 'Atlas',
      role: 'PROCUREMENT',
      status: 'ACTIVE',
      scopes: JSON.stringify(['payments.propose', 'suppliers.compare', 'balances.read']),
    },
  })
  agentId = agent.id
})

/** Fund the Operating wallet through the kernel (Dr wallet / Cr opening equity). */
async function fund(accountId: string, amountMinor: bigint) {
  await postTransaction({
    organizationId: org.id,
    description: 'opening funds',
    source: 'ADJUSTMENT',
    idempotencyKey: `fund-agents:${amountMinor.toString()}`,
    entries: [
      { accountId, direction: 'DEBIT', amountMinor, currency: 'KES' },
      { accountId: coa['OPENING_EQUITY'], direction: 'CREDIT', amountMinor, currency: 'KES' },
    ],
  })
}

/** Agent-intent-style posting — exactly the legs executeAgentIntent posts. */
async function postAgentSpend(agent: string, amountMinor: bigint, key: string) {
  return postTransaction({
    organizationId: org.id,
    description: 'Atlas: agent spend',
    source: 'AGENT',
    idempotencyKey: key,
    actorType: 'AGENT',
    actorId: agent,
    actorLabel: 'Atlas (agent)',
    entries: [
      { accountId: to.accountId, direction: 'DEBIT', amountMinor, currency: 'KES' },
      { accountId: from.accountId, direction: 'CREDIT', amountMinor, currency: 'KES' },
    ],
  })
}

/** An AGENT-source posting timestamped OUTSIDE today's UTC window. */
async function postAgentSpendYesterday(agent: string, amountMinor: bigint) {
  await db.ledgerTransaction.create({
    data: {
      organizationId: org.id,
      reference: ref.ledgerTxn(),
      description: 'Atlas: yesterday spend',
      source: 'AGENT',
      status: 'POSTED',
      idempotencyKey: `agent-spend-yesterday:${agent}`,
      amountMinor,
      currency: 'KES',
      actorType: 'AGENT',
      actorId: agent,
      postedAt: new Date(Date.now() - 26 * 3600 * 1000),
      entries: {
        create: [
          { accountId: to.accountId, direction: 'DEBIT', amountMinor, currency: 'KES' },
          { accountId: from.accountId, direction: 'CREDIT', amountMinor, currency: 'KES' },
        ],
      },
    },
  })
}

async function propose(amountMinor: bigint) {
  return proposeAgentIntent({
    organizationId: org.id,
    agentId,
    tool: 'payments.propose',
    description: `Pay vendor ${(Number(amountMinor) / 100).toFixed(2)}`,
    payload: {
      action: 'payment.create',
      amountMinor,
      currency: 'KES',
      merchant: 'Kikwetu Suppliers',
      toWalletLabel: 'Suppliers',
    },
  })
}

describe('agents · daily-spend window (derived from ledger entries)', () => {
  it('agentSpendToday sums today’s AGENT-source CREDIT legs — nothing else', async () => {
    expect(await agentSpendToday(org.id, agentId)).toBe(0n)

    await postAgentSpend(agentId, 500_000n, 'agent-spend-1')
    expect(await agentSpendToday(org.id, agentId)).toBe(500_000n)

    await postAgentSpend(agentId, 250_000n, 'agent-spend-2')
    expect(await agentSpendToday(org.id, agentId)).toBe(750_000n)

    // a different agent's spend is not counted
    const other = await db.agent.create({
      data: {
        organizationId: org.id,
        name: 'Ledgerline',
        role: 'BILLING',
        status: 'ACTIVE',
        scopes: JSON.stringify(['balances.read']),
      },
    })
    await postAgentSpend(other.id, 100_000n, 'agent-spend-other')
    expect(await agentSpendToday(org.id, agentId)).toBe(750_000n)

    // yesterday's posting is outside the UTC window
    await postAgentSpendYesterday(agentId, 999_000n)
    expect(await agentSpendToday(org.id, agentId)).toBe(750_000n)

    // non-AGENT source with this agent as actor is not counted
    await postTransaction({
      organizationId: org.id,
      description: 'manual transfer',
      source: 'TRANSFER',
      idempotencyKey: 'not-agent-spend',
      actorType: 'AGENT',
      actorId: agentId,
      entries: [
        { accountId: to.accountId, direction: 'DEBIT', amountMinor: 100n, currency: 'KES' },
        { accountId: from.accountId, direction: 'CREDIT', amountMinor: 100n, currency: 'KES' },
      ],
    })
    expect(await agentSpendToday(org.id, agentId)).toBe(750_000n)
  })
})

describe('agents · daily limit is a daily ceiling, not a lifetime ceiling', () => {
  it('a lifetime dailySpendMinor far above the limit does not gate a new day’s intent', async () => {
    await fund(from.accountId, 10_000_000n)
    // the OLD code gated on this never-resetting counter → lifetime ceiling
    await db.agent.update({
      where: { id: agentId },
      data: {
        dailySpendMinor: 5_000_000n,
        dailyLimitMinor: 1_000_000n,
        perTransactionLimitMinor: 2_000_000n,
        requiresApprovalAboveMinor: 2_000_000n,
      },
    })

    // today's windowed spend is 0 — the intent must be allowed and execute
    const intent = await propose(500_000n)
    expect(intent.status).toBe('EXECUTED')
    expect(await agentSpendToday(org.id, agentId)).toBe(500_000n)
  })

  it('a proposal that would bring today’s spend to the limit is denied at the policy gate', async () => {
    await fund(from.accountId, 10_000_000n)
    await db.agent.update({
      where: { id: agentId },
      data: {
        dailyLimitMinor: 1_000_000n,
        perTransactionLimitMinor: 2_000_000n,
        requiresApprovalAboveMinor: 2_000_000n,
      },
    })

    const first = await propose(600_000n)
    expect(first.status).toBe('EXECUTED')

    // projected cumulative spend: 600_000 + 500_000 reaches the limit → DECLINE
    const second = await propose(500_000n)
    expect(second.status).toBe('POLICY_DENIED')
    expect(second.policyReasons).toContain('daily spend ceiling')
    expect(await agentSpendToday(org.id, agentId)).toBe(600_000n)
  })

  it('executeAgentIntent re-derives the window at execution — an approved intent that would now breach the limit fails closed', async () => {
    await fund(from.accountId, 10_000_000n)
    await db.agent.update({
      where: { id: agentId },
      data: {
        dailyLimitMinor: 1_000_000n,
        perTransactionLimitMinor: 2_000_000n,
        requiresApprovalAboveMinor: 2_000_000n,
      },
    })

    // today's windowed spend already at 600_000 (posted by an earlier intent)
    await postAgentSpend(agentId, 600_000n, 'agent-spend-earlier')

    // a pending intent proposed BEFORE that spend (fixture crafted directly)
    const intent = await db.agentIntent.create({
      data: {
        organizationId: org.id,
        agentId,
        tool: 'payments.propose',
        description: 'Pay Late Vendor 500.00',
        payload: JSON.stringify({
          action: 'payment.create',
          amountMinor: '500000',
          currency: 'KES',
          toWalletLabel: 'Suppliers',
        }),
        status: 'APPROVED',
      },
    })

    const executed = await executeAgentIntent(intent.id)
    expect(executed.status).toBe('EXECUTION_FAILED')
    expect(executed.failureReason).toContain('daily spend limit exceeded')
    // nothing moved: the windowed spend is still only the earlier posting
    expect(await agentSpendToday(org.id, agentId)).toBe(600_000n)
    expect(
      await db.ledgerTransaction.count({ where: { organizationId: org.id, source: 'AGENT' } })
    ).toBe(1)
  })
})

describe('agents · funds guard honors holds (financial-kernel.md §6)', () => {
  it('an ACTIVE hold on the source wallet blocks an intent the raw ledger balance would allow', async () => {
    await fund(from.accountId, 1_000_000n)
    await db.agent.update({
      where: { id: agentId },
      data: { perTransactionLimitMinor: 5_000_000n, requiresApprovalAboveMinor: 5_000_000n },
    })
    await db.hold.create({
      data: {
        organizationId: org.id,
        walletId: from.walletId,
        reference: 'hld_agent_guard',
        amountMinor: 700_000n,
        currency: 'KES',
        reason: 'card authorization test',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    // raw ledger balance 1_000_000 ≥ 800_000, but available is only 300_000
    const intent = await propose(800_000n)
    expect(intent.status).toBe('EXECUTION_FAILED')
    expect(intent.failureReason).toContain('insufficient available funds')
    expect(await walletLedgerBalance(from.walletId)).toBe(1_000_000n)
    expect(await agentSpendToday(org.id, agentId)).toBe(0n)
  })

  it('a past-due hold no longer reserves funds — the same intent executes', async () => {
    await fund(from.accountId, 1_000_000n)
    await db.agent.update({
      where: { id: agentId },
      data: { perTransactionLimitMinor: 5_000_000n, requiresApprovalAboveMinor: 5_000_000n },
    })
    await db.hold.create({
      data: {
        organizationId: org.id,
        walletId: from.walletId,
        reference: 'hld_agent_stale',
        amountMinor: 700_000n,
        currency: 'KES',
        reason: 'stale authorization',
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const intent = await propose(800_000n)
    expect(intent.status).toBe('EXECUTED')
    expect(await agentSpendToday(org.id, agentId)).toBe(800_000n)
  })
})
