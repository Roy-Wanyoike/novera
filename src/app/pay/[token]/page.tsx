import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { CheckoutForm } from './checkout-form'
import { EmptyState } from '@/components/novera/empty-state'
import { Archive, LinkIcon } from 'lucide-react'

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const link = await db.paymentLink.findUnique({ where: { token }, select: { label: true } })
  return {
    title: link ? `${link.label} · Checkout` : 'Checkout · Novera',
    robots: { index: false, follow: false },
  }
}

/**
 * PUBLIC HOSTED CHECKOUT — /pay/{token}
 *
 * Resolves the token WITHOUT session scoping (it is a public route), but
 * only the minimum is exposed: org display name, link label, amount. No
    * internal ids, usage stats or revenue ever reach this page.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const link = await db.paymentLink.findUnique({
    where: { token },
    select: {
      label: true,
      type: true,
      amountMinor: true,
      currency: true,
      status: true,
      organization: { select: { name: true } },
    },
  })

  if (!link) {
    return (
      <EmptyState
        icon={<LinkIcon className="h-5 w-5" />}
        title="Link not found"
        description="This checkout link doesn't exist — it may have been mistyped or deleted by the merchant."
      />
    )
  }

  if (link.status !== 'ACTIVE') {
    return (
      <EmptyState
        icon={<Archive className="h-5 w-5" />}
        title="This link is no longer accepting payments"
        description="The merchant has archived it. Reach out to them directly if you still need to pay."
      />
    )
  }

  return (
    <CheckoutForm
      token={token}
      orgName={link.organization.name}
      label={link.label}
      type={link.type}
      currency={link.currency}
      fixedAmountMinor={link.amountMinor !== null ? link.amountMinor.toString() : null}
    />
  )
}
