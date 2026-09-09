'use client'

import * as React from 'react'
import { ChevronDown, ChevronRight, ArrowLeftRight, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToneBadge, StatusBadge } from '@/components/novera/status-badge'
import { MoneyText } from '@/components/novera/money-text'
import { CopyButton } from '@/components/novera/copy-button'
import { LEDGER_TXN_SOURCE_META } from '@novera/domain'
import { fmtDateTime, truncateMiddle } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface EntryRow {
  id: string
  direction: string
  amountMinor: string
  currency: string
  accountCode: string
  accountName: string
}

export interface TxnRow {
  id: string
  reference: string
  description: string
  source: string
  status: string
  amountMinor: string
  currency: string
  postedAt: string | null
  entries: EntryRow[]
}

function statusTone(status: string): 'positive' | 'negative' | 'warning' {
  if (status === 'POSTED') return 'positive'
  if (status === 'REVERSED') return 'negative'
  return 'warning'
}

/** Per-currency Dr = Cr proof for a single transaction. */
function balanceProofs(entries: EntryRow[]) {
  const sums = new Map<string, { dr: bigint; cr: bigint }>()
  for (const e of entries) {
    const bucket = sums.get(e.currency) ?? { dr: BigInt(0), cr: BigInt(0) }
    if (e.direction === 'DEBIT') bucket.dr += BigInt(e.amountMinor)
    else bucket.cr += BigInt(e.amountMinor)
    sums.set(e.currency, bucket)
  }
  return [...sums.entries()].map(([currency, s]) => ({ currency, ...s, balanced: s.dr === s.cr }))
}

export function TransactionsTable({ rows, total }: { rows: TxnRow[]; total: number }) {
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set())

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-10 text-center">
        <ArrowLeftRight className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">No transactions match these filters</p>
        <p className="text-xs text-muted-foreground">
          Try clearing the search or widening the date range.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto scroll-thin">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-6"><span className="sr-only">Expand</span></TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Posted</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="min-w-[200px]">Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-6 text-center">Entries</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => {
              const isOpen = expanded.has(t.id)
              return (
                <React.Fragment key={t.id}>
                  <TableRow
                    className={cn('cursor-pointer', isOpen && 'border-b-0 bg-muted/30 hover:bg-muted/30')}
                    onClick={() => toggle(t.id)}
                  >
                    <TableCell className="pl-6">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? `Collapse ${t.reference}` : `Expand ${t.reference}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggle(t.id)
                        }}
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="font-mono text-xs" title={t.reference}>
                          {truncateMiddle(t.reference)}
                        </span>
                        <CopyButton value={t.reference} label="ref" className="h-6 px-1.5" />
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {fmtDateTime(t.postedAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge meta={LEDGER_TXN_SOURCE_META} status={t.source} />
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-muted-foreground" title={t.description}>
                      {t.description}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <MoneyText minor={t.amountMinor} currency={t.currency} strong />
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        {t.status === 'REVERSED' ? (
                          <Lock className="h-3 w-3 text-danger" aria-hidden="true" />
                        ) : null}
                        <ToneBadge tone={statusTone(t.status)}>{t.status.charAt(0) + t.status.slice(1).toLowerCase()}</ToneBadge>
                      </span>
                    </TableCell>
                    <TableCell className="pr-6 text-center tabular-nums text-muted-foreground">
                      {t.entries.length}
                    </TableCell>
                  </TableRow>

                  {isOpen ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={8} className="px-6 pb-4 pt-0">
                        <div className="rounded-lg border bg-card p-4">
                          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Double-entry postings — {t.reference}
                          </p>
                          <div className="space-y-1.5">
                            {t.entries.map((e) => (
                              <div
                                key={e.id}
                                className="grid grid-cols-[84px_minmax(160px,1fr)_auto] items-center gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm sm:grid-cols-[84px_minmax(220px,1fr)_minmax(140px,2fr)_auto]"
                              >
                                <ToneBadge tone={e.direction === 'DEBIT' ? 'info' : 'neutral'} className="font-mono">
                                  {e.direction === 'DEBIT' ? 'Dr' : 'Cr'}
                                </ToneBadge>
                                <span className="font-mono text-xs" title={e.accountCode}>
                                  {e.accountCode}
                                </span>
                                <span className="hidden truncate text-xs text-muted-foreground sm:block" title={e.accountName}>
                                  {e.accountName}
                                </span>
                                <span className="text-right">
                                  <MoneyText minor={e.amountMinor} currency={e.currency} />
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                            {balanceProofs(t.entries).map((p) => (
                              <span key={p.currency} className="inline-flex items-center gap-1.5">
                                <ToneBadge tone={p.balanced ? 'positive' : 'negative'} className="h-5 px-1.5 text-[10px]">
                                  {p.balanced ? 'Dr = Cr' : 'Unbalanced'}
                                </ToneBadge>
                                <span className="font-mono">{p.currency}</span>
                                <MoneyText minor={p.dr.toString()} currency={p.currency} /> ={' '}
                                <MoneyText minor={p.cr.toString()} currency={p.currency} />
                              </span>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="px-6 text-xs text-muted-foreground">
        Showing {rows.length} of {total} transaction{total === 1 ? '' : 's'} · newest first ·
        amounts are the sum of debits per transaction
      </p>
    </div>
  )
}
