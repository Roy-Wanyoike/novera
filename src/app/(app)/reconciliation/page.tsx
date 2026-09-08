import Link from 'next/link'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { safeJson, titleCase, fmtDateTime, timeAgo, pct, truncateMiddle } from '@/lib/format'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { EmptyState } from '@/components/novera/empty-state'
import { MoneyText } from '@/components/novera/money-text'
import { ToneBadge } from '@/components/novera/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertTriangle,
  FileSearch,
  History,
  Inbox,
  Percent,
  ReceiptText,
  Scale,
} from 'lucide-react'
import { ScanButton } from './scan-button'
import { ReconCases, type CaseRow, type DetailToken } from './cases'

export const metadata = { title: 'Reconciliation' }

// ── detail JSON → display tokens ─────────────────────────────────────

interface CaseDetail {
  ledger?: Record<string, unknown> | null
  provider?: Record<string, unknown> | null
}

function buildSideTokens(
  side: Record<string, unknown> | null | undefined,
  currencyHint: string
): DetailToken[] | null {
  if (!side) return null
  const tokens: DetailToken[] = []
  if (side.reference != null) tokens.push({ kind: 'mono', text: String(side.reference) })
  if (side.amountMinor != null) {
    tokens.push({ kind: 'money', text: '', minor: String(side.amountMinor), currency: currencyHint })
  }
  if (side.currency != null) tokens.push({ kind: 'text', text: String(side.currency) })
  if (side.status != null) tokens.push({ kind: 'text', text: String(side.status) })
  if (side.settledAt != null) tokens.push({ kind: 'text', text: fmtDateTime(String(side.settledAt)) })
  if (side.externalReference != null) {
    tokens.push({ kind: 'mono', text: truncateMiddle(String(side.externalReference)) })
  }
  if (side.note != null) tokens.push({ kind: 'text', text: String(side.note) })
  return tokens.length > 0 ? tokens : null
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }

interface ScanSummaryMeta {
  compared?: number
  matched?: number
  discrepancies?: number
  newCases?: number
}

// ── provider statement status badges ─────────────────────────────────

function ProviderTxnStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'SETTLED':
      return <ToneBadge tone="positive">Settled</ToneBadge>
    case 'FAILED':
      return <ToneBadge tone="negative">Failed</ToneBadge>
    case 'ACKNOWLEDGED':
      return <ToneBadge tone="info">Acknowledged</ToneBadge>
    default:
      return <ToneBadge tone="neutral">Submitted</ToneBadge>
  }
}

function ReconStateBadge({ status, discrepancyType }: { status: string; discrepancyType: string | null }) {
  switch (status) {
    case 'MATCHED':
      return <ToneBadge tone="positive">Matched</ToneBadge>
    case 'RESOLVED':
      return <ToneBadge tone="info">Resolved</ToneBadge>
    case 'DISCREPANCY':
      return (
        <span className="inline-flex items-center gap-1.5">
          <ToneBadge tone="warning">Discrepancy</ToneBadge>
          {discrepancyType ? (
            <span className="text-[10px] text-muted-foreground">{titleCase(discrepancyType)}</span>
          ) : null}
        </span>
      )
    default:
      return <ToneBadge tone="neutral">Unmatched</ToneBadge>
  }
}

// ── page ─────────────────────────────────────────────────────────────

