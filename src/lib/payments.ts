import { db } from '@/lib/db'
import { Money } from '@novera/money'
import { canTransitionPayment } from '@novera/domain'
import {
  postTransaction,
  ensureChartOfAccounts,
  emitLedgerPostedAudit,
  type PostedTransaction,
} from '@/lib/ledger'
import { evaluateRisk } from '@/lib/risk'
import { dispatchToRail, resolveProviderForMethod } from '@/lib/gateway'
import { emitWebhookEvent } from '@/lib/webhooks'
import { recordAudit } from '@/lib/audit'
import { ref } from '@/lib/ids'
import { availableBalanceMinor } from '@/lib/transfers'
import { sha256Hex } from '@/lib/crypto'

/**
 * PAYMENTS — the money movement state machine.
 *
 *   CREATED → AUTHORIZED → PROCESSING → (PENDING) → SETTLED
 *                          ↘ FAILED / CANCELLED / REFUNDED / REVERSED / DISPUTED
 *
 * Every transition:
 *   - is validated against the legal state machine,
 *   - runs risk BEFORE any rail submission,
 *   - posts balanced ledger entries on settlement,
 *   - emits webhooks + audit events,
 *   - respects idempotency keys.
 *
 * Directive: a processing payment is never shown as settled. Pending
 * funds are never displayed as available. No fake success.
 */

export class PaymentError extends Error {
  constructor(message: string) {
    super(`[payments] ${message}`)
    this.name = 'PaymentError'
  }
}

interface TimelineEvent { at: string; event: string; detail: string }

async function appendTimeline(paymentId: string, event: string, detail: string): Promise<void> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, select: { timeline: true } })
  if (!payment) return
  const timeline: TimelineEvent[] = payment.timeline ? JSON.parse(payment.timeline) : []
  timeline.push({ at: new Date().toISOString(), event, detail })
  await db.payment.update({
    where: { id: paymentId },
    data: { timeline: JSON.stringify(timeline) },
  })
}

export interface CreatePaymentInput {
  organizationId: string
  amountMinor: bigint
  currency: string
  method: string
  direction?: 'IN' | 'OUT'
  customerId?: string | null
  customerName?: string | null
  customerEmail?: string | null
  description?: string | null
  invoiceId?: string | null
  paymentLinkId?: string | null
  idempotencyKey?: string | null
  forceOutcome?: 'SUCCESS' | 'FAILURE' | 'PENDING'
  actor?: { type: 'USER' | 'AGENT' | 'SYSTEM' | 'SERVICE'; id?: string; label?: string }
}

/**
 * Create + attempt full lifecycle of a payment intent.
 * Risk runs first (DECLINE → FAILED with reasons, REVIEW → PENDING).
 * Then the rail is engaged; success posts the ledger leg.
 */
/**
 * Canonical request fingerprint for idempotency-key replays. A replay of
 * the same key with a DIFFERENT body is a client bug (or an attack) — the
 * API answers 422 IDEMPOTENCY_ERROR instead of silently returning the
 * original object (Stripe-style contract).
 */
export function paymentFingerprint(input: {
  amountMinor: bigint
  currency: string
  method: string
  direction?: 'IN' | 'OUT'
  customerId?: string | null
  customerEmail?: string | null
  description?: string | null
  invoiceId?: string | null
  paymentLinkId?: string | null
}): string {
  const canonical = JSON.stringify({
    amountMinor: input.amountMinor.toString(),
    currency: input.currency,
    method: input.method,
    direction: input.direction ?? 'IN',
    customerId: input.customerId ?? null,
    customerEmail: input.customerEmail ?? null,
    description: input.description ?? null,
    invoiceId: input.invoiceId ?? null,
    paymentLinkId: input.paymentLinkId ?? null,
  })
  return sha256Hex(canonical)
}

