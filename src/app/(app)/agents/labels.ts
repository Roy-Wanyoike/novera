/**
 * KYA presentation vocabulary shared by the agents index, agent detail,
 * simulator and approvals surfaces. Pure data — safe in both server and
 * client components.
 */

import { AGENT_ROLES, AGENT_TOOLS } from '@novera/domain'

export const ROLE_LABELS: Record<string, string> = {
  PROCUREMENT: 'Procurement',
  TREASURY: 'Treasury',
  EXPENSES: 'Expenses',
  BILLING: 'Billing',
  ANALYST: 'Analyst',
  CUSTOM: 'Custom',
}

export const ROLE_HINTS: Record<string, string> = {
  PROCUREMENT: 'Supplier comparison and approved-supplier payouts',
  TREASURY: 'Cash position, exposure and forecasts',
  EXPENSES: 'Expense scanning and anomaly detection',
  BILLING: 'Invoice drafting and receivables summaries',
  ANALYST: 'Cross-domain read-only analysis',
  CUSTOM: 'Bespoke scoped role',
}

/** Human labels for agent tool scopes (KYA scope chips + registration form). */
export const TOOL_LABELS: Record<string, string> = {
  'payments.propose': 'Propose payments',
  'transfers.propose': 'Propose wallet transfers',
  'suppliers.compare': 'Compare supplier quotes',
  'treasury.report': 'Treasury reporting',
  'balances.read': 'Read balances',
  'invoices.summarize': 'Summarize invoices',
}

/** Compact chips for agent cards where space is tight. */
export const TOOL_SHORT_LABELS: Record<string, string> = {
  'payments.propose': 'payments',
  'transfers.propose': 'transfers',
  'suppliers.compare': 'suppliers',
  'treasury.report': 'treasury',
  'balances.read': 'balances',
  'invoices.summarize': 'invoices',
}

export const TOOL_HINTS: Record<string, string> = {
  'payments.propose': 'Moves money — bounded by per-txn, daily and approval ceilings',
  'transfers.propose': 'Moves money between organization wallets',
  'suppliers.compare': 'Read-only quote comparison',
  'treasury.report': 'Read-only cash position and forecast',
  'balances.read': 'Read-only wallet balances',
  'invoices.summarize': 'Read-only receivables summary',
}

/** Tools whose intents carry an amount — the ones that can actually move money. */
export const MONEY_TOOLS = ['payments.propose', 'transfers.propose']

export function isMoneyTool(tool: string): boolean {
  return MONEY_TOOLS.includes(tool)
}

export const AGENT_ROLES_LIST: string[] = [...AGENT_ROLES]
export const AGENT_TOOLS_LIST: string[] = [...AGENT_TOOLS]

/** Emoji choices for the registration dialog picker (simple, opinionated set). */
export const EMOJI_CHOICES = [
  '🤖', '🛒', '📊', '🧾', '🔍', '💼', '🧮', '⚡', '🦉', '🛡️', '📦', '💳',
] as const

/** Policy decision presentation (ALLOW / REQUIRE_APPROVAL / DECLINE). */
export function policyDecisionTone(
  decision: string | null
): { label: string; tone: 'positive' | 'warning' | 'negative' | 'neutral' } | null {
  switch (decision) {
    case 'ALLOW':
      return { label: 'Policy allowed', tone: 'positive' }
    case 'REQUIRE_APPROVAL':
      return { label: 'Policy escalated', tone: 'warning' }
    case 'DECLINE':
      return { label: 'Policy denied', tone: 'negative' }
    default:
      return null
  }
}
