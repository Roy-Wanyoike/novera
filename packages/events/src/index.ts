/**
 * @novera/events — Domain event catalog.
 *
 * The catalog is the subscribable webhook/audit vocabulary. In the
 * reference build only events with `emitted: true` are actually emitted
 * (via emitWebhookEvent in src/lib/webhooks.ts — simulated TEST-mode
 * delivery, no HTTP); entries marked `emitted: false` are part of the
 * vocabulary but no code path fires them yet. In the production
 * architecture events are published to NATS JetStream with durable
 * consumers (and long-running flows orchestrated by Temporal).
 */

export interface DomainEventMeta {
  name: string
  channel: string // e.g. payments | ledger | cards | invoices | agents | risk | platform
  description: string
  payloadFields: string[]
  /**
   * Whether the reference build actually emits this event as a webhook
   * (emitWebhookEvent → WebhookDelivery rows). `false` = subscribable in
   * the catalog but not yet emitted by any code path — "not yet emitted
   * by the reference build". Optional for backward compatibility;
   * existing consumers that don't read the field are unaffected.
   */
  emitted?: boolean
}

export const DOMAIN_EVENTS: DomainEventMeta[] = [
  {
    name: 'wallet.created',
    channel: 'wallets',
    description: 'A new wallet was provisioned with its ledger account.',
    payloadFields: ['walletId', 'organizationId', 'currency', 'type'],
    emitted: false,
  },
  {
    name: 'payment.created',
    channel: 'payments',
    description: 'A payment intent was created.',
    payloadFields: ['paymentId', 'reference', 'amountMinor', 'currency', 'method'],
    emitted: false,
  },
  {
    name: 'payment.authorized',
    channel: 'payments',
    description: 'Risk and policy checks passed; the payment is authorized.',
    payloadFields: ['paymentId', 'reference', 'riskDecision', 'riskScore'],
    emitted: false,
  },
  {
    name: 'payment.processing',
    channel: 'payments',
    description: 'The payment was submitted to the external rail.',
    payloadFields: ['paymentId', 'reference', 'providerCode', 'providerReference'],
    emitted: false,
  },
  {
    name: 'payment.settled',
    channel: 'payments',
    description: 'The rail confirmed settlement; ledger posting completed.',
    payloadFields: ['paymentId', 'reference', 'settledAt', 'ledgerTransactionRef'],
    emitted: true,
  },
  {
    name: 'payment.failed',
    channel: 'payments',
    description: 'The payment failed; reason attached.',
    payloadFields: ['paymentId', 'reference', 'failureReason'],
    emitted: true,
  },
  {
    name: 'payment.refunded',
    channel: 'payments',
    description: 'A refund was executed against a settled payment.',
    payloadFields: ['paymentId', 'reference', 'refundedMinor'],
    emitted: true,
  },
  {
    name: 'ledger.transaction.posted',
    channel: 'ledger',
    description: 'A balanced double-entry transaction was posted.',
    payloadFields: ['transactionRef', 'source', 'amountMinor', 'currency', 'entryCount'],
    emitted: false,
  },
  {
    name: 'ledger.transaction.reversed',
    channel: 'ledger',
    description: 'A posted transaction was reversed by a compensating entry.',
    payloadFields: ['originalRef', 'reversalRef', 'reason'],
    emitted: false,
  },
  {
    name: 'transfer.executed',
    channel: 'payments',
    description: 'An internal wallet-to-wallet transfer completed.',
    payloadFields: ['transactionRef', 'fromWalletId', 'toWalletId', 'amountMinor', 'currency'],
    emitted: true,
  },
  {
    name: 'invoice.issued',
    channel: 'invoices',
    description: 'An invoice was issued to a customer.',
    payloadFields: ['invoiceId', 'number', 'totalMinor', 'currency', 'dueAt'],
    emitted: false,
  },
  {
    name: 'invoice.paid',
    channel: 'invoices',
    description: 'An invoice reached fully-paid state.',
    payloadFields: ['invoiceId', 'number', 'amountPaidMinor', 'currency'],
    emitted: true,
  },
  {
    name: 'card.created',
    channel: 'cards',
    description: 'A card was issued (tokenized, PAN never stored).',
    payloadFields: ['cardId', 'type', 'last4', 'currency'],
    emitted: false,
  },
  {
    name: 'card.authorization.approved',
    channel: 'cards',
    description: 'A card authorization was approved by the risk + policy stack.',
    payloadFields: ['cardId', 'authId', 'amountMinor', 'merchantName'],
    emitted: true,
  },
  {
    name: 'card.authorization.declined',
    channel: 'cards',
    description: 'A card authorization was declined; reason attached.',
    payloadFields: ['cardId', 'authId', 'declineReason'],
    emitted: true,
  },
  {
    name: 'agent.intent.proposed',
    channel: 'agents',
    description: 'An AI agent proposed a financial intent.',
    payloadFields: ['agentId', 'intentId', 'tool', 'amountMinor?'],
    emitted: false,
  },
  {
    name: 'agent.intent.executed',
    channel: 'agents',
    description: 'A policy-approved agent intent was executed on the ledger.',
    payloadFields: ['agentId', 'intentId', 'ledgerTransactionRef'],
    emitted: true,
  },
  {
    name: 'approval.requested',
    channel: 'agents',
    description: 'A human approval was requested for a financial action.',
    payloadFields: ['approvalId', 'action', 'amountMinor?'],
    emitted: true,
  },
  {
    name: 'approval.decided',
    channel: 'agents',
    description: 'A human decided an approval request.',
    payloadFields: ['approvalId', 'decision', 'decidedBy'],
    emitted: true,
  },
  {
    name: 'risk.review.created',
    channel: 'risk',
    description: 'A transaction entered manual review.',
    payloadFields: ['evaluationId', 'subject', 'score'],
    emitted: false,
  },
  {
    name: 'reconciliation.mismatch.detected',
    channel: 'reconciliation',
    description: 'A discrepancy was detected between ledger and provider records.',
    payloadFields: ['caseId', 'type', 'providerCode'],
    emitted: false,
  },
  {
    name: 'splitrule.executed',
    channel: 'programmable',
    description: 'A programmable split rule executed on a settled payment.',
    payloadFields: ['ruleId', 'paymentId', 'allocations'],
    emitted: true,
  },
  {
    name: 'fx.conversion.executed',
    channel: 'treasury',
    description: 'A currency conversion executed at a locked rate.',
    payloadFields: ['quoteId', 'fromCurrency', 'toCurrency', 'rateScaled'],
    emitted: true,
  },
]

export const EVENT_NAMES = DOMAIN_EVENTS.map((e) => e.name)

export function isDomainEvent(name: string): boolean {
  return EVENT_NAMES.includes(name)
}
