import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'

export default function TransactionsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading ledger">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full max-w-md" />
            </div>
            <Skeleton className="ml-auto h-6 w-24" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-5 w-full" />
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row">
            <Skeleton className="h-9 w-full lg:w-52" />
            <Skeleton className="h-9 w-full lg:w-40" />
            <Skeleton className="h-9 w-full lg:w-40" />
            <Skeleton className="h-9 w-full lg:w-40" />
            <Skeleton className="h-9 flex-1" />
          </div>
          <div className="space-y-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
