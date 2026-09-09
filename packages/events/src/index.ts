/**
 * @novera/events — Domain event catalog.
 *
 * Every financial operation emits events. In the reference build these
 * drive the audit trail, webhook deliveries and the ops feed; in the
 * production architecture they are published to NATS JetStream with
 * durable consumers (and long-running flows orchestrated by Temporal).
 */

export interface DomainEventMeta {
  name: string
  channel: string // e.g. payments | ledger | cards | invoices | agents | risk | platform
  description: string
  payloadFields: string[]
}

export const DOMAIN_EVENTS: DomainEventMeta[] = [
  {
    name: 'wallet.created',
    channel: 'wallets',
    description: 'A new wallet was provisioned with its ledger account.',
    payloadFields: ['walletId', 'organizationId', 'currency', 'type'],
  },
  {
    name: 'payment.created',
    channel: 'payments',
    description: 'A payment intent was created.',
    payloadFields: ['paymentId', 'reference', 'amountMinor', 'currency', 'method'],
  },
  {
    name: 'payment.authorized',
    channel: 'payments',
    description: 'Risk and policy checks passed; the payment is authorized.',
    payloadFields: ['paymentId', 'reference', 'riskDecision', 'riskScore'],
  },
  {
    name: 'payment.processing',
    channel: 'payments',
    description: 'The payment was submitted to the external rail.',
    payloadFields: ['paymentId', 'reference', 'providerCode', 'providerReference'],
  },
  {
    name: 'payment.settled',
    channel: 'payments',
    description: 'The rail confirmed settlement; ledger posting completed.',
    payloadFields: ['paymentId', 'reference', 'settledAt', 'ledgerTransactionRef'],
  },
  {
    name: 'payment.failed',
    channel: 'payments',
    description: 'The payment failed; reason attached.',
    payloadFields: ['paymentId', 'reference', 'failureReason'],
  },
  {
    name: 'payment.refunded',
    channel: 'payments',
    description: 'A refund was executed against a settled payment.',
    payloadFields: ['paymentId', 'reference', 'refundedMinor'],
  },
  {
    name: 'ledger.transaction.posted',
    channel: 'ledger',
    description: 'A balanced double-entry transaction was posted.',
    payloadFields: ['transactionRef', 'source', 'amountMinor', 'currency', 'entryCount'],
  },
  {
    name: 'ledger.transaction.reversed',
    channel: 'ledger',
    description: 'A posted transaction was reversed by a compensating entry.',
    payloadFields: ['originalRef', 'reversalRef', 'reason'],
  },
  {
    name: 'transfer.executed',
    channel: 'payments',
    description: 'An internal wallet-to-wallet transfer completed.',
    payloadFields: ['transactionRef', 'fromWalletId', 'toWalletId', 'amountMinor', 'currency'],
  },
  {
    name: 'invoice.issued',
    channel: 'invoices',
    description: 'An invoice was issued to a customer.',
    payloadFields: ['invoiceId', 'number', 'totalMinor', 'currency', 'dueAt'],
  },
  {
    name: 'invoice.paid',
    channel: 'invoices',
    description: 'An invoice reached fully-paid state.',
    payloadFields: ['invoiceId', 'number', 'amountPaidMinor', 'currency'],
  },
  {
    name: 'card.created',
    channel: 'cards',
    description: 'A card was issued (tokenized, PAN never stored).',
    payloadFields: ['cardId', 'type', 'last4', 'currency'],
  },
  {
    name: 'card.authorization.approved',
    channel: 'cards',
    description: 'A card authorization was approved by the risk + policy stack.',
    payloadFields: ['cardId', 'authId', 'amountMinor', 'merchantName'],
  },
  {
    name: 'card.authorization.declined',
    channel: 'cards',
    description: 'A card authorization was declined; reason attached.',
    payloadFields: ['cardId', 'authId', 'declineReason'],
  },
  {
    name: 'agent.intent.proposed',
    channel: 'agents',
    description: 'An AI agent proposed a financial intent.',
    payloadFields: ['agentId', 'intentId', 'tool', 'amountMinor?'],
  },
  {
    name: 'agent.intent.executed',
    channel: 'agents',
    description: 'A policy-approved agent intent was executed on the ledger.',
    payloadFields: ['agentId', 'intentId', 'ledgerTransactionRef'],
  },
  {
    name: 'approval.requested',
    channel: 'agents',
    description: 'A human approval was requested for a financial action.',
    payloadFields: ['approvalId', 'action', 'amountMinor?'],
  },
  {
    name: 'approval.decided',
    channel: 'agents',
    description: 'A human decided an approval request.',
    payloadFields: ['approvalId', 'decision', 'decidedBy'],
  },
  {
    name: 'risk.review.created',
    channel: 'risk',
    description: 'A transaction entered manual review.',
    payloadFields: ['evaluationId', 'subject', 'score'],
  },
  {
    name: 'reconciliation.mismatch.detected',
    channel: 'reconciliation',
    description: 'A discrepancy was detected between ledger and provider records.',
    payloadFields: ['caseId', 'type', 'providerCode'],
  },
  {
    name: 'splitrule.executed',
    channel: 'programmable',
    description: 'A programmable split rule executed on a settled payment.',
    payloadFields: ['ruleId', 'paymentId', 'allocations'],
  },
  {
    name: 'fx.conversion.executed',
    channel: 'treasury',
    description: 'A currency conversion executed at a locked rate.',
    payloadFields: ['quoteId', 'fromCurrency', 'toCurrency', 'rateScaled'],
  },
]

export const EVENT_NAMES = DOMAIN_EVENTS.map((e) => e.name)

export function isDomainEvent(name: string): boolean {
  return EVENT_NAMES.includes(name)
}
