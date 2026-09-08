'use server'

/**
 * PAYMENT LINKS — audited server actions.
 *
 * A payment link is a public, tokenized checkout entry point. Tokens are
 * unguessable (ref.paymentLink), links can be archived (soft-off), and every
 * create/archive lands in the audit hash chain.
 */

import { revalidatePath } from 'next/cache'
import { Money } from '@novera/money'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { recordAudit } from '@/lib/audit'
import { ref } from '@/lib/ids'

export type LinkActionResult =
  | { ok: true; id: string; token: string; label: string }
  | { ok: false; error: string }

const CURRENCIES = new Set(['KES', 'USD', 'USDC', 'EUR', 'GBP', 'NGN', 'TZS', 'UGX', 'ZAR'])
const LINK_TYPES = new Set(['FIXED', 'CUSTOM', 'DONATION', 'TIP'])

/** Create a payment link — returns the public token for /pay/{token}. */
export async function createLinkAction(formData: FormData): Promise<LinkActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const label = String(formData.get('label') ?? '').trim().slice(0, 80)
  const type = String(formData.get('type') ?? '').trim().toUpperCase()
  const currency = String(formData.get('currency') ?? 'KES').trim().toUpperCase()
  const amountRaw = String(formData.get('amount') ?? '').trim()

  if (!label) return { ok: false, error: 'Give the link a label (what the customer is paying for).' }
  if (!LINK_TYPES.has(type)) return { ok: false, error: 'Choose a link type.' }
  if (!CURRENCIES.has(currency)) return { ok: false, error: `Unsupported currency "${currency}".` }

  let amountMinor: bigint | null = null
  if (type === 'FIXED') {
    try {
      const money = Money.fromMajor(amountRaw, currency)
      if (!money.isPositive()) throw new Error('not positive')
      amountMinor = money.minor
    } catch {
      return { ok: false, error: `Fixed-price links need a valid amount in ${currency} (e.g. 2500.00).` }
    }
  }

  const token = ref.paymentLink()
  const link = await db.paymentLink.create({
    data: {
      organizationId: orgId,
      token,
      label,
      type,
      amountMinor,
      currency,
    },
  })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'paymentlink.created',
    resourceType: 'PaymentLink',
    resourceId: link.id,
    description: `Payment link "${label}" created (${type}, ${currency}${amountMinor !== null ? `, fixed ${Money.fromMinor(amountMinor, currency).format()}` : ', customer chooses amount'})`,
    metadata: { token, type, currency, amountMinor: amountMinor?.toString() ?? null },
  })

  revalidatePath('/payment-links')
  return { ok: true, id: link.id, token, label }
}

/** Archive a link — the public checkout stops accepting payments. */
export async function archiveLinkAction(linkId: string): Promise<LinkActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  const link = await db.paymentLink.findFirst({ where: { id: linkId, organizationId: orgId } })
  if (!link) return { ok: false, error: 'Payment link not found in this organization.' }
  if (link.status !== 'ACTIVE') return { ok: false, error: 'This link is already archived.' }

  await db.paymentLink.update({ where: { id: link.id }, data: { status: 'ARCHIVED' } })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'paymentlink.archived',
    resourceType: 'PaymentLink',
    resourceId: link.id,
    description: `Payment link "${link.label}" (${link.token}) archived — public checkout disabled`,
    metadata: { token: link.token, uses: link.uses },
  })

  revalidatePath('/payment-links')
  return { ok: true, id: link.id, token: link.token, label: link.label }
}
