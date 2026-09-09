'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * Logs toolbar — status-class and method filters (URL-driven, so filters
 * survive refresh and are shareable) + a manual refresh button.
 */
export function LogsToolbar({
  statusClass,
  method,
  total,
}: {
  statusClass: string
  method: string
  total: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isRefreshing, startRefresh] = useTransition()
  const [localPending, setLocalPending] = useState(false)

  const pending = isRefreshing || localPending

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all' || value === '') params.delete(key)
    else params.set(key, value)
    params.delete('page') // filters reset pagination
    const qs = params.toString()
    setLocalPending(true)
    router.push(qs ? `${pathname}?${qs}` : pathname)
    setTimeout(() => setLocalPending(false), 400)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={statusClass} onValueChange={(v) => setParam('status', v)}>
        <SelectTrigger className="w-32" aria-label="Filter by status class">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="2xx">2xx success</SelectItem>
          <SelectItem value="4xx">4xx client</SelectItem>
          <SelectItem value="5xx">5xx server</SelectItem>
        </SelectContent>
      </Select>

      <Select value={method} onValueChange={(v) => setParam('method', v)}>
        <SelectTrigger className="w-32" aria-label="Filter by HTTP method">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All methods</SelectItem>
          <SelectItem value="GET">GET</SelectItem>
          <SelectItem value="POST">POST</SelectItem>
          <SelectItem value="PUT">PUT</SelectItem>
          <SelectItem value="PATCH">PATCH</SelectItem>
          <SelectItem value="DELETE">DELETE</SelectItem>
        </SelectContent>
      </Select>

      <p className="ml-auto text-xs text-muted-foreground">{total.toLocaleString()} matching requests</p>

      <Button variant="outline" size="sm" onClick={() => startRefresh(() => router.refresh())} disabled={pending} aria-label="Refresh logs">
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden />}
        Refresh
      </Button>
    </div>
  )
}
