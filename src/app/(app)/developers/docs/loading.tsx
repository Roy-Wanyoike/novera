import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function ApiDocsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
        <Skeleton className="h-9 w-48" />
      </div>

      {/* base URL / format band */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-4 w-32" />
              </span>
            ))}
            <Skeleton className="ml-auto h-5 w-24" />
          </div>
        </CardContent>
      </Card>

      {/* section headers + endpoint cards */}
      {Array.from({ length: 3 }).map((_, s) => (
        <div key={s} className="space-y-4">
          <div className="flex items-center gap-2.5 border-t pt-8">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-6 w-44" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, c) => (
              <Card key={c}>
                <CardHeader className="gap-3 pb-4">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-16" />
                    <Skeleton className="h-4 w-48 max-w-full" />
                  </div>
                  <Skeleton className="h-3.5 w-72 max-w-full" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
