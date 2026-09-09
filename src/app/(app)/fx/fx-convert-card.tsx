'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { requestFxQuote, executeFxConversion, type FxQuoteView } from './actions'
import { formatScaledRate } from './rate-format'
import { MoneyText } from '@/components/novera/money-text'
import { ToneBadge } from '@/components/novera/status-badge'
import { Button } from '@/components/ui/button'
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
import { cn } from '@/lib/utils'
import { ArrowLeftRight, CheckCircle2, Loader2, RefreshCw, Timer, TriangleAlert } from 'lucide-react'

export interface FxWalletOption {
  id: string
  label: string
  currency: string
  availableMinor: string
}

type Phase = 'idle' | 'quoting' | 'quoted' | 'executing'

export function FxConvertCard({ wallets }: { wallets: FxWalletOption[] }) {
  const [fromId, setFromId] = useState<string>(wallets[0]?.id ?? '')
  const [toId, setToId] = useState<string>(
    (wallets.find((w) => w.id !== wallets[0]?.id && w.currency !== wallets[0]?.currency) ?? wallets[1])?.id ?? ''
  )
  const [amount, setAmount] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [quote, setQuote] = useState<FxQuoteView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(60)
  const [isPending, startTransition] = useTransition()

  const from = wallets.find((w) => w.id === fromId)
  const to = wallets.find((w) => w.id === toId)
  const sameCurrency = from && to && from.currency === to.currency
  const isQuoting = phase === 'quoting'
  const isExecuting = phase === 'executing'
  const expired = phase === 'quoted' && secondsLeft <= 0

  // ── expiry countdown (60s quote window) ──
  useEffect(() => {
    if (phase !== 'quoted' || !quote) return
    const target = new Date(quote.expiresAt).getTime()
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [phase, quote])

  const canQuote = useMemo(
    () => Boolean(from && to && from.id !== to.id && !sameCurrency && amount.trim() !== ''),
    [from, to, sameCurrency, amount]
  )

  function invalidateQuote() {
    setQuote(null)
    setError(null)
    if (phase === 'quoted') setPhase('idle')
  }

  function swap() {
    invalidateQuote()
    const f = fromId
    setFromId(toId)
    setToId(f)
  }

  function handleQuote() {
    if (!from || !to) return
    setError(null)
    setPhase('quoting')
    startTransition(async () => {
      const result = await requestFxQuote({
        fromWalletId: from.id,
        toWalletId: to.id,
        amountMajor: amount.trim(),
      })
      if (result.ok) {
        setQuote(result)
        setSecondsLeft(60)
        setPhase('quoted')
      } else {
        setPhase('idle')
        setError(result.error)
      }
    })
  }

  function handleConfirm() {
    if (!from || !to || !quote || expired) return
    setError(null)
    setPhase('executing')
    startTransition(async () => {
      const result = await executeFxConversion({
        quoteId: quote.quoteId,
        fromWalletId: from.id,
        toWalletId: to.id,
        amountMajor: amount.trim(),
      })
      if (result.ok) {
        toast({
          title: `Converted ${result.fromCurrency} → ${result.toCurrency}`,
          description: `${result.sourceFormatted} → ${result.targetFormatted}. Ledger legs: ${result.refA} (base) · ${result.refB} (quote) — posted through FX clearing.`,
        })
        setQuote(null)
        setAmount('')
        setPhase('idle')
      } else {
        setError(result.error)
        toast({
          title: 'Conversion failed',
          description: result.error,
          variant: 'destructive',
        })
        setPhase('quoted')
        if (result.error.includes('expired')) setSecondsLeft(0)
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* form */}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="fx-from">From wallet</Label>
          <Select
            value={fromId}
            onValueChange={(v) => {
              invalidateQuote()
              setFromId(v)
            }}
          >
            <SelectTrigger id="fx-from" className="w-full" aria-label="Source wallet">
              <SelectValue placeholder="Select wallet" />
            </SelectTrigger>
            <SelectContent>
              {wallets.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.label} · {w.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {from ? (
            <p className="text-xs text-muted-foreground">
              Available: <MoneyText minor={from.availableMinor} currency={from.currency} />
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={swap}
          aria-label="Swap direction"
          className="mb-0.5 sm:mb-1"
        >
          <ArrowLeftRight className="h-4 w-4" />
        </Button>

        <div className="space-y-2">
          <Label htmlFor="fx-to">To wallet</Label>
          <Select
            value={toId}
            onValueChange={(v) => {
              invalidateQuote()
              setToId(v)
            }}
          >
            <SelectTrigger id="fx-to" className="w-full" aria-label="Destination wallet">
              <SelectValue placeholder="Select wallet" />
            </SelectTrigger>
            <SelectContent>
              {wallets.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.label} · {w.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sameCurrency ? (
            <p className="flex items-center gap-1 text-xs text-warning">
              <TriangleAlert className="h-3 w-3" /> Same currency — use a transfer instead.
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fx-amount">Amount ({from?.currency ?? '—'})</Label>
        <Input
          id="fx-amount"
          inputMode="decimal"
          placeholder="e.g. 1000.50"
          value={amount}
          onChange={(e) => {
            invalidateQuote()
            setAmount(e.target.value)
          }}
          disabled={isExecuting}
          className="tabular-nums"
          aria-describedby={error ? 'fx-error' : undefined}
        />
      </div>

      {error ? (
        <p id="fx-error" className="flex items-start gap-2 rounded-md bg-danger/10 p-3 text-xs text-danger" role="alert">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {phase !== 'quoted' ? (
        <Button type="button" onClick={handleQuote} disabled={!canQuote || isQuoting || isPending} className="w-full sm:w-auto">
          {isQuoting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {isQuoting ? 'Locking rate…' : 'Get locked quote'}
        </Button>
      ) : null}

      {/* quote panel */}
      {phase === 'quoted' && quote ? (
        <div className="space-y-4 rounded-lg border border-primary/25 bg-primary/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm font-medium">
                Quote locked — {quote.fromCurrency} → {quote.toCurrency}
              </span>
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
                expired ? 'bg-danger/12 text-danger' : 'bg-warning/15 text-warning'
              )}
              role="timer"
              aria-live="off"
            >
              <Timer className="h-3 w-3" />
              {expired ? 'expired' : `${secondsLeft}s`}
            </span>
          </div>

          {/* countdown progress */}
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className={cn('h-full rounded-full transition-all duration-500', expired ? 'bg-danger' : 'bg-warning')}
              style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / 60) * 100))}%` }}
            />
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">You send</dt>
              <dd className="mt-0.5">
                <MoneyText minor={quote.amountMinor} currency={quote.fromCurrency} strong />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">You receive (estimated at lock)</dt>
              <dd className="mt-0.5">
                <MoneyText minor={quote.convertedMinor} currency={quote.toCurrency} strong />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Locked rate ({quote.toCurrency} per {quote.fromCurrency})</dt>
              <dd className="mt-0.5 tabular-nums">
                {formatScaledRate(quote.rateScaled)}
                <span className="ml-2 text-xs text-muted-foreground">
                  mid {formatScaledRate(quote.rawRateScaled)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Spread</dt>
              <dd className="mt-0.5 tabular-nums">{quote.spreadBps} bps</dd>
            </div>
          </dl>

          <p className="text-xs text-muted-foreground">
            Executable rate is the mid rate less the {quote.spreadBps} bps spread, locked for 60 seconds. On
            confirmation the kernel posts two single-currency legs through FX clearing.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={expired || isExecuting || isPending}
            >
              {isExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isExecuting ? 'Converting…' : 'Confirm & convert'}
            </Button>
            <Button type="button" variant="ghost" onClick={invalidateQuote} disabled={isExecuting}>
              <RefreshCw className="mr-2 h-4 w-4" />
              New quote
            </Button>
          </div>
          {expired ? (
            <p className="flex items-center gap-2 text-xs text-danger" role="alert">
              <TriangleAlert className="h-3.5 w-3.5" />
              This quote has expired — request a new one to convert at the current rate.
            </p>
          ) : null}
        </div>
      ) : null}

      {wallets.length < 2 ? (
        <p className="text-xs text-muted-foreground">
          <ToneBadge tone="neutral">Setup needed</ToneBadge> At least two wallets in different currencies are
          required to convert.
        </p>
      ) : null}
    </div>
  )
}
