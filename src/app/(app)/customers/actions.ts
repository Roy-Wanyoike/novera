'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/audit'

/**
 * CUSTOMERS — server actions. Payer profiles are control-plane records:
 * no money math here, but every create is audited and org-scoped.
 */

export interface NewCustomerInput {
  name: string
  email: string
  phone: string
}

export interface CustomerActionOutcome {
  ok: boolean
  error?: string
  customerId?: string
}

const RISK_TIERS = ['LOW', 'MEDIUM', 'HIGH'] as const

export async function createCustomerAction(input: NewCustomerInput): Promise<CustomerActionOutcome> {
  const session = await requireSession()
  const orgId = session.organization.id

  const name = (input.name ?? '').trim()
  const email = (input.email ?? '').trim().toLowerCase()
  const phone = (input.phone ?? '').trim() || null

  if (name.length < 2) {
    return { ok: false, error: 'Customer name must be at least 2 characters' }
  }
  if (name.length > 120) {
    return { ok: false, error: 'Customer name is too long (max 120 characters)' }
  }
  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address, or leave it empty' }
  }
  if (phone !== null && phone.length > 32) {
    return { ok: false, error: 'Phone number is too long (max 32 characters)' }
  }

  // New customers start at the baseline risk tier; the risk engine owns it after that.
  const riskTier: (typeof RISK_TIERS)[number] = 'LOW'

  const customer = await db.customer.create({
    data: {
      organizationId: orgId,
      name,
      email: email === '' ? null : email,
      phone,
      riskTier,
    },
    select: { id: true },
  })

  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'customer.created',
    resourceType: 'Customer',
    resourceId: customer.id,
    description: `Customer "${name}" created${email ? ` (${email})` : ''}`,
    metadata: { name, email: email || null, phone, riskTier },
  })

  revalidatePath('/customers')
  revalidatePath('/invoices')

  return { ok: true, customerId: customer.id }
}
