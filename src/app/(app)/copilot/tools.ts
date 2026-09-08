import { db } from '@/lib/db'
import { Money } from '@novera/money'
import { walletLedgerBalance } from '@/lib/ledger'
import { availableBalanceMinor } from '@/lib/transfers'
import { statusMeta, titleCase } from '@/lib/format'
import { WALLET_TYPE_META } from '@novera/domain'

/**
 * COPILOT TOOL CATALOG — deterministic, org-scoped ledger queries.
 *
 * Architecture contract (Intelligence Plane):
 *   The LLM NEVER touches the database. It only proposes a tool name + args;
 *   these pure functions are the sole data source for every copilot answer.
 *   All money leaves this module as STRING minor units (BigInt is never
 *   JSON-serialized), paired with a deterministic `formatted` value produced
 *   by @novera/money — so the model never does its own arithmetic.
 *
 * Grounding levels:
 *   GROUNDED  — every figure derived directly from ledger rows
 *   ESTIMATED — projection computed from trailing flows (clearly labelled)
 *   UNKNOWN   — no tool matched; answer is conversational only
 */

export type Grounding = 'GROUNDED' | 'ESTIMATED' | 'UNKNOWN'

export interface ToolResult {
  tool: string
  grounding: Grounding
  data: Record<string, unknown>
}

export const TOOL_NAMES = [
  'get_balances',
  'get_cash_position',
  'get_recent_transactions',
  'get_expenses_by_category',
  'get_overdue_invoices',
  'get_failed_payments',
  'get_projected_cash',
  'get_payment_status',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name)
}

/** Human descriptions feed the classifier prompt (never executed as code). */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_balances: 'wallet balances by label, type, currency, ledger / available / reserved amounts',
  get_cash_position: 'total cash by currency across wallets plus open (unpaid) invoice balances',
  get_recent_transactions: 'most recent posted ledger transactions (reference, description, source, amount). args: {"limit": 5-20}',
  get_expenses_by_category: 'last-30-day spending grouped by category (settled payouts + approved card authorizations)',
  get_overdue_invoices: 'overdue invoices with customer names and outstanding balances',
  get_failed_payments: 'failed payments in the last 30 days with failure reasons and reason frequencies',
  get_projected_cash: 'projected cash 4 weeks out from trailing 30-day net flow (ESTIMATED)',
  get_payment_status: "one payment's lifecycle status by its reference. args: {\"reference\": \"pay_…\"}",
}

// ── helpers ──────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString()

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000)

const walletTypeLabel = (type: string) => statusMeta(WALLET_TYPE_META, type).label

