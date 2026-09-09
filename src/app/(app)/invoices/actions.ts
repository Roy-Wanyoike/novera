'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { Money, MoneyError, isCurrency } from '@novera/money'
import { canTransitionInvoice, PAYMENT_METHODS } from '@novera/domain'
import { recordAudit } from '@/lib/audit'
import { ref } from '@/lib/ids'
import { createPayment } from '@/lib/payments'

/**
 * INVOICES — server actions.
 *
 * Money rule: every amount is parsed with Money.fromMajor() into BigInt
 * minor units on the SERVER. The client only ever sends decimal strings.
 * Totals are computed with pure BigInt arithmetic (tax at bps, half-up).
 * All queries are organization-scoped; every mutation is audited.
 */

export interface NewInvoiceLineInput {
  description: string
  quantity: number
  unitMajor: string
}

export interface NewInvoiceInput {
  customerId: string
  currency: string
  taxRatePct: string
  dueDate: string | null // 'YYYY-MM-DD' from <input type="date">
  notes: string
  items: NewInvoiceLineInput[]
}

export interface ActionOutcome {
  ok: boolean
  error?: string
  invoiceId?: string
  number?: string
}

export interface ReminderOutcome extends ActionOutcome {
  reminderCount?: number
}

export interface PaymentRecordOutcome extends ActionOutcome {
  paymentStatus?: string
  paymentReference?: string
  invoiceStatus?: string
  detail?: string
}

const MAX_ITEMS = 40
const MAX_QTY = 1_000_000

function actor(session: Awaited<ReturnType<typeof requireSession>>) {
  return {
    type: 'USER' as const,
    id: session.user.id,
    label: session.user.name,
  }
}

/** Half-up scaled rate application in pure BigInt (no floats in money math). */
function applyBpsHalfUp(amountMinor: bigint, bps: number): bigint {
  const scaled = amountMinor * BigInt(Math.round(bps))
  const divisor = 10000n
  const quotient = scaled / divisor
  const remainder = scaled % divisor
  // half-up for non-negative amounts and rates
  if (remainder * 2n >= divisor) return quotient + 1n
  return quotient
}

