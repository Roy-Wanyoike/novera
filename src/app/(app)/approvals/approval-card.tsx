'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, Loader2, Timer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyText } from '@/components/novera/money-text'
import { ToneBadge } from '@/components/novera/status-badge'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { initials, titleCase, fmtDateTime } from '@/lib/format'
import { decideApprovalAction } from './actions'

export interface PendingApprovalView {
  id: string
  requesterType: string
  requesterName: string
  requesterEmoji: string | null
  action: string
  tool: string | null
  description: string | null
  amountMinor: string | null
  currency: string | null
  merchant: string | null
  toWalletLabel: string | null
  policyReasons: string[]
  createdAt: string
  expiresAt: string | null
  agentId: string | null
}

/** Ticking expiry countdown — warning tone under 24h, danger when lapsed. */
function ExpiryCountdown({ expiresAt }: { expiresAt: string | null }) {
  // Re-render every 30s; the value itself is derived from the clock at render.
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (!expiresAt) return null

  const remaining = new Date(expiresAt).getTime() - Date.now()
  if (remaining <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger" role="timer">
        <Timer className="h-3.5 w-3.5" aria-hidden />
        expired — awaiting cleanup
      </span>
    )
  }

  const days = Math.floor(remaining / 86_400_000)
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  const soon = remaining < 24 * 3_600_000

  return (
    <span
      role="timer"
      aria-label={soon ? 'Expires soon' : 'Expiry countdown'}
      suppressHydrationWarning
      className={cn(
        'inline-flex items-center gap-1.5 text-xs tabular-nums',
        soon ? 'font-medium text-warning' : 'text-muted-foreground'
      )}
    >
      <Timer className={cn('h-3.5 w-3.5', soon && 'animate-pulse')} aria-hidden />
      expires in {days > 0 ? `${days}d ` : ''}
      {hours}h {minutes}m
    </span>
  )
}

/** Pending approval card: payload summary + countdown + note + decision. */
export function ApprovalCard({ approval }: { approval: PendingApprovalView }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [deciding, setDeciding] = useState<'APPROVED' | 'DECLINED' | null>(null)

  const decide = async (decision: 'APPROVED' | 'DECLINED') => {
    setDeciding(decision)
    try {
      const res = await decideApprovalAction(approval.id, decision, note)
      if (res.ok) {
        if (decision === 'APPROVED') {
          toast({
            title: 'Intent executed on the ledger',
            description: `${approval.requesterName}'s proposal was approved and posted as a balanced transaction.`,
          })
        } else {
          toast({
            title: 'Intent rejected',
            description: `${approval.requesterName}'s proposal was declined — nothing moved.`,
          })
        }
        router.refresh()
      } else {
        toast({ title: 'Decision failed', description: res.error, variant: 'destructive' })
      }
    } catch (err) {
      toast({
        title: 'Decision failed',
        description: err instanceof Error ? err.message : 'Unexpected error.',
        variant: 'destructive',
      })
    } finally {
      setDeciding(null)
    }
  }

  const busy = deciding !== null

  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {approval.requesterType === 'AGENT' ? (
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xl"
                aria-hidden
              >
                {approval.requesterEmoji ?? '🤖'}
              </span>
            ) : (
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary"
                aria-hidden
              >
                {initials(approval.requesterName) || '?'}
              </span>
            )}
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium leading-tight">
                <span className="truncate">{approval.requesterName}</span>
                {approval.requesterType === 'AGENT' ? (
                  <span className="text-xs font-normal text-muted-foreground">(agent)</span>
                ) : (
                  <span className="text-xs font-normal text-muted-foreground">(human)</span>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {titleCase(approval.action)}
                {approval.agentId ? (
                  <>
                    {' · '}
                    <Link
                      href={`/agents/${approval.agentId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      view agent
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <ToneBadge tone="warning">Pending</ToneBadge>
        </div>

        {approval.description ? (
          <p className="text-sm leading-relaxed text-foreground/90">{approval.description}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No description provided by the requester.</p>
        )}

        <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-4">
          <div className="space-y-0.5">
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Amount
            </dt>
            <dd>
              {approval.amountMinor && approval.currency ? (
                <MoneyText minor={approval.amountMinor} currency={approval.currency} strong />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Merchant
            </dt>
            <dd className="truncate">{approval.merchant ?? '—'}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Destination
            </dt>
            <dd className="truncate">{approval.toWalletLabel ?? '—'}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Tool
            </dt>
            <dd className="truncate font-mono text-[11px]">{approval.tool ?? '—'}</dd>
          </div>
        </dl>

        {approval.policyReasons.length > 0 ? (
          <ul className="space-y-1 rounded-lg border border-warning/25 bg-warning/5 p-3">
            <li className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Why the policy engine escalated this
            </li>
            {approval.policyReasons.map((reason, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warning/70"
                />
                {reason}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <ExpiryCountdown expiresAt={approval.expiresAt} />
          <span>requested {fmtDateTime(approval.createdAt)}</span>
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor={`note-${approval.id}`} className="text-xs text-muted-foreground">
            Decision note (recorded on the audit chain)
          </Label>
          <Input
            id={`note-${approval.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Quotes verified, contract terms confirmed"
            maxLength={200}
            disabled={busy}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
              onClick={() => void decide('DECLINED')}
              disabled={busy}
            >
              {deciding === 'DECLINED' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <X className="h-4 w-4" aria-hidden />
              )}
              Decline
            </Button>
            <Button
              type="button"
              className="gap-1.5"
              onClick={() => void decide('APPROVED')}
              disabled={busy}
            >
              {deciding === 'APPROVED' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Check className="h-4 w-4" aria-hidden />
              )}
              Approve &amp; execute
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
