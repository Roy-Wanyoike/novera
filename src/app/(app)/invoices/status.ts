/**
 * Invoice presentation helpers — shared by the invoices and customers routes.
 *
 * OVERDUE is an *honest display derivation*: an issued/viewed/partially-paid
 * invoice whose due date has passed. The stored row is never mutated here —
 * the data below the UI stays exactly what the kernel wrote.
 */

import { INVOICE_STATUSES } from '@novera/domain'

/** Statuses that still owe money (used for outstanding + "open invoices" counts). */
export const OPEN_INVOICE_STATUSES = ['ISSUED', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'] as const

export function isOpenInvoiceStatus(status: string): boolean {
  return (OPEN_INVOICE_STATUSES as readonly string[]).includes(status)
}

export function isInvoiceStatusValue(status: string): boolean {
  return (INVOICE_STATUSES as readonly string[]).includes(status)
}

/**
 * Derive the status to display. A stored ISSUED/VIEWED/PARTIALLY_PAID invoice
 * past its due date renders as OVERDUE — without touching the stored status.
 */
export function displayInvoiceStatus(invoice: {
  status: string
  dueAt: Date | null
}): string {
  const live =
    invoice.status === 'ISSUED' ||
    invoice.status === 'VIEWED' ||
    invoice.status === 'PARTIALLY_PAID'
  if (live && invoice.dueAt !== null && invoice.dueAt.getTime() < Date.now()) {
    return 'OVERDUE'
  }
  return invoice.status
}

/** Sum a projection of invoices per currency — money never crosses currencies. */
export function sumByCurrency<T>(
  rows: T[],
  project: (row: T) => { currency: string; minor: bigint } | null
): Map<string, bigint> {
  const out = new Map<string, bigint>()
  for (const row of rows) {
    const v = project(row)
    if (!v || v.minor <= 0n) continue
    out.set(v.currency, (out.get(v.currency) ?? 0n) + v.minor)
  }
  return out
}