/** Create an invoice (DRAFT, or straight to ISSUED). Computes totals server-side. */
export async function createInvoiceAction(
  input: NewInvoiceInput,
  mode: 'DRAFT' | 'ISSUED'
): Promise<ActionOutcome> {
  const session = await requireSession()
  const orgId = session.organization.id

  if (mode !== 'DRAFT' && mode !== 'ISSUED') {
    return { ok: false, error: 'Invalid mode' }
  }

  // ── customer (org-scoped) ──
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, organizationId: orgId },
  })
  if (!customer) return { ok: false, error: 'Customer not found in this organization' }

  // ── currency ──
  if (!isCurrency(input.currency)) {
    return { ok: false, error: `Unsupported currency: ${input.currency}` }
  }

  // ── line items ──
  const rawItems = (input.items ?? []).filter(
    (i) => i.description.trim() !== '' || i.unitMajor.trim() !== ''
  )
  if (rawItems.length === 0) {
    return { ok: false, error: 'Add at least one line item with a description and unit price' }
  }
  if (rawItems.length > MAX_ITEMS) {
    return { ok: false, error: `Too many line items (max ${MAX_ITEMS})` }
  }

  const lines: { description: string; quantity: number; unitMinor: bigint; totalMinor: bigint }[] = []
  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i]
    const description = item.description.trim()
    if (!description) {
      return { ok: false, error: `Line ${i + 1}: description is required` }
    }
    const quantity = Number(item.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return { ok: false, error: `Line ${i + 1}: quantity must be a whole number between 1 and ${MAX_QTY}` }
    }
    if (item.unitMajor.trim() === '') {
      return { ok: false, error: `Line ${i + 1}: unit price is required` }
    }
    let unitMinor: bigint
    try {
      // Money.fromMajor validates the decimal string exactly (no floats).
      const unit = Money.fromMajor(item.unitMajor, input.currency)
      if (unit.isNegative()) {
        return { ok: false, error: `Line ${i + 1}: unit price cannot be negative` }
      }
      unitMinor = unit.minor
    } catch (err) {
      if (err instanceof MoneyError) {
        return { ok: false, error: `Line ${i + 1}: ${err.message}` }
      }
      throw err
    }
    lines.push({
      description,
      quantity,
      unitMinor,
      totalMinor: unitMinor * BigInt(quantity),
    })
  }

  // ── totals (BigInt only) ──
  const subtotalMinor = lines.reduce((acc, l) => acc + l.totalMinor, 0n)
  if (subtotalMinor === 0n) {
    return { ok: false, error: 'Invoice total cannot be zero' }
  }

  const taxRate = Number(input.taxRatePct)
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
    return { ok: false, error: 'Tax rate must be between 0 and 100' }
  }
  const taxBps = Math.round(taxRate * 100)
  const taxMinor = applyBpsHalfUp(subtotalMinor, taxBps)
  const discountMinor = 0n
  const totalMinor = subtotalMinor + taxMinor - discountMinor

  // ── due date ──
  let dueAt: Date | null = null
  if (input.dueDate && input.dueDate.trim() !== '') {
    dueAt = new Date(`${input.dueDate}T12:00:00Z`)
    if (Number.isNaN(dueAt.getTime())) {
      return { ok: false, error: 'Invalid due date' }
    }
  }

  const notes = (input.notes ?? '').trim() || null

  // ── next number: existing count + 1, zero-padded (retry on collision) ──
  const existingCount = await db.invoice.count({ where: { organizationId: orgId } })
  let created: { id: string; number: string } | null = null
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const number = ref.invoice(existingCount + 1 + attempt)
    try {
      created = await db.invoice.create({
        data: {
          organizationId: orgId,
          number,
          customerId: customer.id,
          status: mode,
          currency: input.currency,
          subtotalMinor,
          taxMinor,
          discountMinor,
          totalMinor,
          amountPaidMinor: 0n,
          dueAt,
          issuedAt: mode === 'ISSUED' ? new Date() : null,
          notes,
          items: {
            create: lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitMinor: l.unitMinor,
              totalMinor: l.totalMinor,
            })),
          },
        },
        select: { id: true, number: true },
      })
    } catch (err) {
      lastError = err
    }
  }
  if (!created) {
    const message = lastError instanceof Error ? lastError.message : 'unknown error'
    return { ok: false, error: `Could not allocate the next invoice number (${message})` }
  }

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: mode === 'ISSUED' ? 'invoice.issued' : 'invoice.created',
    resourceType: 'Invoice',
    resourceId: created.id,
    description: `Invoice ${created.number} for ${customer.name} ${mode === 'ISSUED' ? 'created and issued' : 'saved as draft'} (${input.currency} ${Money.fromMinor(totalMinor, input.currency).formatPlain()})`,
    metadata: {
      number: created.number,
      customerId: customer.id,
      customerName: customer.name,
      subtotalMinor: subtotalMinor.toString(),
      taxMinor: taxMinor.toString(),
      taxBps,
      totalMinor: totalMinor.toString(),
      currency: input.currency,
      itemCount: lines.length,
      mode,
    },
  })

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${created.id}`)
  revalidatePath('/customers')

  return { ok: true, invoiceId: created.id, number: created.number }
}

/** DRAFT → ISSUED (legal transition guard, audited). */
export async function issueInvoiceAction(invoiceId: string): Promise<ActionOutcome> {
  const session = await requireSession()
  const orgId = session.organization.id

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    include: { customer: true },
  })
  if (!invoice) return { ok: false, error: 'Invoice not found' }

  if (!canTransitionInvoice(invoice.status, 'ISSUED')) {
    return { ok: false, error: `Cannot issue an invoice in status ${invoice.status}` }
  }

  await db.invoice.update({
    where: { id: invoice.id },
    data: { status: 'ISSUED', issuedAt: invoice.issuedAt ?? new Date() },
  })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'invoice.issued',
    resourceType: 'Invoice',
    resourceId: invoice.id,
    description: `Invoice ${invoice.number} issued to ${invoice.customer.name}`,
    metadata: { number: invoice.number, totalMinor: invoice.totalMinor.toString(), currency: invoice.currency },
  })

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoice.id}`)
  return { ok: true, invoiceId: invoice.id, number: invoice.number }
}

/** Mark a payment reminder as sent: bumps reminderCount + lastReminderAt, audited. */
export async function sendInvoiceReminderAction(invoiceId: string): Promise<ReminderOutcome> {
  const session = await requireSession()
  const orgId = session.organization.id

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    include: { customer: true },
  })
  if (!invoice) return { ok: false, error: 'Invoice not found' }

  const notRemindable =
    invoice.issuedAt === null ||
    invoice.status === 'PAID' ||
    invoice.status === 'CANCELLED' ||
    invoice.status === 'DRAFT'
  if (notRemindable) {
    return { ok: false, error: 'Reminders apply to issued, unpaid invoices only' }
  }

  const reminderCount = invoice.reminderCount + 1
  await db.invoice.update({
    where: { id: invoice.id },
    data: { reminderCount, lastReminderAt: new Date() },
  })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'invoice.reminder_sent',
    resourceType: 'Invoice',
    resourceId: invoice.id,
    description: `Payment reminder #${reminderCount} recorded for ${invoice.number} (${invoice.customer.name})`,
    metadata: { number: invoice.number, reminderCount },
  })

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoice.id}`)
  return { ok: true, invoiceId: invoice.id, number: invoice.number, reminderCount }
}

/** Cancel an invoice (legal transition guard, audited). */
export async function cancelInvoiceAction(invoiceId: string): Promise<ActionOutcome> {
  const session = await requireSession()
  const orgId = session.organization.id

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    include: { customer: true },
  })
  if (!invoice) return { ok: false, error: 'Invoice not found' }

  if (!canTransitionInvoice(invoice.status, 'CANCELLED')) {
    return { ok: false, error: `Cannot cancel an invoice in status ${invoice.status}` }
  }

  await db.invoice.update({
    where: { id: invoice.id },
    data: { status: 'CANCELLED' },
  })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'invoice.cancelled',
    resourceType: 'Invoice',
    resourceId: invoice.id,
    description: `Invoice ${invoice.number} cancelled (${invoice.customer.name})`,
    metadata: {
      number: invoice.number,
      previousStatus: invoice.status,
      amountPaidMinor: invoice.amountPaidMinor.toString(),
    },
    severity: 'WARN',
  })

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoice.id}`)
  revalidatePath('/customers')
  return { ok: true, invoiceId: invoice.id, number: invoice.number }
}

