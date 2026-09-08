import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { fmtDateTime } from '@/lib/format'
import { PageHeader } from '@/components/novera/page-header'
import { EmptyState } from '@/components/novera/empty-state'
import { MethodChip } from '../_components/method-chip'
import { LogsToolbar } from './_components/logs-toolbar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'

export const metadata = { title: 'Request logs' }

const PAGE_SIZE = 25
const STATUS_CLASSES = ['all', '2xx', '4xx', '5xx'] as const
const METHODS = ['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function statusTone(status: number): string {
  if (status >= 500) return 'text-danger'
  if (status >= 400) return 'text-warning'
  return 'text-success'
}

interface LogsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const session = await requireSession()
  const params = await searchParams

  const rawStatus = typeof params.status === 'string' ? params.status : 'all'
  const statusClass = (STATUS_CLASSES as readonly string[]).includes(rawStatus) ? rawStatus : 'all'
  const rawMethod = typeof params.method === 'string' ? params.method.toUpperCase() : 'ALL'
  const method = (METHODS as readonly string[]).includes(rawMethod) ? rawMethod : 'all'
  const rawPage = Number(typeof params.page === 'string' ? params.page : '1')
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1

  const where = {
    organizationId: session.organization.id,
    ...(statusClass === '2xx' ? { status: { gte: 200, lt: 300 } } : {}),
    ...(statusClass === '4xx' ? { status: { gte: 400, lt: 500 } } : {}),
    ...(statusClass === '5xx' ? { status: { gte: 500 } } : {}),
    ...(method !== 'all' ? { method } : {}),
  }

  const [total, logs] = await Promise.all([
    db.apiRequestLog.count({ where }),
    db.apiRequestLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { apiKey: { select: { name: true, mode: true } } },
    }),
  ])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const queryFor = (p: number) => {
    const q = new URLSearchParams()
    if (statusClass !== 'all') q.set('status', statusClass)
    if (method !== 'all') q.set('method', method)
    if (p > 1) q.set('page', String(p))
    const s = q.toString()
    return s ? `/developers/logs?${s}` : '/developers/logs'
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request logs"
        description="Every authenticated /api/v1 call, org-scoped per key: status, latency and error codes. Request bodies are redacted before storage."
      />

      <LogsToolbar statusClass={statusClass} method={method} total={total} />

      {logs.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" aria-hidden />}
          title="No requests match these filters"
          description="Requests appear here as soon as an API key is used. Try clearing the filters, or make a call from the quickstart."
        />
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Key</TableHead>
                <TableHead className="text-right">Status</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {fmtDateTime(log.createdAt)}
                  </TableCell>
                  <TableCell>
                    <MethodChip method={log.method} />
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-xs">{log.path}</code>
                  </TableCell>
                  <TableCell className="max-w-36 truncate text-xs text-muted-foreground">
                    {log.apiKey ? log.apiKey.name : '—'}
                  </TableCell>
                  <TableCell className={cn('text-right font-mono text-xs font-semibold tabular-nums', statusTone(log.status))}>
                    {log.status}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {log.durationMs} ms
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {log.errorCode ? (
                      <span className="text-warning">{log.errorCode}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pageCount > 1 ? (
        <nav className="flex items-center justify-between gap-2" aria-label="Pagination">
          <p className="text-xs text-muted-foreground">
            Page {current} of {pageCount} · {total.toLocaleString()} requests
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild aria-disabled={current <= 1} className={current <= 1 ? 'pointer-events-none opacity-50' : ''}>
              <Link href={queryFor(Math.max(1, current - 1))} aria-label="Previous page">
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
                Previous
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild aria-disabled={current >= pageCount} className={current >= pageCount ? 'pointer-events-none opacity-50' : ''}>
              <Link href={queryFor(Math.min(pageCount, current + 1))} aria-label="Next page">
                Next
                <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </nav>
      ) : (
        <p className="text-xs text-muted-foreground">{total.toLocaleString()} requests</p>
      )}
    </div>
  )
}
