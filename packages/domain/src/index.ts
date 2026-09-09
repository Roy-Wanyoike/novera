/**
 * @novera/domain — Shared domain vocabulary.
 *
 * The SQLite reference build stores status fields as strings; this package
 * is the single source of truth for the legal values, the legal state
 * transitions, and the presentation metadata used across the UI.
 */

import type { CurrencyCode } from '@novera/money'

// ── Payment lifecycle ────────────────────────────────────────────────

export const PAYMENT_STATUSES = [
  'CREATED', 'AUTHORIZED', 'PROCESSING', 'PENDING', 'SETTLED',
  'FAILED', 'CANCELLED', 'REFUNDED', 'REVERSED', 'DISPUTED',
] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ['AUTHORIZED', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['PROCESSING', 'FAILED', 'CANCELLED', 'REVERSED'],
  PROCESSING: ['PENDING', 'SETTLED', 'FAILED'],
  PENDING: ['SETTLED', 'FAILED', 'REVERSED'],
  SETTLED: ['REFUNDED', 'DISPUTED', 'REVERSED'],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: ['REVERSED'],
  REVERSED: [],
  DISPUTED: ['REVERSED', 'REFUNDED'],
}

export const PAYMENT_METHODS = ['MPESA', 'BANK', 'CARD', 'WALLET', 'USDC'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const RAIL_TYPES = ['MOBILE_MONEY', 'BANK', 'CARD', 'CRYPTO', 'INTERNAL', 'FX'] as const
export type RailType = (typeof RAIL_TYPES)[number]

// ── Ledger ───────────────────────────────────────────────────────────

export const LEDGER_TXN_SOURCES = [
  'TRANSFER', 'PAYMENT', 'PAYOUT', 'FX_CONVERSION', 'SPLIT_RULE', 'AGENT',
  'CARD_AUTH', 'ADJUSTMENT', 'REVERSAL', 'FEE', 'OPENING',
] as const
export type LedgerTxnSource = (typeof LEDGER_TXN_SOURCES)[number]

export const LEDGER_ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number]

export const HOLD_STATUSES = ['ACTIVE', 'CAPTURED', 'RELEASED', 'EXPIRED'] as const
export type HoldStatus = (typeof HOLD_STATUSES)[number]

// ── Wallets ──────────────────────────────────────────────────────────

export const WALLET_TYPES = [
  'OPERATING', 'TAX', 'RESERVE', 'PAYROLL', 'PROJECT', 'SUPPLIER', 'AGENT', 'SETTLEMENT', 'PERSONAL',
] as const
export type WalletType = (typeof WALLET_TYPES)[number]

export const WALLET_STATUS = ['ACTIVE', 'FROZEN', 'ARCHIVED'] as const

// ── Invoices ─────────────────────────────────────────────────────────

