import { db } from '@/lib/db'
import { ensureChartOfAccounts } from '@/lib/ledger'
import { recordAudit } from '@/lib/audit'
import { ref } from '@/lib/ids'

/**
 * ORGANIZATION PROVISIONING
 *
 * Every new organization receives: the standard chart of accounts,
 * a KES operating wallet (with its own ledger account), and the default
 * risk rule set. All wallet balances start at exactly zero — opening
 * balances are posted as explicit OPENING ledger transactions.
 */

export const DEFAULT_RISK_RULES = [
  {
    name: 'Large transaction review',
    description: 'Collections above KES 200,000 are held for manual review',
    conditions: JSON.stringify([
      { field: 'amountMinor', op: 'gt', value: '20000000' },
      { field: 'currency', op: 'eq', value: 'KES' },
    ]),
    action: 'REVIEW',
    priority: 50,
  },
  {
    name: 'High-risk geography decline',
    description: 'Transactions from sanctioned/high-risk country codes are declined',
    conditions: JSON.stringify([{ field: 'country', op: 'in', value: ['XX', 'YY'] }]),
    action: 'DECLINE',
    priority: 10,
  },
  {
    name: 'Known fraud emails decline',
    description: 'Blocklist of customer emails implicated in prior fraud',
    conditions: JSON.stringify([{ field: 'customerEmail', op: 'in', value: ['fraud@blocked.test'] }]),
    action: 'DECLINE',
    priority: 5,
  },
]

export async function provisionOrganization(organizationId: string, baseCurrency = 'KES') {
  const org = await db.organization.findUnique({ where: { id: organizationId } })
  if (!org) throw new Error('organization not found')

  await ensureChartOfAccounts(organizationId)

  const walletDefs: { label: string; type: string; description: string }[] = [
    { label: 'Operating', type: 'OPERATING', description: 'Primary day-to-day funds' },
  ]

  const existing = await db.wallet.findMany({ where: { organizationId } })
  const created: string[] = []
  for (const def of walletDefs) {
    if (existing.some((w) => w.label === def.label && w.currency === baseCurrency)) continue
    const ledgerAccount = await db.ledgerAccount.create({
      data: {
        organizationId,
        code: `WALLET:${baseCurrency}:${def.label.toUpperCase()}`,
        name: `${def.label} wallet (${baseCurrency})`,
        type: 'ASSET',
        normalBalance: 'DEBIT',
        currency: baseCurrency,
      },
    })
    const wallet = await db.wallet.create({
      data: {
        organizationId,
        label: def.label,
        type: def.type,
        currency: baseCurrency,
        ledgerAccountId: ledgerAccount.id,
        description: def.description,
      },
    })
    created.push(wallet.id)
  }

  // default org risk rules
  for (const rule of DEFAULT_RISK_RULES) {
    const exists = await db.riskRule.findFirst({
      where: { organizationId, name: rule.name },
    })
    if (!exists) {
      await db.riskRule.create({ data: { organizationId, ...rule } })
    }
  }

  await recordAudit({
    organizationId,
    actorType: 'SYSTEM',
    action: 'organization.provisioned',
    resourceType: 'Organization',
    resourceId: organizationId,
    description: `Chart of accounts + operating wallet provisioned for ${org.name}`,
    metadata: { wallets: created.length },
  })

  return { walletsCreated: created }
}

export async function addWallet(
  organizationId: string,
  label: string,
  type: string,
  currency: string,
  description?: string
) {
  const dupe = await db.wallet.findFirst({ where: { organizationId, label, currency } })
  if (dupe) throw new Error(`wallet "${label}" (${currency}) already exists`)
  const ledgerAccount = await db.ledgerAccount.create({
    data: {
      organizationId,
      code: `WALLET:${currency}:${label.toUpperCase()}:${ref.paymentLink().slice(-4)}`,
      name: `${label} wallet (${currency})`,
      type: 'ASSET',
      normalBalance: 'DEBIT',
      currency,
    },
  })
  const wallet = await db.wallet.create({
    data: {
      organizationId,
      label,
      type,
      currency,
      ledgerAccountId: ledgerAccount.id,
      description: description ?? null,
    },
  })
  await recordAudit({
    organizationId,
    actorType: 'USER',
    action: 'wallet.created',
    resourceType: 'Wallet',
    resourceId: wallet.id,
    description: `Wallet "${label}" (${currency}) created`,
  })
  return wallet
}

export async function postOpeningBalance(
  organizationId: string,
  walletId: string,
  amountMinor: bigint,
  currency: string,
  actor: { id?: string; label?: string }
) {
  const wallet = await db.wallet.findFirst({ where: { id: walletId, organizationId } })
  if (!wallet) throw new Error('wallet not found')
  const coa = await ensureChartOfAccounts(organizationId)
  const { postTransaction } = await import('@/lib/ledger')
  return postTransaction({
    organizationId,
    description: `Opening balance for ${wallet.label}`,
    source: 'OPENING',
    actorType: 'USER',
    actorId: actor.id ?? null,
    actorLabel: actor.label ?? null,
    entries: [
      { accountId: wallet.ledgerAccountId, direction: 'DEBIT', amountMinor, currency },
      { accountId: coa['OPENING_EQUITY'], direction: 'CREDIT', amountMinor, currency },
    ],
    metadata: { wallet: wallet.label, type: 'OPENING' },
  })
}
