'use server'

import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { recordAudit } from '@/lib/audit'
import { authorizeCard, generateCardNumber4 } from '@/lib/cards'
import { Money, MoneyError } from '@novera/money'
import { CARD_TYPES, CARD_AUTH_CHANNELS, CARD_TRANSITIONS, type CardStatus } from '@novera/domain'
import { revalidatePath } from 'next/cache'

/**
 * CARDS DOMAIN — server actions
 *
 * Every mutation is org-scoped (IDOR-safe), validated, and audited.
 * Money arrives as decimal strings from the client and is parsed through
 * Money.fromMajor — never floats. PAN/CVV are never stored: issuance is
 * tokenized (random last4, generated expiry).
 */

export type ActionResult = { ok: true } | { ok: false; error: string }

export interface IssueCardInput {
  label: string
  type: string
  currency: string
  holderName: string
  walletId: string
  perTxnLimit: string // decimal major units; '' = no limit
  dailyLimit: string
  monthlyLimit: string
  mccAllowlist: string // comma-separated MCC codes
  merchantAllowlist: string // comma-separated name fragments
  countryAllowlist: string // comma-separated ISO-3166 alpha-2
  allowOnline: boolean
  allowContactless: boolean
  allowAtm: boolean
  allowInternational: boolean
  agentId?: string | null
}

export type IssueResult =
  | { ok: true; cardId: string; last4: string }
  | { ok: false; error: string }

/** Parse a decimal limit string into minor units, or null when unbounded. */
function parseLimit(raw: string, currency: string): bigint | null {
  const s = raw.trim()
  if (!s) return null
  const m = Money.fromMajor(s, currency)
  if (m.isNegative()) throw new MoneyError('limit cannot be negative')
  return m.minor
}

/** Split a comma-separated field into a clean trimmed list. */
function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50)
}

function jsonOrNull(items: string[]): string | null {
  return items.length > 0 ? JSON.stringify(items) : null
}

function canTransition(from: string, to: string): boolean {
  const allowed = CARD_TRANSITIONS[from as CardStatus]
  return (allowed ?? []).includes(to as CardStatus)
}

function revalidateCards(cardId?: string) {
  revalidatePath('/cards')
  if (cardId) revalidatePath(`/cards/${cardId}`)
}

// ─── Issue ────────────────────────────────────────────────────────────