export const INVOICE_STATUSES = [
  'DRAFT', 'ISSUED', 'VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED',
] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['ISSUED', 'CANCELLED'],
  ISSUED: ['VIEWED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
  VIEWED: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE', 'CANCELLED'],
  PAID: [],
  OVERDUE: ['PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  CANCELLED: [],
}

// ── Cards ────────────────────────────────────────────────────────────

export const CARD_TYPES = ['VIRTUAL', 'DISPOSABLE', 'PHYSICAL', 'EMPLOYEE', 'PROJECT', 'AGENT'] as const
export type CardType = (typeof CARD_TYPES)[number]

export const CARD_STATUSES = [
  'REQUESTED', 'CREATED', 'PROVISIONING', 'ACTIVE', 'FROZEN', 'LOST', 'STOLEN', 'EXPIRED', 'TERMINATED',
] as const
export type CardStatus = (typeof CARD_STATUSES)[number]

export const CARD_TRANSITIONS: Record<CardStatus, CardStatus[]> = {
  REQUESTED: ['CREATED', 'TERMINATED'],
  CREATED: ['PROVISIONING', 'TERMINATED'],
  PROVISIONING: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['FROZEN', 'LOST', 'STOLEN', 'EXPIRED', 'TERMINATED'],
  FROZEN: ['ACTIVE', 'TERMINATED'],
  LOST: ['TERMINATED'],
  STOLEN: ['TERMINATED'],
  EXPIRED: [],
  TERMINATED: [],
}

export const CARD_AUTH_CHANNELS = ['ONLINE', 'POS', 'ATM', 'CONTACTLESS'] as const

// ── Agents (Know Your Agent) ─────────────────────────────────────────

export const AGENT_ROLES = ['PROCUREMENT', 'TREASURY', 'EXPENSES', 'BILLING', 'ANALYST', 'CUSTOM'] as const
export type AgentRole = (typeof AGENT_ROLES)[number]

export const AGENT_STATUSES = ['ACTIVE', 'PAUSED', 'REVOKED'] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

export const AGENT_INTENT_STATUSES = [
  'PROPOSED', 'POLICY_DENIED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED', 'EXECUTION_FAILED',
] as const
export type AgentIntentStatus = (typeof AGENT_INTENT_STATUSES)[number]

export const AGENT_TOOLS = [
  'payments.propose',
  'transfers.propose',
  'suppliers.compare',
  'treasury.report',
  'balances.read',
  'invoices.summarize',
] as const
export type AgentTool = (typeof AGENT_TOOLS)[number]

export const APPROVAL_ACTIONS = [
  'AGENT_PAYMENT', 'TRANSFER', 'CARD_ISSUANCE', 'POLICY_CHANGE', 'SPLIT_RULE_CHANGE', 'KEY_ROTATION',
] as const

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'DECLINED', 'EXPIRED'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

// ── Risk ─────────────────────────────────────────────────────────────

export const RISK_DECISIONS = ['ALLOW', 'REVIEW', 'DECLINE'] as const
export type RiskDecision = (typeof RISK_DECISIONS)[number]

// ── Reconciliation ───────────────────────────────────────────────────

export const RECON_CASE_TYPES = [
  'MISSING_AT_PROVIDER', 'MISSING_IN_LEDGER', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH',
  'STATUS_MISMATCH', 'LATE_SETTLEMENT', 'UNKNOWN_REFERENCE', 'DUPLICATE',
] as const
export type ReconCaseType = (typeof RECON_CASE_TYPES)[number]

export const RECON_CASE_STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'] as const

// ── Programmable money ───────────────────────────────────────────────

export const SPLIT_TRIGGERS = ['PAYMENT_RECEIVED', 'INVOICE_PAID', 'MANUAL'] as const
export type SplitTrigger = (typeof SPLIT_TRIGGERS)[number]

// ── Roles & modes ────────────────────────────────────────────────────

export const ORG_ROLES = ['OWNER', 'ADMIN', 'FINANCE', 'DEVELOPER', 'MEMBER', 'VIEWER'] as const
export type OrgRole = (typeof ORG_ROLES)[number]

export const ENV_MODES = ['TEST', 'LIVE'] as const
export type EnvMode = (typeof ENV_MODES)[number]

// ── Presentation metadata (status → label/tone) ─────────────────────
// tone: 'positive' | 'warning' | 'negative' | 'neutral' | 'info' | 'accent'

export interface StatusMeta { label: string; tone: string }

const tone = (label: string, t: string): StatusMeta => ({ label, tone: t })

export const PAYMENT_STATUS_META: Record<string, StatusMeta> = {
  CREATED: tone('Created', 'neutral'),
  AUTHORIZED: tone('Authorized', 'info'),
  PROCESSING: tone('Processing', 'info'),
  PENDING: tone('Pending', 'warning'),
  SETTLED: tone('Settled', 'positive'),
  FAILED: tone('Failed', 'negative'),
  CANCELLED: tone('Cancelled', 'neutral'),
  REFUNDED: tone('Refunded', 'warning'),
  REVERSED: tone('Reversed', 'warning'),
  DISPUTED: tone('Disputed', 'negative'),
}

export const INVOICE_STATUS_META: Record<string, StatusMeta> = {
  DRAFT: tone('Draft', 'neutral'),
  ISSUED: tone('Issued', 'info'),
  VIEWED: tone('Viewed', 'info'),
  PARTIALLY_PAID: tone('Partially paid', 'warning'),
  PAID: tone('Paid', 'positive'),
  OVERDUE: tone('Overdue', 'negative'),
  CANCELLED: tone('Cancelled', 'neutral'),
}

export const CARD_STATUS_META: Record<string, StatusMeta> = {
  REQUESTED: tone('Requested', 'neutral'),
  CREATED: tone('Created', 'neutral'),
  PROVISIONING: tone('Provisioning', 'info'),
  ACTIVE: tone('Active', 'positive'),
  FROZEN: tone('Frozen', 'warning'),
  LOST: tone('Lost', 'negative'),
  STOLEN: tone('Stolen', 'negative'),
  EXPIRED: tone('Expired', 'neutral'),
  TERMINATED: tone('Terminated', 'neutral'),
}

export const AGENT_STATUS_META: Record<string, StatusMeta> = {
  ACTIVE: tone('Active', 'positive'),
  PAUSED: tone('Paused', 'warning'),
  REVOKED: tone('Revoked', 'negative'),
}

export const AGENT_INTENT_STATUS_META: Record<string, StatusMeta> = {
  PROPOSED: tone('Proposed', 'info'),
  POLICY_DENIED: tone('Policy denied', 'negative'),
  PENDING_APPROVAL: tone('Awaiting approval', 'warning'),
  APPROVED: tone('Approved', 'info'),
  EXECUTED: tone('Executed', 'positive'),
  REJECTED: tone('Rejected', 'negative'),
  EXECUTION_FAILED: tone('Execution failed', 'negative'),
}

export const APPROVAL_STATUS_META: Record<string, StatusMeta> = {
  PENDING: tone('Pending', 'warning'),
  APPROVED: tone('Approved', 'positive'),
  DECLINED: tone('Declined', 'negative'),
  EXPIRED: tone('Expired', 'neutral'),
}

export const RISK_DECISION_META: Record<string, StatusMeta> = {
  ALLOW: tone('Allowed', 'positive'),
  REVIEW: tone('Review', 'warning'),
  DECLINE: tone('Declined', 'negative'),
}

export const RECON_STATUS_META: Record<string, StatusMeta> = {
  OPEN: tone('Open', 'warning'),
  INVESTIGATING: tone('Investigating', 'info'),
  RESOLVED: tone('Resolved', 'positive'),
  DISMISSED: tone('Dismissed', 'neutral'),
}

export const WALLET_TYPE_META: Record<string, StatusMeta> = {
  OPERATING: tone('Operating', 'accent'),
  TAX: tone('Tax', 'warning'),
  RESERVE: tone('Reserve', 'info'),
  PAYROLL: tone('Payroll', 'info'),
  PROJECT: tone('Project', 'accent'),
  SUPPLIER: tone('Supplier', 'neutral'),
  AGENT: tone('Agent', 'accent'),
  SETTLEMENT: tone('Settlement', 'neutral'),
  PERSONAL: tone('Personal', 'accent'),
}

export const LEDGER_TXN_SOURCE_META: Record<string, StatusMeta> = {
  TRANSFER: tone('Transfer', 'neutral'),
  PAYMENT: tone('Payment', 'positive'),
  PAYOUT: tone('Payout', 'warning'),
  FX_CONVERSION: tone('FX', 'info'),
  SPLIT_RULE: tone('Split rule', 'accent'),
  AGENT: tone('Agent', 'accent'),
  CARD_AUTH: tone('Card', 'info'),
  ADJUSTMENT: tone('Adjustment', 'warning'),
  REVERSAL: tone('Reversal', 'negative'),
  FEE: tone('Fee', 'neutral'),
  OPENING: tone('Opening', 'neutral'),
}

export const RAIL_TYPE_LABEL: Record<string, string> = {
  MOBILE_MONEY: 'Mobile money',
  BANK: 'Bank',
  CARD: 'Card',
  CRYPTO: 'Crypto',
  INTERNAL: 'Internal',
  FX: 'FX',
}

export const METHOD_META: Record<string, { label: string; rail: string }> = {
  MPESA: { label: 'M-Pesa', rail: 'MOBILE_MONEY' },
  BANK: { label: 'Bank transfer', rail: 'BANK' },
  CARD: { label: 'Card', rail: 'CARD' },
  WALLET: { label: 'Novera wallet', rail: 'INTERNAL' },
  USDC: { label: 'USDC', rail: 'CRYPTO' },
}

export const CURRENCY_LABEL: Record<CurrencyCode, string> = {
  KES: 'Kenyan Shilling',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  NGN: 'Nigerian Naira',
  TZS: 'Tanzanian Shilling',
  UGX: 'Ugandan Shilling',
  ZAR: 'South African Rand',
  USDC: 'USD Coin',
}

/** Guard: is this payment status transition legal? */
export function canTransitionPayment(from: string, to: string): boolean {
  const allowed = PAYMENT_TRANSITIONS[from as PaymentStatus]
  return !!allowed && allowed.includes(to as PaymentStatus)
}

export function canTransitionInvoice(from: string, to: string): boolean {
  const allowed = INVOICE_TRANSITIONS[from as InvoiceStatus]
  return !!allowed && allowed.includes(to as InvoiceStatus)
}

/** Statuses that mean "money has (at least tentatively) moved in". */
export const PAYMENT_INBOUND_ACTIVE = ['AUTHORIZED', 'PROCESSING', 'PENDING', 'SETTLED'] as const
export const PAYMENT_INBOUND_SETTLED = ['SETTLED'] as const
