import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { MoneyText } from '@/components/novera/money-text'
import { EmptyState } from '@/components/novera/empty-state'
import { timeAgo } from '@/lib/format'
import { CardVisual } from './card-visual'
import { IssueCardDialog } from './issue-card-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { CreditCard, Lock, ShieldAlert, Wallet } from 'lucide-react'
import Link from 'next/link'

export const metadata = { title: 'Cards — Novera' }

const STATUS_ORDER: Record<string, number> = {
  ACTIVE: 0,
  FROZEN: 1,
  PROVISIONING: 2,
  REQUESTED: 3,
  CREATED: 3,
  LOST: 4,
  STOLEN: 4,
  EXPIRED: 5,
  TERMINATED: 5,
}

/** Sum spend grouped by currency — mixed-currency KPIs render each leg honestly. */
function spendByCurrency(cards: { minor: bigint; currency: string }[]): { minor: bigint; currency: string }[] {
  const totals = new Map<string, bigint>()
  for (const c of cards) {
    totals.set(c.currency, (totals.get(c.currency) ?? 0n) + c.minor)
  }
  return [...totals.entries()].map(([currency, minor]) => ({ minor, currency }))
}

function MultiMoneySpend({ legs }: { legs: { minor: bigint; currency: string }[] }) {
  if (legs.length === 0) return <span className="text-muted-foreground">—</span>
  if (legs.length === 1) {
    return <MoneyText minor={legs[0].minor} currency={legs[0].currency} strong />
  }
  return (
    <div className="flex flex-col">
      {legs.map((l) => (
        <MoneyText key={l.currency} minor={l.minor} currency={l.currency} strong className={legs.length > 2 ? 'text-lg' : 'text-xl'} />
      ))}
    </div>
  )
}

export default async function CardsPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  const [cards, auths, wallets, agents] = await Promise.all([
    db.card.findMany({
      where: { organizationId: orgId },
      include: {
        wallet: { select: { label: true, currency: true } },
        agent: { select: { name: true } },
      },
    }),
    db.cardAuthorization.findMany({
      where: { card: { organizationId: orgId } },
      select: { decision: true },
    }),
    db.wallet.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      select: { id: true, label: true, currency: true, type: true },
      orderBy: { label: 'asc' },
    }),
    db.agent.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ])

  cards.sort((a, b) => {
    const sa = STATUS_ORDER[a.status] ?? 9
    const sb = STATUS_ORDER[b.status] ?? 9
    if (sa !== sb) return sa - sb
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  const activeCount = cards.filter((c) => c.status === 'ACTIVE').length
  const todayLegs = spendByCurrency(cards.map((c) => ({ minor: c.spendTodayMinor, currency: c.currency })))
  const monthLegs = spendByCurrency(cards.map((c) => ({ minor: c.spendMonthMinor, currency: c.currency })))
  const declined = auths.filter((a) => a.decision === 'DECLINED').length
  const declineRate = auths.length > 0 ? Math.round((declined / auths.length) * 1000) / 10 : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cards"
        description="Issue and control programmable spend cards — hard controls, risk scoring and explainable declines at authorization time. PAN/CVV are never stored; issuance is tokenized."
        actions={<IssueCardDialog wallets={wallets} agents={agents} />}
      />

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active cards"
          value={activeCount}
          deltaLabel={cards.length > activeCount ? `${cards.length - activeCount} inactive` : undefined}
          hint={cards.length > 0 ? `${cards.length} total` : undefined}
          icon={<CreditCard className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Spend today"
          value={<MultiMoneySpend legs={todayLegs} />}
          hint="across all cards"
          icon={<Wallet className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Spend this month"
          value={<MultiMoneySpend legs={monthLegs} />}
          hint="across all cards"
          icon={<Wallet className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Decline rate"
          value={declineRate === null ? '—' : `${declineRate}%`}
          hint={auths.length > 0 ? `${declined} of ${auths.length} authorizations` : 'no authorizations yet'}
          icon={<ShieldAlert className="h-4 w-4" aria-hidden />}
        />
      </div>

      {/* card grid */}
      {cards.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-6 w-6" aria-hidden />}
          title="No cards issued yet"
          description="Issue your first programmable card — set limits, MCC and geography allowlists, channel permissions, then watch every authorization decision in the simulator."
          action={<IssueCardDialog wallets={wallets} agents={agents} />}
        />
      ) : (
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                All cards · {cards.length}
              </p>
              <p className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <Lock className="h-3 w-3" aria-hidden />
                Tokenized — last4 only
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <Link
                  key={card.id}
                  href={`/cards/${card.id}`}
                  className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <CardVisual
                    card={{
                      label: card.label,
                      holderName: card.holderName,
                      last4: card.last4,
                      expiryMonth: card.expiryMonth,
                      expiryYear: card.expiryYear,
                      status: card.status,
                      type: card.type,
                      currency: card.currency,
                      agentName: card.agent?.name ?? null,
                    }}
                    footer={
                      <div className="mt-3 flex items-start justify-between gap-3 px-1">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium leading-tight">{card.label}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {card.wallet ? `${card.wallet.label} · ${card.wallet.currency}` : 'No wallet linked'}
                            {card.lastUsedAt ? ` · used ${timeAgo(card.lastUsedAt)}` : ' · never used'}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Today</p>
                          <MoneyText minor={card.spendTodayMinor} currency={card.currency} className="text-sm" strong />
                        </div>
                      </div>
                    }
                  />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