export async function issueCard(input: IssueCardInput): Promise<IssueResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const label = input.label.trim()
  const holderName = input.holderName.trim()
  const type = input.type
  const currency = input.currency

  if (label.length < 1 || label.length > 60) return { ok: false, error: 'Label is required (max 60 characters).' }
  if (holderName.length < 1 || holderName.length > 80) return { ok: false, error: 'Holder name is required (max 80 characters).' }
  if (!(CARD_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'Invalid card type.' }
  if (currency !== 'KES' && currency !== 'USD') return { ok: false, error: 'Currency must be KES or USD.' }

  let perTxnLimitMinor: bigint | null
  let dailyLimitMinor: bigint | null
  let monthlyLimitMinor: bigint | null
  try {
    perTxnLimitMinor = parseLimit(input.perTxnLimit, currency)
    dailyLimitMinor = parseLimit(input.dailyLimit, currency)
    monthlyLimitMinor = parseLimit(input.monthlyLimit, currency)
  } catch (err) {
    return { ok: false, error: err instanceof MoneyError ? err.message : 'Invalid limit value — use decimal amounts like 2500.00.' }
  }

  const mcc = parseList(input.mccAllowlist)
  const badMcc = mcc.filter((c) => !/^\d{3,4}$/.test(c))
  if (badMcc.length > 0) return { ok: false, error: `Invalid MCC codes: ${badMcc.join(', ')} — use 3–4 digit codes (e.g. 5411).` }

  const countries = parseList(input.countryAllowlist).map((c) => c.toUpperCase())
  const badCountry = countries.filter((c) => !/^[A-Z]{2}$/.test(c))
  if (badCountry.length > 0) return { ok: false, error: `Invalid country codes: ${badCountry.join(', ')} — use ISO alpha-2 (e.g. KE, US).` }

  const merchants = parseList(input.merchantAllowlist)

  // Wallet: must belong to this org, be ACTIVE, and match the card currency.
  const wallet = await db.wallet.findFirst({
    where: { id: input.walletId, organizationId: orgId },
  })
  if (!wallet || wallet.status !== 'ACTIVE') return { ok: false, error: 'Select a valid active wallet.' }
  if (wallet.currency !== currency) return { ok: false, error: `Wallet "${wallet.label}" holds ${wallet.currency} — it cannot fund a ${currency} card.` }

  // Agent binding (AGENT cards only, one card per agent).
  let agentId: string | null = null
  if (input.agentId) {
    if (type !== 'AGENT') return { ok: false, error: 'Only AGENT-type cards can be bound to an agent.' }
    const agent = await db.agent.findFirst({
      where: { id: input.agentId, organizationId: orgId },
      select: { id: true, name: true },
    })
    if (!agent) return { ok: false, error: 'Agent not found in this organization.' }
    const existing = await db.card.findFirst({
      where: { agentId: agent.id, organizationId: orgId },
      select: { id: true },
    })
    if (existing) return { ok: false, error: `${agent.name} already has a card bound to it.` }
    agentId = agent.id
  }

  const now = new Date()
  const last4 = generateCardNumber4()

  const card = await db.card.create({
    data: {
      organizationId: orgId,
      label,
      type,
      status: 'ACTIVE',
      brand: 'VISA',
      last4,
      expiryMonth: now.getMonth() + 1,
      expiryYear: now.getFullYear() + 3,
      currency,
      holderName,
      perTxnLimitMinor,
      dailyLimitMinor,
      monthlyLimitMinor,
      mccAllowlist: jsonOrNull(mcc),
      merchantAllowlist: jsonOrNull(merchants),
      countryAllowlist: jsonOrNull(countries),
      allowOnline: input.allowOnline,
      allowContactless: input.allowContactless,
      allowAtm: input.allowAtm,
      allowInternational: input.allowInternational,
      walletId: wallet.id,
      agentId,
    },
  })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'card.created',
    resourceType: 'Card',
    resourceId: card.id,
    description: `Issued ${type.toLowerCase()} card "${label}" •••• ${last4} (${currency}) to ${holderName}`,
    metadata: {
      type,
      currency,
      status: 'ACTIVE',
      walletId: wallet.id,
      perTxnLimitMinor: perTxnLimitMinor?.toString() ?? null,
      dailyLimitMinor: dailyLimitMinor?.toString() ?? null,
      monthlyLimitMinor: monthlyLimitMinor?.toString() ?? null,
      mccAllowlist: mcc,
      countryAllowlist: countries,
      merchantAllowlist: merchants,
      allowOnline: input.allowOnline,
      allowContactless: input.allowContactless,
      allowAtm: input.allowAtm,
      allowInternational: input.allowInternational,
      agentId,
    },
  })

  revalidateCards(card.id)
  return { ok: true, cardId: card.id, last4 }
}

// ─── Lifecycle: freeze / unfreeze / terminate ─────────────────────────

export async function freezeCard(cardId: string): Promise<ActionResult> {
  const session = await requireSession()
  const card = await db.card.findFirst({ where: { id: cardId, organizationId: session.organization.id } })
  if (!card) return { ok: false, error: 'Card not found.' }
  if (card.status !== 'ACTIVE') return { ok: false, error: `Only ACTIVE cards can be frozen (this card is ${card.status.toLowerCase()}).` }
  if (!canTransition(card.status, 'FROZEN')) return { ok: false, error: 'Illegal state transition.' }

  await db.card.update({ where: { id: card.id }, data: { status: 'FROZEN' } })
  await recordAudit({
    organizationId: session.organization.id,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'card.frozen',
    resourceType: 'Card',
    resourceId: card.id,
    description: `Froze card "${card.label}" •••• ${card.last4} — new authorizations will decline`,
    severity: 'WARN',
    metadata: { from: 'ACTIVE', to: 'FROZEN' },
  })
  revalidateCards(card.id)
  return { ok: true }
}

