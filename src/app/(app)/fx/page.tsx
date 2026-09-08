import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { scaledRate, applySpread } from '@/lib/fx'
import { walletSummary } from '@/lib/transfers'
import type { StatusMeta } from '@novera/domain'
import { PageHeader } from '@/components/novera/page-header'
import { StatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { EmptyState } from '@/components/novera/empty-state'
import { fmtDateTime } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ArrowLeftRight, History, TrendingUp } from 'lucide-react'
import { FxConvertCard } from './fx-convert-card'
import { formatScaledRate } from './rate-format'

export const metadata = { title: 'FX' }

const RATE_PAIRS: [string, string][] = [
  ['KES', 'USD'],
  ['USD', 'KES'],
  ['KES', 'EUR'],
  ['EUR', 'KES'],
  ['KES', 'UGX'],
  ['UGX', 'KES'],
  ['KES', 'TZS'],
  ['TZS', 'KES'],
  ['USD', 'USDC'],
  ['USDC', 'USD'],
]

const FX_STATUS_META: Record<string, StatusMeta> = {
  QUOTED: { label: 'Quoted', tone: 'info' },
  EXECUTED: { label: 'Executed', tone: 'positive' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
}

/**
 * Local view of walletSummary() rows — the shared helper's inferred
 * return (never[]) is an artifact of the repo's tsc target; the runtime
 * shape is exactly this, and the Next compiler builds it cleanly.
 */
interface WalletRow {
  id: string
  label: string
  currency: string
  status: string
  availableMinor: bigint
}

export default async function FxPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  // ── Rate board: scaled-integer rates, formatted without floats ────
  const board = RATE_PAIRS.map(([base, quote]) => {
    const mid = scaledRate(base, quote)
    const executable = applySpread(mid, 80)
    const inverse = scaledRate(quote, base)
    return { base, quote, mid, executable, inverse }
  })

  // ── Wallets for the convert flow (org-scoped, active only) ────────
  const wallets = ((await walletSummary(orgId)) as WalletRow[])
    .filter((w) => w.status === 'ACTIVE')
    .map((w) => ({
      id: w.id,
      label: w.label,
      currency: w.currency,
      availableMinor: w.availableMinor.toString(),
    }))

  // ── Quote history ──────────────────────────────────────────────────
  const quotes = await db.fxQuote.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true,
      baseCurrency: true,
      quoteCurrency: true,
      rateScaled: true,
      spreadBps: true,
      status: true,
      createdAt: true,
      executedAt: true,
      expiresAt: true,
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="FX"
        description="Indicative rate board, locked quotes and two-leg conversions. Rates are scaled integers (×10⁸) — never floats — and every conversion posts real double entries through FX clearing."
        actions={<ToneBadge tone="warning">Indicative TEST rates</ToneBadge>}
      />

      <div className="grid gap-6 lg:grid-cols-5">
        {/* (a) Rate board */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Rate board</CardTitle>
              <ToneBadge tone="info">Scaled integers</ToneBadge>
            </div>
            <CardDescription>
              Mid reference and executable rate (mid − 80 bps spread) per pair, both directions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pair</TableHead>
                    <TableHead className="text-right">Mid rate</TableHead>
                    <TableHead className="text-right">Executable (−80 bps)</TableHead>
                    <TableHead className="text-right">Inverse (mid)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {board.map((row) => (
                    <TableRow key={`${row.base}-${row.quote}`}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                          {row.base} → {row.quote}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatScaledRate(row.mid)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatScaledRate(row.executable)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatScaledRate(row.inverse)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Rates are stored as integers scaled by 10⁸ and formatted through exact BigInt division — no floating
              point anywhere in the path. TEST-mode reference rates; the executable column is what a locked quote
              applies.
            </p>
          </CardContent>
        </Card>

        {/* (b) Convert flow */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Convert</CardTitle>
              <ToneBadge tone="info">60s locked quotes</ToneBadge>
            </div>
            <CardDescription>
              Quote, watch the rate lock, confirm inside the window. The kernel validates wallet currencies against
              the quote direction before anything moves.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {wallets.length < 2 ? (
              <EmptyState
                icon={<TrendingUp className="h-5 w-5" />}
                title="Need two currency wallets"
                description="Converting requires active wallets in different currencies — for example the KES operating wallet and the USD wallet."
              />
            ) : (
              <FxConvertCard wallets={wallets} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* (c) Quote history + two-leg posting note */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">Quote history</CardTitle>
              <ToneBadge tone="neutral">{quotes.length} shown</ToneBadge>
            </div>
            <CardDescription>Every quote this organization has locked, with its final state.</CardDescription>
          </CardHeader>
          <CardContent>
            {quotes.length === 0 ? (
              <EmptyState
                icon={<History className="h-5 w-5" />}
                title="No quotes yet"
                description="Request your first quote from the convert panel — it will appear here with its locked rate and outcome."
              />
            ) : (
              <div className="max-h-96 overflow-y-auto overflow-x-auto scroll-thin">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pair</TableHead>
                      <TableHead className="text-right">Locked rate</TableHead>
                      <TableHead className="text-right">Spread</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Created</TableHead>
                      <TableHead className="text-right">Executed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quotes.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="font-medium">
                          {q.baseCurrency} → {q.quoteCurrency}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatScaledRate(q.rateScaled)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {q.spreadBps} bps
                        </TableCell>
                        <TableCell>
                          <StatusBadge meta={FX_STATUS_META} status={q.status} />
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {fmtDateTime(q.createdAt)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {q.executedAt ? fmtDateTime(q.executedAt) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">How FX posts to the ledger</CardTitle>
            <CardDescription>
              FX posts two single-currency entries through FX clearing — per-currency invariants hold.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 font-mono text-xs">
              <div className="rounded-md border bg-muted/40 p-3 leading-relaxed">
                <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Leg A — base currency
                </p>
                <p>Dr FX_CLEARING</p>
                <p>Cr source wallet (base)</p>
              </div>
              <div className="rounded-md border bg-muted/40 p-3 leading-relaxed">
                <p className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Leg B — quote currency
                </p>
                <p>Dr target wallet (quote)</p>
                <p>Cr FX_CLEARING</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Each leg is an independent balanced transaction in a single currency, so the per-currency trial
              balance proof holds exactly — cross-currency value never mixes inside one entry. Reversals, audits and
              webhooks fire per posting, exactly like any other ledger movement.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