/**
 * Record a payment against an invoice. Delegates to the payments kernel
 * (createPayment with invoiceId): risk runs first, then the rail, then the
 * ledger leg — and applyPaymentToInvoice() moves the invoice to
 * PARTIALLY_PAID / PAID on settlement. The outcome reported to the UI is
 * whatever the kernel actually decided. No fake success.
 */
export async function recordInvoicePaymentAction(
  invoiceId: string,
  method: string,
  amountMajor: string,
  reference: string
): Promise<PaymentRecordOutcome> {
  const session = await requireSession()
  const orgId = session.organization.id

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId: orgId },
    include: { customer: true },
  })
  if (!invoice) return { ok: false, error: 'Invoice not found' }

  const payable =
    invoice.issuedAt !== null && invoice.status !== 'PAID' && invoice.status !== 'CANCELLED'
  if (!payable) {
    return { ok: false, error: `Cannot record a payment against a ${invoice.status.toLowerCase()} invoice` }
  }

  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) {
    return { ok: false, error: 'Choose a payment method' }
  }

  let amountMinor: bigint
  try {
    const amount = Money.fromMajor(amountMajor, invoice.currency)
    if (!amount.isPositive()) {
      return { ok: false, error: 'Amount must be greater than zero' }
    }
    amountMinor = amount.minor
  } catch (err) {
    if (err instanceof MoneyError) {
      return { ok: false, error: `Amount: ${err.message}` }
    }
    throw err
  }

  const payment = await createPayment({
    organizationId: orgId,
    amountMinor,
    currency: invoice.currency,
    method,
    direction: 'IN',
    customerId: invoice.customer.id,
    customerName: invoice.customer.name,
    customerEmail: invoice.customer.email,
    description: [reference.trim(), `Invoice ${invoice.number} payment`]
      .filter(Boolean)
      .join(' — '),
    invoiceId: invoice.id,
    idempotencyKey: `invpay:${invoice.id}:${Date.now().toString(36)}:${amountMinor.toString(36)}`,
    actor: actor(session),
  })

  if (!payment) return { ok: false, error: 'The payments kernel rejected this payment' }

  // The kernel owns the invoice state — read back what actually happened.
  const after = await db.invoice.findUnique({ where: { id: invoice.id } })

  let detail: string
  switch (payment.status) {
    case 'SETTLED':
      detail =
        after && after.amountPaidMinor < after.totalMinor
          ? 'Kernel settled the payment — invoice moved to PARTIALLY_PAID.'
          : 'Kernel settled the payment — invoice is now PAID.'
      break
    case 'PENDING':
      detail = 'Kernel held the payment for risk review — the invoice is unchanged until it settles.'
      break
    case 'FAILED':
      detail = `Kernel reported failure (${payment.failureReason ?? 'risk or rail declined'}) — the invoice is unchanged.`
      break
    default:
      detail = `Kernel status: ${payment.status} — the invoice is unchanged until settlement.`
  }

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'invoice.payment_recorded',
    resourceType: 'Invoice',
    resourceId: invoice.id,
    description: `Payment ${payment.reference} (${payment.method} ${Money.fromMinor(amountMinor, invoice.currency).format()}) recorded against ${invoice.number} → kernel status ${payment.status}`,
    metadata: {
      invoiceNumber: invoice.number,
      paymentId: payment.id,
      paymentReference: payment.reference,
      amountMinor: amountMinor.toString(),
      method,
      kernelStatus: payment.status,
      invoiceStatusAfter: after?.status ?? null,
    },
  })

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoice.id}`)
  revalidatePath('/customers')
  revalidatePath(`/payments/${payment.id}`)

  return {
    ok: true,
    invoiceId: invoice.id,
    paymentStatus: payment.status,
    paymentReference: payment.reference,
    invoiceStatus: after?.status ?? invoice.status,
    detail,
  }
}
