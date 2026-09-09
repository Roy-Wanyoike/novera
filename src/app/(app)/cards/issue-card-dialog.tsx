'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Loader2, Lock, Plus, ShieldCheck } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { issueCard } from './actions'

export interface WalletOption {
  id: string
  label: string
  currency: string
  type: string
}

export interface AgentOption {
  id: string
  name: string
  role: string
}

const CARD_TYPE_OPTIONS = [
  { value: 'VIRTUAL', hint: 'Reusable card for ongoing spend' },
  { value: 'DISPOSABLE', hint: 'Single-vendor, tight-limit card' },
  { value: 'EMPLOYEE', hint: 'Personal card bound to a team member' },
  { value: 'PROJECT', hint: 'Ring-fenced budget for one project' },
  { value: 'AGENT', hint: 'Spending card bound to an AI agent (KYA)' },
  { value: 'PHYSICAL', hint: 'Plastic card shipped to holder' },
]

const MCC_HINT = 'Common codes: 5411 groceries · 5732 electronics · 5812 restaurants · 4816 cloud · 7372 software · 5541 fuel · 1520 contractors'

const EMPTY = {
  label: '',
  type: 'VIRTUAL',
  currency: 'KES',
  holderName: '',
  walletId: '',
  perTxnLimit: '',
  dailyLimit: '',
  monthlyLimit: '',
  mccAllowlist: '',
  merchantAllowlist: '',
  countryAllowlist: '',
  agentId: '',
}

