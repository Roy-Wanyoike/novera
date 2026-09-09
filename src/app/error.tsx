'use client'

import { useEffect, useState } from 'react'
import { fmtDateTime } from '@/lib/format'
import { ErrorBoundaryPanel } from '@/components/novera/error-boundary'

/**
 * Root error boundary — catches exceptions in routes outside the (app)
 * shell (marketing, auth, checkout). Renders a centered, branded panel
 * inside the root layout's theme.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [errorId] = useState(() => Math.random().toString(36).slice(2, 10))
  const [occurredAt] = useState(() => fmtDateTime(new Date()))

  useEffect(() => {
    console.error('[novera:root-error]', error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <ErrorBoundaryPanel
        title="Something went wrong"
        description="An unexpected error interrupted this page. Retrying usually resolves it — if it persists, quote the error id below."
        digest={error.digest}
        errorId={errorId}
        occurredAt={occurredAt}
        onReset={reset}
        homeHref="/"
        homeLabel="Back to home"
      />
    </div>
  )
}
