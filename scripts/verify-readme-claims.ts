/**
 * Investor-README claim verification.
 * Runs against the seeded sandbox DB and re-derives the numbers the README
 * states, using the SHIPPED verifier (src/lib/audit.ts → verifyAuditChain)
 * so nothing in the README is aspirational.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const [
    orgs, users, wallets, customers, payments, paymentLinks, agents, intents,
    approvals, cards, cardAuths, invoices, rules, ruleExecs, policies,
    riskRules, riskEvals, apiKeys, apiLogs, webhooks, deliveries, fxQuotes,
    txns, entries, reconCases, auditEvents,
  ] = await Promise.all([
    db.organization.count(), db.user.count(), db.wallet.count(), db.customer.count(),
    db.payment.count(), db.paymentLink.count(), db.agent.count(), db.agentIntent.count(),
    db.approvalRequest.count(), db.card.count(), db.cardAuthorization.count(),
    db.invoice.count(), db.splitRule.count(), db.splitRuleExecution.count(), db.policy.count(),
    db.riskRule.count(), db.riskEvaluation.count(), db.apiKey.count(), db.apiRequestLog.count(),
    db.webhookEndpoint.count(), db.webhookDelivery.count(), db.fxQuote.count(),
    db.ledgerTransaction.count(), db.ledgerEntry.count(), db.reconciliationCase.count(),
    db.auditEvent.count(),
  ])

  // Trial balance per currency: SUM(debits) must equal SUM(credits)
  const grouped = await db.ledgerEntry.groupBy({
    by: ['currency', 'direction'],
    _sum: { amountMinor: true },
  })
  const perCurrency: Record<string, { debit: bigint; credit: bigint }> = {}
  for (const g of grouped) {
    perCurrency[g.currency] ??= { debit: 0n, credit: 0n }
    perCurrency[g.currency][g.direction === 'DEBIT' ? 'debit' : 'credit'] += g._sum.amountMinor ?? 0n
  }
  const trial = Object.entries(perCurrency).map(([cur, v]) => ({
    currency: cur, balanced: v.debit === v.credit,
    debit: v.debit.toString(), credit: v.credit.toString(),
  }))

  // Use the shipped verifier (same code path the /audit UI uses)
  const { verifyAuditChain } = await import('../src/lib/audit')
  const chain = await verifyAuditChain(100000)

  console.log(JSON.stringify({
    counts: {
      orgs, users, wallets, customers, payments, paymentLinks, agents, agentIntents: intents,
      approvals, cards, cardAuths, invoices, splitRules: rules, ruleExecs, policies,
      riskRules, riskEvals, apiKeys, apiLogs, webhooks, deliveries, fxQuotes,
      ledgerTransactions: txns, ledgerEntries: entries, reconCases, auditEvents,
    },
    trialBalance: trial,
    allCurrenciesBalanced: trial.every((b) => b.balanced),
    auditChain: chain,
  }, null, 2))

  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
