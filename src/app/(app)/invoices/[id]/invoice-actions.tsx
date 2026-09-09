'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Money, type CurrencyCode } from '@novera/money'
import { PAYMENT_METHODS, METHOD_META } from '@novera/domain'
import { toast } from '@/hooks/use-toast'
import { MoneyText } from '@/components/novera/money-text'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Bell,
  Ban,
  CreditCard,
  Loader2,
  Send,
} from 'lucide-react'
import {
  cancelInvoiceAction,
  issueInvoiceAction,
  recordInvoicePaymentAction,
  sendInvoiceReminderAction,
} from '../actions'

export interface InvoiceActionView {
  id: string
  number: string
  storedStatus: string
  displayStatus: string
  currency: string
  totalMinor: string
  amountPaidMinor: string
  issuedAt: string | null
  dueAt: string | null
  reminderCount: number
}

/** Method options offered for a manual collection against this invoice. */
const METHODS = PAYMENT_METHODS.filter((m) => m !== 'USDC') as readonly string[]

export function InvoiceActions({ invoice }: { invoice: InvoiceActionView }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [payOpen, setPayOpen] = useState(false)

  const balanceMinor = BigInt(invoice.totalMinor) - BigInt(invoice.amountPaidMinor)
  const currency = invoice.currency as CurrencyCode
  const defaultAmount = useMemo(
    () => Money.fromMinor(balanceMinor, invoice.currency).toMajorString(),
    [balanceMinor, invoice.currency]
  )

  const isDraft = invoice.storedStatus === 'DRAFT'
  const collectable =
    invoice.issuedAt !== null &&
    invoice.storedStatus !== 'PAID' &&
    invoice.storedStatus !== 'CANCELLED'
  const remindable = collectable
  const cancellable = invoice.storedStatus !== 'PAID' && invoice.storedStatus !== 'CANCELLED'

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: () => void) {
    startTransition(async () => {
      const result = await fn()
      if (!result.ok) {
        toast({ title: 'Action failed', description: result.error ?? 'Unexpected error', variant: 'destructive' })
        return
      }
      success()
      router.refresh()
    })
  }

  if (invoice.storedStatus === 'PAID') {
    return (
      <span className="text-sm text-muted-foreground" aria-label="Invoice fully paid">
        Paid in full — no actions
      </span>
    )
  }
  if (invoice.storedStatus === 'CANCELLED') {
    return (
      <span className="text-sm text-muted-foreground" aria-label="Invoice cancelled">
        Cancelled — no actions
      </span>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isDraft ? (
        <Button
          size="sm"
          className="h-9"
          disabled={pending}
          onClick={() =>
            run(() => issueInvoiceAction(invoice.id), () =>
              toast({
                title: `Invoice ${invoice.number} issued`,
                description: 'Status moved DRAFT → ISSUED and the issue was audited.',
              })
            )
          }
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Issue
        </Button>
      ) : null}

      {remindable ? (
        <Button
          size="sm"
          variant="outline"
          className="h-9"
          disabled={pending}
          onClick={() =>
            run(() => sendInvoiceReminderAction(invoice.id), () =>
              toast({
                title: 'Reminder marked as sent',
                description: `Reminder #${invoice.reminderCount + 1} recorded for ${invoice.number} — audit trail updated.`,
              })
            )
          }
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
          Mark sent reminder
        </Button>
      ) : null}

      {collectable ? <RecordPaymentDialog
        invoice={invoice}
        open={payOpen}
        onOpenChange={setPayOpen}
        defaultAmount={defaultAmount}
        balanceMinor={balanceMinor}
      /> : null}

      {cancellable ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-9 text-danger border-danger/30 hover:bg-danger/10" disabled={pending}>
              <Ban className="h-4 w-4" />
              Cancel
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel invoice {invoice.number}?</AlertDialogTitle>
              <AlertDialogDescription>
                The invoice moves to CANCELLED and can no longer collect payments.{' '}
                {BigInt(invoice.amountPaidMinor) > 0n ? (
                  <>
                    <strong className="text-warning">
                      {Money.fromMinor(invoice.amountPaidMinor, invoice.currency).format()} has
                      already been paid
                    </strong>{' '}
                    — those payments and their ledger entries remain on record.
                  </>
                ) : (
                  'No payments have been recorded against it.'
                )}{' '}
                The cancellation is written to the audit hash chain.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Keep invoice</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                className="bg-danger text-danger-foreground hover:bg-danger/90"
                onClick={(e) => {
                  e.preventDefault()
                  run(() => cancelInvoiceAction(invoice.id), () =>
                    toast({
                      title: `Invoice ${invoice.number} cancelled`,
                      description: 'Audited as WARN severity; stored status is now CANCELLED.',
                    })
                  )
                }}
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Cancel invoice
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}

function RecordPaymentDialog({
  invoice,
  open,
  onOpenChange,
  defaultAmount,
  balanceMinor,
}: {
  invoice: InvoiceActionView
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultAmount: string
  balanceMinor: bigint
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [method, setMethod] = useState<string>('MPESA')
  const [amount, setAmount] = useState(defaultAmount)
  const [reference, setReference] = useState('')

  function submit() {
    startTransition(async () => {
      const result = await recordInvoicePaymentAction(invoice.id, method, amount, reference)
      if (!result.ok) {
        toast({ title: 'Payment not recorded', description: result.error ?? 'Unexpected error', variant: 'destructive' })
        return
      }
      onOpenChange(false)
      toast({
        title: `Payment ${result.paymentReference} → ${result.paymentStatus}`,
        description: `${result.detail} Ref: ${result.paymentReference}.`,
      })
      router.refresh()
    })
  }

  return (
    <>
      <Button size="sm" className="h-9" onClick={() => onOpenChange(true)}>
        <CreditCard className="h-4 w-4" />
        Record payment
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment · {invoice.number}</DialogTitle>
            <DialogDescription>
              Runs a real collection through the payments kernel against this invoice: risk is
              evaluated first, then the sandbox rail, then the ledger. The kernel applies the
              result to the invoice — it may flip to PARTIALLY_PAID or PAID.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Balance due</span>
                <MoneyText minor={balanceMinor} currency={invoice.currency} strong />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-method">Method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="pay-method" className="w-full" aria-label="Payment method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_META[m]?.label ?? m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                TEST MODE — deterministic sandbox rails only; no real money moves.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-amount">Amount</Label>
              <div className="relative">
                <Input
                  id="pay-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={defaultAmount}
                  aria-label={`Amount in ${invoice.currency}`}
                  className="pr-14 tabular"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {invoice.currency}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pay-reference">Reference (optional)</Label>
              <Input
                id="pay-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. EFT-91234 / M-Pesa code"
                aria-label="Payment reference"
              />
            </div>

            <Separator />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Outcomes are honest: risk may <span className="text-warning">hold</span> the payment
              for review or the rail may <span className="text-danger">fail</span> — in those cases
              the invoice stays exactly as it is.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Back
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