export async function createPayment(input: CreatePaymentInput) {
  if (input.idempotencyKey) {
    const existing = await db.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    if (existing) return existing
  }

  const org = await db.organization.findUnique({ where: { id: input.organizationId } })
  if (!org) throw new PaymentError('organization not found')

  const providerId = await resolveProviderForMethod(input.method)
  const provider = providerId ? await db.railProvider.findUnique({ where: { id: providerId } }) : null

  // fee: provider bps + fixed (fee only on collections)
  const feeMinor =
    input.direction === 'OUT'
      ? 0n
      : provider
        ? (input.amountMinor * BigInt(provider.feeBps)) / 10000n + provider.fixedFeeMinor
        : 0n

  let payment
  try {
    payment = await db.payment.create({
      data: {
        organizationId: input.organizationId,
        reference: ref.payment(),
        customerId: input.customerId ?? null,
        customerName: input.customerName ?? null,
        customerEmail: input.customerEmail ?? null,
        amountMinor: input.amountMinor,
        feeMinor,
        currency: input.currency,
        direction: input.direction ?? 'IN',
        method: input.method,
        providerId: providerId ?? null,
        status: 'CREATED',
        description: input.description ?? null,
        invoiceId: input.invoiceId ?? null,
        paymentLinkId: input.paymentLinkId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        idempotencyFingerprint:
          input.idempotencyKey != null ? paymentFingerprint(input) : null,
        timeline: JSON.stringify([
          { at: new Date().toISOString(), event: 'created', detail: `Payment intent created via ${input.method}` },
        ]),
      },
    })
  } catch (err) {
    // Concurrent duplicate on the unique idempotencyKey: both requests
    // passed the pre-check, the second create loses the race — re-read and
    // return the original (the caller sees a replay, not a 500).
    if ((err as { code?: string }).code === 'P2002' && input.idempotencyKey) {
      const existing = await db.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      })
      if (existing) return existing
    }
    throw err
  }

  await recordAudit({
    organizationId: input.organizationId,
    actorType: input.actor?.type ?? 'SYSTEM',
    actorId: input.actor?.id ?? null,
    actorLabel: input.actor?.label ?? null,
    action: 'payment.created',
    resourceType: 'Payment',
    resourceId: payment.id,
    description: `Payment intent ${payment.reference} created (${input.method} ${input.currency})`,
    metadata: { amountMinor: input.amountMinor.toString(), method: input.method },
  })

  // ── RISK (before anything moves) ──
  const risk = await evaluateRisk({
    organizationId: input.organizationId,
    subject: 'PAYMENT_CREATE',
    amountMinor: input.amountMinor,
    currency: input.currency,
    method: input.method,
    customerId: input.customerId ?? null,
    customerEmail: input.customerEmail ?? null,
    paymentId: payment.id,
  })

  await db.payment.update({
    where: { id: payment.id },
    data: { riskDecision: risk.decision, riskScore: risk.score },
  })
  await appendTimeline(payment.id, 'risk_evaluated', `Risk ${risk.decision} (score ${risk.score}): ${risk.reasons[0]}`)

  if (risk.decision === 'DECLINE') {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: `Risk declined: ${risk.reasons[0]}` , failedAt: new Date() },
    })
    await appendTimeline(payment.id, 'failed', `Declined by risk engine`)
    await emitWebhookEvent({
      organizationId: input.organizationId,
      event: 'payment.failed',
      paymentId: payment.id,
      data: { reference: payment.reference, reason: 'risk_declined', riskScore: risk.score },
    })
    return db.payment.findUnique({ where: { id: payment.id } })
  }

  // ── AUTHORIZED ──
  await transition(payment.id, 'AUTHORIZED')
  await appendTimeline(payment.id, 'authorized', `Authorized after risk ${risk.decision}`)

  if (risk.decision === 'REVIEW' || input.forceOutcome === 'PENDING') {
    // PROCESSING → PENDING through the state machine (no direct status
    // writes bypassing canTransitionPayment)
    await transition(payment.id, 'PROCESSING')
    await transition(payment.id, 'PENDING')
    await appendTimeline(payment.id, 'pending', 'Held for manual review')
    await recordAudit({
      organizationId: input.organizationId,
      actorType: 'SYSTEM',
      action: 'risk.review.created',
      resourceType: 'Payment',
      resourceId: payment.id,
      description: `Payment ${payment.reference} queued for manual review`,
      severity: 'WARN',
    })
    return db.payment.findUnique({ where: { id: payment.id } })
  }

  // ── RAIL DISPATCH ──
  if (!providerId) {
    // No provider for the method: fail the payment honestly instead of
    // leaving it stuck in AUTHORIZED forever (status + timeline + webhook).
    await transition(payment.id, 'FAILED')
    await appendTimeline(payment.id, 'failed', `No provider available for method ${input.method}`)
    await emitWebhookEvent({
      organizationId: input.organizationId,
      event: 'payment.failed',
      paymentId: payment.id,
      data: { reference: payment.reference, reason: 'no_provider', method: input.method },
    })
    return db.payment.findUnique({ where: { id: payment.id } })
  }
  await transition(payment.id, 'PROCESSING')
  const dispatch = await dispatchToRail({
    providerId,
    paymentId: payment.id,
    amountMinor: input.amountMinor,
    currency: input.currency,
    method: input.method,
    customerEmail: input.customerEmail,
    forceOutcome: input.forceOutcome,
  })
  await db.payment.update({
    where: { id: payment.id },
    data: { providerReference: dispatch.externalReference },
  })
  await appendTimeline(
    payment.id,
    'rail_submitted',
    `${provider!.name} acknowledged ${dispatch.externalReference} (${dispatch.latencyMs}ms)`
  )

  if (!dispatch.ok) {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: 'Provider reported failure', failedAt: new Date() },
    })
    await appendTimeline(payment.id, 'failed', 'Provider reported failure')
    await emitWebhookEvent({
      organizationId: input.organizationId,
      event: 'payment.failed',
      paymentId: payment.id,
      data: { reference: payment.reference, reason: 'provider_failure' },
    })
    return db.payment.findUnique({ where: { id: payment.id } })
  }

  // ── SETTLE: post the ledger leg ──
  try {
    return await settlePayment(payment.id, input.actor)
  } catch (err) {
    // Settlement can fail for real financial reasons (e.g. an outbound
    // payout with insufficient wallet funds). The payment fails honestly
    // — FAILED + timeline + webhook — instead of crashing the request.
    if (err instanceof PaymentError) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: err.message, failedAt: new Date() },
      })
      await appendTimeline(payment.id, 'failed', err.message)
      await emitWebhookEvent({
        organizationId: input.organizationId,
        event: 'payment.failed',
        paymentId: payment.id,
        data: { reference: payment.reference, reason: 'settlement_declined', detail: err.message },
      })
      return db.payment.findUnique({ where: { id: payment.id } })
    }
    throw err
  }
}

