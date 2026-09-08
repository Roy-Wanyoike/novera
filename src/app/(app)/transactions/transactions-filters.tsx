'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LEDGER_TXN_SOURCES, LEDGER_TXN_SOURCE_META } from '@novera/domain'

export interface LedgerFilters {
  source: string
  status: string
  from: string
  to: string
  q: string
}

const STATUSES = ['POSTED', 'REVERSED'] as const

export function TransactionsFilters({ filters }: { filters: LedgerFilters }) {
  const router = useRouter()
  const [q, setQ] = React.useState(filters.q)

  // Keep the local search box in sync when the URL changes (e.g. ref deep-links).
  React.useEffect(() => {
    setQ(filters.q)
  }, [filters.q])

  function push(next: Partial<LedgerFilters>) {
    const merged = { ...filters, ...next }
    const params = new URLSearchParams()
    if (merged.source) params.set('source', merged.source)
    if (merged.status) params.set('status', merged.status)
    if (merged.from) params.set('from', merged.from)
    if (merged.to) params.set('to', merged.to)
    if (merged.q.trim()) params.set('q', merged.q.trim())
    const query = params.toString()
    router.push(query ? `/transactions?${query}` : '/transactions', { scroll: false })
  }

  const hasAny = !!(filters.source || filters.status || filters.from || filters.to || filters.q)

  return (
    <form
      className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        push({ q })
      }}
      role="search"
      aria-label="Filter ledger transactions"
    >
      <div className="w-full space-y-1.5 lg:w-52">
        <Label htmlFor="filter-source" className="text-xs text-muted-foreground">
          Source
        </Label>
        <Select value={filters.source || 'ALL'} onValueChange={(v) => push({ source: v === 'ALL' ? '' : v })}>
          <SelectTrigger id="filter-source" className="h-9" aria-label="Filter by source">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All sources</SelectItem>
            {LEDGER_TXN_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {LEDGER_TXN_SOURCE_META[s]?.label ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-full space-y-1.5 lg:w-40">
        <Label htmlFor="filter-status" className="text-xs text-muted-foreground">
          Status
        </Label>
        <Select value={filters.status || 'ALL'} onValueChange={(v) => push({ status: v === 'ALL' ? '' : v })}>
          <SelectTrigger id="filter-status" className="h-9" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-full space-y-1.5 lg:w-40">
        <Label htmlFor="filter-from" className="text-xs text-muted-foreground">
          From date
        </Label>
        <Input
          id="filter-from"
          type="date"
          className="h-9"
          value={filters.from}
          onChange={(e) => push({ from: e.target.value })}
          aria-label="Posted after this date"
        />
      </div>

      <div className="w-full space-y-1.5 lg:w-40">
        <Label htmlFor="filter-to" className="text-xs text-muted-foreground">
          To date
        </Label>
        <Input
          id="filter-to"
          type="date"
          className="h-9"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => push({ to: e.target.value })}
          aria-label="Posted before this date"
        />
      </div>

      <div className="flex w-full flex-1 items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="filter-q" className="text-xs text-muted-foreground">
            Search
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="filter-q"
              className="h-9 pl-8"
              placeholder="Reference or description…"
              value={q}
              maxLength={100}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>
        <Button type="submit" variant="outline" size="sm" className="h-9 shrink-0">
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Apply
        </Button>
        {hasAny ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 shrink-0 text-muted-foreground"
            onClick={() => router.push('/transactions', { scroll: false })}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  )
}
