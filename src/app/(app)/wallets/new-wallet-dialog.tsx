'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { WALLET_TYPES, WALLET_TYPE_META } from '@novera/domain'
import { CURRENCIES } from '@novera/money'
import { createWallet } from './actions'

const CURRENCY_CODES = Object.keys(CURRENCIES) as (keyof typeof CURRENCIES)[]

export function NewWalletDialog({
  variant = 'default',
  size = 'default',
  label = 'New wallet',
  className,
}: {
  variant?: 'default' | 'outline'
  size?: 'default' | 'sm'
  label?: string
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [walletLabel, setWalletLabel] = React.useState('')
  const [walletType, setWalletType] = React.useState<string>('OPERATING')
  const [currency, setCurrency] = React.useState<string>('KES')

  function reset() {
    setWalletLabel('')
    setWalletType('OPERATING')
    setCurrency('KES')
    setError(null)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await createWallet({
        label: walletLabel,
        type: walletType,
        currency,
      })
      if (result.ok) {
        toast({
          title: 'Wallet created',
          description: `${walletLabel.trim()} · ${currency} · ${WALLET_TYPE_META[walletType]?.label ?? walletType}`,
        })
        setOpen(false)
        reset()
        router.refresh()
      } else {
        setError(result.error)
      }
    } catch {
      setError('Unexpected error — please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset() }}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>New wallet</DialogTitle>
            <DialogDescription>
              Creates a wallet with its own ledger account. Balances start at exactly zero —
              fund it with a transfer or an opening balance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wallet-label">Label</Label>
              <Input
                id="wallet-label"
                value={walletLabel}
                onChange={(e) => setWalletLabel(e.target.value)}
                placeholder="e.g. Nairobi Ops"
                maxLength={60}
                autoComplete="off"
                required
                aria-invalid={!!error}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="wallet-type">Type</Label>
                <Select value={walletType} onValueChange={setWalletType}>
                  <SelectTrigger id="wallet-type" aria-label="Wallet type">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {WALLET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {WALLET_TYPE_META[t]?.label ?? t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="wallet-currency">Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="wallet-currency" aria-label="Currency">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code} — {CURRENCIES[code].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error ? (
              <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !walletLabel.trim()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {pending ? 'Creating…' : 'Create wallet'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