/** Post balanced entries for a settled collection (or payout). */
export async function settlePayment(
  paymentId: string,
  actor?: { type: 'USER' | 'AGENT' | 'SYSTEM' | 'SERVICE'; id?: string; label?: string }
) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { provider: true, organization: { include: { wallets: true } } },
  })
  if (!payment) throw new PaymentError('payment not found')
  if (payment.status === 'SETTLED') return payment

  if (!canTransitionPayment(payment.status, 'SETTLED')) {
    throw new PaymentError(`cannot settle payment in status ${payment.status}`)
  }

  const coa = await ensureChartOfAccounts(payment.organizationId)
  const salesId = coa['SALES']

  // Find destination: default operating wallet of matching currency
  const targetWallet =
    payment.organization.wallets.find(
      (w) => w.type === 'OPERATING' && w.currency === payment.currency && w.status === 'ACTIVE'
    ) ?? payment.organization.wallets.find((w) => w.currency === payment.currency && w.status === 'ACTIVE')

  const direction = payment.direction === 'OUT' ? 'payout' : 'collection'

  let ledgerTxn: PostedTransaction | null = null
  if (targetWallet) {
    if (direction === 'collection') {
      // Customer paid gross 1000 (fee 48, net 952).
      // ORG BOOKS: wallet asset UP by net (DEBIT), processing fee is an
      // EXPENSE (DEBIT), revenue recognized on gross (CREDIT SALES).
      const gross = payment.amountMinor
      const fee = payment.feeMinor
      const net = gross - fee
      ledgerTxn = await postTransaction({
        organizationId: payment.organizationId,
        description: `${payment.method} collection ${payment.reference}`,
        source: 'PAYMENT',
        idempotencyKey: `settle:${payment.id}`,
        actorType: actor?.type ?? 'SYSTEM',
        actorId: actor?.id ?? null,
        actorLabel: actor?.label ?? null,
        entries: [
          { accountId: targetWallet.ledgerAccountId, direction: 'DEBIT', amountMinor: net, currency: payment.currency },
          ...(fee > 0n
            ? [{ accountId: coa['FEE_EXPENSE'], direction: 'DEBIT' as const, amountMinor: fee, currency: payment.currency }]
            : []),
          { accountId: salesId, direction: 'CREDIT', amountMinor: gross, currency: payment.currency },
        ],
        metadata: { paymentRef: payment.reference, grossMinor: gross.toString(), feeMinor: fee.toString() },
      })
    } else {
      // Payout: money LEAVES the wallet — asset DOWN (CREDIT wallet),
      // disbursement recognized as expense (DEBIT).
      //
      // The available-balance guard and the posting run in ONE transaction:
      // the wallet cannot be drained below zero by an overdrawing payout
      // (fail-closed: nothing is posted when funds are insufficient).
      const payoutInput = {
        organizationId: payment.organizationId,
        description: `${payment.method} payout ${payment.reference}`,
        source: 'PAYOUT' as const,
        idempotencyKey: `settle:${payment.id}` as string | null,
        actorType: actor?.type ?? 'USER',
        actorId: actor?.id ?? null,
        actorLabel: actor?.label ?? null,
        entries: [
          { accountId: coa['PAYOUT_EXPENSE'], direction: 'DEBIT' as const, amountMinor: payment.amountMinor, currency: payment.currency },
          { accountId: targetWallet.ledgerAccountId, direction: 'CREDIT' as const, amountMinor: payment.amountMinor, currency: payment.currency },
        ],
        metadata: { paymentRef: payment.reference },
      }
      ledgerTxn = await db.$transaction(async (prisma) => {
        const available = await availableBalanceMinor(targetWallet.id, prisma)
        if (available < payment.amountMinor) {
          throw new PaymentError(
            `insufficient available funds for payout: ${available} < ${payment.amountMinor} ${payment.currency}`
          )
        }
        return postTransaction(payoutInput, prisma)
      })
      // Post-commit audit (chain-integrity contract; see audit.ts).
      await emitLedgerPostedAudit(payoutInput, ledgerTxn)
    }
  }

  const settled = await db.payment.update({
    where: { id: payment.id },
    data: {
      status: 'SETTLED',
      settledAt: new Date(),
      ledgerTransactionId: ledgerTxn?.id ?? null,
    },
  })
  await appendTimeline(
    payment.id,
    'settled',
    `Settled${ledgerTxn ? `; ledger ${ledgerTxn.reference} posted` : ' (no wallet leg)'}`
  )

  await emitWebhookEvent({
    organizationId: payment.organizationId,
    event: 'payment.settled',
    paymentId: payment.id,
    data: {
      reference: payment.reference,
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      settledAt: settled.settledAt?.toISOString(),
      ledgerTransactionRef: ledgerTxn?.reference ?? null,
    },
  })

  // Invoice linkage
  if (payment.invoiceId) {
    await applyPaymentToInvoice(payment.organizationId, payment.invoiceId)
  }

  // Payment link stats
  if (payment.paymentLinkId) {
    await db.paymentLink.update({
      where: { id: payment.paymentLinkId },
      data: { uses: { increment: 1 }, revenueMinor: { increment: payment.amountMinor } },
    })
  }

  // Programmable money: run active split rules on PAYMENT_RECEIVED
  await runSplitRulesForPayment(payment.id)

  return db.payment.findUnique({ where: { id: payment.id } })
}