export async function unfreezeCard(cardId: string): Promise<ActionResult> {
  const session = await requireSession()
  const card = await db.card.findFirst({ where: { id: cardId, organizationId: session.organization.id } })
  if (!card) return { ok: false, error: 'Card not found.' }
  if (card.status !== 'FROZEN') return { ok: false, error: 'Only FROZEN cards can be reactivated.' }
  if (!canTransition(card.status, 'ACTIVE')) return { ok: false, error: 'Illegal state transition.' }

  await db.card.update({ where: { id: card.id }, data: { status: 'ACTIVE' } })
  await recordAudit({
    organizationId: session.organization.id,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'card.unfrozen',
    resourceType: 'Card',
    resourceId: card.id,
    description: `Reactivated card "${card.label}" •••• ${card.last4}`,
    metadata: { from: 'FROZEN', to: 'ACTIVE' },
  })
  revalidateCards(card.id)
  return { ok: true }
}

export async function terminateCard(cardId: string): Promise<ActionResult> {
  const session = await requireSession()
  const card = await db.card.findFirst({ where: { id: cardId, organizationId: session.organization.id } })
  if (!card) return { ok: false, error: 'Card not found.' }
  if (!canTransition(card.status, 'TERMINATED')) return { ok: false, error: `A ${card.status.toLowerCase()} card cannot be terminated.` }

  await db.card.update({ where: { id: card.id }, data: { status: 'TERMINATED' } })
  await recordAudit({
    organizationId: session.organization.id,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'card.terminated',
    resourceType: 'Card',
    resourceId: card.id,
    description: `Terminated card "${card.label}" •••• ${card.last4} — irreversible`,
    severity: 'WARN',
    metadata: { from: card.status, to: 'TERMINATED' },
  })
  revalidateCards(card.id)
  return { ok: true }
}

// ─── Controls: limits & channel toggles ───────────────────────────────

export interface CardLimitsInput {
  perTxnLimit: string
  dailyLimit: string
  monthlyLimit: string
}

export async function updateCardLimits(cardId: string, input: CardLimitsInput): Promise<ActionResult> {
  const session = await requireSession()
  const card = await db.card.findFirst({ where: { id: cardId, organizationId: session.organization.id } })
  if (!card) return { ok: false, error: 'Card not found.' }
  if (card.status === 'TERMINATED') return { ok: false, error: 'Terminated cards cannot be edited.' }

  let perTxnLimitMinor: bigint | null
  let dailyLimitMinor: bigint | null
  let monthlyLimitMinor: bigint | null
  try {
    perTxnLimitMinor = parseLimit(input.perTxnLimit, card.currency)
    dailyLimitMinor = parseLimit(input.dailyLimit, card.currency)
    monthlyLimitMinor = parseLimit(input.monthlyLimit, card.currency)
  } catch (err) {
    return { ok: false, error: err instanceof MoneyError ? err.message : 'Invalid limit value — use decimal amounts like 2500.00.' }
  }

  await db.card.update({
    where: { id: card.id },
    data: { perTxnLimitMinor, dailyLimitMinor, monthlyLimitMinor },
  })
  await recordAudit({
    organizationId: session.organization.id,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'card.limits.updated',
    resourceType: 'Card',
    resourceId: card.id,
    description: `Updated limits on "${card.label}" •••• ${card.last4}`,
    metadata: {
      perTxnLimitMinor: { from: card.perTxnLimitMinor?.toString() ?? null, to: perTxnLimitMinor?.toString() ?? null },
      dailyLimitMinor: { from: card.dailyLimitMinor?.toString() ?? null, to: dailyLimitMinor?.toString() ?? null },
      monthlyLimitMinor: { from: card.monthlyLimitMinor?.toString() ?? null, to: monthlyLimitMinor?.toString() ?? null },
    },
  })
  revalidateCards(card.id)
  return { ok: true }
}

