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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { METHOD_META } from '@novera/domain'
import { createPaymentAction } from './actions'
import { Loader2, Plus } from 'lucide-react'

const CURRENCIES = ['KES', 'USD', 'USDC', 'EUR', 'GBP', 'NGN', 'TZS', 'UGX', 'ZAR'] as const

/** Honest, human status text — never dressed up. */
function statusWord(status: string): string {
  switch (status) {
    case 'SETTLED':
      return 'settled'
    case 'PENDING':
      return 'pending review'
    case 'PROCESSING':
    case 'AUTHORIZED':
      return 'processing'
    case 'FAILED':
      return 'failed'
    default:
      return status.toLowerCase()
  }
}

function statusText(status: string, failureReason: string | null): string {
  switch (status) {
    case 'SETTLED':
      return 'settled — funds posted to the ledger'
    case 'PENDING':
      return 'held for manual review by risk rules'
    case 'PROCESSING':
    case 'AUTHORIZED':
      return 'processing on the rail — not settled yet'
    case 'FAILED':
      return `failed — ${failureReason ?? 'provider reported failure'}`
    default:
      return status.toLowerCase()
  }
}

export function NewPaymentDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<string>('KES')
  const [method, setMethod] = useState<string>('MPESA')

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createPaymentAction(formData)
      if (result.ok) {
        toast({
          title: `Payment ${result.reference} is ${statusWord(result.status)}`,
          description: statusText(result.status, result.failureReason),
        })
        setOpen(false)
        setAmount('')
        router.refresh()
      } else {
        toast({
          title: 'Payment not created',
          description: result.error,
          variant: 'destructive',
        })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New payment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New payment</DialogTitle>
          <DialogDescription>
            Creates an intent and runs it through the real pipeline: risk check → rail dispatch →
            settlement ledger. The outcome shown is the true outcome.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="np-customer-name">Customer name</Label>
              <Input id="np-customer-name" name="customerName" placeholder="Amina Otieno" autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-customer-email">
                Customer email <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input id="np-customer-email" name="customerEmail" type="email" placeholder="amina@example.com" autoComplete="off" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="np-amount">
                Amount <span className="text-danger">*</span>
              </Label>
              <Input
                id="np-amount"
                name="amount"
                required
                inputMode="decimal"
                placeholder="1500.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoComplete="off"
                aria-describedby="np-amount-hint"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-currency">Currency</Label>
              <input type="hidden" name="currency" value={currency} />
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="np-currency" className="w-full" aria-label="Currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-method">Method</Label>
              <input type="hidden" name="method" value={method} />
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="np-method" className="w-full" aria-label="Payment method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(METHOD_META) as (keyof typeof METHOD_META)[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHOD_META[m].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p id="np-amount-hint" className="text-xs text-muted-foreground -mt-2">
            USDC accepts up to 6 decimals; all others 2. Fees are applied per provider rate.
          </p>

          <div className="space-y-2">
            <Label htmlFor="np-description">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input id="np-description" name="description" placeholder="Invoice INV-2026-0004 settlement" autoComplete="off" />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? 'Processing…' : 'Create payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
