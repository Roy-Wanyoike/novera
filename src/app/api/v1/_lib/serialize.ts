import { safeJson } from '@/lib/format'

/**
 * API v1 — response serializers.
 *
 * BigInt is NOT JSON-serializable: every minor-unit amount is converted to a
 * decimal string here, before anything reaches NextResponse.json. Timestamps
 * become ISO 8601. Secrets are never included in GET payloads.
 *
 * Parameter types are structural (not Prisma payload types) so routes can
 * select exactly the columns they need.
 */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

export interface ProviderInfo {
  id: string
  code: string
  name: string
  railType: string
  mode: string
}

export interface PaymentLike {
  id: string
  reference: string
  status: string
  amountMinor: bigint
  feeMinor: bigint
  refundedMinor: bigint
  currency: string
  direction: string
  method: string
  customerEmail: string | null
  description: string | null
  riskDecision: string | null
  riskScore: number | null
  provider: ProviderInfo | null
  providerReference: string | null
  ledgerTransactionId: string | null
  failureReason: string | null
  timeline: string | null
  idempotencyKey: string | null
  createdAt: Date
  settledAt: Date | null
  failedAt: Date | null
  updatedAt: Date
}

export interface PaymentSummaryLike {
  id: string
  reference: string
  status: string
  amountMinor: bigint
  feeMinor: bigint
  currency: string
  method: string
  direction: string
  customerEmail: string | null
  riskDecision: string | null
  riskScore: number | null
  createdAt: Date
  settledAt: Date | null
}

export interface WalletLike {
  id: string
  label: string
  type: string
  currency: string
  status: string
  description: string | null
  createdAt: Date
}

export interface LedgerEntryLike {
  direction: string
  amountMinor: bigint
  currency: string
  account: { code: string; name: string; type: string; isSystemAccount: boolean }
}

export interface TransactionLike {
  id: string
  reference: string
  description: string
  source: string
  status: string
  amountMinor: bigint
  currency: string
  effectiveAt: Date
  postedAt: Date | null
  createdAt: Date
  actorType: string
  actorId: string | null
  actorLabel: string | null
  entries: LedgerEntryLike[]
}

export interface InvoiceLike {
  id: string
  number: string
  status: string
  currency: string
  subtotalMinor: bigint
  taxMinor: bigint
  discountMinor: bigint
  totalMinor: bigint
  amountPaidMinor: bigint
  customer: { id: string; name: string; email: string | null } | null
  issuedAt: Date | null
  dueAt: Date | null
  paidAt: Date | null
  createdAt: Date
}

export interface WebhookEndpointLike {
  id: string
  url: string
  description: string | null
  events: string
  status: string
  createdAt: Date
}

export function serializePayment(p: PaymentLike) {
  return {
    id: p.id,
    reference: p.reference,
    status: p.status,
    amountMinor: p.amountMinor.toString(),
    feeMinor: p.feeMinor.toString(),
    refundedMinor: p.refundedMinor.toString(),
    currency: p.currency,
    direction: p.direction,
    method: p.method,
    customerEmail: p.customerEmail,
    description: p.description,
    risk: p.riskDecision
      ? { decision: p.riskDecision, score: p.riskScore ?? 0 }
      : null,
    provider: p.provider
      ? { id: p.provider.id, code: p.provider.code, name: p.provider.name, railType: p.provider.railType, mode: p.provider.mode }
      : null,
    providerReference: p.providerReference,
    ledgerTransactionId: p.ledgerTransactionId,
    failureReason: p.failureReason,
    timeline: safeJson<{ at: string; event: string; detail: string }[]>(p.timeline, []),
    idempotencyKey: p.idempotencyKey,
    createdAt: p.createdAt.toISOString(),
    settledAt: iso(p.settledAt),
    failedAt: iso(p.failedAt),
    updatedAt: p.updatedAt.toISOString(),
  }
}

export function serializePaymentSummary(p: PaymentSummaryLike) {
  return {
    id: p.id,
    reference: p.reference,
    status: p.status,
    amountMinor: p.amountMinor.toString(),
    feeMinor: p.feeMinor.toString(),
    currency: p.currency,
    method: p.method,
    direction: p.direction,
    customerEmail: p.customerEmail,
    riskDecision: p.riskDecision,
    riskScore: p.riskScore,
    createdAt: p.createdAt.toISOString(),
    settledAt: iso(p.settledAt),
  }
}

export function serializeWallet(w: WalletLike, ledgerMinor: bigint) {
  return {
    id: w.id,
    label: w.label,
    type: w.type,
    currency: w.currency,
    status: w.status,
    description: w.description,
    ledgerMinor: ledgerMinor.toString(),
    createdAt: w.createdAt.toISOString(),
  }
}

export function serializeTransaction(t: TransactionLike) {
  return {
    id: t.id,
    reference: t.reference,
    description: t.description,
    source: t.source,
    status: t.status,
    amountMinor: t.amountMinor.toString(),
    currency: t.currency,
    effectiveAt: t.effectiveAt.toISOString(),
    postedAt: iso(t.postedAt),
    createdAt: t.createdAt.toISOString(),
    actor: { type: t.actorType, id: t.actorId, label: t.actorLabel },
    entries: t.entries.map((e) => ({
      direction: e.direction,
      amountMinor: e.amountMinor.toString(),
      currency: e.currency,
      account: {
        code: e.account.code,
        name: e.account.name,
        type: e.account.type,
        isSystemAccount: e.account.isSystemAccount,
      },
    })),
  }
}

export function serializeInvoice(inv: InvoiceLike) {
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    currency: inv.currency,
    subtotalMinor: inv.subtotalMinor.toString(),
    taxMinor: inv.taxMinor.toString(),
    discountMinor: inv.discountMinor.toString(),
    totalMinor: inv.totalMinor.toString(),
    amountPaidMinor: inv.amountPaidMinor.toString(),
    customer: inv.customer
      ? { id: inv.customer.id, name: inv.customer.name, email: inv.customer.email }
      : null,
    issuedAt: iso(inv.issuedAt),
    dueAt: iso(inv.dueAt),
    paidAt: iso(inv.paidAt),
    createdAt: inv.createdAt.toISOString(),
  }
}

export function serializeWebhookEndpoint(e: WebhookEndpointLike, secret?: string) {
  const out: Record<string, unknown> = {
    id: e.id,
    url: e.url,
    description: e.description,
    events: safeJson<string[]>(e.events, []),
    status: e.status,
    createdAt: e.createdAt.toISOString(),
  }
  // The signing secret is returned exactly once, at creation time.
  if (secret !== undefined) out.secret = secret
  return out
}