async function transition(paymentId: string, to: string): Promise<void> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, select: { status: true, reference: true } })
  if (!payment) throw new PaymentError('payment not found')
  if (!canTransitionPayment(payment.status, to)) {
    throw new PaymentError(`illegal transition ${payment.status} → ${to} (${payment.reference})`)
  }
  await db.payment.update({ where: { id: paymentId }, data: { status: to } })
}

/** Refund (full or partial) against a settled payment — compensating entries. */
export async function refundPayment(
  organizationId: string,
  paymentId: string,
  amountMinor: bigint,
  actor?: { type: 'USER' | 'AGENT' | 'SYSTEM' | 'SERVICE'; id?: string; label?: string }
) {
  const payment = await db.payment.findUnique({ where: { id: paymentId } })
  if (!payment || payment.organizationId !== organizationId) throw new PaymentError('payment not found')
  if (payment.status !== 'SETTLED') throw new PaymentError('only settled payments can be refunded')
  const alreadyRefunded = payment.refundedMinor
  if (amountMinor <= 0n || amountMinor + alreadyRefunded > payment.amountMinor) {
    throw new PaymentError('refund amount invalid')
  }

  // Idempotent replay short-circuit: a ledger transaction with this exact
  // refund key already exists → the money already moved exactly once. A
  // retry must NOT re-add to refundedMinor, re-emit the webhook or append
  // timeline events — it returns the current payment state.
  const refundIdemKey = `refund:${payment.id}:${amountMinor.toString()}`
  const replayed = await db.ledgerTransaction.findUnique({
    where: { idempotencyKey: refundIdemKey },
    select: { id: true },
  })
  if (replayed) {
    return db.payment.findUniqueOrThrow({ where: { id: payment.id } })
  }

  const coa = await ensureChartOfAccounts(organizationId)
  const wallets = await db.wallet.findMany({ where: { organizationId } })
  const wallet =
    wallets.find((w) => w.type === 'OPERATING' && w.currency === payment.currency) ??
    wallets.find((w) => w.currency === payment.currency)
  if (!wallet) throw new PaymentError('no wallet to refund from')

  // Refund: reverse of the collection posting — revenue DOWN (DEBIT SALES),
  // wallet asset DOWN (CREDIT wallet net part), fee expense reversed
  // (CREDIT FEE_EXPENSE) so debits === credits exactly.
  const feeShare = (payment.feeMinor * amountMinor) / payment.amountMinor
  const walletLeg = amountMinor - feeShare

  await postTransaction({
    organizationId,
    description: `Refund ${payment.reference}`,
    source: 'REVERSAL',
    idempotencyKey: refundIdemKey,
    actorType: actor?.type ?? 'USER',
    actorId: actor?.id ?? null,
    actorLabel: actor?.label ?? null,
    entries: [
      { accountId: coa['SALES'], direction: 'DEBIT', amountMinor: amountMinor, currency: payment.currency },
          { accountId: wallet.ledgerAccountId, direction: 'CREDIT', amountMinor: walletLeg, currency: payment.currency },
      ...(feeShare > 0n
        ? [{ accountId: coa['FEE_EXPENSE'], direction: 'CREDIT' as const, amountMinor: feeShare, currency: payment.currency }]
        : []),
    ],
    metadata: { refundOf: payment.reference, refundedMinor: amountMinor.toString() },
  })

  const refundedTotal = alreadyRefunded + amountMinor
  const updated = await db.payment.update({
    where: { id: payment.id },
    data: {
      refundedMinor: refundedTotal,
      status: refundedTotal === payment.amountMinor ? 'REFUNDED' : 'SETTLED',
    },
  })
  await appendTimeline(payment.id, 'refunded', `Refunded ${amountMinor} minor units`)
  await emitWebhookEvent({
    organizationId,
    event: 'payment.refunded',
    paymentId: payment.id,
    data: { reference: payment.reference, refundedMinor: amountMinor.toString() },
  })
  return updated
}