function money(minor: bigint, currency: string): string {
  try {
    return Money.fromMinor(minor, currency).format()
  } catch {
    return `${minor.toString()} ${currency}`
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Per-currency wallet totals, derived from ledger entries minus active holds. */
async function walletTotalsByCurrency(organizationId: string) {
  const wallets = await db.wallet.findMany({
    where: { organizationId },
    select: { id: true, currency: true, status: true },
  })
  const map = new Map<string, { ledger: bigint; available: bigint; wallets: number }>()
  for (const w of wallets) {
    if (w.status === 'ARCHIVED') continue
    const ledger = await walletLedgerBalance(w.id)
    const available = await availableBalanceMinor(w.id)
    const bucket = map.get(w.currency) ?? { ledger: 0n, available: 0n, wallets: 0 }
    bucket.ledger += ledger
    bucket.available += available
    bucket.wallets += 1
    map.set(w.currency, bucket)
  }
  return [...map.entries()].map(([currency, b]) => ({
    currency,
    wallets: b.wallets,
    ledgerMinor: b.ledger.toString(),
    ledgerFormatted: money(b.ledger, currency),
    availableMinor: b.available.toString(),
    availableFormatted: money(b.available, currency),
    reservedMinor: (b.ledger - b.available).toString(),
  }))
}

// ── tools ────────────────────────────────────────────────────────────

interface WalletBalanceRow {
  wallet: string
  type: string
  status: string
  currency: string
  ledgerMinor: string
  ledgerFormatted: string
  availableMinor: string
  availableFormatted: string
  reservedMinor: string
}

async function getBalances(organizationId: string): Promise<ToolResult> {
  const wallets = await db.wallet.findMany({
    where: { organizationId },
    orderBy: [{ type: 'asc' }, { label: 'asc' }],
    select: { id: true, label: true, type: true, currency: true, status: true },
  })
  const rows: WalletBalanceRow[] = []
  for (const w of wallets) {
    const ledger = await walletLedgerBalance(w.id)
    const available = await availableBalanceMinor(w.id)
    rows.push({
      wallet: w.label,
      type: walletTypeLabel(w.type),
      status: w.status,
      currency: w.currency,
      ledgerMinor: ledger.toString(),
      ledgerFormatted: money(ledger, w.currency),
      availableMinor: available.toString(),
      availableFormatted: money(available, w.currency),
      reservedMinor: (ledger - available).toString(),
    })
  }
  return {
    tool: 'get_balances',
    grounding: 'GROUNDED',
    data: {
      asOf: nowIso(),
      walletCount: rows.length,
      note: 'available = ledger balance − active holds; pending settlement is never counted as available',
      wallets: rows,
    },
  }
}

async function getCashPosition(organizationId: string): Promise<ToolResult> {
  const totals = await walletTotalsByCurrency(organizationId)
  const openInvoices = await db.invoice.findMany({
    where: {
      organizationId,
      status: { in: ['ISSUED', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'] },
    },
    select: { totalMinor: true, amountPaidMinor: true, currency: true },
  })
  const outstanding = new Map<string, bigint>()
  let openCount = 0
  for (const inv of openInvoices) {
    const balance = inv.totalMinor - inv.amountPaidMinor
    if (balance <= 0n) continue
    openCount += 1
    outstanding.set(inv.currency, (outstanding.get(inv.currency) ?? 0n) + balance)
  }
  const receivables = [...outstanding.entries()].map(([currency, minor]) => ({
    currency,
    outstandingMinor: minor.toString(),
    outstandingFormatted: money(minor, currency),
  }))
  return {
    tool: 'get_cash_position',
    grounding: 'GROUNDED',
    data: {
      asOf: nowIso(),
      cashByCurrency: totals,
      openInvoices: {
        count: openCount,
        outstandingByCurrency: receivables,
        note: 'outstanding = invoice total minus settled payments; not yet cash',
      },
    },
  }
}

async function getRecentTransactions(organizationId: string, limit: number): Promise<ToolResult> {
  const txns = await db.ledgerTransaction.findMany({
    where: { organizationId, status: 'POSTED' },
    orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: {
      reference: true,
      description: true,
      source: true,
      amountMinor: true,
      currency: true,
      actorType: true,
      actorLabel: true,
      effectiveAt: true,
    },
  })
  return {
    tool: 'get_recent_transactions',
    grounding: 'GROUNDED',
    data: {
      asOf: nowIso(),
      count: txns.length,
      transactions: txns.map((t) => ({
        reference: t.reference,
        description: t.description,
        source: t.source,
        amountMinor: t.amountMinor.toString(),
        amountFormatted: money(t.amountMinor, t.currency),
        currency: t.currency,
        postedAt: t.effectiveAt.toISOString(),
        actor: t.actorLabel ?? titleCase(t.actorType),
      })),
    },
  }
}

// ── expense categorization (deterministic keyword buckets) ───────────

const EXPENSE_BUCKETS: { category: string; keywords: string[] }[] = [
  { category: 'Payroll & salaries', keywords: ['payroll', 'salary', 'salaries', 'wage', 'wages', 'staff payment'] },
  { category: 'Suppliers & procurement', keywords: ['supplier', 'vendor', 'procurement', 'purchase', 'restock', 'inventory', 'goods', 'wholesale'] },
  { category: 'Software & subscriptions', keywords: ['saas', 'software', 'subscription', 'aws', 'cloud', 'hosting', 'domain', 'openai', 'anthropic', 'claude', 'github', 'slack', 'notion', 'figma', 'google', 'microsoft', 'crm', 'erp'] },
  { category: 'Rent & facilities', keywords: ['rent', 'office', 'facility', 'utilities', 'electricity', 'water bill', 'internet', 'cleaning', 'security'] },
  { category: 'Travel & transport', keywords: ['travel', 'flight', 'hotel', 'transport', 'fuel', 'uber', 'bolt', 'taxi', 'mileage', 'logistics', 'delivery', 'courier'] },
  { category: 'Marketing & ads', keywords: ['marketing', 'advertising', 'ad spend', 'campaign', 'promotion', 'billboard', 'influencer', 'branding'] },
  { category: 'Fees & charges', keywords: ['fee', 'fees', 'charge', 'commission', 'tariff', 'service cost'] },
  { category: 'Taxes & regulatory', keywords: ['tax', 'taxes', 'kra', 'vat', 'levy', 'license', 'permit', 'regulatory'] },
]

function bucketFor(text: string): string {
  const lower = text.toLowerCase()
  for (const bucket of EXPENSE_BUCKETS) {
    if (bucket.keywords.some((k) => lower.includes(k))) return bucket.category
  }
  return 'Other'
}

async function getExpensesByCategory(organizationId: string): Promise<ToolResult> {
  const since = daysAgo(30)
  const payouts = await db.payment.findMany({
    where: { organizationId, direction: 'OUT', status: 'SETTLED', createdAt: { gte: since } },
    select: { description: true, method: true, amountMinor: true, currency: true },
  })
  const cardAuths = await db.cardAuthorization.findMany({
    where: {
      card: { organizationId },
      decision: 'APPROVED',
      ledgerTransactionId: { not: null },
      createdAt: { gte: since },
    },
    select: { merchantName: true, amountMinor: true, currency: true },
  })

  const catMap = new Map<string, { category: string; currency: string; total: bigint; count: number }>()
  const methodMap = new Map<string, { method: string; currency: string; total: bigint; count: number }>()

  const addCat = (category: string, currency: string, minor: bigint) => {
    const key = `${currency}::${category}`
    const b = catMap.get(key) ?? { category, currency, total: 0n, count: 0 }
    b.total += minor
    b.count += 1
    catMap.set(key, b)
  }

  for (const p of payouts) {
    addCat(bucketFor(p.description ?? ''), p.currency, p.amountMinor)
    const mKey = `${p.currency}::${p.method}`
    const m = methodMap.get(mKey) ?? { method: titleCase(p.method), currency: p.currency, total: 0n, count: 0 }
    m.total += p.amountMinor
    m.count += 1
    methodMap.set(mKey, m)
  }
  for (const a of cardAuths) {
    addCat(bucketFor(a.merchantName), a.currency, a.amountMinor)
  }

  const currencies = [...new Set([...catMap.values()].map((c) => c.currency))]
  const perCurrency = currencies.map((currency) => {
    const cats = [...catMap.values()].filter((c) => c.currency === currency).sort((a, b) => (b.total > a.total ? 1 : -1))
    const total = cats.reduce((acc, c) => acc + c.total, 0n)
    return {
      currency,
      totalMinor: total.toString(),
      totalFormatted: money(total, currency),
      categories: cats.map((c) => ({
        category: c.category,
        transactionCount: c.count,
        totalMinor: c.total.toString(),
        totalFormatted: money(c.total, currency),
        sharePct: total === 0n ? 0 : Math.round((Number(c.total) / Number(total)) * 1000) / 10,
      })),
    }
  })

  return {
    tool: 'get_expenses_by_category',
    grounding: 'GROUNDED',
    data: {
      asOf: nowIso(),
      window: 'last 30 days',
      included: 'settled outgoing payments + approved card authorizations',
      payoutCount: payouts.length,
      cardAuthCount: cardAuths.length,
      perCurrency,
      byPaymentMethod: [...methodMap.values()].map((m) => ({
        method: m.method,
        currency: m.currency,
        count: m.count,
        totalMinor: m.total.toString(),
        totalFormatted: money(m.total, m.currency),
      })),
    },
  }
}

async function getOverdueInvoices(organizationId: string): Promise<ToolResult> {
  const now = new Date()
  const invoices = await db.invoice.findMany({
    where: {
      organizationId,
      OR: [
        { status: 'OVERDUE' },
        { status: { in: ['ISSUED', 'VIEWED', 'PARTIALLY_PAID'] }, dueAt: { lt: now } },
      ],
    },
    include: { customer: { select: { name: true } } },
    orderBy: { dueAt: 'asc' },
  })
  const rows = invoices.map((i) => {
    const balance = i.totalMinor - i.amountPaidMinor
    return {
      number: i.number,
      customer: i.customer.name,
      status: i.status,
      currency: i.currency,
      dueDate: i.dueAt ? i.dueAt.toISOString() : null,
      daysOverdue: i.dueAt ? Math.max(0, Math.floor((now.getTime() - i.dueAt.getTime()) / 86_400_000)) : null,
      totalMinor: i.totalMinor.toString(),
      paidMinor: i.amountPaidMinor.toString(),
      balanceMinor: balance.toString(),
      balanceFormatted: money(balance, i.currency),
    }
  })
  const byCurrency = new Map<string, bigint>()
  for (const r of rows) {
    byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0n) + BigInt(r.balanceMinor))
  }
  return {
    tool: 'get_overdue_invoices',
    grounding: 'GROUNDED',
    data: {
      asOf: nowIso(),
      count: rows.length,
      totalOutstandingByCurrency: [...byCurrency.entries()].map(([currency, minor]) => ({
        currency,
        outstandingMinor: minor.toString(),
        outstandingFormatted: money(minor, currency),
      })),
      invoices: rows,
    },
  }
}

async function getFailedPayments(organizationId: string): Promise<ToolResult> {
  const since = daysAgo(30)
  const payments = await db.payment.findMany({
    where: {
      organizationId,
      status: 'FAILED',
      OR: [{ failedAt: { gte: since } }, { failedAt: null, createdAt: { gte: since } }],
    },
    orderBy: [{ failedAt: 'desc' }, { createdAt: 'desc' }],
    take: 25,
    select: {
      reference: true,
      customerName: true,
      amountMinor: true,
      currency: true,
      method: true,
      direction: true,
      failureReason: true,
      riskDecision: true,
      failedAt: true,
    },
  })
  const reasonCounts = new Map<string, number>()
  for (const p of payments) {
    const reason = p.failureReason ?? 'Unknown reason'
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
  }
  const byCurrency = new Map<string, bigint>()
  for (const p of payments) {
    byCurrency.set(p.currency, (byCurrency.get(p.currency) ?? 0n) + p.amountMinor)
  }
  return {
    tool: 'get_failed_payments',
    grounding: 'GROUNDED',
    data: {
      asOf: nowIso(),
      window: 'last 30 days',
      count: payments.length,
      failureReasonsRanked: [...reasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => ({ reason, count })),
      attemptedAmountByCurrency: [...byCurrency.entries()].map(([currency, minor]) => ({
        currency,
        attemptedMinor: minor.toString(),
        attemptedFormatted: money(minor, currency),
      })),
      payments: payments.map((p) => ({
        reference: p.reference,
        customer: p.customerName ?? '—',
        direction: p.direction,
        method: titleCase(p.method),
        amountMinor: p.amountMinor.toString(),
        amountFormatted: money(p.amountMinor, p.currency),
        currency: p.currency,
        failureReason: p.failureReason ?? 'Unknown',
        riskDecision: p.riskDecision ?? null,
        failedAt: p.failedAt ? p.failedAt.toISOString() : null,
      })),
    },
  }
}

async function getProjectedCash(organizationId: string): Promise<ToolResult> {
  const since = daysAgo(30)
  const settled = await db.payment.findMany({
    where: { organizationId, status: 'SETTLED', settledAt: { gte: since } },
    select: { direction: true, amountMinor: true, currency: true },
  })
  const flow = new Map<string, { inflow: bigint; outflow: bigint }>()
  for (const p of settled) {
    const b = flow.get(p.currency) ?? { inflow: 0n, outflow: 0n }
    if (p.direction === 'IN') b.inflow += p.amountMinor
    else b.outflow += p.amountMinor
    flow.set(p.currency, b)
  }
  const totals = await walletTotalsByCurrency(organizationId)

  const perCurrency = totals.map((t) => {
    const f = flow.get(t.currency) ?? { inflow: 0n, outflow: 0n }
    const net = f.inflow - f.outflow
    const netPerWeek = net / 4n // integer division — a deliberately conservative estimate
    const available = BigInt(t.availableMinor)
    const projected = available + netPerWeek * 4n
    return {
      currency: t.currency,
      currentAvailableMinor: t.availableMinor,
      currentAvailableFormatted: t.availableFormatted,
      trailing30dInflowMinor: f.inflow.toString(),
      trailing30dOutflowMinor: f.outflow.toString(),
      trailingNetMinor: net.toString(),
      netPerWeekMinor: netPerWeek.toString(),
      netPerWeekFormatted: money(netPerWeek, t.currency),
      projectedIn4WeeksMinor: projected.toString(),
      projectedIn4WeeksFormatted: money(projected, t.currency),
      projectedDeltaMinor: (projected - available).toString(),
    }
  })

  return {
    tool: 'get_projected_cash',
    grounding: 'ESTIMATED',
    data: {
      asOf: nowIso(),
      estimateLabel: 'ESTIMATED',
      method: 'trailing 30-day settled net flow, held constant for 4 more weeks',
      perCurrency,
      disclaimer:
        'This is an ESTIMATE, not a forecast guarantee: it assumes the trailing 30-day net flow repeats unchanged and ignores scheduled invoices, holds and seasonality.',
    },
  }
}

async function getPaymentStatus(organizationId: string, reference: string): Promise<ToolResult> {
  if (!reference) {
    return {
      tool: 'get_payment_status',
      grounding: 'GROUNDED',
      data: {
        found: false,
        note: 'No payment reference was provided. References look like pay_xxxxxxxx.',
      },
    }
  }
  const p = await db.payment.findFirst({
    where: { organizationId, reference },
    select: {
      reference: true,
      status: true,
      direction: true,
      method: true,
      amountMinor: true,
      currency: true,
      customerName: true,
      description: true,
      failureReason: true,
      riskDecision: true,
      riskScore: true,
      refundedMinor: true,
      createdAt: true,
      settledAt: true,
      failedAt: true,
    },
  })
  if (!p) {
    return {
      tool: 'get_payment_status',
      grounding: 'GROUNDED',
      data: {
        found: false,
        note: `No payment with reference ${reference} exists in this organization.`,
      },
    }
  }
  return {
    tool: 'get_payment_status',
    grounding: 'GROUNDED',
    data: {
      found: true,
      payment: {
        reference: p.reference,
        status: p.status,
        direction: p.direction === 'IN' ? 'collection (money in)' : 'payout (money out)',
        method: titleCase(p.method),
        amountMinor: p.amountMinor.toString(),
        amountFormatted: money(p.amountMinor, p.currency),
        currency: p.currency,
        customer: p.customerName ?? '—',
        description: p.description ?? '—',
        failureReason: p.failureReason ?? null,
        riskDecision: p.riskDecision ?? null,
        riskScore: p.riskScore ?? null,
        refundedMinor: p.refundedMinor.toString(),
        createdAt: p.createdAt.toISOString(),
        settledAt: p.settledAt ? p.settledAt.toISOString() : null,
        failedAt: p.failedAt ? p.failedAt.toISOString() : null,
      },
    },
  }
}

// ── dispatcher ───────────────────────────────────────────────────────

/** Execute a validated tool deterministically. Args are sanitized here. */
export async function runTool(
  name: ToolName,
  args: Record<string, unknown>,
  organizationId: string
): Promise<ToolResult> {
  switch (name) {
    case 'get_balances':
      return getBalances(organizationId)
    case 'get_cash_position':
      return getCashPosition(organizationId)
    case 'get_recent_transactions':
      return getRecentTransactions(organizationId, clampInt(args.limit, 10, 1, 20))
    case 'get_expenses_by_category':
      return getExpensesByCategory(organizationId)
    case 'get_overdue_invoices':
      return getOverdueInvoices(organizationId)
    case 'get_failed_payments':
      return getFailedPayments(organizationId)
    case 'get_projected_cash':
      return getProjectedCash(organizationId)
    case 'get_payment_status': {
      const reference = typeof args.reference === 'string' ? args.reference.trim().slice(0, 64) : ''
      return getPaymentStatus(organizationId, reference)
    }
  }
}
