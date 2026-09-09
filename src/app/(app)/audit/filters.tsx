'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import { Loader2, RotateCcw, Search } from 'lucide-react'

export interface AuditFilterValues {
  severity: string
  actorType: string
  action: string
  from: string
  to: string
}

/** Filter bar for the audit trail — pushes filters into the URL (server-side pagination). */
export function AuditFilters({ initial }: { initial: AuditFilterValues }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [filters, setFilters] = useState<AuditFilterValues>(initial)
  const firstRender = useRef(true)

  function commit(next: AuditFilterValues) {
    const params = new URLSearchParams()
    if (next.severity) params.set('severity', next.severity)
    if (next.actorType) params.set('actorType', next.actorType)
    if (next.action.trim()) params.set('action', next.action.trim())
    if (next.from) params.set('from', next.from)
    if (next.to) params.set('to', next.to)
    const qs = params.toString()
    startTransition(() => router.push(qs ? `/audit?${qs}` : '/audit'))
  }

  // Debounced commit on any filter change (text input included).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const t = setTimeout(() => commit(filters), 400)
    return () => clearTimeout(t)
  }, [filters])

  function set(patch: Partial<AuditFilterValues>) {
    setFilters((f) => ({ ...f, ...patch }))
  }

  const hasFilters =
    filters.severity || filters.actorType || filters.action.trim() || filters.from || filters.to

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="audit-action" className="text-xs text-muted-foreground">
          Action search
        </Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="audit-action"
            placeholder="e.g. payment.settled"
            value={filters.action}
            onChange={(e) => set({ action: e.target.value })}
            className="h-9 w-full pl-8 font-mono text-xs lg:w-52"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground" htmlFor="audit-severity">
          Severity
        </Label>
        <Select value={filters.severity || 'ALL'} onValueChange={(v) => set({ severity: v === 'ALL' ? '' : v })}>
          <SelectTrigger id="audit-severity" className="h-9 w-full lg:w-36 text-xs">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="INFO">Info</SelectItem>
            <SelectItem value="WARN">Warning</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground" htmlFor="audit-actor">
          Actor
        </Label>
        <Select value={filters.actorType || 'ALL'} onValueChange={(v) => set({ actorType: v === 'ALL' ? '' : v })}>
          <SelectTrigger id="audit-actor" className="h-9 w-full lg:w-36 text-xs">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="USER">User</SelectItem>
            <SelectItem value="AGENT">Agent</SelectItem>
            <SelectItem value="SYSTEM">System</SelectItem>
            <SelectItem value="SERVICE">Service</SelectItem>
            <SelectItem value="PROVIDER">Provider</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
          From
        </Label>
        <Input
          id="audit-from"
          type="date"
          value={filters.from}
          onChange={(e) => set({ from: e.target.value })}
          className="h-9 w-full text-xs lg:w-36"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id="audit-to"
          type="date"
          value={filters.to}
          onChange={(e) => set({ to: e.target.value })}
          className="h-9 w-full text-xs lg:w-36"
        />
      </div>

      <div className="flex items-center gap-2 lg:ml-auto">
        {pending ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Filtering…
          </span>
        ) : null}
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 text-xs text-muted-foreground"
            onClick={() => {
              const cleared: AuditFilterValues = {
                severity: '',
                actorType: '',
                action: '',
                from: '',
                to: '',
              }
              setFilters(cleared)
              commit(cleared)
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  )
}
