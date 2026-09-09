'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { CardStatusBadge } from '@/components/novera/status-badge'
import { CopyButton } from '@/components/novera/copy-button'
import { freezeCard, terminateCard, unfreezeCard, updateCardLimits, updateCardToggles } from '../actions'
import { toast } from '@/hooks/use-toast'
import { Bot, Lock, Settings2, ShieldCheck, Snowflake, Sun, Trash2 } from 'lucide-react'
import { fmtDate } from '@/lib/format'

export interface CardDetailData {
  id: string
  label: string
  type: string
  status: string
  brand: string
  last4: string
  currency: string
  holderName: string
  perTxnLimitMajor: string | null
  dailyLimitMajor: string | null
  monthlyLimitMajor: string | null
  mccAllowlist: string[]
  merchantAllowlist: string[]
  countryAllowlist: string[]
  allowOnline: boolean
  allowContactless: boolean
  allowAtm: boolean
  allowInternational: boolean
  lastUsedAt: string | null
  createdAt: string
  walletId: string | null
  walletLabel: string | null
  agentId: string | null
  agentName: string | null
  agentRole: string | null
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export function CardControls({ card }: { card: CardDetailData }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [limitsOpen, setLimitsOpen] = useState(false)
  const [perTxn, setPerTxn] = useState(card.perTxnLimitMajor ?? '')
  const [daily, setDaily] = useState(card.dailyLimitMajor ?? '')
  const [monthly, setMonthly] = useState(card.monthlyLimitMajor ?? '')

  const terminal = card.status === 'TERMINATED' || card.status === 'EXPIRED'
  const canFreeze = card.status === 'ACTIVE'
  const canUnfreeze = card.status === 'FROZEN'
  // LOST/STOLEN/FROZEN/ACTIVE cards can still be terminated; EXPIRED/TERMINATED cannot.
  const canTerminate = !terminal

  const toggles = [
    { key: 'allowOnline', label: 'Online', desc: 'Card-not-present payments' },
    { key: 'allowContactless', label: 'Contactless', desc: 'Tap-to-pay terminals' },
    { key: 'allowAtm', label: 'ATM', desc: 'Cash withdrawals' },
    { key: 'allowInternational', label: 'International', desc: 'Non-Kenyan merchants' },
  ] as const

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, successTitle: string, successDescription?: string) {
    startTransition(async () => {
      const result = await fn()
      if (result.ok) {
        toast({ title: successTitle, description: successDescription })
        router.refresh()
      } else {
        toast({ title: 'Action failed', description: result.error ?? 'Unknown error', variant: 'destructive' })
      }
    })
  }

  function onToggle(key: (typeof toggles)[number]['key'], label: string, checked: boolean) {
    const next = {
      allowOnline: key === 'allowOnline' ? checked : card.allowOnline,
      allowContactless: key === 'allowContactless' ? checked : card.allowContactless,
      allowAtm: key === 'allowAtm' ? checked : card.allowAtm,
      allowInternational: key === 'allowInternational' ? checked : card.allowInternational,
    }
    run(
      () => updateCardToggles(card.id, next),
      `${label} payments ${checked ? 'enabled' : 'disabled'}`,
      'Change audited as card.controls.updated'
    )
  }

