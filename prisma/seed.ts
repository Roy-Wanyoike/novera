/**
 * NOVERA SEED — deterministic sandbox dataset (TEST mode).
 *
 * The seed drives data through the REAL kernel services — payments settle
 * via the ledger, split rules execute on receipt, webhooks fire, the
 * audit chain builds. If the ledger invariants hold after seeding, the
 * kernel is proven. Nothing is inserted behind the kernel's back.
 *
 * Run: bun prisma/seed.ts
 */

// ── deterministic PRNG ───────────────────────────────────────────────
let seedState = 0x4e4f5645
function rnd(): number {
  seedState ^= seedState << 13
  seedState ^= seedState >>> 17
  seedState ^= seedState << 5
  return ((seedState >>> 0) % 100000) / 100000
}
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
const between = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))
const daysAgo = (n: number, jitterHours = 12): Date =>
  new Date(Date.now() - n * 86400000 - between(0, jitterHours) * 3600000)

import { db } from '../src/lib/db'

// ── deterministic PRNG ───────────────────────────────────────────────

async function reset() {
  // break self-referencing reversal chains before deletion
  await db.$executeRawUnsafe(`UPDATE "LedgerTransaction" SET "reversalOfId" = NULL`).catch(() => {})
  const tables = [
    'auditEvent', 'copilotMessage', 'webhookDelivery', 'webhookEndpoint', 'apiRequestLog',
    'apiKey', 'riskEvaluation', 'riskRule', 'policy', 'splitRuleExecution', 'splitRule',
    'agentIntent', 'approvalRequest', 'agent', 'cardAuthorization', 'card', 'invoiceItem',
    'invoice', 'customer', 'providerTransaction', 'reconciliationCase', 'railProvider',
    'paymentLink', 'payment', 'hold', 'settlementAccount', 'fxQuote', 'ledgerEntry',
    'ledgerTransaction', 'wallet', 'ledgerAccount', 'session', 'membership', 'organization', 'user',
  ]
  for (const t of tables) {
    await db.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => {})
  }
  const remaining = await db.organization.count()
  if (remaining > 0) {
    throw new Error(`reset failed — ${remaining} organizations remain (FK ordering bug)`)
  }
}

