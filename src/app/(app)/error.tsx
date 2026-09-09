'use client'

import { useEffect, useState } from 'react'
import { fmtDateTime } from '@/lib/format'
import { ErrorBoundaryPanel } from '@/components/novera/error-boundary'

/**
 * App-shell error boundary — catches any server or client exception below
 * the (app) segment and renders a branded, in-shell panel instead of
 * Next.js's unbranded default. The full error is logged to the console;
 * users only ever see a stable error id.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [errorId] = useState(() => Math.random().toString(36).slice(2, 10))
  const [occurredAt] = useState(() => fmtDateTime(new Date()))

  useEffect(() => {
    console.error('[novera:app-error]', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <ErrorBoundaryPanel
        title="This page hit an error"
        description="Something failed while rendering this view. Retrying usually resolves it — if it persists, quote the error id below."
        digest={error.digest}
        errorId={errorId}
        occurredAt={occurredAt}
        onReset={reset}
      />
    </div>
  )
}
