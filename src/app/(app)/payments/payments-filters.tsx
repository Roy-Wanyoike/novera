'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PAYMENT_STATUSES, PAYMENT_METHODS, METHOD_META } from '@novera/domain'
import { Search, X } from 'lucide-react'

/**
 * Filter bar for the payments index. Server-rendered filtering via URL
 * search params — status / method selects and a debounced search box.
 */
export function PaymentsFilters({
  status,
  method,
  q,
}: {
  status: string
  method: string
  q: string
}) {
  const router = useRouter()
  const [search, setSearch] = useState(q)

  function applyParams(changes: Record<string, string>) {
    const params = new URLSearchParams()
    const next = {
      status,
      method,
      q,
      ...changes,
    }
    if (next.status) params.set('status', next.status)
    if (next.method) params.set('method', next.method)
    if (next.q) params.set('q', next.q)
    const s = params.toString()
    router.push(s ? `/payments?${s}` : '/payments')
  }

  // Keep local input in sync when the URL changes (e.g. after clearing).
  useEffect(() => {
    setSearch(q)
  }, [q])

  // Debounced search → navigate.
  useEffect(() => {
    if (search === q) return
    const t = setTimeout(() => {
      applyParams({ q: search })
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  return (
    <div
      className="flex flex-wrap items-end gap-2"
      role="search"
      aria-label="Filter payments"
    >
      <div className="space-y-1.5">
        <Label htmlFor="payment-search" className="text-xs text-muted-foreground">
          Search
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="payment-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Reference, customer, email…"
            className="h-9 w-56 pl-8 text-sm"
            type="search"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payment-status" className="text-xs text-muted-foreground">
          Status
        </Label>
        <Select value={status || 'ALL'} onValueChange={(v) => applyParams({ status: v === 'ALL' ? '' : v })}>
          <SelectTrigger id="payment-status" className="h-9 w-40 text-sm" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="payment-method" className="text-xs text-muted-foreground">
          Method
        </Label>
        <Select value={method || 'ALL'} onValueChange={(v) => applyParams({ method: v === 'ALL' ? '' : v })}>
          <SelectTrigger id="payment-method" className="h-9 w-40 text-sm" aria-label="Filter by method">
            <SelectValue placeholder="All methods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All methods</SelectItem>
            {PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {METHOD_META[m]?.label ?? m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {status || method || q ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 text-muted-foreground"
          onClick={() => router.push('/payments')}
        >
          <X className="h-4 w-4" />
          Clear
        </Button>
      ) : null}
    </div>
  )
}