export function IssueCardDialog({
  wallets,
  agents,
}: {
  wallets: WalletOption[]
  agents: AgentOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [allowOnline, setAllowOnline] = useState(true)
  const [allowContactless, setAllowContactless] = useState(true)
  const [allowAtm, setAllowAtm] = useState(false)
  const [allowInternational, setAllowInternational] = useState(false)

  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState({ ...EMPTY })

  const currencyWallets = useMemo(
    () => wallets.filter((w) => w.currency === form.currency),
    [wallets, form.currency]
  )

  const walletInvalid = form.walletId !== '' && !currencyWallets.some((w) => w.id === form.walletId)

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function onCurrencyChange(currency: string) {
    setForm((f) => {
      const current = wallets.find((w) => w.id === f.walletId)
      return {
        ...f,
        currency,
        // keep the wallet only if it matches the newly selected currency
        walletId: current && current.currency === currency ? f.walletId : '',
      }
    })
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.walletId) {
      toast({ title: 'Select a wallet', description: 'The card must be funded from an organization wallet of the same currency.' })
      return
    }
    startTransition(async () => {
      const result = await issueCard({
        label: form.label,
        type: form.type,
        currency: form.currency,
        holderName: form.holderName,
        walletId: form.walletId,
        perTxnLimit: form.perTxnLimit,
        dailyLimit: form.dailyLimit,
        monthlyLimit: form.monthlyLimit,
        mccAllowlist: form.mccAllowlist,
        merchantAllowlist: form.merchantAllowlist,
        countryAllowlist: form.countryAllowlist,
        allowOnline,
        allowContactless,
        allowAtm,
        allowInternational,
        agentId: form.agentId || null,
      })
      if (result.ok) {
        toast({
          title: `Card issued — •••• ${result.last4}`,
          description: `${form.type} card "${form.label}" is active and ready for authorization.`,
        })
        setOpen(false)
        setForm({ ...EMPTY })
        router.refresh()
      } else {
        toast({ title: 'Could not issue card', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" aria-hidden />
          Issue card
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Issue a new card</DialogTitle>
          <DialogDescription className="flex items-start gap-2 leading-relaxed">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            PAN/CVV are never stored — tokenized issuance keeps only the last4. Cards spend directly from the selected wallet.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* identity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="card-label">Label</Label>
              <Input
                id="card-label"
                value={form.label}
                onChange={(e) => set('label', e.target.value)}
                placeholder="AWS & cloud infra"
                maxLength={60}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-holder">Holder name</Label>
              <Input
                id="card-holder"
                value={form.holderName}
                onChange={(e) => set('holderName', e.target.value)}
                placeholder="Amina Otieno"
                maxLength={80}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-type">Type</Label>
              <Select value={form.type} onValueChange={(v) => set('type', v)}>
                <SelectTrigger id="card-type" className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {CARD_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex flex-col">
                        <span>{t.value.charAt(0) + t.value.slice(1).toLowerCase()}</span>
                        <span className="text-xs text-muted-foreground">{t.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="card-currency">Currency</Label>
              <Select value={form.currency} onValueChange={onCurrencyChange}>
                <SelectTrigger id="card-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KES">KES — Kenyan Shilling</SelectItem>
                  <SelectItem value="USD">USD — US Dollar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="card-wallet">Funding wallet</Label>
              <Select value={form.walletId} onValueChange={(v) => set('walletId', v)}>
                <SelectTrigger id="card-wallet" className="w-full" aria-invalid={walletInvalid}>
                  <SelectValue placeholder={currencyWallets.length ? 'Select wallet' : `No ${form.currency} wallets available`} />
                </SelectTrigger>
                <SelectContent>
                  {currencyWallets.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.label} · {w.currency} · {w.type.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {currencyWallets.length
                  ? `Showing active ${form.currency} wallets.`
                  : `This organization has no active ${form.currency} wallets.`}
              </p>
            </div>
            {form.type === 'AGENT' ? (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="card-agent">Bound agent (optional)</Label>
                <Select value={form.agentId} onValueChange={(v) => set('agentId', v)}>
                  <SelectTrigger id="card-agent" className="w-full">
                    <SelectValue placeholder="No agent — unbound" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} · {a.role.toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  An agent card draws its KYA guardrails from the card controls here — spend policy stays in the control plane.
                </p>
              </div>
            ) : null}
          </div>

          <Separator />

          {/* limits */}
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium">Spend limits</h4>
              <p className="text-xs text-muted-foreground">
                Decimal amounts in {form.currency}. Leave blank for no limit — hard controls enforced at authorization time.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="limit-per-txn">Per transaction</Label>
                <Input
                  id="limit-per-txn"
                  inputMode="decimal"
                  value={form.perTxnLimit}
                  onChange={(e) => set('perTxnLimit', e.target.value)}
                  placeholder="500.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="limit-daily">Daily</Label>
                <Input
                  id="limit-daily"
                  inputMode="decimal"
                  value={form.dailyLimit}
                  onChange={(e) => set('dailyLimit', e.target.value)}
                  placeholder="1500.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="limit-monthly">Monthly</Label>
                <Input
                  id="limit-monthly"
                  inputMode="decimal"
                  value={form.monthlyLimit}
                  onChange={(e) => set('monthlyLimit', e.target.value)}
                  placeholder="12000.00"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* allowlists */}
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium">Merchant & geography allowlists</h4>
              <p className="text-xs text-muted-foreground">Comma-separated. Leave blank to allow all.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="allow-mcc">MCC codes</Label>
                <Input
                  id="allow-mcc"
                  value={form.mccAllowlist}
                  onChange={(e) => set('mccAllowlist', e.target.value)}
                  placeholder="5411, 5732, 7372"
                />
                <p className="text-xs text-muted-foreground">{MCC_HINT}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="allow-merchant">Merchant fragments</Label>
                <Input
                  id="allow-merchant"
                  value={form.merchantAllowlist}
                  onChange={(e) => set('merchantAllowlist', e.target.value)}
                  placeholder="AWS, Jumia, Naivas"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="allow-country">Countries (ISO alpha-2)</Label>
                <Input
                  id="allow-country"
                  value={form.countryAllowlist}
                  onChange={(e) => set('countryAllowlist', e.target.value)}
                  placeholder="KE"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* channel toggles */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">Channel permissions</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { key: 'online', label: 'Online', desc: 'E-commerce & card-not-present', value: allowOnline, set: setAllowOnline },
                  { key: 'contactless', label: 'Contactless', desc: 'Tap-to-pay at terminals', value: allowContactless, set: setAllowContactless },
                  { key: 'atm', label: 'ATM', desc: 'Cash withdrawals', value: allowAtm, set: setAllowAtm },
                  { key: 'international', label: 'International', desc: 'Non-Kenyan merchants', value: allowInternational, set: setAllowInternational },
                ] as const
              ).map((t) => (
                <div
                  key={t.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <Label htmlFor={`toggle-${t.key}`} className="text-sm font-normal">
                      {t.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">{t.desc}</p>
                  </div>
                  <Switch
                    id={`toggle-${t.key}`}
                    checked={t.value}
                    onCheckedChange={t.set}
                    aria-label={`${t.label} payments ${t.value ? 'enabled' : 'disabled'}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <div className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
              Issued as ACTIVE · audited as card.created
            </div>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              Issue card
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
