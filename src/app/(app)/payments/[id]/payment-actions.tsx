'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { refundPaymentAction, retryPaymentAction, markDisputedAction } from '../actions'
import { AlertTriangle, Loader2, RotateCcw, Undo2 } from 'lucide-react'

function statusText(status: string, failureReason: string | null): string {
  switch (status) {
    case 'SETTLED':
      return 'Settled — compensating ledger entries posted.'
    case 'REFUNDED':
      return 'Fully refunded — compensating ledger entries posted.'
    case 'PENDING':
      return 'Held for manual review by risk rules.'
    case 'FAILED':
      return `Failed — ${failureReason ?? 'provider reported failure'}`
    default:
      return `Status: ${status.toLowerCase()}`
  }
}

/** Retry (FAILED payments) — creates a fresh intent with the same details. */
export function RetryPaymentButton({ paymentId }: { paymentId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await retryPaymentAction(paymentId)
          if (result.ok) {
            toast({
              title: `Retry ${result.reference} created`,
              description: statusText(result.status, result.failureReason),
            })
            router.refresh()
          } else {
            toast({ title: 'Retry not created', description: result.error, variant: 'destructive' })
          }
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
      Retry
    </Button>
  )
}

/** Refund (SETTLED payments) — full by default, partial allowed. */
export function RefundPaymentDialog({
  paymentId,
  currency,
  remainingMinor,
  remainingMajor,
}: {
  paymentId: string
  currency: string
  remainingMinor: string
  remainingMajor: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [amount, setAmount] = useState(remainingMajor)

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await refundPaymentAction(paymentId, formData)
      if (result.ok) {
        toast({
          title: `Refund posted on ${result.reference}`,
          description: statusText(result.status, result.failureReason),
        })
        setOpen(false)
        router.refresh()
      } else {
        toast({ title: 'Refund not posted', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setAmount(remainingMajor) }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Undo2 className="h-4 w-4" />
          Refund
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Refund payment</DialogTitle>
          <DialogDescription>
            Posts compensating double-entry lines against the settlement (wallet and fee legs). The
            payment moves to REFUNDED when the full amount is returned.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="refund-amount">Amount ({currency})</Label>
            <Input
              id="refund-amount"
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoComplete="off"
              aria-describedby="refund-hint"
            />
            <p id="refund-hint" className="text-xs text-muted-foreground">
              Up to <span className="font-medium tabular">{remainingMajor}</span> {currency} remains refundable on this payment.
            </p>
          </div>
          <input type="hidden" name="remainingMinor" value={remainingMinor} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? 'Posting…' : 'Post refund'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Mark disputed (SETTLED payments) — legal transition + audit event. */
export function MarkDisputedDialog({ paymentId, reference }: { paymentId: string; reference: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function onSubmit(formData: FormData) {
    const note = String(formData.get('note') ?? '')
    startTransition(async () => {
      const result = await markDisputedAction(paymentId, note)
      if (result.ok) {
        toast({
          title: `${reference} marked as disputed`,
          description: 'Status moved to DISPUTED and recorded in the audit chain.',
        })
        setOpen(false)
        router.refresh()
      } else {
        toast({ title: 'Not updated', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <AlertTriangle className="h-4 w-4" />
          Mark disputed
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {reference} as disputed</DialogTitle>
          <DialogDescription>
            Flags the settled payment as under dispute. The funds stay recorded as they are — this
            is a state flag with an audit trail, not a reversal. Refunds from DISPUTED remain
            possible.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dispute-note">
              Dispute note <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="dispute-note"
              name="note"
              rows={3}
              placeholder="Chargeback raised by issuing bank, case #…"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? 'Recording…' : 'Mark as disputed'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
