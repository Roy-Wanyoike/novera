'use client'

import { useEffect, useState } from 'react'
import { fmtDateTime } from '@/lib/format'
import { ErrorBoundaryPanel } from '@/components/novera/error-boundary'

/**
 * Global error boundary — fires when the ROOT layout itself fails, so it
 * must render its own <html>/<body>. The `dark` class is applied directly
 * because the theme provider (which normally sets it) is part of the
 * layout that failed; the app's global stylesheet is still injected, so
 * the dark design tokens resolve to the app's dark slate surface.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [errorId] = useState(() => Math.random().toString(36).slice(2, 10))
  const [occurredAt] = useState(() => fmtDateTime(new Date()))

  useEffect(() => {
    console.error('[novera:global-error]', error)
  }, [error])

  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-background text-foreground">
        <div className="flex min-h-screen items-center justify-center p-6">
          <ErrorBoundaryPanel
            title="Novera is temporarily unavailable"
            description="A critical error stopped the application from rendering. Retrying usually resolves it — if it persists, quote the error id below."
            digest={error.digest}
            errorId={errorId}
            occurredAt={occurredAt}
            onReset={reset}
            homeHref="/"
            homeLabel="Back to home"
          />
        </div>
      </body>
    </html>
  )
}
