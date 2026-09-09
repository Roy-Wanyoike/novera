import { db } from '@/lib/db'
import { postTransaction, ensureChartOfAccounts } from '@/lib/ledger'
import { evaluateRisk } from '@/lib/risk'
import { recordAudit } from '@/lib/audit'
import { emitWebhookEvent } from '@/lib/webhooks'

/**
 * CARD AUTHORIZATION ENGINE
 *
 *   Network → Processor → Novera Card Service → Risk → Policy → Ledger
 *
 * Authorization is synchronous and deterministic: controls (limits, MCC,
 * geography, channel toggles) are hard rules; risk adds a score. Approval
 * places a HOLD on the wallet (reserved, not available); capture posts the
 * ledger leg. PAN/CVV are never stored — cards are tokenized (last4 only).
 */

export interface CardAuthInput {
  cardId: string
  merchantName: string
  mcc: string
  amountMinor: bigint
  currency: string
  country?: string
  channel: 'ONLINE' | 'POS' | 'ATM' | 'CONTACTLESS'
}

export interface CardAuthDecision {
  decision: 'APPROVED' | 'DECLINED'
  reason?: string
  riskScore: number
  rulesChecked: string[]
}

export async function authorizeCard(input: CardAuthInput): Promise<CardAuthDecision & { authId: string }> {
  const card = await db.card.findUnique({
    where: { id: input.cardId },
    include: { wallet: true, organization: true },
  })
  if (!card) throw new Error('card not found')

  const rulesChecked: string[] = []
  let decline: string | null = null

  const declineIf = (cond: boolean, reason: string) => {
    if (cond && !decline) decline = reason
    if (cond) rulesChecked.push(reason)
  }

  // ── hard controls (deterministic policy) ──
  declineIf(card.status !== 'ACTIVE', `card is ${card.status.toLowerCase()}`)
  declineIf(card.currency !== input.currency, `currency mismatch (card is ${card.currency})`)
  if (card.perTxnLimitMinor) declineIf(input.amountMinor > card.perTxnLimitMinor, 'exceeds per-transaction limit')
  if (card.dailyLimitMinor) declineIf(card.spendTodayMinor + input.amountMinor > card.dailyLimitMinor, 'exceeds daily limit')
  if (card.monthlyLimitMinor) declineIf(card.spendMonthMinor + input.amountMinor > card.monthlyLimitMinor, 'exceeds monthly limit')

  if (card.mccAllowlist) {
    const allow: string[] = JSON.parse(card.mccAllowlist)
    declineIf(allow.length > 0 && !allow.includes(input.mcc), 'MCC not in allowlist')
  }
  if (card.merchantAllowlist) {
    const allow: string[] = JSON.parse(card.merchantAllowlist)
    declineIf(
      allow.length > 0 && !allow.some((m) => input.merchantName.toLowerCase().includes(m.toLowerCase())),
      'merchant not in allowlist'
    )
  }
  if (card.countryAllowlist) {
    const allow: string[] = JSON.parse(card.countryAllowlist)
    declineIf(allow.length > 0 && !allow.includes(input.country ?? 'KE'), 'country not in allowlist')
  }
  declineIf(input.channel === 'ONLINE' && !card.allowOnline, 'online payments disabled')
  declineIf(input.channel === 'CONTACTLESS' && !card.allowContactless, 'contactless disabled')
  declineIf(input.channel === 'ATM' && !card.allowAtm, 'ATM withdrawals disabled')
  declineIf((input.country ?? 'KE') !== 'KE' && !card.allowInternational, 'international payments disabled')

  // ── risk engine ──
  const risk = await evaluateRisk({
    organizationId: card.organizationId,
    subject: 'CARD_AUTH',
    amountMinor: input.amountMinor,
    currency: input.currency,
    method: 'CARD',
    country: input.country,
    merchant: input.merchantName,
    mcc: input.mcc,
    channel: input.channel,
  })

  if (risk.decision === 'DECLINE' && !decline) decline = `risk: ${risk.reasons[0]}`

  const decision: CardAuthDecision['decision'] = decline ? 'DECLINED' : 'APPROVED'

  const auth = await db.cardAuthorization.create({
    data: {
      cardId: card.id,
      merchantName: input.merchantName,
      mcc: input.mcc,
      amountMinor: input.amountMinor,
      currency: input.currency,
      country: input.country ?? 'KE',
      channel: input.channel,
      decision,
      declineReason: decline,
      riskScore: risk.score,
      evaluatedRules: JSON.stringify([...rulesChecked, ...risk.ruleHits]),
    },
  })

  if (decision === 'APPROVED' && card.walletId) {
    // reserve the funds with a hold
    await db.hold.create({
      data: {
        organizationId: card.organizationId,
        walletId: card.walletId,
        reference: `cardauth_${auth.id}`,
        amountMinor: input.amountMinor,
        currency: input.currency,
        reason: `Card authorization ${input.merchantName}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    })
    await db.card.update({
      where: { id: card.id },
      data: {
        spendTodayMinor: { increment: input.amountMinor },
        spendMonthMinor: { increment: input.amountMinor },
        lastUsedAt: new Date(),
      },
    })
    // capture immediately in this reference build (single-phase auth+capture)
    await captureAuthorization(auth.id)
  }

  await recordAudit({
    organizationId: card.organizationId,
    actorType: 'SERVICE',
    actorLabel: 'Card network simulator',
    action: decision === 'APPROVED' ? 'card.authorization.approved' : 'card.authorization.declined',
    resourceType: 'CardAuthorization',
    resourceId: auth.id,
    description: `${decision} ${input.merchantName} ${(Number(input.amountMinor) / 100).toFixed(2)} ${input.currency} (•••• ${card.last4})`,
    severity: decision === 'APPROVED' ? 'INFO' : 'WARN',
    metadata: { mcc: input.mcc, channel: input.channel, reason: decline },
  })

  await emitWebhookEvent({
    organizationId: card.organizationId,
    event: decision === 'APPROVED' ? 'card.authorization.approved' : 'card.authorization.declined',
    data: { cardId: card.id, authId: auth.id, amountMinor: input.amountMinor.toString(), merchantName: input.merchantName },
  })

  return { decision, reason: decline ?? undefined, riskScore: risk.score, rulesChecked, authId: auth.id }
}

/** Capture an approved authorization: release the hold, post the ledger leg. */
export async function captureAuthorization(authId: string) {
  const auth = await db.cardAuthorization.findUnique({
    where: { id: authId },
    include: { card: { include: { wallet: true } } },
  })
  if (!auth || auth.decision !== 'APPROVED' || auth.ledgerTransactionId) return

  const wallet = auth.card.wallet
  if (!wallet) return

  const hold = await db.hold.findUnique({ where: { reference: `cardauth_${auth.id}` } })
  const coa = await ensureChartOfAccounts(auth.card.organizationId)

  const txn = await postTransaction({
    organizationId: auth.card.organizationId,
    description: `Card •••• ${auth.card.last4} — ${auth.merchantName}`,
    source: 'CARD_AUTH',
    idempotencyKey: `cardauth:${auth.id}`,
    actorType: 'SERVICE',
    actorLabel: 'Card processor (TEST)',
    entries: [
      // spend: expense UP (DEBIT), wallet asset DOWN (CREDIT)
      { accountId: coa['CARD_EXPENSE'], direction: 'DEBIT', amountMinor: auth.amountMinor, currency: auth.currency },
      { accountId: wallet.ledgerAccountId, direction: 'CREDIT', amountMinor: auth.amountMinor, currency: auth.currency },
    ],
    metadata: { authId: auth.id, mcc: auth.mcc, merchant: auth.merchantName },
  })

  if (hold) {
    await db.hold.update({
      where: { id: hold.id },
      data: { status: 'CAPTURED', capturedAt: new Date(), captureTransactionId: txn.id },
    })
  }

  await db.cardAuthorization.update({
    where: { id: auth.id },
    data: { ledgerTransactionId: txn.id },
  })
}

export function generateCardNumber4(): string {
  const n = Math.floor(1000 + Math.random() * 9000)
  return String(n)
}
