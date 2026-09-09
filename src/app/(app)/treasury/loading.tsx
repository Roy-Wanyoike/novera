import { Skeleton } from '@/components/ui/skeleton'

export default function TreasuryLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-96 w-full rounded-xl lg:col-span-3" />
        <Skeleton className="h-96 w-full rounded-xl lg:col-span-2" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-80 w-full rounded-xl lg:col-span-3" />
        <Skeleton className="h-80 w-full rounded-xl lg:col-span-2" />
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  )
}
