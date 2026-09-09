import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ToneBadge } from '@/components/novera/status-badge'
import { MoneyText } from '@/components/novera/money-text'
import { Scale } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TrialBalanceCurrencyRow {
  currency: string
  debits: string
  credits: string
  balanced: boolean
}

/**
 * TRIAL BALANCE — the marquee honesty feature.
 * Proves Σ posted debits = Σ posted credits, per currency, derived live
 * from ledger entries. Never cached, never asserted without checking.
 */
export function TrialBalanceCard({
  perCurrency,
  totalDebits,
  totalCredits,
  balanced,
}: {
  perCurrency: TrialBalanceCurrencyRow[]
  totalDebits: string
  totalCredits: string
  balanced: boolean
}) {
  return (
    <Card
      className={cn(
        'border-2',
        balanced ? 'border-success/40 bg-success/[0.04]' : 'border-danger/40 bg-danger/[0.04]'
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'rounded-full p-2',
                balanced ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
              )}
            >
              <Scale className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-0.5">
              <CardTitle className="text-base">Trial balance</CardTitle>
              <CardDescription>
                Sum of all posted debits = sum of all posted credits, per currency — computed live
                from ledger entries.
              </CardDescription>
            </div>
          </div>
          <ToneBadge tone={balanced ? 'positive' : 'negative'} className="text-xs">
            {balanced ? 'Balanced' : 'Out of balance'}
          </ToneBadge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {perCurrency.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No posted entries yet — the ledger balances trivially at zero.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {perCurrency.map((row) => (
              <div
                key={row.currency}
                className="grid grid-cols-2 items-center gap-2 py-2.5 sm:grid-cols-[minmax(64px,auto)_1fr_1fr_minmax(auto,104px)]"
              >
                <span className="font-mono text-sm font-medium">{row.currency}</span>
                <span className="flex justify-end gap-1.5 text-sm">
                  <span className="hidden text-xs uppercase tracking-wider text-muted-foreground sm:inline">
                    Dr
                  </span>
                  <MoneyText minor={row.debits} currency={row.currency} />
                </span>
                <span className="flex justify-end gap-1.5 text-sm">
                  <span className="hidden text-xs uppercase tracking-wider text-muted-foreground sm:inline">
                    Cr
                  </span>
                  <MoneyText minor={row.credits} currency={row.currency} />
                </span>
                <span className="col-span-2 flex sm:col-span-1 sm:justify-end">
                  <ToneBadge tone={row.balanced ? 'positive' : 'negative'} className="text-xs">
                    {row.balanced ? 'Balanced' : 'Out of balance'}
                  </ToneBadge>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
          Aggregate across all accounts and currencies (raw minor units):{' '}
          <span className="tabular-nums">{totalDebits}</span> debits ={' '}
          <span className="tabular-nums">{totalCredits}</span> credits. The per-currency rows
          above are the authoritative proof. Posted transactions are immutable — corrections post
          as reversals, so this holds at every point in history.
        </p>
      </CardContent>
    </Card>
  )
}
