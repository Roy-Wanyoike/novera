import { PageHeader } from '@/components/novera/page-header'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader title="Reconciliation" description="Loading reconciliation operations…" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5 space-y-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-40" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-9 w-72" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b py-3 last:border-0">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-36 ml-auto" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="p-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b px-6 py-3 last:border-0">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24 ml-auto" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
