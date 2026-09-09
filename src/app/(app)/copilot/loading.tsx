import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export default function CopilotLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-7 w-40" />
          </div>
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
        <Skeleton className="h-6 w-44" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* chat panel */}
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent className="space-y-4 py-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`flex gap-3 ${i % 2 === 1 ? 'flex-row-reverse' : ''}`}>
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className={`h-4 ${i % 2 === 1 ? 'ml-auto' : ''} w-44 max-w-full`} />
                  <Skeleton className={`h-3.5 ${i % 2 === 1 ? 'ml-auto' : ''} w-60 max-w-full`} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* context aside */}
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="gap-0 py-0">
              <CardHeader className="border-b py-4">
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="space-y-3 py-4">
                {Array.from({ length: i === 1 ? 3 : 4 }).map((_, j) => (
                  <div key={j} className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <Skeleton className="h-3.5 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-3.5 w-20" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
