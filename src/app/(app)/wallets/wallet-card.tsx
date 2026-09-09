import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { MoneyText } from '@/components/novera/money-text'
import { Check, Lock, ChevronRight } from 'lucide-react'
import { WALLET_TYPE_META } from '@novera/domain'
import { fmtDate } from '@/lib/format'

/**
 * Wallet card — server component. The whole card links to the wallet
 * detail page. Available vs reserved is the honesty feature: reserved
 * funds sit under active holds and are NOT spendable.
 */
export interface WalletCardData {
  id: string
  label: string
  type: string
  currency: string
  status: string
  description: string | null
  createdAt: string
  ledgerBalanceMinor: string
  availableMinor: string
  reservedMinor: string
}

const CURRENCY_TONE: Record<string, 'positive' | 'info' | 'warning' | 'neutral' | 'accent'> = {
  KES: 'positive',
  USD: 'info',
  USDC: 'warning',
}

export function WalletCard({ wallet }: { wallet: WalletCardData }) {
  const reserved = BigInt(wallet.reservedMinor)
  const hasReserved = reserved > BigInt(0)
  return (
    <Link
      href={`/wallets/${wallet.id}`}
      className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label={`Open wallet ${wallet.label} (${wallet.currency})`}
    >
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="flex h-full flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge meta={WALLET_TYPE_META} status={wallet.type} />
                {wallet.status !== 'ACTIVE' ? (
                  <ToneBadge tone={wallet.status === 'FROZEN' ? 'warning' : 'neutral'}>
                    {wallet.status.toLowerCase()}
                  </ToneBadge>
                ) : null}
              </div>
              <p className="truncate font-medium leading-tight group-hover:text-primary">
                {wallet.label}
              </p>
              {wallet.description ? (
                <p className="truncate text-xs text-muted-foreground">{wallet.description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <ToneBadge tone={CURRENCY_TONE[wallet.currency] ?? 'neutral'} className="font-mono">
                {wallet.currency}
              </ToneBadge>
              <ChevronRight
                className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden="true"
              />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Ledger balance
            </p>
            <MoneyText
              minor={wallet.ledgerBalanceMinor}
              currency={wallet.currency}
              strong
              className="text-2xl"
            />
          </div>

          <div className="mt-auto grid grid-cols-2 gap-3 border-t pt-3">
            <div className="min-w-0 space-y-0.5">
              <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Check className="h-3 w-3 text-success" aria-hidden="true" />
                Available
              </p>
              <MoneyText minor={wallet.availableMinor} currency={wallet.currency} className="text-sm" />
            </div>
            <div className="min-w-0 space-y-0.5 text-right">
              <p className="flex items-center justify-end gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Lock className="h-3 w-3 text-warning" aria-hidden="true" />
                Reserved
              </p>
              <MoneyText
                minor={wallet.reservedMinor}
                currency={wallet.currency}
                className={`text-sm ${hasReserved ? 'text-warning' : 'text-muted-foreground/70'}`}
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground/70">
            Created {fmtDate(wallet.createdAt)} · entries-derived, never cached
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}
