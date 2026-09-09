import { cn } from '@/lib/utils'
import { formatMinor, formatSignedMinor } from '@novera/money'

/**
 * Canonical money display: tabular numbers, right-aligned in tables,
 * optional signed variant for deltas.
 */
export function MoneyText({
  minor,
  currency,
  signed = false,
  muted = false,
  className,
  strong = false,
}: {
  minor: bigint | number | string
  currency: string
  signed?: boolean
  muted?: boolean
  strong?: boolean
  className?: string
}) {
  const text = signed ? formatSignedMinor(minor, currency) : formatMinor(minor, currency)
  const negative = text.startsWith('-')
  return (
    <span
      className={cn(
        'tabular whitespace-nowrap',
        muted && 'text-muted-foreground',
        strong && 'font-semibold',
        negative && signed && 'text-danger',
        className
      )}
    >
      {text}
    </span>
  )
}

export function MoneyMajor({ minor, currency, className }: { minor: bigint | number | string; currency: string; className?: string }) {
  return <span className={cn('tabular', className)}>{formatMinor(minor, currency)}</span>
}
