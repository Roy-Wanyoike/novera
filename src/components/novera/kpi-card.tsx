'use client'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import type { ReactNode } from 'react'

export function KpiCard({
  label,
  value,
  deltaPct,
  deltaLabel,
  hint,
  icon,
  className,
}: {
  label: string
  value: ReactNode
  deltaPct?: number
  deltaLabel?: string
  hint?: string
  icon?: ReactNode
  className?: string
}) {
  const positive = (deltaPct ?? 0) > 0
  const negative = (deltaPct ?? 0) < 0
  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          {icon ? <div className="text-muted-foreground/70">{icon}</div> : null}
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {deltaPct !== undefined ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium',
                positive && 'bg-success/12 text-success',
                negative && 'bg-danger/12 text-danger',
                !positive && !negative && 'bg-muted text-muted-foreground'
              )}
            >
              {positive ? <TrendingUp className="h-3 w-3" /> : negative ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {positive ? '+' : ''}
              {deltaPct.toFixed(1)}%
            </span>
          ) : null}
          {deltaLabel ? <span className="text-muted-foreground">{deltaLabel}</span> : null}
          {hint ? <span className="ml-auto text-muted-foreground/70">{hint}</span> : null}
        </div>
      </CardContent>
    </Card>
  )
}
