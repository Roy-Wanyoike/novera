'use client'

import { useState, useTransition } from 'react'
import {
  CheckCircle2,
  Clock,
  Coins,
  CreditCard,
  FlaskConical,
  Landmark,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
  XCircle,
} from 'lucide-react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { PaymentStatusBadge } from '@/components/novera/status-badge'
import { MoneyText } from '@/components/novera/money-text'
import { CopyButton } from '@/components/novera/copy-button'
import { formatMinor } from '@novera/money'
import { fmtTime } from '@/lib/format'
import { toast } from '@/hooks/use-toast'
import { payLinkAction, type CheckoutResult } from './actions'

const METHOD_OPTIONS = [
  { value: 'MPESA', label: 'M-Pesa', hint: 'Mobile money · STK push', icon: Smartphone },
  { value: 'CARD', label: 'Card', hint: 'Visa / Mastercard', icon: CreditCard },
  { value: 'BANK', label: 'Bank transfer', hint: 'EFT / RTGS', icon: Landmark },
  { value: 'USDC', label: 'USDC', hint: 'USD Coin on Base', icon: Coins },
] as const

const TYPE_HINT: Record<string, string> = {
  FIXED: 'Fixed amount',
  CUSTOM: 'You choose the amount',
  DONATION: 'Choose your contribution',
  TIP: 'Choose your tip',
}

