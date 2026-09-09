'use client'

import Link from 'next/link'
import { Hexagon, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Branded error panel shared by every error boundary (app, root, global).
 * Renders the Novera mark on the app's design tokens — dark slate surface,
 * primary accents — with a "Try again" action and a subtle error id/date
 * line for support conversations. Never leaks error internals to the UI.
 */

export function ErrorBoundaryPanel({
  title = 'Something went wrong',
  description,
  digest,
  errorId,
  occurredAt,
  onReset,
  resetLabel = 'Try again',
  homeHref = '/dashboard',
  homeLabel = 'Back to dashboard',
  className,
}: {
  title?: string
  description: string
  digest?: string
  errorId: string
  occurredAt: string
  onReset: () => void
  resetLabel?: string
  homeHref?: string
  homeLabel?: string
  className?: string
}) {
  return (
    <Card className={`w-full max-w-md ${className ?? ''}`}>
      <CardHeader className="items-center space-y-4 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-primary/25 bg-primary/15">
          <Hexagon className="h-5 w-5 text-primary" strokeWidth={2.2} aria-hidden />
        </div>
        <div className="space-y-1.5">
          <CardTitle className="text-xl tracking-tight">{title}</CardTitle>
          <CardDescription className="leading-relaxed">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="leading-relaxed">
            No money moved as part of this failure — the ledger only changes through explicit,
            balanced postings.
          </span>
        </div>

        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button type="button" className="gap-1.5" onClick={onReset}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            {resetLabel}
          </Button>
          <Button asChild variant="outline" className="gap-1.5">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        </div>

        {/* Subtle diagnostics — for support, not for users to act on. */}
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          Error ID <span className="font-mono">{digest ?? errorId}</span> · {occurredAt}
        </p>
      </CardContent>
    </Card>
  )
}
