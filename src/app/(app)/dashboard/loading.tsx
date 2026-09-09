import { Skeleton } from '@/components/ui/skeleton'

/**
 * Dashboard skeleton — mirrors the page composition so the frame doesn't
 * jump when data lands: header → KPI row → chart + cash panel → activity
 * + agent strips → ops glance.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading overview">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[116px] rounded-xl" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 rounded-xl border p-6 lg:col-span-2">
          <div className="space-y-2">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-[240px] w-full sm:h-[300px]" />
        </div>
        <div className="space-y-4 rounded-xl border p-6">
          <div className="space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-56 max-w-full" />
          </div>
          <Skeleton className="h-16 w-full rounded-lg" />
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <div className="space-y-1.5 text-right">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="ml-auto h-3 w-14" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-[340px] rounded-xl lg:col-span-3" />
        <Skeleton className="h-[340px] rounded-xl lg:col-span-2" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[132px] rounded-xl" />
        ))}
      </div>
    </div>
  )
}
