import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import {
  PAYMENT_STATUS_META,
  INVOICE_STATUS_META,
  CARD_STATUS_META,
  AGENT_STATUS_META,
  AGENT_INTENT_STATUS_META,
  APPROVAL_STATUS_META,
  RECON_STATUS_META,
  type StatusMeta,
} from '@novera/domain'

/**
 * Tone-mapped status badge — the single way statuses render everywhere.
 * Pages MUST use these for every status column so the whole product
 * speaks one visual language.
 */

const TONE_CLASSES: Record<string, string> = {
  positive: 'bg-success/12 text-success border-success/25 hover:bg-success/15',
  negative: 'bg-danger/12 text-danger border-danger/25 hover:bg-danger/15',
  warning: 'bg-warning/15 text-warning border-warning/30 hover:bg-warning/20',
  info: 'bg-primary/10 text-primary border-primary/25 hover:bg-primary/15',
  accent: 'bg-accent text-accent-foreground border-transparent hover:bg-accent/90',
  neutral: 'bg-muted text-muted-foreground border-border hover:bg-muted/80',
}

export function StatusBadge({
  meta,
  status,
  className,
}: {
  meta: Record<string, StatusMeta>
  status: string
  className?: string
}) {
  const m = meta[status] ?? { label: status.replace(/_/g, ' ').toLowerCase(), tone: 'neutral' }
  return (
    <Badge variant="outline" className={cn('font-medium capitalize', TONE_CLASSES[m.tone] ?? TONE_CLASSES.neutral, className)}>
      {m.label}
    </Badge>
  )
}

export function PaymentStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge meta={PAYMENT_STATUS_META} status={status} className={className} />
}

export function InvoiceStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge meta={INVOICE_STATUS_META} status={status} className={className} />
}

export function CardStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge meta={CARD_STATUS_META} status={status} className={className} />
}

export function AgentStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge meta={AGENT_STATUS_META} status={status} className={className} />
}

export function IntentStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge meta={AGENT_INTENT_STATUS_META} status={status} className={className} />
}

export function ApprovalStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge meta={APPROVAL_STATUS_META} status={status} className={className} />
}

export function ReconStatusBadge({ status, className }: { status: string; className?: string }) {
  return <StatusBadge meta={RECON_STATUS_META} status={status} className={className} />
}

export function ToneBadge({
  tone,
  children,
  className,
}: {
  tone: 'positive' | 'negative' | 'warning' | 'info' | 'accent' | 'neutral'
  children: ReactNode
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn('font-medium', TONE_CLASSES[tone], className)}>
      {children}
    </Badge>
  )
}
