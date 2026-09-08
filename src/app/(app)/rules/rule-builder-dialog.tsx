'use client'

import { useMemo, useState, useTransition } from 'react'
import { createRule } from './actions'
import { ToneBadge } from '@/components/novera/status-badge'
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
import { GitBranch, Loader2, Plus, Trash2 } from 'lucide-react'

export interface BuilderWallet {
  id: string
  label: string
  currency: string
}

interface Row {
  key: number
  walletId: string
  percent: string
}

const TRIGGERS: { value: string; label: string; hint: string }[] = [
  { value: 'PAYMENT_RECEIVED', label: 'Payment received', hint: 'Runs on every settled collection' },
  { value: 'INVOICE_PAID', label: 'Invoice paid', hint: 'Runs when a linked invoice is fully paid' },
  { value: 'MANUAL', label: 'Manual', hint: 'Only runs when explicitly invoked' },
]

let rowKey = 0
function nextRow(walletId = '', percent = ''): Row {
  rowKey += 1
  return { key: rowKey, walletId, percent }
}

export function RuleBuilderDialog({ wallets }: { wallets: BuilderWallet[] }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState('PAYMENT_RECEIVED')
  const [rows, setRows] = useState<Row[]>([nextRow(), nextRow(), nextRow()])
  const [isPending, startTransition] = useTransition()

  const parsed = useMemo(
    () =>
      rows.map((r) => {
        const pct = Number(r.percent)
        const valid = r.percent.trim() !== '' && Number.isFinite(pct) && pct > 0 && pct <= 100
        return { row: r, pct, valid, bps: valid ? Math.round(pct * 100) : 0 }
      }),
    [rows]
  )
  const totalBps = parsed.reduce((s, p) => s + p.bps, 0)
  const sumValid = parsed.every((p) => p.valid)
  const balanced = totalBps === 10_000
  const uniqueWallets = new Set(parsed.map((p) => p.row.walletId).filter(Boolean)).size === parsed.filter((p) => p.row.walletId).length
  const nameValid = name.trim().length >= 1 && name.trim().length <= 80

  const canSave = nameValid && sumValid && balanced && uniqueWallets && rows.length > 0 && !isPending

  function reset() {
    setName('')
    setTrigger('PAYMENT_RECEIVED')
    setRows([nextRow(), nextRow(), nextRow()])
  }

  function addRow() {
    const used = new Set(rows.map((r) => r.walletId))
    const free = wallets.find((w) => !used.has(w.id))
    setRows((prev) => [...prev, nextRow(free?.id ?? '')])
  }

  function removeRow(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev))
  }

  function handleSave() {
    startTransition(async () => {
      const result = await createRule({
        name: name.trim(),
        trigger,
        allocations: parsed.map((p) => ({
          label: '',
          walletId: p.row.walletId,
          percentBps: p.bps,
        })),
      })
      if (result.ok) {
        toast({
          title: 'Rule created as DRAFT',
          description: `"${name.trim()}" is saved with balanced allocations. Approve it from the rules table to activate.`,
        })
        setOpen(false)
        reset()
      } else {
        toast({ title: 'Could not save rule', description: result.error, variant: 'destructive' })
      }
    })
  }

  const remaining = (10_000 - totalBps) / 100

  return (
    <Dialog open={open} onOpenChange={(v) => setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New rule
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            Build a split rule
          </DialogTitle>
          <DialogDescription>
            Programmable money: route incoming payments across wallets in fixed proportions. Allocations are stored
            as integer basis points and must total exactly 100%.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Revenue waterfall 10/20/70"
              maxLength={80}
              aria-invalid={!nameValid}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-trigger">Trigger</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger id="rule-trigger" className="w-full" aria-label="Trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIGGERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <span className="font-medium">{t.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{t.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Allocations</Label>
              <span className="text-xs text-muted-foreground">
                {rows.length} of 10 rows
              </span>
            </div>
            <div className="space-y-2">
              {parsed.map((p, i) => {
                const wallet = wallets.find((w) => w.id === p.row.walletId)
                return (
                  <div key={p.row.key} className="flex items-center gap-2">
                    <div className="flex-1 space-y-1">
                      <Select
                        value={p.row.walletId}
                        onValueChange={(v) =>
                          setRows((prev) => prev.map((r) => (r.key === p.row.key ? { ...r, walletId: v } : r)))
                        }
                      >
                        <SelectTrigger aria-label={`Allocation ${i + 1} wallet`} className="w-full">
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
                      {wallet ? (
                        <p className="pl-1 text-[11px] text-muted-foreground">→ {wallet.currency}</p>
                      ) : null}
                    </div>
                    <div className="w-24 space-y-1">
                      <Input
                        inputMode="decimal"
                        value={p.row.percent}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r) => (r.key === p.row.key ? { ...r, percent: e.target.value } : r))
                          )
                        }
                        placeholder="10"
                        aria-label={`Allocation ${i + 1} percent`}
                        className="text-right tabular-nums"
                        aria-invalid={!p.valid}
                      />
                      <p className="text-right text-[11px] text-muted-foreground">%</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(p.row.key)}
                      disabled={rows.length <= 1 || isPending}
                      aria-label={`Remove allocation ${i + 1}`}
                      className="shrink-0 text-muted-foreground hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={rows.length >= 10 || isPending}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Add allocation
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Total allocation</span>
              {balanced ? (
                <ToneBadge tone="positive">100% — balanced</ToneBadge>
              ) : (
                <ToneBadge tone="warning">
                  {(totalBps / 100).toFixed(2)}% — {remaining > 0 ? `add ${remaining.toFixed(2)}%` : `remove ${Math.abs(remaining).toFixed(2)}%`}
                </ToneBadge>
              )}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className={`h-full rounded-full transition-all ${balanced ? 'bg-success' : 'bg-warning'}`}
                style={{ width: `${Math.min(100, (totalBps / 10_000) * 100)}%` }}
              />
            </div>
            {!uniqueWallets ? (
              <p className="text-xs text-warning">Each wallet can appear in at most one allocation.</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Saving is blocked until the split totals exactly 100%. The rule is stored as DRAFT — activation
              requires a separate approval.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isPending ? 'Saving…' : 'Save as draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