export default async function ReconciliationPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  // Last scan (audit events with action reconciliation.scan)
  const lastScan = await db.auditEvent.findFirst({
    where: { organizationId: orgId, action: 'reconciliation.scan' },
    orderBy: { createdAt: 'desc' },
  })
  const scanMeta = safeJson<ScanSummaryMeta>(lastScan?.metadata, {})

  // Cases: open queue + closed history
  const [openCaseRows, historyCaseRows] = await Promise.all([
    db.reconciliationCase.findMany({
      where: { organizationId: orgId, status: { in: ['OPEN', 'INVESTIGATING'] } },
      orderBy: { createdAt: 'asc' },
      include: { provider: true, payment: { select: { id: true, reference: true, currency: true } } },
    }),
    db.reconciliationCase.findMany({
      where: { organizationId: orgId, status: { in: ['RESOLVED', 'DISMISSED'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { provider: true, payment: { select: { id: true, reference: true, currency: true } } },
    }),
  ])

  const toRow = (
    c: (typeof openCaseRows)[number]
  ): CaseRow => {
    const detail = safeJson<CaseDetail>(c.detail, {})
    const currencyHint =
      (detail.ledger?.currency as string | undefined) ??
      (detail.provider?.currency as string | undefined) ??
      c.payment?.currency ??
      'KES'
    return {
      id: c.id,
      typeLabel: titleCase(c.type),
      severity: c.severity,
      status: c.status,
      providerName: c.provider?.name ?? '—',
      paymentId: c.payment?.id ?? null,
      paymentReference: c.payment?.reference ?? null,
      createdAt: fmtDateTime(c.createdAt),
      ledgerTokens: buildSideTokens(detail.ledger, currencyHint),
      providerTokens: buildSideTokens(detail.provider, currencyHint),
      resolutionNote: c.resolutionNote,
      resolvedBy: c.resolvedBy,
      resolvedAt: c.resolvedAt ? fmtDateTime(c.resolvedAt) : null,
    }
  }

  const queue = openCaseRows
    .map(toRow)
    .sort((a, b) => {
      const rankDiff = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
      return rankDiff
    })
  const history = historyCaseRows.map(toRow)

  // Provider statements: the provider's side of the story.
  // Org-linked statements + orphan statements referenced by this org's cases.
  const casePtIds = [...openCaseRows, ...historyCaseRows]
    .map((c) => c.providerTransactionId)
    .filter((id): id is string => id != null)

  const [orgStatements, orphanStatements] = await Promise.all([
    db.providerTransaction.findMany({
      where: { payment: { organizationId: orgId } },
      include: { provider: true, payment: { select: { id: true, reference: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    casePtIds.length
      ? db.providerTransaction.findMany({
          where: { id: { in: casePtIds }, paymentId: null },
          include: { provider: true, payment: { select: { id: true, reference: true } } },
        })
      : Promise.resolve([]),
  ])

  const statements = Array.from(
    new Map([...orgStatements, ...orphanStatements].map((pt) => [pt.id, pt])).values()
  )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 60)

  // KPIs
  const sevCount = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const c of queue) {
    if (c.severity in sevCount) sevCount[c.severity as keyof typeof sevCount]++
  }
  const matchedRate =
    scanMeta.compared && scanMeta.compared > 0
      ? pct(scanMeta.matched ?? 0, scanMeta.compared)
      : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reconciliation Operations Center"
        description="Ledger ↔ provider matching. Discrepancies become cases in the ops queue — nothing auto-repairs. Every resolution is an explicit, audited operator action."
        actions={<ScanButton />}
      />

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Open cases"
          value={queue.length}
          hint={`${sevCount.CRITICAL} critical · ${sevCount.HIGH} high · ${sevCount.MEDIUM} medium · ${sevCount.LOW} low`}
          icon={<Inbox className="h-4 w-4" />}
        />
        <KpiCard
          label="Matched rate"
          value={matchedRate !== null ? `${matchedRate}%` : '—'}
          hint={
            scanMeta.compared
              ? `last scan · ${scanMeta.compared} compared`
              : 'run a scan to establish a baseline'
          }
          icon={<Percent className="h-4 w-4" />}
        />
        <KpiCard
          label="Discrepancies · last scan"
          value={scanMeta.discrepancies ?? '—'}
          hint={
            scanMeta.newCases !== undefined ? `${scanMeta.newCases} new cases opened` : undefined
          }
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <KpiCard
          label="Last scan"
          value={lastScan ? timeAgo(lastScan.createdAt) : 'never'}
          hint={lastScan ? fmtDateTime(lastScan.createdAt) : 'no reconciliation scans recorded yet'}
          icon={<History className="h-4 w-4" />}
        />
      </div>

      {/* Cases — the ops queue */}
      <Card>
        <CardHeader>
          <CardTitle>Cases</CardTitle>
          <CardDescription>
            Sorted by severity. Resolve with a note (≥ 10 chars, audited) or dismiss with a reason —
            closed cases move to the history tab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReconCases queue={queue} history={history} />
        </CardContent>
      </Card>

      {/* Provider statements */}
      <Card>
        <CardHeader>
          <CardTitle>Provider statements</CardTitle>
          <CardDescription>
            The provider&rsquo;s side of the story — what each rail reports vs what the Novera ledger
            claims. Latest {statements.length} statements{statements.length >= 60 ? ' (truncated)' : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {statements.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                icon={<ReceiptText className="h-5 w-5" />}
                title="No provider statements yet"
                description="Statements appear as payments are dispatched to the simulated TEST rails."
              />
            </div>
          ) : (
            <div className="scroll-thin max-h-[520px] overflow-y-auto">
              <div className="overflow-x-auto">
                <Table className="[&_th:first-child]:pl-6 [&_td:first-child]:pl-6 [&_th:last-child]:pr-6 [&_td:last-child]:pr-6">
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>External reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Provider status</TableHead>
                      <TableHead>Reconciliation</TableHead>
                      <TableHead>Linked payment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statements.map((pt) => (
                      <TableRow key={pt.id}>
                        <TableCell className="text-sm font-medium">{pt.provider.name}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">
                            {pt.externalReference}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <MoneyText minor={pt.amountMinor} currency={pt.currency} />
                        </TableCell>
                        <TableCell>
                          <ProviderTxnStatusBadge status={pt.status} />
                        </TableCell>
                        <TableCell>
                          <ReconStateBadge
                            status={pt.reconciliationStatus}
                            discrepancyType={pt.discrepancyType}
                          />
                        </TableCell>
                        <TableCell>
                          {pt.payment ? (
                            <Link
                              href={`/payments/${pt.payment.id}`}
                              className="font-mono text-xs text-primary hover:underline"
                            >
                              {pt.payment.reference}
                            </Link>
                          ) : (
                            <span className="text-xs text-warning">
                              <FileSearch className="mr-1 inline h-3 w-3" aria-hidden />
                              unknown reference
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Scale className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Sandbox reference build — all providers are deterministic TEST simulators; statements shown
        reflect the simulated rails, never live settlement.
      </p>
    </div>
  )
}