  function onSaveLimits(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await updateCardLimits(card.id, { perTxnLimit: perTxn, dailyLimit: daily, monthlyLimit: monthly })
      if (result.ok) {
        toast({ title: 'Limits updated', description: `Hard controls on •••• ${card.last4} were re-armed.` })
        setLimitsOpen(false)
        router.refresh()
      } else {
        toast({ title: 'Could not update limits', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <Card className="self-start">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            Controls
          </span>
          <CardStatusBadge status={card.status} />
        </CardTitle>
        <CardDescription>Every change is audited and enforced at authorization time.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* lifecycle actions */}
        <div className="flex flex-wrap gap-2">
          {canFreeze ? (
            <Button variant="outline" disabled={pending} onClick={() => run(() => freezeCard(card.id), 'Card frozen', 'New authorizations will decline with "card is frozen".')}>
              <Snowflake className="h-4 w-4" aria-hidden />
              Freeze
            </Button>
          ) : null}
          {canUnfreeze ? (
            <Button variant="outline" disabled={pending} onClick={() => run(() => unfreezeCard(card.id), 'Card reactivated', 'The card is ACTIVE and authorizable again.')}>
              <Sun className="h-4 w-4" aria-hidden />
              Unfreeze
            </Button>
          ) : null}
          <Dialog open={limitsOpen} onOpenChange={setLimitsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={pending || terminal}>
                <Settings2 className="h-4 w-4" aria-hidden />
                Edit limits
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Spend limits — •••• {card.last4}</DialogTitle>
                <DialogDescription>
                  Decimal amounts in {card.currency}. Blank removes the limit; hard-checked on every authorization.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={onSaveLimits} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-per-txn">Per transaction</Label>
                    <Input id="edit-per-txn" inputMode="decimal" value={perTxn} onChange={(e) => setPerTxn(e.target.value)} placeholder="none" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-daily">Daily</Label>
                    <Input id="edit-daily" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="none" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-monthly">Monthly</Label>
                    <Input id="edit-monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="none" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setLimitsOpen(false)} disabled={pending}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={pending}>
                    Save limits
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={pending || !canTerminate}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Terminate
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Terminate card •••• {card.last4}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This is irreversible. The card will decline all future authorizations and cannot be reactivated. Existing
                  captured transactions remain in the ledger. The action is audited.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Keep card</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={() => run(() => terminateCard(card.id), 'Card terminated', '•••• ' + card.last4 + ' will decline all future authorizations.')}
                  className="bg-danger text-white hover:bg-danger/90"
                >
                  Terminate permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {terminal ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            This card is {card.status.toLowerCase()} — controls are locked. Issued authorizations remain queryable.
          </p>
        ) : null}

        <Separator />

        {/* channel toggles */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Channel permissions</p>
          <div className="grid gap-2">
            {toggles.map((t) => {
              const checked = card[t.key]
              return (
                <div
                  key={t.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <Label htmlFor={`ctl-${t.key}`} className="text-sm font-normal">
                      {t.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">{t.desc}</p>
                  </div>
                  <Switch
                    id={`ctl-${t.key}`}
                    checked={checked}
                    disabled={pending || terminal}
                    onCheckedChange={(v) => onToggle(t.key, t.label, v)}
                    aria-label={`${t.label} payments ${checked ? 'enabled' : 'disabled'}`}
                  />
                </div>
              )
            })}
          </div>
        </div>

        <Separator />

        {/* facts */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Fact label="Brand">{card.brand}</Fact>
          <Fact label="Type">{card.type.charAt(0) + card.type.slice(1).toLowerCase()}</Fact>
          <Fact label="Currency">{card.currency}</Fact>
          <Fact label="Holder">{card.holderName}</Fact>
          <Fact label="Funding wallet">
            {card.walletId ? (
              <Link href={`/wallets/${card.walletId}`} className="underline underline-offset-2 hover:text-primary">
                {card.walletLabel}
              </Link>
            ) : (
              '—'
            )}
          </Fact>
          <Fact label="Last used">{card.lastUsedAt ? fmtDate(card.lastUsedAt) : 'Never'}</Fact>
          <Fact label="Issued">{fmtDate(card.createdAt)}</Fact>
          <Fact label="Card ID">
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              {card.id.slice(0, 10)}…
              <CopyButton value={card.id} label="Copy" />
            </span>
          </Fact>
        </dl>

        {/* allowlists */}
        {(card.mccAllowlist.length > 0 || card.merchantAllowlist.length > 0 || card.countryAllowlist.length > 0) ? (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Allowlists</p>
              <div className="space-y-1.5 text-xs">
                {card.mccAllowlist.length > 0 ? (
                  <p>
                    <span className="text-muted-foreground">MCC:</span> <span className="font-mono">{card.mccAllowlist.join(', ')}</span>
                  </p>
                ) : null}
                {card.merchantAllowlist.length > 0 ? (
                  <p>
                    <span className="text-muted-foreground">Merchants:</span> {card.merchantAllowlist.join(', ')}
                  </p>
                ) : null}
                {card.countryAllowlist.length > 0 ? (
                  <p>
                    <span className="text-muted-foreground">Countries:</span> {card.countryAllowlist.join(', ')}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        ) : null}

        {card.type === 'AGENT' && card.agentName ? (
          <>
            <Separator />
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{card.agentName}</p>
                  <p className="text-xs text-muted-foreground">{card.agentRole?.toLowerCase()} agent — bound KYA card</p>
                </div>
              </div>
              {card.agentId ? (
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  <Link href={`/agents/${card.agentId}`}>View agent</Link>
                </Button>
              ) : null}
            </div>
          </>
        ) : null}

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          PAN/CVV never stored — tokenized issuance.
        </p>
        <p className="sr-only">
          <ShieldCheck aria-hidden />
          Card controls panel for {card.label}
        </p>
      </CardContent>
    </Card>
  )
}
