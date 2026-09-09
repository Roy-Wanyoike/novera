import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-10 text-center', className)}>
      {icon ? <div className="rounded-full bg-muted p-3 text-muted-foreground">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-xs text-muted-foreground leading-relaxed">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
