import { cn } from '@/lib/utils'

/**
 * HTTP method chip — the visual language for every endpoint mention
 * across the developer portal (landing, docs, logs).
 */
const METHOD_CLASSES: Record<string, string> = {
  GET: 'bg-success/12 text-success border-success/25',
  POST: 'bg-primary/10 text-primary border-primary/25',
  PUT: 'bg-warning/15 text-warning border-warning/30',
  PATCH: 'bg-warning/15 text-warning border-warning/30',
  DELETE: 'bg-danger/12 text-danger border-danger/25',
}

export function MethodChip({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-14 shrink-0 items-center justify-center rounded border px-1.5 font-mono text-[10px] font-semibold tracking-wider',
        METHOD_CLASSES[method.toUpperCase()] ?? 'bg-muted text-muted-foreground border-border',
        className
      )}
    >
      {method.toUpperCase()}
    </span>
  )
}
