'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { MoneyText } from '@/components/novera/money-text'
import { EmptyState } from '@/components/novera/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CheckCircle2, Inbox, ShieldQuestion, XCircle } from 'lucide-react'
import { approveReviewPayment, declineReviewPayment } from './actions'

export interface ReviewQueueRow {
  id: string
  reference: string
  customerName: string
  amountMinor: string
  currency: string
  method: string
  riskScore: number | null
  reasons: string[]
  createdAt: string
}

/** The manual risk review queue — where PENDING review payments get resolved. */
export function ReviewQueue({ rows }: { rows: ReviewQueueRow[] }) {
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [declineTarget, setDeclineTarget] = useState<ReviewQueueRow | null>(null)

  function approve(row: ReviewQueueRow) {
    setBusyId(row.id)
    startTransition(async () => {
      const result = await approveReviewPayment(row.id)
      if (result.ok) {
        toast({ title: 'Payment approved', description: result.message })
      } else {
        toast({ title: 'Could not approve', description: result.message, variant: 'destructive' })
      }
      setBusyId(null)
    })
  }

  function confirmDecline() {
    const row = declineTarget
    if (!row) return
    setDeclineTarget(null)
    setBusyId(row.id)
    startTransition(async () => {
      const result = await declineReviewPayment(row.id)
      if (result.ok) {
        toast({ title: 'Payment declined', description: result.message })
      } else {
        toast({ title: 'Could not decline', description: result.message, variant: 'destructive' })
      }
      setBusyId(null)
    })
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-5 w-5" />}
        title="Review queue is clear"
        description="Payments whose risk evaluation lands on REVIEW are held here until an operator approves or declines them."
      />
    )
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Reasons</TableHead>
              <TableHead>Held since</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const busy = pending && busyId === row.id
              return (
                <TableRow key={row.id} className={busy ? 'opacity-60' : undefined}>
                  <TableCell>
                    <Link
                      href={`/payments/${row.id}`}
                      className="font-mono text-xs font-medium text-primary hover:underline"
                    >
                      {row.reference}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm font-medium">{row.customerName}</div>
                    <div className="text-xs text-muted-foreground">{row.method}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <MoneyText minor={row.amountMinor} currency={row.currency} strong />
                  </TableCell>
                  <TableCell>
                    <span className="tabular text-sm font-semibold text-warning">
                      {row.riskScore ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <ul className="space-y-0.5">
                      {row.reasons.slice(0, 3).map((reason, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <ShieldQuestion className="mt-0.5 h-3 w-3 shrink-0 text-warning/80" aria-hidden />
                          <span className="leading-snug">{reason}</span>
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {row.createdAt}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-8 gap-1.5"
                        disabled={pending}
                        onClick={() => approve(row)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        {busy ? 'Working…' : 'Approve & settle'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 border-danger/30 text-danger hover:bg-danger/10 hover:text-danger"
                        disabled={pending}
                        onClick={() => setDeclineTarget(row)}
                      >
                        <XCircle className="h-3.5 w-3.5" aria-hidden />
                        Decline
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={declineTarget !== null} onOpenChange={(open) => !open && setDeclineTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline this payment?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <span className="block">
                  <span className="font-mono">{declineTarget?.reference}</span> for{' '}
                  {declineTarget ? (
                    <MoneyText minor={declineTarget.amountMinor} currency={declineTarget.currency} />
                  ) : null}{' '}
                  will be marked FAILED with reason &ldquo;Declined in manual review&rdquo;. The decision is
                  written to the tamper-evident audit trail.
                </span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep in queue</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={(e) => {
                e.preventDefault()
                confirmDecline()
              }}
            >
              Decline payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
