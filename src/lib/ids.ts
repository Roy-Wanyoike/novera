import { randomBytes } from 'crypto'

/**
 * Prefix-based, sortable-ish reference IDs.
 * Format: <prefix>_<base36 timestamp><random> — collision-resistant,
 * human-scannable in logs and audit trails.
 */

function base36(n: number): string {
  return n.toString(36)
}

function rand(len: number): string {
  return randomBytes(len).toString('base64url').replace(/[-_]/g, '').slice(0, len).toLowerCase()
}

export function makeRef(prefix: string, randLen = 8): string {
  const ts = base36(Date.now())
  return `${prefix}_${ts}${rand(randLen)}`
}

export const ref = {
  payment: () => makeRef('pay', 8),
  ledgerTxn: () => makeRef('ltx', 8),
  invoice: (seq: number) => `INV-2026-${String(seq).padStart(4, '0')}`,
  hold: () => makeRef('hld', 8),
  paymentLink: () => makeRef('plink', 8),
  checkout: () => makeRef('chk', 10),
  agent: () => makeRef('agent', 6),
  intent: () => makeRef('int', 8),
  approval: () => makeRef('apr', 8),
  webhook: () => makeRef('wh', 8),
  providerTxn: (providerCode: string) => makeRef(providerCode.toLowerCase().replace(/[^a-z]/g, ''), 10),
  fxQuote: () => makeRef('fxq', 8),
  caseId: () => makeRef('rc', 8),
  apiKey: (mode: 'TEST' | 'LIVE') =>
    `nv_${mode === 'LIVE' ? 'live' : 'test'}_${rand(6)}${rand(6)}`,
  agentCredential: () => `nv_agent_${rand(6)}${rand(6)}`,
  webhookSecret: () => `nvwhsec_${rand(24)}`,
}

export function correlationId(): string {
  return randomBytes(8).toString('hex')
}
