import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { trialBalance } from '@/lib/ledger'
import { LEDGER_TXN_SOURCES } from '@novera/domain'
import { PageHeader } from '@/components/novera/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TrialBalanceCard } from './trial-balance-card'
import { TransactionsFilters, type LedgerFilters } from './transactions-filters'
import { TransactionsTable, type TxnRow } from './transactions-table'

export const metadata = { title: 'Ledger · Novera' }

const PAGE_SIZE = 50
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface SearchParams {
  source?: string
  status?: string
  from?: string
  to?: string
  q?: string
  ref?: string
}

function sanitizeFilters(sp: SearchParams): LedgerFilters {
  const source = LEDGER_TXN_SOURCES.includes(sp.source as (typeof LEDGER_TXN_SOURCES)[number])
    ? (sp.source as string)
    : ''
  const status = sp.status === 'POSTED' || sp.status === 'REVERSED' ? sp.status : ''
  const from = sp.from && DATE_RE.test(sp.from) ? sp.from : ''
  const to = sp.to && DATE_RE.test(sp.to) ? sp.to : ''
  // Deep-links (e.g. from a wallet entry) arrive as ?ref=… — surface them in search.
  const q = (sp.ref ?? sp.q ?? '').toString().trim().slice(0, 100)
  return { source, status, from, to, q }
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await requireSession()
  const orgId = session.organization.id
  const filters = sanitizeFilters(await searchParams)

  const postedAt: { gte?: Date; lte?: Date } = {}
  if (filters.from) postedAt.gte = new Date(`${filters.from}T00:00:00.000Z`)
  if (filters.to) postedAt.lte = new Date(`${filters.to}T23:59:59.999Z`)

  const where = {
    organizationId: orgId,
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.from || filters.to ? { postedAt } : {}),
    ...(filters.q
      ? { OR: [{ reference: { contains: filters.q } }, { description: { contains: filters.q } }] }
      : {}),
  }

  const [tb, txns, total] = await Promise.all([
    trialBalance(orgId),
    db.ledgerTransaction.findMany({
      where,
      orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }],
      take: PAGE_SIZE,
      include: {
        entries: { orderBy: { direction: 'asc' }, include: { account: { select: { code: true, name: true } } } },
      },
    }),
    db.ledgerTransaction.count({ where }),
  ])

  const rows: TxnRow[] = txns.map((t) => ({
    id: t.id,
    reference: t.reference,
    description: t.description,
    source: t.source,
    status: t.status,
    amountMinor: t.amountMinor.toString(),
    currency: t.currency,
    postedAt: t.postedAt ? t.postedAt.toISOString() : null,
    entries: t.entries.map((e) => ({
      id: e.id,
      direction: e.direction,
      amountMinor: e.amountMinor.toString(),
      currency: e.currency,
      accountCode: e.account.code,
      accountName: e.account.name,
    })),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ledger"
        description="The double-entry transaction explorer. Every posting balances debits = credits per currency; posted transactions are immutable — corrections happen via reversal, never edits."
      />

      <TrialBalanceCard
        perCurrency={tb.perCurrency.map((c) => ({
          currency: c.currency,
          debits: c.debits.toString(),
          credits: c.credits.toString(),
          balanced: c.balanced,
        }))}
        totalDebits={tb.totalDebits.toString()}
        totalCredits={tb.totalCredits.toString()}
        balanced={tb.balanced}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Transactions</CardTitle>
          <CardDescription>
            {total} transaction{total === 1 ? '' : 's'} in this organization
            {filters.q ? ` matching “${filters.q}”` : ''}
            {filters.source ? ` · source ${filters.source}` : ''}
            {filters.status ? ` · ${filters.status.toLowerCase()}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="border-b">
            <TransactionsFilters filters={filters} />
          </div>
          <div className="pt-2">
            <TransactionsTable rows={rows} total={total} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
