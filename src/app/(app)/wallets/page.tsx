import { requireSession } from '@/lib/session'
import { walletSummary } from '@/lib/transfers'
import { db } from '@/lib/db'
import { Money } from '@novera/money'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { EmptyState } from '@/components/novera/empty-state'
import { WalletCard } from './wallet-card'
import { NewWalletDialog } from './new-wallet-dialog'
import { TransferDialog } from './transfer-dialog'
import { Wallet, BookText, CircleCheck, Lock } from 'lucide-react'

export const metadata = { title: 'Wallets · Novera' }

/** walletSummary returns an inferred (opaque) array — this is its runtime contract. */
interface WalletSummaryRow {
  id: string
  label: string
  type: string
  currency: string
  status: string
  description: string | null
  createdAt: Date
  ledgerBalanceMinor: bigint
  availableMinor: bigint
  reservedMinor: bigint
}

export default async function WalletsPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  const [summariesRaw, activeHolds] = await Promise.all([
    walletSummary(orgId),
    db.hold.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
  ])
  const summaries = summariesRaw as WalletSummaryRow[]

  const wallets = summaries.map((w) => ({
    id: w.id,
    label: w.label,
    type: w.type,
    currency: w.currency,
    status: w.status,
    description: w.description,
    createdAt: w.createdAt.toISOString(),
    ledgerBalanceMinor: w.ledgerBalanceMinor.toString(),
    availableMinor: w.availableMinor.toString(),
    reservedMinor: w.reservedMinor.toString(),
  }))

  // Per-currency totals — never sum across currencies.
  const totals = new Map<string, { ledger: bigint; reserved: bigint; available: bigint }>()
  for (const w of summaries) {
    const t = totals.get(w.currency) ?? { ledger: BigInt(0), reserved: BigInt(0), available: BigInt(0) }
    t.ledger += w.ledgerBalanceMinor
    t.reserved += w.reservedMinor
    t.available += w.availableMinor
    totals.set(w.currency, t)
  }
  const joinByCurrency = (pick: (t: { ledger: bigint; reserved: bigint; available: bigint }) => bigint) =>
    [...totals.entries()]
      .map(([currency, t]) => Money.fromMinor(pick(t), currency).format())
      .join('  ·  ') || '—'

  const activeCount = summaries.filter((w) => w.status === 'ACTIVE').length
  const currencyCodes = [...totals.keys()]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallets"
        description="Multi-currency wallets, each backed by its own ledger account. Balances are derived from posted ledger entries minus active holds — reserved funds are held and not spendable."
        actions={
          <>
            <TransferDialog
              wallets={wallets.map((w) => ({
                id: w.id,
                label: w.label,
                type: w.type,
                currency: w.currency,
                status: w.status,
                availableMinor: w.availableMinor,
              }))}
            />
            <NewWalletDialog />
          </>
        }
      />

      <section aria-label="Wallet totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Wallets"
          value={summaries.length}
          hint={`${activeCount} active`}
          icon={<Wallet className="h-4 w-4" />}
        />
        <KpiCard
          label={`Ledger balance${currencyCodes.length > 1 ? ` · ${currencyCodes.join(', ')}` : ''}`}
          value={<span className="break-words">{joinByCurrency((t) => t.ledger)}</span>}
          hint="Posted entries only"
          icon={<BookText className="h-4 w-4" />}
        />
        <KpiCard
          label="Available"
          value={<span className="break-words">{joinByCurrency((t) => t.available)}</span>}
          hint="Ledger − active holds"
          icon={<CircleCheck className="h-4 w-4" />}
        />
        <KpiCard
          label="Reserved on holds"
          value={<span className="break-words">{joinByCurrency((t) => t.reserved)}</span>}
          hint={activeHolds > 0 ? `${activeHolds} active hold${activeHolds === 1 ? '' : 's'} — not spendable` : 'No active holds'}
          icon={<Lock className="h-4 w-4" />}
        />
      </section>

      {wallets.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-6 w-6" />}
          title="No wallets yet"
          description="Create your first wallet to start holding funds. Every wallet gets its own double-entry ledger account and starts at exactly zero."
          action={<NewWalletDialog />}
        />
      ) : (
        <section aria-label="Wallets" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {wallets.map((w) => (
            <WalletCard key={w.id} wallet={w} />
          ))}
        </section>
      )}
    </div>
  )
}
