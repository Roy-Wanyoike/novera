'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight, Loader2, Info } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MoneyText } from '@/components/novera/money-text'
import { toast } from '@/hooks/use-toast'
import { WALLET_TYPE_META } from '@novera/domain'
import { transferFunds } from './actions'

export interface TransferWalletOption {
  id: string
  label: string
  type: string
  currency: string
  status: string
  availableMinor: string
}

export function TransferDialog({
  wallets,
  defaultFromId,
  variant = 'default',
  size = 'default',
  label = 'Transfer',
  className,
}: {
  wallets: TransferWalletOption[]
  defaultFromId?: string
  variant?: 'default' | 'outline'
  size?: 'default' | 'sm'
  label?: string
  className?: string
}) {
  const router = useRouter()
  const initialFrom = defaultFromId && wallets.some((w) => w.id === defaultFromId)
    ? defaultFromId
    : wallets[0]?.id ?? ''
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fromId, setFromId] = React.useState(initialFrom)
  const [toId, setToId] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [note, setNote] = React.useState('')

  const from = wallets.find((w) => w.id === fromId)
  const toWallets = from ? wallets.filter((w) => w.currency === from.currency) : wallets
  const to = wallets.find((w) => w.id === toId)

  function reset() {
    setFromId(initialFrom)
    setToId('')
    setAmount('')
    setNote('')
    setError(null)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await transferFunds({
        fromWalletId: fromId,
        toWalletId: toId,
        amount,
        note: note || undefined,
      })
      if (result.ok) {
        toast({
          title: `Transfer posted — ledger ${result.reference ?? ''}`,
          description: from && to
            ? `${amount.trim()} ${from.currency} · ${from.label} → ${to.label}`
            : undefined,
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

  const submitDisabled =
    pending || !fromId || !toId || !amount.trim() || fromId === toId

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={className} disabled={wallets.length < 2}>
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Transfer between wallets</DialogTitle>
            <DialogDescription>
              Posts a balanced double-entry transaction — source is debited, destination is
              credited — after an available-funds and risk check.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="transfer-from">From wallet</Label>
              <Select
                value={fromId}
                onValueChange={(v) => {
                  setFromId(v)
                  if (toId && wallets.find((w) => w.id === v)?.currency !== wallets.find((w) => w.id === toId)?.currency) {
                    setToId('')
                  }
                }}
              >
                <SelectTrigger id="transfer-from" aria-label="Source wallet">
                  <SelectValue placeholder="Source wallet" />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.id} value={w.id} disabled={w.status !== 'ACTIVE'}>
                      <span className="flex items-center gap-2">
                        <span>{w.label}</span>
                        <span className="text-muted-foreground">
                          <MoneyText minor={w.availableMinor} currency={w.currency} muted />
                          {w.status !== 'ACTIVE' ? ` · ${w.status.toLowerCase()}` : ''}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {from ? (
                <p className="text-xs text-muted-foreground">
                  Available to spend:{' '}
                  <MoneyText minor={from.availableMinor} currency={from.currency} />
                  {` · ${WALLET_TYPE_META[from.type]?.label ?? from.type} · ${from.currency}`}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="transfer-to">To wallet</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger id="transfer-to" aria-label="Destination wallet">
                  <SelectValue placeholder="Destination wallet" />
                </SelectTrigger>
                <SelectContent>
                  {toWallets.map((w) => (
                    <SelectItem key={w.id} value={w.id} disabled={w.id === fromId || w.status !== 'ACTIVE'}>
                      <span className="flex items-center gap-2">
                        <span>{w.label}</span>
                        <span className="text-muted-foreground">
                          {w.currency}
                          {w.status !== 'ACTIVE' ? ` · ${w.status.toLowerCase()}` : ''}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {toWallets.length < 2 ? (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  Only same-currency wallets can be transferred to directly. Cross-currency
                  movement goes through FX conversion.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="transfer-amount">Amount{from ? ` (${from.currency})` : ''}</Label>
              <Input
                id="transfer-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                autoComplete="off"
                aria-describedby={from ? 'transfer-amount-hint' : undefined}
              />
              {from ? (
                <p id="transfer-amount-hint" className="text-xs text-muted-foreground">
                  Available now: <MoneyText minor={from.availableMinor} currency={from.currency} />
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="transfer-note">Note (optional)</Label>
              <Textarea
                id="transfer-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Monthly payroll funding"
                rows={2}
                maxLength={140}
              />
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
            <Button type="submit" disabled={submitDisabled}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {pending ? 'Posting…' : 'Post transfer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
