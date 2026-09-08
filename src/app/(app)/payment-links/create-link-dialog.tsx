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
import { createLinkAction } from './actions'
import { Loader2, Plus } from 'lucide-react'

const CURRENCIES = ['KES', 'USD', 'USDC', 'EUR', 'GBP', 'NGN', 'TZS', 'UGX', 'ZAR'] as const

const TYPE_HELP: Record<string, string> = {
  FIXED: 'You set the exact amount — the customer just pays.',
  CUSTOM: 'The customer enters their own amount at checkout.',
  DONATION: 'Supporter chooses any amount — ideal for causes.',
  TIP: 'Customer chooses any amount — great for service tips.',
}

export function CreateLinkDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [type, setType] = useState<string>('FIXED')
  const [currency, setCurrency] = useState<string>('KES')
  const [label, setLabel] = useState('')

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createLinkAction(formData)
      if (result.ok) {
        toast({
          title: `Link "${result.label}" created`,
          description: `Share /pay/${result.token} — the hosted checkout is live.`,
        })
        setOpen(false)
        setLabel('')
        router.refresh()
      } else {
        toast({ title: 'Link not created', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Create link
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create payment link</DialogTitle>
          <DialogDescription>
            Generates a tokenized public checkout at <span className="font-mono text-xs">/pay/&lt;token&gt;</span>.
            No code needed — risk, rails and the ledger run behind it.
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pl-label">
              Label <span className="text-danger">*</span>
            </Label>
            <Input
              id="pl-label"
              name="label"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Consulting retainer"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">Shown to the customer on the checkout page.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pl-type">Type</Label>
              <input type="hidden" name="type" value={type} />
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="pl-type" className="w-full" aria-label="Link type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED">Fixed amount</SelectItem>
                  <SelectItem value="CUSTOM">Custom amount</SelectItem>
                  <SelectItem value="DONATION">Donation</SelectItem>
                  <SelectItem value="TIP">Tip</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{TYPE_HELP[type]}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pl-currency">Currency</Label>
              <input type="hidden" name="currency" value={currency} />
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="pl-currency" className="w-full" aria-label="Currency">
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
          </div>

          {type === 'FIXED' ? (
            <div className="space-y-2">
              <Label htmlFor="pl-amount">
                Amount ({currency}) <span className="text-danger">*</span>
              </Label>
              <Input
                id="pl-amount"
                name="amount"
                required
                inputMode="decimal"
                placeholder="2500.00"
                autoComplete="off"
              />
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? 'Creating…' : 'Create link'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
