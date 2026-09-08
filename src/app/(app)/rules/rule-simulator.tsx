'use client'

import { useMemo, useState } from 'react'
import { Money } from '@novera/money'
import { MoneyText } from '@/components/novera/money-text'
import { ToneBadge } from '@/components/novera/status-badge'
import { EmptyState } from '@/components/novera/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CheckCircle2, FlaskConical, TriangleAlert } from 'lucide-react'

export interface SimulatorRule {
  id: string
  name: string
  status: string
  /** currency used for simulation — derived from the allocation wallets */
  currency: string
  mixedCurrencies: boolean
  allocations: { label: string; percentBps: number }[]
}

/**
 * Deterministic split simulation — the exact same largest-remainder
 * allocation the kernel runs on settlement (Money.allocateBps on
 * BigInt minor units). Parts always sum exactly to the input:
 * zero leakage by construction.
 */
export function RuleSimulator({ rules }: { rules: SimulatorRule[] }) {
  const [ruleId, setRuleId] = useState(rules[0]?.id ?? '')
  const [amount, setAmount] = useState('1000.00')

  const rule = rules.find((r) => r.id === ruleId)

  const simulation = useMemo(() => {
    if (!rule || rule.allocations.length === 0) return null
    let money: Money
    try {
      money = Money.fromMajor(amount.trim(), rule.currency)
    } catch {
      return { invalid: true as const }
    }
    if (!money.isPositive() || amount.trim() === '') return { invalid: true as const }
    const parts = money.allocateBps(rule.allocations.map((a) => a.percentBps))
    const sumMinor = parts.reduce((acc, p) => acc + p.minor, BigInt(0))
    return { money, parts, sumMinor, exact: sumMinor === money.minor }
  }, [rule, amount])

  return (
    <div className="space-y-4">
      {rules.length === 0 ? (
        <EmptyState
          icon={<FlaskConical className="h-5 w-5" />}
          title="Nothing to simulate"
          description="Create a draft rule or activate the existing one — then simulate any amount against it here."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sim-rule">Rule</Label>
              <Select value={ruleId} onValueChange={setRuleId}>
                <SelectTrigger id="sim-rule" className="w-full" aria-label="Rule to simulate">
                  <SelectValue placeholder="Select rule" />
                </SelectTrigger>
                <SelectContent>
                  {rules.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} · {r.status.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sim-amount">Amount ({rule?.currency ?? '—'})</Label>
              <Input
                id="sim-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 1000.00"
                className="tabular-nums"
              />
            </div>
          </div>

          {rule?.mixedCurrencies ? (
            <p className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning" role="status">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This rule&apos;s wallets span multiple currencies; the kernel executes per payment currency. Simulated
              here in {rule.currency}.
            </p>
          ) : null}

          {simulation && !('invalid' in simulation) ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-lg border">
                {rule!.allocations.map((a, i) => {
                  const part = simulation.parts[i]
                  return (
                    <div
                      key={`${a.label}-${i}`}
                      className="flex items-center justify-between gap-3 border-b last:border-b-0 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
                          {(a.percentBps / 100).toFixed(2)}%
                        </span>
                        <span className="text-sm font-medium">{a.label}</span>
                      </div>
                      <div className="text-right">
                        <MoneyText minor={part.minor.toString()} currency={rule!.currency} strong />
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {part.minor.toLocaleString('en-US')} minor
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success/25 bg-success/5 px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  Parts sum exactly to input
                </span>
                <div className="text-right">
                  <MoneyText
                    minor={simulation.sumMinor.toString()}
                    currency={rule!.currency}
                    strong
                    className="text-sm"
                  />
                  <span className="block text-[10px] text-muted-foreground">
                    input {simulation.money.format()} · {simulation.exact ? 'exact' : 'mismatch'}
                  </span>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Allocation uses the largest-remainder method over integer minor units — the same deterministic code
                path the payments kernel runs at settlement. Remainder units are distributed one-by-one to the
                largest fractional parts, so no minor unit is ever created or lost.
              </p>
            </div>
          ) : (
            <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              Enter a positive amount to simulate the split — e.g. 999.99 to watch remainder units distribute
              exactly.
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <ToneBadge tone="info">Deterministic</ToneBadge>
        <span className="text-xs text-muted-foreground">
          Simulation runs client-side on the same BigInt allocation kernel — no network, no side effects.
        </span>
      </div>
    </div>
  )
}
