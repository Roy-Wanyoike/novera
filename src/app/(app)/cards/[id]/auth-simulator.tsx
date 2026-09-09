'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Money, formatMinor } from '@novera/money'
import { CardStatusBadge } from '@/components/novera/status-badge'
import { MoneyText } from '@/components/novera/money-text'
import { simulateAuthorization } from '../actions'
import { toast } from '@/hooks/use-toast'
import { CheckCircle2, ChevronRight, Loader2, Send, ShieldAlert, XCircle, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * AUTHORIZATION SIMULATOR — the cards showcase.
 *
 * Feeds the REAL decisioning pipeline (authorizeCard): hard controls → risk
 * engine → hold → capture → ledger → webhook. The result panel renders the
 * full explainability trail: decision, decline reason, risk score and every
 * evaluated rule.
 */

const MCC_OPTIONS: { code: string; label: string }[] = [
  { code: '5411', label: '5411 — Grocery stores' },
  { code: '5732', label: '5732 — Electronics' },
  { code: '5812', label: '5812 — Restaurants' },
  { code: '4816', label: '4816 — Cloud / network services' },
  { code: '7372', label: '7372 — Software & SaaS' },
  { code: '5734', label: '5734 — Computer software stores' },
  { code: '5541', label: '5541 — Service stations (fuel)' },
  { code: '5172', label: '5172 — Petroleum products' },
  { code: '1520', label: '1520 — General contractors' },
  { code: '4121', label: '4121 — Commuter transport' },
  { code: '5300', label: '5300 — Wholesale clubs' },
  { code: '5912', label: '5912 — Pharmacies' },
  { code: '6011', label: '6011 — ATM cash disbursement' },
  { code: '4511', label: '4511 — Airlines' },
  { code: '3501', label: '3501 — Hotels & resorts' },
]

const CHANNEL_OPTIONS = [
  { value: 'ONLINE', label: 'Online — card not present' },
  { value: 'POS', label: 'POS — chip & PIN' },
  { value: 'CONTACTLESS', label: 'Contactless — tap' },
  { value: 'ATM', label: 'ATM — cash withdrawal' },
]

const COUNTRY_OPTIONS = ['KE', 'US', 'GB', 'DE', 'NG', 'ZA', 'TZ', 'UG']

export interface SimulatorControls {
  perTxnLimitMinor: string | null
  dailyLimitMinor: string | null
  monthlyLimitMinor: string | null
  mccAllowlist: string[]
  merchantAllowlist: string[]
  countryAllowlist: string[]
  allowOnline: boolean
  allowContactless: boolean
  allowAtm: boolean
  allowInternational: boolean
}

interface DecisionState {
  decision: 'APPROVED' | 'DECLINED'
  reason?: string
  riskScore: number
  rulesChecked: string[]
  authId: string
  amountMinor: string
  currency: string
  merchantName: string
}

function riskTone(score: number) {
  if (score >= 60) return 'text-danger'
  if (score >= 30) return 'text-warning'
  return 'text-success'
}

function riskBar(score: number) {
  if (score >= 60) return 'bg-danger'
  if (score >= 30) return 'bg-warning'
  return 'bg-success'
}

export function AuthSimulator({
  cardId,
  currency,
  status,
  last4,
  controls,
}: {
  cardId: string
  currency: string
  status: string
  last4: string
  controls: SimulatorControls
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [merchantName, setMerchantName] = useState('Naivas Supermarket')
  const [mcc, setMcc] = useState('5411')
  const [amount, setAmount] = useState('1500.00')
  const [simCurrency, setSimCurrency] = useState(currency)
  const [channel, setChannel] = useState('ONLINE')
  const [country, setCountry] = useState('KE')
  const [result, setResult] = useState<DecisionState | null>(null)

  const authorizationEnabled = status === 'ACTIVE'

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      let amountMinor: string
      try {
        const m = Money.fromMajor(amount, simCurrency)
        if (!m.isPositive()) throw new Error('Amount must be positive')
        amountMinor = m.minor.toString()
      } catch {
        toast({ title: 'Invalid amount', description: 'Use a decimal value like 1200.00', variant: 'destructive' })
        return
      }
      const res = await simulateAuthorization({
        cardId,
        merchantName,
        mcc,
        amount,
        currency: simCurrency,
        channel,
        country,
      })
      if (res.ok) {
        setResult({
          decision: res.decision,
          reason: res.reason,
          riskScore: res.riskScore,
          rulesChecked: res.rulesChecked,
          authId: res.authId,
          amountMinor,
          currency: simCurrency,
          merchantName,
        })
        if (res.decision === 'APPROVED') {
          toast({ title: 'Authorization approved', description: `${merchantName} — ${formatMinor(amountMinor, simCurrency)} captured to the ledger.` })
        } else {
          toast({ title: 'Authorization declined', description: res.reason ?? 'Declined by controls', variant: 'destructive' })
        }
        router.refresh()
      } else {
        toast({ title: 'Simulator error', description: res.error, variant: 'destructive' })
      }
    })
  }

  // current hard controls — visible context so users can craft test cases
  const controlChips: { label: string; warning: boolean }[] = []
  if (controls.perTxnLimitMinor) controlChips.push({ label: `Per-txn ≤ ${formatMinor(controls.perTxnLimitMinor, currency)}`, warning: false })
  if (controls.dailyLimitMinor) controlChips.push({ label: `Daily ≤ ${formatMinor(controls.dailyLimitMinor, currency)}`, warning: false })
  if (controls.monthlyLimitMinor) controlChips.push({ label: `Monthly ≤ ${formatMinor(controls.monthlyLimitMinor, currency)}`, warning: false })
  controlChips.push({ label: 'Online', warning: !controls.allowOnline })
  controlChips.push({ label: 'Contactless', warning: !controls.allowContactless })
  controlChips.push({ label: 'ATM', warning: !controls.allowAtm })
  controlChips.push({ label: 'International', warning: !controls.allowInternational })

  return (
    <Card className="self-start">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" aria-hidden />
            Authorization simulator
          </span>
          <CardStatusBadge status={status} />
        </CardTitle>
        <CardDescription>
          Sends a network authorization for •••• {last4} through the real decisioning pipeline — hard controls, risk engine, hold, capture, ledger and webhook.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* live control plane summary */}
        <div className="flex flex-wrap gap-1.5" aria-label="Active card controls">
          {controlChips.map((c) => (
            <span
              key={c.label}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-medium ring-1',
                c.warning
                  ? 'bg-warning/12 text-warning ring-warning/30'
                  : 'bg-muted text-muted-foreground ring-border'
              )}
            >
              {c.label}{c.warning ? ' off' : ''}
            </span>
          ))}
          {controls.mccAllowlist.length > 0 ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
              MCC {controls.mccAllowlist.join('/')}
            </span>
          ) : null}
          {controls.countryAllowlist.length > 0 ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
              Geo {controls.countryAllowlist.join('/')}
            </span>
          ) : null}
        </div>

        {!authorizationEnabled ? (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning ring-1 ring-warning/30">
            This card is {status.toLowerCase()} — attempts will decline deterministically. Unfreeze or issue a new card to approve authorizations.
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sim-merchant">Merchant</Label>
              <Input
                id="sim-merchant"
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                placeholder="Amazon Web Services"
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-mcc">MCC</Label>
              <Select value={mcc} onValueChange={setMcc}>
                <SelectTrigger id="sim-mcc" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {MCC_OPTIONS.map((o) => (
                    <SelectItem key={o.code} value={o.code}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-amount">Amount</Label>
              <Input
                id="sim-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1200.00"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-currency">Currency</Label>
              <Select value={simCurrency} onValueChange={setSimCurrency}>
                <SelectTrigger id="sim-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KES">KES</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Card holds {currency} — mismatches decline.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-channel">Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger id="sim-channel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-country">Merchant country</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger id="sim-country" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            Authorize
          </Button>
        </form>

        {/* decision panel — explainability is the feature */}
        {result ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'rounded-xl border p-4 space-y-3',
              result.decision === 'APPROVED'
                ? 'border-success/40 bg-success/10'
                : 'border-danger/40 bg-danger/10'
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                {result.decision === 'APPROVED' ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
                )}
                <div>
                  <p className={cn('text-sm font-semibold', result.decision === 'APPROVED' ? 'text-success' : 'text-danger')}>
                    {result.decision}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {result.merchantName} · <MoneyText minor={result.amountMinor} currency={result.currency} />
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Risk score</p>
                <p className={cn('text-sm font-semibold tabular', riskTone(result.riskScore))}>{result.riskScore}<span className="text-muted-foreground font-normal">/100</span></p>
              </div>
            </div>

            {/* risk meter */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className={cn('h-full rounded-full transition-all', riskBar(result.riskScore))} style={{ width: `${Math.min(100, result.riskScore)}%` }} />
            </div>

            {result.decision === 'DECLINED' && result.reason ? (
              <p className="flex items-start gap-2 rounded-md bg-danger/10 px-3 py-2 text-sm font-medium text-danger ring-1 ring-danger/25">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {result.reason}
              </p>
            ) : null}

            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Evaluated rules</p>
              {result.rulesChecked.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No controls or risk rules triggered — clean authorization.
                </p>
              ) : (
                <ul className="space-y-1">
                  {result.rulesChecked.map((rule, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="leading-relaxed">{rule}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
              {result.decision === 'APPROVED' ? (
                <>Hold placed &amp; captured — double-entry ledger leg posted, webhook emitted. Auth <span className="font-mono">{result.authId.slice(0, 12)}…</span></>
              ) : (
                <>No funds moved. The attempt is recorded in the authorization feed and audit trail. Auth <span className="font-mono">{result.authId.slice(0, 12)}…</span></>
              )}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
