import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { verifyAuditChain } from '@/lib/audit'
import { fmtDateTime, titleCase, truncateMiddle } from '@/lib/format'
import { PageHeader } from '@/components/novera/page-header'
import { EmptyState } from '@/components/novera/empty-state'
import { ToneBadge } from '@/components/novera/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ArrowLeft, ArrowRight, History, Link2, ShieldCheck, ShieldX } from 'lucide-react'
import { AuditFilters } from './filters'

export const metadata = { title: 'Audit' }

const PAGE_SIZE = 50
const SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const
const ACTOR_TYPES = ['USER', 'AGENT', 'SYSTEM', 'SERVICE', 'PROVIDER'] as const

const ACTOR_TONE: Record<string, 'positive' | 'negative' | 'warning' | 'info' | 'accent' | 'neutral'> = {
  USER: 'info',
  AGENT: 'accent',
  SYSTEM: 'neutral',
  SERVICE: 'warning',
  PROVIDER: 'info',
}

function SeverityBadge({ severity }: { severity: string }) {
  switch (severity) {
    case 'CRITICAL':
      return <ToneBadge tone="negative">Critical</ToneBadge>
    case 'WARN':
      return <ToneBadge tone="warning">Warning</ToneBadge>
    default:
      return <ToneBadge tone="neutral">Info</ToneBadge>
  }
}

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireSession()
  const orgId = session.organization.id
  const params = await searchParams

  // ── filters (validated, URL-driven) ──
  const severityRaw = firstParam(params.severity)
  const severity = (SEVERITIES as readonly string[]).includes(severityRaw) ? severityRaw : ''
  const actorRaw = firstParam(params.actorType)
  const actorType = (ACTOR_TYPES as readonly string[]).includes(actorRaw) ? actorRaw : ''
  const actionSearch = firstParam(params.action).trim().slice(0, 100)
  const fromRaw = firstParam(params.from)
  const toRaw = firstParam(params.to)
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? new Date(`${fromRaw}T00:00:00`) : null
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? new Date(`${toRaw}T23:59:59`) : null
  const page = Math.max(1, Number.parseInt(firstParam(params.page), 10) || 1)

  const where: Prisma.AuditEventWhereInput = { organizationId: orgId }
  if (severity) where.severity = severity
  if (actorType) where.actorType = actorType
  if (actionSearch) where.action = { contains: actionSearch }
  if (fromDate || toDate) {
    where.createdAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    }
  }

  // ── data: chain verification, paginated events, side context ──
  const [verification, total, rows, latest, severityCounts] = await Promise.all([
    verifyAuditChain(2000),
    db.auditEvent.count({ where }),
    db.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    db.auditEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    db.auditEvent.groupBy({ by: ['severity'], where: { organizationId: orgId }, _count: { _all: true } }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const rangeFrom = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const rangeTo = Math.min(safePage * PAGE_SIZE, total)

  const sevMap: Record<string, number> = { INFO: 0, WARN: 0, CRITICAL: 0 }
  for (const g of severityCounts) sevMap[g.severity] = g._count._all
  const orgTotal = sevMap.INFO + sevMap.WARN + sevMap.CRITICAL

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams()
    if (severity) qs.set('severity', severity)
    if (actorType) qs.set('actorType', actorType)
    if (actionSearch) qs.set('action', actionSearch)
    if (fromDate) qs.set('from', fromRaw)
    if (toDate) qs.set('to', toRaw)
    if (targetPage > 1) qs.set('page', String(targetPage))
    const s = qs.toString()
    return s ? `/audit?${s}` : '/audit'
  }

  const hasFilters = severity || actorType || actionSearch || fromDate || toDate

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit"
        description="Tamper-evident event trail. Every state change in the money path writes an append-only audit event; each hash chains to the previous one."
      />

      {/* ── chain integrity banner ── */}
      {verification.valid ? (
        <div
          className="flex flex-col gap-3 rounded-xl border border-success/30 bg-success/10 p-5 sm:flex-row sm:items-center sm:justify-between"
          role="status"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-success/15 p-2 text-success">
              <ShieldCheck className="h-4.5 w-4.5" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                Hash chain verified
                <ToneBadge tone="positive">Verified</ToneBadge>
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {verification.totalEvents} events, tamper-evident (sha256 linked). Each event&rsquo;s hash is
                computed from the previous hash plus canonical fields — retroactive edits break the chain
                and are detectable. Events are append-only.
              </p>
            </div>
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            {verification.verified}/{verification.totalEvents} recomputed
          </p>
        </div>
      ) : (
        <div
          className="flex flex-col gap-3 rounded-xl border border-danger/40 bg-danger/10 p-5"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-danger/15 p-2 text-danger">
              <ShieldX className="h-4.5 w-4.5" aria-hidden />
            </div>
            <div className="space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-danger">
                Chain integrity broken
                <ToneBadge tone="negative">Tamper detected</ToneBadge>
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Verification stopped after {verification.verified} of {verification.totalEvents} events
                (first broken at {truncateMiddle(verification.firstBrokenAt ?? '—', 12, 8)}). This should
                never happen — investigate immediately.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── event trail (main) ── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Event trail</CardTitle>
            <CardDescription>
              {orgTotal} events recorded for {session.organization.name}
              {hasFilters ? ` · ${total} match the current filters` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AuditFilters
              initial={{ severity, actorType, action: actionSearch, from: fromRaw, to: toRaw }}
            />

            {rows.length === 0 ? (
              <EmptyState
                icon={<History className="h-5 w-5" />}
                title="No events match these filters"
                description="Try widening the date range or clearing the severity and actor filters."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table className="[&_th:first-child]:pl-2 [&_td:first-child]:pl-2 [&_th:last-child]:pr-2 [&_td:last-child]:pr-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Correlation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDateTime(e.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-0.5">
                            <ToneBadge tone={ACTOR_TONE[e.actorType] ?? 'neutral'}>
                              {titleCase(e.actorType)}
                            </ToneBadge>
                            <span className="max-w-24 truncate text-[10px] text-muted-foreground">
                              {e.actorLabel ?? e.actorId ?? '—'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{e.action}</span>
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <span className="block truncate text-xs" title={e.description}>
                            {e.description}
                          </span>
                        </TableCell>
                        <TableCell>
                          <SeverityBadge severity={e.severity} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="text-xs">{titleCase(e.resourceType)}</span>
                            {e.resourceId ? (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {truncateMiddle(e.resourceId, 10, 6)}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          {e.correlationId ? (
                            <span className="font-mono text-[10px] text-muted-foreground" title={e.correlationId}>
                              {truncateMiddle(e.correlationId, 8, 6)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* pagination */}
            {total > 0 ? (
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {rangeFrom}–{rangeTo} of {total} events · page {safePage} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm" className="h-8 gap-1.5" disabled={safePage <= 1}>
                    <Link href={pageHref(safePage - 1)} aria-disabled={safePage <= 1} className={safePage <= 1 ? 'pointer-events-none opacity-50' : ''}>
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                      Previous
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-8 gap-1.5" disabled={safePage >= totalPages}>
                    <Link href={pageHref(safePage + 1)} aria-disabled={safePage >= totalPages} className={safePage >= totalPages ? 'pointer-events-none opacity-50' : ''}>
                      Next
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* ── side context: chain links + distribution ── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" aria-hidden />
                Chain — latest links
              </CardTitle>
              <CardDescription>
                Newest first. Each hash = sha256(prevHash + canonical fields), so every event is
                welded to everything before it.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {latest.length === 0 ? (
                <div className="px-6 pb-6">
                  <EmptyState title="No events yet" description="Audit events appear as the organization transacts." />
                </div>
              ) : (
                <ol className="space-y-0 px-6 pb-6">
                  {latest.map((e, i) => (
                    <li key={e.id} className="relative pb-4 pl-6 last:pb-0">
                      {i < latest.length - 1 ? (
                        <div className="absolute left-[7px] top-5 h-[calc(100%-10px)] w-px bg-border" aria-hidden />
                      ) : null}
                      <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 border-primary/50 bg-primary/15" aria-hidden />
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-xs font-medium">{e.action}</span>
                        <span className="text-[10px] text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                        {truncateMiddle(e.prevHash ?? 'GENESIS', 10, 8)}
                        <span className="mx-1 text-primary/70">→</span>
                        {truncateMiddle(e.hash, 10, 8)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Severity distribution</CardTitle>
              <CardDescription>Across all {orgTotal} org events.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Severity distribution bar">
                {sevMap.CRITICAL > 0 ? (
                  <div className="bg-danger" style={{ width: `${(sevMap.CRITICAL / orgTotal) * 100}%` }} />
                ) : null}
                {sevMap.WARN > 0 ? (
                  <div className="bg-warning" style={{ width: `${(sevMap.WARN / orgTotal) * 100}%` }} />
                ) : null}
                <div className="bg-muted-foreground/25" style={{ width: `${(sevMap.INFO / Math.max(1, orgTotal)) * 100}%` }} />
              </div>
              <ul className="space-y-1.5">
                <li className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/25" aria-hidden />
                    Info
                  </span>
                  <span className="tabular font-medium">{sevMap.INFO}</span>
                </li>
                <li className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-warning" aria-hidden />
                    Warnings
                  </span>
                  <span className="tabular font-medium">{sevMap.WARN}</span>
                </li>
                <li className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-danger" aria-hidden />
                    Critical
                  </span>
                  <span className="tabular font-medium">{sevMap.CRITICAL}</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
