import { Skeleton } from '@/components/ui/skeleton'

export default function FxLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-96 w-full rounded-xl lg:col-span-3" />
        <Skeleton className="h-96 w-full rounded-xl lg:col-span-2" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-72 w-full rounded-xl lg:col-span-3" />
        <Skeleton className="h-72 w-full rounded-xl lg:col-span-2" />
      </div>
    </div>
  )
}