export function CheckoutForm({
  token,
  orgName,
  label,
  type,
  currency,
  fixedAmountMinor,
}: {
  token: string
  orgName: string
  label: string
  type: string
  currency: string
  fixedAmountMinor: string | null
}) {
  const [method, setMethod] = useState<string>('MPESA')
  const [amount, setAmount] = useState('')
  const [simulateFailure, setSimulateFailure] = useState(false)
  const [result, setResult] = useState<CheckoutResult | null>(null)
  const [pending, startTransition] = useTransition()

  const editableAmount = fixedAmountMinor === null
  const buttonLabel = editableAmount ? `Pay in ${currency}` : `Pay ${formatMinor(fixedAmountMinor, currency)}`

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await payLinkAction(token, formData)
      if (res.ok) {
        setResult(res)
      } else {
        toast({ title: 'Payment not completed', description: res.error, variant: 'destructive' })
      }
    })
  }

  // ── Receipt / outcome states (inline, never a new route) ──
  if (result && result.ok) {
    const settled = result.status === 'SETTLED'
    const processing = result.status === 'PENDING' || result.status === 'PROCESSING' || result.status === 'AUTHORIZED'
    const failed = result.status === 'FAILED'

    return (
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border">
            {settled ? (
              <CheckCircle2 className="h-6 w-6 text-success" />
            ) : processing ? (
              <Clock className="h-6 w-6 text-warning" />
            ) : failed ? (
              <XCircle className="h-6 w-6 text-danger" />
            ) : (
              <Clock className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {settled ? 'Payment received' : processing ? 'Payment processing' : failed ? 'Payment failed' : 'Payment recorded'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {settled
              ? `${orgName} has been paid. This is a TEST sandbox — the "funds" are simulated ledger entries.`
              : processing
                ? 'The payment is held up for review. Nothing is confirmed yet — watch the merchant dashboard for the final state.'
                : failed
                  ? (result.failureReason ?? 'The provider reported a failure.')
                  : `Status: ${result.status.toLowerCase()}`}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Reference</dt>
              <dd className="flex items-center gap-1.5">
                <code className="font-mono text-sm">{result.reference}</code>
                <CopyButton value={result.reference} label="Copy" />
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Status</dt>
              <dd>
                <PaymentStatusBadge status={result.status} />
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Amount</dt>
              <dd>
                <MoneyText minor={result.amountMinor} currency={result.currency} strong />
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">Provider</dt>
              <dd className="text-sm">
                {result.providerName ? (
                  <span className="flex items-center gap-1.5">
                    {result.providerName}
                    {result.providerMode ? (
                      <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-warning">
                        {result.providerMode}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          {/* Timeline snapshot — what happened, when */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              What happened
            </p>
            <ol className="space-y-1.5">
              {result.timeline.map((ev, i) => (
                <li key={`${ev.at}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {ev.event.replace(/_/g, ' ')}
                    </span>{' '}
                    · {ev.detail}
                  </span>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {fmtTime(ev.at)}
                  </time>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-2">
            {failed ? (
              <Button onClick={() => setResult(null)} className="w-full">
                Try the payment again
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setResult(null)} className="w-full">
                {settled ? 'Make another payment' : 'Back to checkout'}
              </Button>
            )}
            <p className="text-center text-xs text-muted-foreground">
              Keep your reference <span className="font-mono">{result.reference}</span> for any
              support requests.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Checkout form ──
  return (
    <Card>
      <CardHeader className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{orgName}</p>
          <h1 className="text-xl font-semibold tracking-tight">{label}</h1>
        </div>
        <div className="flex items-baseline justify-between rounded-lg border bg-muted/30 px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            {TYPE_HINT[type] ?? 'Amount'}
          </span>
          {fixedAmountMinor !== null ? (
            <MoneyText minor={fixedAmountMinor} currency={currency} strong className="text-2xl" />
          ) : (
            <span className="text-sm text-muted-foreground">in {currency}</span>
          )}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
          Risk-checked and ledger-recorded — you&rsquo;ll see exactly what happened, when.
        </p>
      </CardHeader>

      <CardContent>
        <form action={onSubmit} className="space-y-5">
          <input type="hidden" name="method" value={method} />
          {simulateFailure ? <input type="hidden" name="simulateFailure" value="on" /> : null}

          {editableAmount ? (
            <div className="space-y-2">
              <Label htmlFor="co-amount">
                Amount ({currency}) <span className="text-danger">*</span>
              </Label>
              <Input
                id="co-amount"
                name="amount"
                required
                inputMode="decimal"
                placeholder={currency === 'USDC' ? '25.50' : '2500.00'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Enter the amount you want to pay (in {currency}).
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="co-name">
                Your name <span className="text-danger">*</span>
              </Label>
              <Input id="co-name" name="name" required placeholder="Jane Wanjiku" autoComplete="name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="co-email">
                Email <span className="text-danger">*</span>
              </Label>
              <Input
                id="co-email"
                name="email"
                type="email"
                required
                placeholder="jane@example.com"
                autoComplete="email"
              />
            </div>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              Payment method <span className="text-danger">*</span>
            </legend>
            <RadioGroup
              value={method}
              onValueChange={setMethod}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              aria-label="Payment method"
            >
              {METHOD_OPTIONS.map((m) => {
                const Icon = m.icon
                const selected = method === m.value
                return (
                  <Label
                    key={m.value}
                    htmlFor={`method-${m.value}`}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors ${
                      selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <RadioGroupItem value={m.value} id={`method-${m.value}`} className="mt-0.5" />
                    <span className="flex flex-1 items-center gap-2.5">
                      <Icon className="h-4.5 w-4.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="leading-tight">
                        <span className="block text-sm font-medium">{m.label}</span>
                        <span className="block text-xs text-muted-foreground">{m.hint}</span>
                      </span>
                    </span>
                  </Label>
                )
              })}
            </RadioGroup>
          </fieldset>

          {/* Sandbox control — clearly labeled, honest-but-fun */}
          <div className="rounded-lg border border-dashed border-warning/40 bg-warning/5 p-3.5">
            <label
              htmlFor="simulate-failure"
              className="flex cursor-pointer items-start gap-3 text-sm"
            >
              <Checkbox
                id="simulate-failure"
                checked={simulateFailure}
                onCheckedChange={(v) => setSimulateFailure(v === true)}
                className="mt-0.5"
                aria-describedby="simulate-failure-hint"
              />
              <span className="leading-tight">
                <span className="flex items-center gap-1.5 font-medium">
                  <FlaskConical className="h-3.5 w-3.5 text-warning" aria-hidden />
                  Sandbox control — simulate a failed payment
                </span>
                <span id="simulate-failure-hint" className="mt-0.5 block text-xs text-muted-foreground">
                  For testing what a decline looks like. This checkout is a TEST environment; nothing
                  real is charged either way.
                </span>
              </span>
            </label>
          </div>

          <Button type="submit" size="lg" className="w-full text-base" disabled={pending}>
            {pending ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : null}
            {pending ? 'Processing…' : buttonLabel}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="h-3 w-3" aria-hidden />
            Simulated settlement in TEST mode — no real money moves.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