export interface CardTogglesInput {
  allowOnline: boolean
  allowContactless: boolean
  allowAtm: boolean
  allowInternational: boolean
}

export async function updateCardToggles(cardId: string, input: CardTogglesInput): Promise<ActionResult> {
  const session = await requireSession()
  const card = await db.card.findFirst({ where: { id: cardId, organizationId: session.organization.id } })
  if (!card) return { ok: false, error: 'Card not found.' }
  if (card.status === 'TERMINATED') return { ok: false, error: 'Terminated cards cannot be edited.' }

  await db.card.update({
    where: { id: card.id },
    data: {
      allowOnline: input.allowOnline,
      allowContactless: input.allowContactless,
      allowAtm: input.allowAtm,
      allowInternational: input.allowInternational,
    },
  })
  await recordAudit({
    organizationId: session.organization.id,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'card.controls.updated',
    resourceType: 'Card',
    resourceId: card.id,
    description: `Updated channel controls on "${card.label}" •••• ${card.last4}`,
    metadata: {
      from: {
        allowOnline: card.allowOnline,
        allowContactless: card.allowContactless,
        allowAtm: card.allowAtm,
        allowInternational: card.allowInternational,
      },
      to: input,
    },
  })
  revalidateCards(card.id)
  return { ok: true }
}

// ─── Authorization simulator ──────────────────────────────────────────

export interface SimulateAuthInput {
  cardId: string
  merchantName: string
  mcc: string
  amount: string // decimal major units
  currency: string
  channel: string
  country: string
}

export type SimulateResult =
  | {
      ok: true
      decision: 'APPROVED' | 'DECLINED'
      reason?: string
      riskScore: number
      rulesChecked: string[]
      authId: string
    }
  | { ok: false; error: string }

/**
 * Runs the REAL authorization pipeline (hard controls → risk → hold →
 * capture → ledger → webhook) against the card. This is the same code path
 * the processor gateway would invoke — the simulator only feeds it input.
 */
export async function simulateAuthorization(input: SimulateAuthInput): Promise<SimulateResult> {
  const session = await requireSession()

  const card = await db.card.findFirst({
    where: { id: input.cardId, organizationId: session.organization.id },
    select: { id: true, currency: true },
  })
  if (!card) return { ok: false, error: 'Card not found.' }

  const merchantName = input.merchantName.trim()
  if (merchantName.length < 1 || merchantName.length > 80) return { ok: false, error: 'Merchant name is required.' }
  if (!/^\d{3,4}$/.test(input.mcc)) return { ok: false, error: 'MCC must be a 3–4 digit code.' }
  if (!(CARD_AUTH_CHANNELS as readonly string[]).includes(input.channel)) return { ok: false, error: 'Invalid channel.' }
  if (input.currency !== 'KES' && input.currency !== 'USD') return { ok: false, error: 'Currency must be KES or USD.' }
  const country = input.country.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, error: 'Country must be an ISO alpha-2 code.' }

  let amountMinor: bigint
  try {
    const money = Money.fromMajor(input.amount, input.currency)
    if (!money.isPositive()) throw new MoneyError('amount must be positive')
    amountMinor = money.minor
  } catch (err) {
    return { ok: false, error: err instanceof MoneyError ? err.message : 'Invalid amount — use a decimal value like 1200.00.' }
  }

  try {
    const result = await authorizeCard({
      cardId: card.id,
      merchantName,
      mcc: input.mcc,
      amountMinor,
      currency: input.currency,
      channel: input.channel as 'ONLINE' | 'POS' | 'ATM' | 'CONTACTLESS',
      country,
    })
    revalidateCards(card.id)
    return {
      ok: true,
      decision: result.decision,
      reason: result.reason,
      riskScore: result.riskScore,
      rulesChecked: result.rulesChecked,
      authId: result.authId,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Authorization engine error: ${err.message}` : 'Authorization engine error.' }
  }
}
