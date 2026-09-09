import { cn } from '@/lib/utils'
import { Reveal } from './reveal'

/**
 * Shared marketing section header — eyebrow + title + description,
 * centered, consistent across every landing section.
 */
export function SectionHeader({
  eyebrow,
  title,
  description,
  align = 'center',
  className,
}: {
  eyebrow: string
  title: React.ReactNode
  description?: React.ReactNode
  align?: 'center' | 'left'
  className?: string
}) {
  return (
    <Reveal
      className={cn(
        'max-w-3xl space-y-4',
        align === 'center' ? 'mx-auto text-center' : 'text-left',
        className
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight leading-tight text-balance md:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="text-base leading-relaxed text-muted-foreground text-pretty">{description}</p>
      ) : null}
    </Reveal>
  )
}
