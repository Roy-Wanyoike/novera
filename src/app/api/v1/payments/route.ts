import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Money, MoneyError } from '@novera/money'
import { PAYMENT_STATUSES, PAYMENT_METHODS } from '@novera/domain'
import { createPayment, PaymentError } from '@/lib/payments'
import { withApiKey, okJson, errorJson, parseLimit } from '../_lib/auth'
import { serializePayment, serializePaymentSummary } from '../_lib/serialize'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface CreatePaymentBody {
  amount?: unknown
  currency?: unknown
  method?: unknown
  customerEmail?: unknown
  description?: unknown
  idempotencyKey?: unknown
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * GET /api/v1/payments?status=&limit= — org-scoped payment list.
 * Scope: payments:write | wallets:read
 */
export async function GET(req: NextRequest) {
  return withApiKey(req, ['payments:write', 'wallets:read'], async (key) => {
    const url = new URL(req.url)
    const limit = parseLimit(url.searchParams.get('limit'), 25, 100)
    if (limit === null) {
      return errorJson(400, 'INVALID_ARGUMENT', 'Query parameter "limit" must be an integer between 1 and 100.')
    }
    const status = url.searchParams.get('status')
    if (status && !(PAYMENT_STATUSES as readonly string[]).includes(status)) {
      return errorJson(
        400,
        'INVALID_ARGUMENT',
        `Unknown payment status "${status}". Valid values: ${PAYMENT_STATUSES.join(', ')}.`
      )
    }

    const payments = await db.payment.findMany({
      where: {
        organizationId: key.organizationId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        reference: true,
        status: true,
        amountMinor: true,
        feeMinor: true,
        currency: true,
        method: true,
        direction: true,
        customerEmail: true,
        riskDecision: true,
        riskScore: true,
        createdAt: true,
        settledAt: true,
      },
    })

    return okJson({
      payments: payments.map(serializePaymentSummary),
      count: payments.length,
      ...(status ? { filter: { status } } : {}),
    })
  })
}

/**
 * POST /api/v1/payments — create a payment intent.
 *
 * Body: {amount: decimal string, currency, method, customerEmail?,
 *        description?, idempotencyKey?}
 * The kernel runs risk BEFORE the rail, posts balanced ledger entries on
 * settlement and emits webhooks. Idempotency: a repeated idempotencyKey
 * returns the original payment unchanged.
 * Scope: payments:write
 */
export async function POST(req: NextRequest) {
  return withApiKey(req, ['payments:write'], async (key) => {
    let body: CreatePaymentBody
    try {
      body = (await req.json()) as CreatePaymentBody
    } catch {
      return errorJson(400, 'INVALID_ARGUMENT', 'Request body must be valid JSON.')
    }

    const amount = str(body.amount)
    const currency = str(body.currency)
    const method = str(body.method)
    const customerEmail = str(body.customerEmail)
    const description = str(body.description)
    const headerKey = req.headers.get('idempotency-key')
    const idempotencyKey = str(body.idempotencyKey) ?? headerKey

    if (!amount) return errorJson(400, 'INVALID_ARGUMENT', '"amount" is required (decimal string, e.g. "1250.00").')
    if (!currency) return errorJson(400, 'INVALID_ARGUMENT', '"currency" is required (e.g. "KES").')
    if (!method) return errorJson(400, 'INVALID_ARGUMENT', `"method" is required. Valid methods: ${PAYMENT_METHODS.join(', ')}.`)
    if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
      return errorJson(400, 'INVALID_ARGUMENT', `Unknown method "${method}". Valid methods: ${PAYMENT_METHODS.join(', ')}.`)
    }
    if (idempotencyKey && idempotencyKey.length > 255) {
      return errorJson(400, 'INVALID_ARGUMENT', '"idempotencyKey" must be at most 255 characters.')
    }

    // Exact decimal parsing — no floats ever touch the money path.
    let money: Money
    try {
      money = Money.fromMajor(amount, currency)
    } catch (err) {
      if (err instanceof MoneyError) {
        return errorJson(400, 'INVALID_ARGUMENT', `Invalid amount/currency: ${err.message}`)
      }
      throw err
    }
    if (!money.isPositive()) {
      return errorJson(400, 'INVALID_ARGUMENT', '"amount" must be greater than zero.')
    }
    if (customerEmail && !EMAIL_RE.test(customerEmail)) {
      return errorJson(400, 'INVALID_ARGUMENT', '"customerEmail" must be a valid email address.')
    }

    // Idempotent replay: return the original payment untouched.
    if (idempotencyKey) {
      const existing = await db.payment.findFirst({
        where: { organizationId: key.organizationId, idempotencyKey },
        include: { provider: true },
      })
      if (existing) {
        return okJson(serializePayment(existing), 200)
      }
    }

    let paymentError: string | null = null
    let created: Awaited<ReturnType<typeof createPayment>> = null
    try {
      created = await createPayment({
        organizationId: key.organizationId,
        amountMinor: money.minor,
        currency: money.currency,
        method,
        customerEmail,
        description,
        idempotencyKey,
        actor: { type: 'SERVICE', id: key.id, label: `apikey:${key.name}` },
      })
    } catch (err) {
      if (err instanceof PaymentError) {
        paymentError = err.message
      } else {
        throw err
      }
    }
    if (paymentError !== null) {
      return errorJson(422, 'PAYMENT_ERROR', paymentError)
    }
    if (!created || created.organizationId !== key.organizationId) {
      // The global idempotencyKey uniqueness can collide across orgs in the
      // reference kernel — refuse to leak another org's record.
      return errorJson(422, 'PAYMENT_ERROR', 'This idempotencyKey is already in use by another resource.')
    }

    const withProvider = await db.payment.findUnique({
      where: { id: created.id },
      include: { provider: true },
    })
    if (!withProvider) {
      return errorJson(500, 'INTERNAL', 'Payment was created but could not be read back.')
    }

    // A failed payment is still a successful API call — the object carries
    // status + failureReason. No fake success.
    return okJson(serializePayment(withProvider), 201)
  })
}