/** Update invoice state after a settled payment. */
export async function applyPaymentToInvoice(organizationId: string, invoiceId: string) {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true },
  })
  if (!invoice || invoice.organizationId !== organizationId) return
  const paid = invoice.payments
    .filter((p) => p.status === 'SETTLED')
    .reduce((a, p) => a + p.amountMinor, 0n)

  const isFull = paid >= invoice.totalMinor
  const isPartial = paid > 0n && paid < invoice.totalMinor

  const status =
    invoice.status === 'CANCELLED' || invoice.status === 'DRAFT'
      ? invoice.status
      : isFull
        ? 'PAID'
        : isPartial
          ? 'PARTIALLY_PAID'
          : invoice.status

  await db.invoice.update({
    where: { id: invoice.id },
    data: { amountPaidMinor: paid, status, paidAt: isFull ? new Date() : invoice.paidAt },
  })

  if (isFull && invoice.status !== 'PAID') {
    await emitWebhookEvent({
      organizationId,
      event: 'invoice.paid',
      data: { invoiceId: invoice.id, number: invoice.number, amountPaidMinor: paid.toString() },
    })
  }
}

// ── Split rules execution (programmable money) ───────────────────────

async function runSplitRulesForPayment(paymentId: string) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { organization: { include: { wallets: true } } },
  })
  if (!payment || payment.direction !== 'IN') return

  const rules = await db.splitRule.findMany({
    where: { organizationId: payment.organizationId, status: 'ACTIVE' },
  })
  const trigger =
    payment.invoiceId != null ? 'INVOICE_PAID' : 'PAYMENT_RECEIVED'

  for (const rule of rules) {
    if (rule.trigger !== trigger && rule.trigger !== 'PAYMENT_RECEIVED') continue
    if (rule.trigger === 'INVOICE_PAID' && payment.invoiceId == null) continue

    const allocations: { label: string; walletId: string; percentBps: number }[] = JSON.parse(rule.allocations)
    const wallets = payment.organization.wallets
    const fromWallet =
      wallets.find((w) => w.type === 'OPERATING' && w.currency === payment.currency) ??
      wallets.find((w) => w.currency === payment.currency)
    if (!fromWallet) continue

    // Resolve every allocation (including the share that STAYS in the
    // source wallet) so the parts are computed against the FULL weight
    // set — filtering first would renormalize the percentages.
    const all = allocations.map((a) => ({
      label: a.label,
      percentBps: a.percentBps,
      wallet:
        wallets.find((w) => w.id === a.walletId) ??
        wallets.find((w) => w.label === a.label && w.currency === payment.currency) ??
        null,
    }))
    const money = Money.fromMinor(payment.amountMinor, payment.currency)
    const parts = money.allocateBps(all.map((a) => a.percentBps))
    const indexed = all.map((a, i) => ({ ...a, part: parts[i] }))

    // Only allocations routed to OTHER wallets create entries; the share
    // allocated to the source wallet simply stays (no entry), so debits
    // always equal credits exactly and percentages are never renormalized.
    const targets = indexed.filter((a) => a.wallet && a.wallet.id !== fromWallet.id)
    if (targets.length === 0) continue

    const totalToMove = targets.reduce((s, t) => s + t.part.minor, 0n)
    if (totalToMove === 0n) continue
    const breakdown = targets.map((t) => ({
      wallet: t.wallet!.label,
      percentBps: t.percentBps,
      amountMinor: t.part.minor,
    }))

    const entries = [
      // source wallet asset DOWN (CREDIT) by the routed total; each target
      // wallet asset UP (DEBIT) by its exact allocated part.
      { accountId: fromWallet.ledgerAccountId, direction: 'CREDIT' as const, amountMinor: totalToMove, currency: payment.currency },
      ...targets.map((t) => ({
        accountId: t.wallet!.ledgerAccountId,
        direction: 'DEBIT' as const,
        amountMinor: t.part.minor,
        currency: payment.currency,
      })),
    ]

    try {
      const ledgerTxn = await postTransaction({
        organizationId: payment.organizationId,
        description: `Split rule "${rule.name}" on ${payment.reference}`,
        source: 'SPLIT_RULE',
        idempotencyKey: `split:${rule.id}:${payment.id}`,
        entries,
        metadata: { ruleId: rule.id, paymentRef: payment.reference },
      })
      await db.splitRuleExecution.create({
        data: {
          splitRuleId: rule.id,
          paymentId: payment.id,
          organizationId: payment.organizationId,
          ledgerTransactionId: ledgerTxn.id,
          breakdown: JSON.stringify(breakdown),
          amountMinor: payment.amountMinor,
          currency: payment.currency,
        },
      })
      await emitWebhookEvent({
        organizationId: payment.organizationId,
        event: 'splitrule.executed',
        paymentId: payment.id,
        data: { ruleId: rule.id, breakdown },
      })
    } catch {
      // split failure must never break settlement; ops will see it in audit
    }
  }
}
