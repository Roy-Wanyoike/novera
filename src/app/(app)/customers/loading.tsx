import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'

export default function CustomersLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-3 h-8 w-28" />
              <Skeleton className="mt-3 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-9 w-full sm:max-w-xs" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      <Card>
        <CardContent className="p-6 pt-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b py-3.5 last:border-0">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-44" />
              <Skeleton className="hidden h-4 w-48 sm:block" />
              <Skeleton className="ml-auto h-6 w-16 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