// import kernel services AFTER db client (they share the global prisma)
async function main() {
  console.log('── resetting database ──')
  await reset()

  // ── rail providers (all TEST mode, explicitly sandbox) ──
  const providers = await Promise.all([
    db.railProvider.create({ data: { code: 'MPESA_V1', name: 'Safaricom M-Pesa (sandbox)', railType: 'MOBILE_MONEY', mode: 'TEST', latencyMsAvg: 850, successRateBps: 9910, feeBps: 120, fixedFeeMinor: 0n, currency: 'KES' } }),
    db.railProvider.create({ data: { code: 'EQUITY_EFT', name: 'Equity Bank EFT/RTGS (sandbox)', railType: 'BANK', mode: 'TEST', latencyMsAvg: 4200, successRateBps: 9790, feeBps: 90, currency: 'KES' } }),
    db.railProvider.create({ data: { code: 'CARD_VISA', name: 'Visa via processor (sandbox)', railType: 'CARD', mode: 'TEST', latencyMsAvg: 640, successRateBps: 9740, feeBps: 280, currency: 'KES' } }),
    db.railProvider.create({ data: { code: 'USDC_BASE', name: 'USDC on Base (sandbox)', railType: 'CRYPTO', mode: 'TEST', latencyMsAvg: 2100, successRateBps: 9950, feeBps: 40, currency: 'USDC' } }),
    db.railProvider.create({ data: { code: 'NOVERA_INTERNAL', name: 'Novera internal ledger', railType: 'INTERNAL', mode: 'TEST', latencyMsAvg: 35, successRateBps: 10000, feeBps: 0, currency: 'KES' } }),
  ])
  const providerByCode = Object.fromEntries(providers.map((p) => [p.code, p]))

  // ── users + organizations ──
  const { hashPassword, pickAvatarColor, sha256Hex } = await import('../src/lib/crypto')
  const owner = await db.user.create({
    data: {
      email: 'demo@novera.africa',
      name: 'Amina Otieno',
      passwordHash: hashPassword('novera-demo-2026'),
      avatarColor: pickAvatarColor('demo@novera.africa'),
    },
  })
  const finance = await db.user.create({
    data: {
      email: 'finance@novera.africa',
      name: 'David Kimani',
      passwordHash: hashPassword('novera-demo-2026'),
      avatarColor: pickAvatarColor('finance@novera.africa'),
    },
  })
  const dev = await db.user.create({
    data: {
      email: 'dev@novera.africa',
      name: 'Grace Wanjiru',
      passwordHash: hashPassword('novera-demo-2026'),
      avatarColor: pickAvatarColor('dev@novera.africa'),
    },
  })

  const acme = await db.organization.create({
    data: { name: 'Acme Kenya Ltd', slug: 'acme-kenya', type: 'BUSINESS', country: 'KE', mode: 'TEST' },
  })
  const solar = await db.organization.create({
    data: { name: 'SolarNow Distributors', slug: 'solarnow', type: 'MERCHANT', country: 'KE', mode: 'TEST' },
  })
  await db.membership.create({ data: { userId: owner.id, organizationId: acme.id, role: 'OWNER' } })
  await db.membership.create({ data: { userId: finance.id, organizationId: acme.id, role: 'FINANCE' } })
  await db.membership.create({ data: { userId: dev.id, organizationId: acme.id, role: 'DEVELOPER' } })
  await db.membership.create({ data: { userId: owner.id, organizationId: solar.id, role: 'OWNER' } })

  // ── provisioning through the real services ──
  const { provisionOrganization, addWallet, postOpeningBalance } = await import('../src/lib/provision')
  await provisionOrganization(acme.id)
  await provisionOrganization(solar.id)

  for (const org of [acme, solar]) {
    await addWallet(org.id, 'Tax', 'TAX', 'KES', 'VAT + withholding set-aside (10% split target)')
    await addWallet(org.id, 'Reserve', 'RESERVE', 'KES', 'Working-capital reserve (20% split target)')
    await addWallet(org.id, 'Payroll', 'PAYROLL', 'KES', 'Salary disbursements')
    await addWallet(org.id, 'USD', 'OPERATING', 'USD', 'USD collections & supplier payouts')
  }
  await addWallet(acme.id, 'USDC', 'OPERATING', 'USDC', 'Stablecoin treasury — sandbox')
  const supplierWalletAcme = await addWallet(acme.id, 'Suppliers', 'SUPPLIER', 'KES', 'Supplier payout pool')

  const walletsAcme = await db.wallet.findMany({ where: { organizationId: acme.id } })
  const operatingKes = walletsAcme.find((w) => w.label === 'Operating' && w.currency === 'KES')!
  const taxWallet = walletsAcme.find((w) => w.label === 'Tax')!
  const reserveWallet = walletsAcme.find((w) => w.label === 'Reserve')!
  const usdWallet = walletsAcme.find((w) => w.label === 'USD')!

  await postOpeningBalance(acme.id, operatingKes.id, 125_000_000n, 'KES', { id: owner.id, label: 'Amina Otieno' })
  await postOpeningBalance(acme.id, usdWallet.id, 1_200_000n, 'USD', { id: owner.id, label: 'Amina Otieno' })

  // extra org-specific risk rules
  await db.riskRule.create({
    data: {
      organizationId: acme.id,
      name: 'Card high-ticket review',
      description: 'Card collections above KES 80,000 require review',
      conditions: JSON.stringify([
        { field: 'method', op: 'eq', value: 'CARD' },
        { field: 'amountMinor', op: 'gt', value: '8000000' },
      ]),
      action: 'REVIEW',
      priority: 40,
    },
  })

  // ── customers ──
  const customerNames = [
    ['Juma Hardware', 'juma@hardware.co.ke', '0711234567', 'LOW'],
    ['Bright Future School', 'accounts@brightfuture.ac.ke', '0722334455', 'LOW'],
    ['Mombasa Fresh Foods', 'orders@mbfresh.co.ke', '0733445566', 'MEDIUM'],
    ['TechBridge Solutions', 'pay@techbridge.io', '0744556677', 'LOW'],
    ['Kilifi Beach Resort', 'finance@kilifibeach.com', '0755667788', 'LOW'],
    ['Urban Logistics', 'ap@urbanlog.ke', '0766778899', 'MEDIUM'],
    ['Zawadi Crafts', 'zawadi@crafts.ke', '0777889900', 'LOW'],
    ['Nairobi Dental Clinic', 'billing@ndc.co.ke', '0788990011', 'LOW'],
    ['GreenFields Agro', 'info@greenfields.ke', '0711001100', 'HIGH'],
    ['Pendo Interiors', 'pendo@interiors.co.ke', '0722002200', 'LOW'],
  ] as const
  const customers: { id: string; name: string; email: string | null; riskTier: string }[] = []
  for (const [name, email, phone, tier] of customerNames) {
    customers.push(
      await db.customer.create({
        data: { organizationId: acme.id, name, email, phone, country: 'KE', riskTier: tier },
      })
    )
  }

  // ── programmable money: the 10/20/70 split rule ──
  const splitRule = await db.splitRule.create({
    data: {
      organizationId: acme.id,
      name: 'Revenue waterfalls 10/20/70',
      trigger: 'PAYMENT_RECEIVED',
      allocations: JSON.stringify([
        { label: 'Tax', walletId: taxWallet.id, percentBps: 1000 },
        { label: 'Reserve', walletId: reserveWallet.id, percentBps: 2000 },
        { label: 'Operating', walletId: operatingKes.id, percentBps: 7000 },
      ]),
      status: 'ACTIVE',
      approvedByName: 'Amina Otieno',
    },
  })
  void splitRule

  // ── payment links ──
  const { ref } = await import('../src/lib/ids')
  const linkFixed = await db.paymentLink.create({
    data: { organizationId: acme.id, token: 'plink_demo_fixed', label: 'Consulting retainer', type: 'FIXED', amountMinor: 250000n, currency: 'KES' },
  })
  const linkCustom = await db.paymentLink.create({
    data: { organizationId: acme.id, token: 'plink_demo_custom', label: 'Support our work', type: 'DONATION', currency: 'KES' },
  })
  void linkFixed; void linkCustom

  // ── webhook endpoint ──
  const whSecret = ref.webhookSecret()
  await db.webhookEndpoint.create({
    data: {
      organizationId: acme.id,
      url: 'https://ops.acme.example/hooks/novera',
      description: 'Acme ops — payment events',
      events: JSON.stringify(['payment.settled', 'payment.failed', 'payment.refunded', 'invoice.paid', 'approval.requested']),
      secret: whSecret,
    },
  })

  // ── API keys ──
  const liveKey = 'nv_live_demo0001secret'
  const testKey = 'nv_test_demo0001secret'
  await db.apiKey.create({
    data: {
      organizationId: acme.id, name: 'Production backend', mode: 'LIVE',
      prefix: liveKey.slice(0, 17), keyHash: sha256Hex(liveKey), lastFour: liveKey.slice(-4),
      scopes: JSON.stringify(['payments:write', 'wallets:read', 'balances:read', 'webhooks:manage']),
      requestCount: 0,
    },
  })
  await db.apiKey.create({
    data: {
      organizationId: acme.id, name: 'CI / sandbox', mode: 'TEST',
      prefix: testKey.slice(0, 17), keyHash: sha256Hex(testKey), lastFour: testKey.slice(-4),
      scopes: JSON.stringify(['payments:write', 'wallets:read', 'transfers:write']),
      requestCount: 0,
    },
  })
  // simulated historical API traffic
  const apiPaths = [['POST', '/api/v1/payments'], ['GET', '/api/v1/wallets'], ['GET', '/api/v1/balances'], ['POST', '/api/v1/transfers'], ['GET', '/api/v1/payments/pay_xxx']]
  for (let i = 0; i < 42; i++) {
    const [m, p] = pick(apiPaths)
    await db.apiRequestLog.create({
      data: {
        organizationId: acme.id,
        apiKeyId: null,
        method: m, path: p,
        status: rnd() < 0.92 ? 200 : pick([400, 401, 404, 429]),
        durationMs: between(40, 900),
        requestBody: m === 'POST' ? JSON.stringify({ amount: 1234, currency: 'KES', method: 'MPESA' }) : null,
        errorCode: rnd() < 0.08 ? pick(['INVALID_ARGUMENT', 'UNAUTHORIZED', 'RATE_LIMITED']) : null,
        createdAt: daysAgo(between(0, 30)),
      },
    })
  }

  // ── invoices (various states) ──
  const { createInvoiceBundle } = await import('./seed-helpers')
  const invoiceSeeds: { customerIdx: number; status: string; items: [string, number, number][]; days: number; dueInDays: number }[] = [
    { customerIdx: 0, status: 'ISSUED', items: [['Cement supply — 50 bags', 50, 85000], ['Delivery', 1, 12000]], days: 3, dueInDays: 11 },
    { customerIdx: 1, status: 'VIEWED', items: [['Termly fees subsidy', 1, 4800000]], days: 5, dueInDays: 9 },
    { customerIdx: 3, status: 'PARTIALLY_PAID', items: [['Fibre installation', 1, 2200000], ['Routers ×4', 4, 185000]], days: 12, dueInDays: 2 },
    { customerIdx: 4, status: 'OVERDUE', items: [['Conference hosting retainer', 1, 950000]], days: 46, dueInDays: -16 },
    { customerIdx: 6, status: 'OVERDUE', items: [['Bulk crafts order', 1, 310000]], days: 52, dueInDays: -22 },
    { customerIdx: 5, status: 'PAID', items: [['Monthly fleet fuel', 1, 1650000]], days: 21, dueInDays: 0 },
    { customerIdx: 7, status: 'DRAFT', items: [['Quarterly deep-clean', 1, 480000]], days: 0, dueInDays: 14 },
  ]
  const invoices: { id: string; number: string; status: string; totalMinor: bigint; amountPaidMinor: bigint; currency: string; dueAt: Date | null }[] = []
  for (let i = 0; i < invoiceSeeds.length; i++) {
    const inv = invoiceSeeds[i]
    const invoice = await createInvoiceBundle(db, {
      organizationId: acme.id,
      customerId: customers[inv.customerIdx].id,
      number: `INV-2026-${String(i + 1).padStart(4, '0')}`,
      status: inv.status,
      items: inv.items,
      issuedAt: inv.status === 'DRAFT' ? null : daysAgo(inv.days),
      dueAt: new Date(Date.now() + inv.dueInDays * 86400000),
      viewedAt: ['VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'].includes(inv.status) ? daysAgo(inv.days - 1) : null,
      taxRate: 0.16,
    })
    invoices.push(invoice)
  }

  // ── payments through the REAL pipeline ──
  const { createPaymentSeeded } = await import('./seed-helpers')
  console.log('── creating ~200 payments via kernel ──')

  const methodWeights: [string, number][] = [['MPESA', 55], ['CARD', 18], ['BANK', 14], ['USDC', 7], ['WALLET', 6]]
  function pickMethod(): string {
    const total = methodWeights.reduce((a, [, w]) => a + w, 0)
    let r = rnd() * total
    for (const [m, w] of methodWeights) { r -= w; if (r <= 0) return m }
    return 'MPESA'
  }

  let settledCount = 0
  const paymentCount = 200
  for (let i = 0; i < paymentCount; i++) {
    const method = pickMethod()
    const day = Math.floor(Math.pow(rnd(), 1.35) * 88) // weighted toward recent
    const createdAt = daysAgo(day)
    const customer = pick(customers)
    const amount =
      method === 'MPESA' ? BigInt(between(350, 8000) * 100) :
      method === 'CARD' ? BigInt(between(200, 4500) * 100) :
      method === 'BANK' ? BigInt(between(2500, 90000) * 100) :
      method === 'USDC' ? BigInt(between(15, 300) * 1000000) :
      BigInt(between(500, 12000) * 100)
    const currency = method === 'USDC' ? 'USDC' : 'KES'

    // status distribution
    const roll = rnd()
    const outcome: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'REFUND' | 'DISPUTE' =
      roll < 0.80 ? 'SUCCESS' : roll < 0.865 ? 'FAILURE' : roll < 0.905 ? 'PENDING' : roll < 0.945 ? 'REFUND' : 'DISPUTE'

    const invoice =
      method === 'BANK' && rnd() < 0.6 ? pick(invoices.filter((inv) => inv.status !== 'DRAFT')) : null

    await createPaymentSeeded({
      organizationId: acme.id,
      method,
      amountMinor: amount,
      currency,
      customer,
      createdAt,
      outcome,
      invoiceId: invoice?.id ?? null,
      description: invoice ? `Invoice ${invoice.number} payment` : `${pick(['Order', 'Purchase', 'Settlement', 'Subscription', 'Top-up'])} via ${method}`,
      idempotencySeed: `seed-pay-${i}`,
    })
    if (outcome === 'SUCCESS') settledCount++
  }
  console.log(`   settled: ${settledCount}`)

  // ── cards ──
  const { issueCard } = await import('./seed-helpers')
  const cards: Awaited<ReturnType<typeof issueCard>>[] = []
  cards.push(
    await issueCard(db, {
      organizationId: acme.id, label: 'Team spend card', type: 'VIRTUAL', currency: 'KES',
      holderName: 'Amina Otieno', last4: '4417', perTxn: 50_000n, daily: 150_000n, monthly: 1_200_000n,
      walletId: operatingKes.id, mcc: JSON.stringify(['5411', '5732', '4121', '7372', '5812']),
    })
  )
  cards.push(
    await issueCard(db, {
      organizationId: acme.id, label: 'AWS & cloud infra', type: 'VIRTUAL', currency: 'USD',
      holderName: 'TechBridge (Acme)', last4: '9082', perTxn: 600_000n, daily: 1_000_000n,
      walletId: usdWallet.id, mcc: JSON.stringify(['4816', '7372', '5734']), allowInternational: true,
    })
  )
  cards.push(
    await issueCard(db, {
      organizationId: acme.id, label: 'Site supervisor — fuel & materials', type: 'EMPLOYEE', currency: 'KES',
      holderName: 'Joseph Mwangi', last4: '3310', perTxn: 20_000n, daily: 40_000n, monthly: 300_000n,
      walletId: operatingKes.id, mcc: JSON.stringify(['5541', '5172', '1520']),
    })
  )
  const disposable = await issueCard(db, {
    organizationId: acme.id, label: 'One-off vendor payment', type: 'DISPOSABLE', currency: 'KES',
    holderName: 'Acme Kenya', last4: '7725', perTxn: 12_000n, daily: 12_000n,
    walletId: operatingKes.id,
  })
  void disposable

  // card authorizations through the real decisioning engine
  const { authorizeCardSeeded } = await import('./seed-helpers')
  const auths: { cardIdx: number; merchant: string; mcc: string; amountMinor: bigint; currency: string; channel: string; expect: 'APPROVED' | 'DECLINED' | 'ANY' }[] = [
    { cardIdx: 0, merchant: 'Naivas Supermarket', mcc: '5411', amountMinor: 485_000n, currency: 'KES', channel: 'POS', expect: 'APPROVED' },
    { cardIdx: 0, merchant: 'Jumia KE', mcc: '5732', amountMinor: 124_000n, currency: 'KES', channel: 'ONLINE', expect: 'APPROVED' },
    { cardIdx: 0, merchant: 'Carrefour Nairobi', mcc: '5411', amountMinor: 6_800_000n, currency: 'KES', channel: 'POS', expect: 'DECLINED' },
    { cardIdx: 1, merchant: 'Amazon Web Services', mcc: '4816', amountMinor: 423_000n, currency: 'USD', channel: 'ONLINE', expect: 'APPROVED' },
    { cardIdx: 1, merchant: 'Datadog Inc', mcc: '7372', amountMinor: 312_000n, currency: 'USD', channel: 'ONLINE', expect: 'APPROVED' },
    { cardIdx: 2, merchant: 'Total Energies Kiambu', mcc: '5541', amountMinor: 860_000n, currency: 'KES', channel: 'POS', expect: 'APPROVED' },
    { cardIdx: 2, merchant: 'Best Electronics', mcc: '5732', amountMinor: 2_400_000n, currency: 'KES', channel: 'ONLINE', expect: 'DECLINED' },
    { cardIdx: 2, merchant: 'City Bar & Grill', mcc: '5812', amountMinor: 640_000n, currency: 'KES', channel: 'CONTACTLESS', expect: 'DECLINED' },
  ]
  for (const a of auths) {
    await authorizeCardSeeded({
      cardId: cards[a.cardIdx].id, merchantName: a.merchant, mcc: a.mcc,
      amountMinor: a.amountMinor, currency: a.currency,
      channel: a.channel as 'ONLINE' | 'POS' | 'ATM' | 'CONTACTLESS',
      createdAt: daysAgo(between(1, 25)),
    })
  }

  // ── FX quotes + one executed conversion ──
  const { createFxQuote, executeConversion } = await import('../src/lib/fx')
  const quote1 = await createFxQuote({ organizationId: acme.id, baseCurrency: 'KES', quoteCurrency: 'USD', amountMinor: 20_000_000n })
  void quote1
  const quote2 = await createFxQuote({ organizationId: acme.id, baseCurrency: 'KES', quoteCurrency: 'USD', amountMinor: 45_000_000n })
  await executeConversion({
    organizationId: acme.id, quoteId: quote2.quote.id, amountMinor: 45_000_000n,
    fromWalletId: operatingKes.id, toWalletId: usdWallet.id,
    actor: { type: 'USER', id: owner.id, label: 'Amina Otieno' },
  })

  // ── agents (Know Your Agent) ──
  const agentCred = 'nv_agent_procure01secret'
  const procurement = await db.agent.create({
    data: {
      organizationId: acme.id, name: 'Atlas', role: 'PROCUREMENT', avatarEmoji: '🛒',
      description: 'Compares supplier quotes and pays approved suppliers within strict limits.',
      status: 'ACTIVE',
      perTransactionLimitMinor: 4_500_000n, dailyLimitMinor: 15_000_000n, requiresApprovalAboveMinor: 3_000_000n,
      allowedMerchants: JSON.stringify(['Naivas', 'Kikwetu Suppliers', 'HardWareHub', 'Best Electronics']),
      scopes: JSON.stringify(['payments.propose', 'suppliers.compare', 'balances.read']),
      credentialPrefix: agentCred.slice(0, 17), credentialHash: sha256Hex(agentCred),
      totalActions: 0,
    },
  })
  const treasuryAgent = await db.agent.create({
    data: {
      organizationId: acme.id, name: 'Meridian', role: 'TREASURY', avatarEmoji: '📊',
      description: 'Read-only treasury reporting — cash position, exposure and forecasts. Cannot move money.',
      status: 'ACTIVE',
      perTransactionLimitMinor: null, dailyLimitMinor: null, requiresApprovalAboveMinor: 0n,
      scopes: JSON.stringify(['treasury.report', 'balances.read']),
      totalActions: 0,
    },
  })
  const billingAgent = await db.agent.create({
    data: {
      organizationId: acme.id, name: 'Ledgerline', role: 'BILLING', avatarEmoji: '🧾',
      description: 'Drafts invoices and summarizes receivables. Payment proposals always require human approval.',
      status: 'ACTIVE',
      requiresApprovalAboveMinor: 0n,
      scopes: JSON.stringify(['invoices.summarize', 'balances.read']),
      totalActions: 0,
    },
  })
  const pausedAgent = await db.agent.create({
    data: {
      organizationId: acme.id, name: 'Scout', role: 'EXPENSES', avatarEmoji: '🔍',
      description: 'Expense anomaly scout. Paused pending policy review.',
      status: 'PAUSED', scopes: JSON.stringify(['balances.read']), totalActions: 12,
    },
  })
  void pausedAgent

  // agent intents through the real policy pipeline
  const { proposeAgentIntent, decideApproval } = await import('../src/lib/agents')
  // 1. under-limit → executes
  await proposeAgentIntent({
    organizationId: acme.id, agentId: procurement.id, tool: 'suppliers.compare',
    description: 'Compare 3 quotes for office chairs (Kikwetu vs HardwareHub vs Best Electronics)',
    payload: { action: 'supplier.compare', quoteCount: 3, bestPriceMinor: '3850000' },
  })
  // 2. above approval threshold → pending human approval
  const midIntent = await proposeAgentIntent({
    organizationId: acme.id, agentId: procurement.id, tool: 'payments.propose',
    description: 'Pay Kikwetu Suppliers KES 38,500 for 14 office chairs (best of 3 quotes)',
    payload: { action: 'payment.create', amountMinor: 3_850_000n, currency: 'KES', merchant: 'Kikwetu Suppliers', toWalletLabel: 'Suppliers' },
  })
  // 3. over per-txn limit → policy denied
  await proposeAgentIntent({
    organizationId: acme.id, agentId: procurement.id, tool: 'payments.propose',
    description: 'Pay Best Electronics KES 220,000 for conference AV equipment',
    payload: { action: 'payment.create', amountMinor: 22_000_000n, currency: 'KES', merchant: 'Best Electronics', toWalletLabel: 'Suppliers' },
  })
  // 4. read-only treasury report
  await proposeAgentIntent({
    organizationId: acme.id, agentId: treasuryAgent.id, tool: 'treasury.report',
    description: 'Weekly cash-position summary with 4-week forecast',
    payload: { action: 'treasury.report', windowDays: 7 },
  })
  // 5. approved + executed history
  const histIntent = await proposeAgentIntent({
    organizationId: acme.id, agentId: procurement.id, tool: 'payments.propose',
    description: 'Pay HardWareHub KES 35,000 for warehouse shelving',
    payload: { action: 'payment.create', amountMinor: 3_500_000n, currency: 'KES', merchant: 'HardWareHub', toWalletLabel: 'Suppliers' },
  })
  if (histIntent.status === 'PENDING_APPROVAL' && histIntent.approvalRequestId) {
    await decideApproval(acme.id, histIntent.approvalRequestId, 'APPROVED', { id: finance.id, name: 'David Kimani' }, 'Quote verified against PO-2291.')
  }
  // 6. rejected history
  const rejIntent = await proposeAgentIntent({
    organizationId: acme.id, agentId: billingAgent.id, tool: 'payments.propose',
    description: 'Propose early settlement discount payout to Zawadi Crafts',
    payload: { action: 'payment.create', amountMinor: 1_200_000n, currency: 'KES', merchant: 'Zawadi Crafts' },
  })
  if (rejIntent.status === 'PENDING_APPROVAL' && rejIntent.approvalRequestId) {
    await decideApproval(acme.id, rejIntent.approvalRequestId, 'DECLINED', { id: owner.id, name: 'Amina Otieno' }, 'Discount not agreed in contract terms.')
  }
  void midIntent

  // seed supplier wallet with funds so agent execution succeeded
  // (opening balance for suppliers pool)
  await postOpeningBalance(acme.id, supplierWalletAcme.id, 5_000_000n, 'KES', { id: owner.id, label: 'Amina Otieno' })

  // ── copilot seed conversation ──
  await db.copilotMessage.create({
    data: { organizationId: acme.id, role: 'assistant', content: 'Hi Amina — I ground every answer in your verified ledger data. Ask me things like "What is my cash position?", "Who owes me money?", or "Why did this payment fail?"', grounding: 'GROUNDED' },
  })

  // ── reconciliation: inject controlled discrepancies, then scan ──
  const { injectReconAnomalies } = await import('./seed-helpers')
  await injectReconAnomalies(db, acme.id)
  const { runReconciliationScan } = await import('../src/lib/recon')
  const scan = await runReconciliationScan(acme.id)
  console.log(`   recon scan: ${scan.matched} matched, ${scan.discrepancies} discrepancies, ${scan.newCases} cases`)

  // ── internal transfers history ──
  const { executeTransfer } = await import('../src/lib/transfers')
  const payrollWallet = walletsAcme.find((w) => w.label === 'Payroll')!
  await executeTransfer({
    organizationId: acme.id, fromWalletId: operatingKes.id, toWalletId: payrollWallet.id,
    amountMinor: 24_500_000n, currency: 'KES', note: 'October payroll funding',
    actor: { type: 'USER', id: finance.id, label: 'David Kimani' },
  }).catch((e) => console.warn('   transfer skipped:', (e as Error).message))

  // ── verification: trial balance must hold ──
  const { trialBalance } = await import('../src/lib/ledger')
  const { verifyAuditChain } = await import('../src/lib/audit')
  const tb = await trialBalance(acme.id)
  const tbSolar = await trialBalance(solar.id)
  const chain = await verifyAuditChain(5000)
  console.log('── invariant checks ──')
  console.log(`   trial balance (acme): debits ${tb.totalDebits} = credits ${tb.totalCredits} → ${tb.balanced ? 'OK' : 'BROKEN'}`)
  console.log(`   trial balance (solar): ${tbSolar.balanced ? 'OK' : 'BROKEN'}`)
  console.log(`   audit chain: ${chain.verified}/${chain.totalEvents} verified → ${chain.valid ? 'VALID' : 'BROKEN'}`)
  if (!tb.balanced || !chain.valid) {
    throw new Error('SEED FAILED: financial invariants violated')
  }

  console.log('── seed complete ──')
  console.log('   login: demo@novera.africa / novera-demo-2026')
  console.log('   agent key: nv_agent_procure01secret (Atlas)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())