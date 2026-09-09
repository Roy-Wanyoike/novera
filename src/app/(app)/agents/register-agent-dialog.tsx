'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, CheckCircle2, Loader2, Plus, ShieldCheck } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CodeBlock } from '@/components/novera/copy-button'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { registerAgent, type RegisterAgentResult } from './actions'
import {
  AGENT_ROLES_LIST,
  AGENT_TOOLS_LIST,
  EMOJI_CHOICES,
  MONEY_TOOLS,
  ROLE_HINTS,
  ROLE_LABELS,
  TOOL_HINTS,
  TOOL_LABELS,
} from './labels'

/**
 * Register agent — the KYA moment.
 * Name → role → emoji → scopes → deterministic limits → one-time credential.
 */
export function RegisterAgentDialog({ baseCurrency }: { baseCurrency: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<RegisterAgentResult | null>(null)

  const [name, setName] = useState('')
  const [role, setRole] = useState('PROCUREMENT')
  const [emoji, setEmoji] = useState<string>('🤖')
  const [description, setDescription] = useState('')
  const [perTxn, setPerTxn] = useState('')
  const [daily, setDaily] = useState('')
  const [approvalAbove, setApprovalAbove] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [provisionWallet, setProvisionWallet] = useState(false)

  const moneyScopeSelected = scopes.some((s) => MONEY_TOOLS.includes(s))
  useEffect(() => {
    if (moneyScopeSelected) setProvisionWallet(true)
  }, [moneyScopeSelected])

  const reset = () => {
    setName('')
    setRole('PROCUREMENT')
    setEmoji('🤖')
    setDescription('')
    setPerTxn('')
    setDaily('')
    setApprovalAbove('')
    setScopes([])
    setProvisionWallet(false)
    setError(null)
    setSuccess(null)
    setSubmitting(false)
  }

  const toggleScope = (tool: string, checked: boolean) => {
    setScopes((prev) => (checked ? [...prev, tool] : prev.filter((s) => s !== tool)))
  }

  const submit = async () => {
    setError(null)
    if (name.trim().length < 2) {
      setError('Give the agent a name (2+ characters).')
      return
    }
    if (scopes.length === 0) {
      setError('Grant at least one tool scope — least privilege starts at registration.')
      return
    }
    setSubmitting(true)
    try {
      const res = await registerAgent({
        name,
        role,
        description,
        emoji,
        perTransactionLimitMajor: perTxn,
        dailyLimitMajor: daily,
        approvalAboveMajor: approvalAbove,
        scopes,
        provisionWallet,
        currency: baseCurrency,
      })
      if (res.ok) {
        setSuccess(res)
        toast({
          title: `${res.agentName} registered`,
          description: 'KYA complete — identity, scopes and deterministic limits are on the audit chain.',
        })
        router.refresh()
      } else {
        setError(res.error ?? 'Registration failed.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" className="gap-2">
          <Plus className="h-4 w-4" aria-hidden />
          Register agent
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto scroll-thin sm:max-w-xl">
        {success?.ok ? (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" aria-hidden />
                {success.agentName} registered — KYA complete
              </DialogTitle>
              <DialogDescription>
                Identity, scopes and deterministic limits are recorded on the audit hash-chain. The
                agent is live (ACTIVE) and can propose intents immediately.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <p className="text-sm font-medium">Credential — copy it now, it is never shown again</p>
              <CodeBlock code={success.credential ?? ''} language="agent credential" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Novera stores only the SHA-256 hash of this secret (prefix{' '}
                <span className="font-mono">{success.credentialPrefix}…</span>). If you lose it, rotate
                the credential and register the replacement event — the audit trail keeps both.
              </p>
            </div>

            {success.walletProvisioned ? (
              <p className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/10 p-3 text-xs text-primary">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                A dedicated agent wallet was provisioned — agents never share human wallets.
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" aria-hidden />
                Register an agent
              </DialogTitle>
              <DialogDescription>
                Know Your Agent: an identity, scoped credentials, deterministic policy limits and a
                full audit trail. The credential is generated once and stored hashed.
              </DialogDescription>
            </DialogHeader>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
              >
                {error}
              </p>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Agent name</Label>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Atlas II"
                  maxLength={60}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label>Avatar</Label>
                <div
                  role="radiogroup"
                  aria-label="Choose an avatar emoji"
                  className="grid w-fit grid-cols-6 gap-1.5"
                >
                  {EMOJI_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={emoji === choice}
                      aria-label={`Avatar ${choice}`}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-md border text-lg transition-colors',
                        emoji === choice
                          ? 'border-primary bg-primary/10 ring-2 ring-primary/40'
                          : 'border-border hover:bg-muted'
                      )}
                      onClick={() => setEmoji(choice)}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="agent-role" className="w-full">
                  <SelectValue placeholder="Pick a role" />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_ROLES_LIST.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r] ?? r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">{ROLE_HINTS[role] ?? 'Bespoke scoped role.'}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-description">Description</Label>
              <Textarea
                id="agent-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this agent for? e.g. Compares supplier quotes and pays approved suppliers within strict limits."
                rows={2}
                maxLength={280}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="agent-per-txn">Per-transaction ceiling</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                    {baseCurrency}
                  </span>
                  <Input
                    id="agent-per-txn"
                    inputMode="decimal"
                    placeholder="450.00"
                    className="pl-12 tabular-nums"
                    value={perTxn}
                    onChange={(e) => setPerTxn(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">Blank = no ceiling (risky).</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-daily">Daily ceiling</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                    {baseCurrency}
                  </span>
                  <Input
                    id="agent-daily"
                    inputMode="decimal"
                    placeholder="1500.00"
                    className="pl-12 tabular-nums"
                    value={daily}
                    onChange={(e) => setDaily(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">Cumulative daily spend cap.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-approval">Approval required above</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                    {baseCurrency}
                  </span>
                  <Input
                    id="agent-approval"
                    inputMode="decimal"
                    placeholder="300.00"
                    className="pl-12 tabular-nums"
                    value={approvalAbove}
                    onChange={(e) => setApprovalAbove(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">0 or blank = always ask a human.</p>
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Tool scopes</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {AGENT_TOOLS_LIST.map((tool) => {
                  const checked = scopes.includes(tool)
                  return (
                    <label
                      key={tool}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                        checked ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/50'
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleScope(tool, v === true)}
                        aria-label={TOOL_LABELS[tool] ?? tool}
                        className="mt-0.5"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium leading-none">
                          {TOOL_LABELS[tool] ?? tool}
                        </span>
                        <span className="block font-mono text-[10px] text-muted-foreground">{tool}</span>
                        <span className="block text-[11px] leading-snug text-muted-foreground">
                          {TOOL_HINTS[tool]}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
              <Checkbox
                checked={provisionWallet}
                onCheckedChange={(v) => setProvisionWallet(v === true)}
                className="mt-0.5"
                id="agent-wallet"
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium leading-none">Provision a dedicated wallet</span>
                <span className="block text-[11px] text-muted-foreground">
                  Agents never share human wallets — recommended when money-moving scopes are granted.
                </span>
              </span>
            </label>

            <DialogFooter className="gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Register agent
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
