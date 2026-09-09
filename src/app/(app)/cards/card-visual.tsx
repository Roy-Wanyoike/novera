import { cn } from '@/lib/utils'
import { CardStatusBadge } from '@/components/novera/status-badge'
import { Bot, Wifi } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Premium payment-card visual — the shared face used by the index grid and
 * the detail hero. The card face is intentionally a constant dark gradient
 * (like a physical card) built from neutral/emerald tones so it reads well
 * over both light and dark app themes. Structure around it uses semantic
 * tokens.
 */

export interface CardVisualData {
  label: string
  holderName: string
  last4: string
  expiryMonth: number
  expiryYear: number
  status: string
  type: string
  currency: string
  agentName?: string | null
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

const TYPE_LABEL: Record<string, string> = {
  VIRTUAL: 'Virtual',
  DISPOSABLE: 'Disposable',
  PHYSICAL: 'Physical',
  EMPLOYEE: 'Employee',
  PROJECT: 'Project',
  AGENT: 'Agent',
}

export function CardVisual({
  card,
  size = 'md',
  className,
  footer,
}: {
  card: CardVisualData
  size?: 'md' | 'lg'
  className?: string
  footer?: ReactNode
}) {
  const lg = size === 'lg'
  return (
    <div className={cn('group/card w-full', lg ? 'max-w-md' : 'max-w-full', className)}>
      <div
        role="img"
        aria-label={`${card.label} card ending ${card.last4}, ${card.status.toLowerCase()}`}
        className={cn(
          'relative w-full overflow-hidden rounded-2xl ring-1 ring-white/15',
          'bg-gradient-to-br from-zinc-800 via-zinc-900 to-black',
          'shadow-lg shadow-black/20 select-none',
          'aspect-[8/5]',
          'transition-transform duration-200 ease-out',
          lg ? '' : 'group-hover/card:-translate-y-0.5'
        )}
      >
        {/* emerald ambient glow + top sheen — subtle, no blue */}
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-20 h-52 w-52 rounded-full bg-emerald-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-10 -bottom-24 h-48 w-48 rounded-full bg-emerald-400/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20" />

        {/* top row: status + brand */}
        <div className={cn('relative flex items-start justify-between gap-2', lg ? 'p-5' : 'p-4')}>
          <CardStatusBadge status={card.status} className="backdrop-blur-sm" />
          <div className="flex flex-col items-end gap-1">
            <span
              className={cn(
                'font-semibold italic tracking-[0.18em] text-white/95',
                lg ? 'text-2xl leading-none' : 'text-xl leading-none'
              )}
              style={{ fontFamily: 'var(--font-geist-sans), ui-sans-serif, system-ui' }}
            >
              VISA
            </span>
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/50">{card.currency}</span>
          </div>
        </div>

        {/* chip + contactless */}
        <div className={cn('relative flex items-center gap-3', lg ? 'px-5' : 'px-4')}>
          <div
            aria-hidden
            className={cn(
              'rounded-md bg-gradient-to-br from-amber-200/80 via-amber-100/60 to-amber-300/70',
              'ring-1 ring-black/20 shadow-inner',
              lg ? 'h-8 w-11' : 'h-7 w-10'
            )}
          >
            <div className="grid h-full w-full grid-cols-3 gap-px p-1 opacity-40">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-[2px] border border-black/30" />
              ))}
            </div>
          </div>
          <Wifi aria-hidden className={cn('rotate-90 text-white/50', lg ? 'h-5 w-5' : 'h-4 w-4')} />
        </div>

        {/* masked number — PAN never stored, only last4 */}
        <div className={cn('relative mt-auto', lg ? 'px-5 pb-1 pt-3' : 'px-4 pb-1 pt-2')}>
          <p
            className={cn(
              'font-mono tracking-[0.24em] text-white/90 tabular',
              lg ? 'text-lg' : 'text-sm sm:text-base'
            )}
          >
            •••• •••• •••• {card.last4}
          </p>
        </div>

        {/* bottom row: holder + expiry + type/agent chips */}
        <div className={cn('relative flex items-end justify-between gap-2', lg ? 'px-5 pb-5 pt-2' : 'px-4 pb-4 pt-1')}>
          <div className="min-w-0">
            <p className={cn('truncate uppercase tracking-[0.14em] text-white/80', lg ? 'text-sm font-medium' : 'text-xs font-medium')}>
              {card.holderName}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white/75 ring-1 ring-white/15">
                {TYPE_LABEL[card.type] ?? card.type.toLowerCase()}
              </span>
              {card.type === 'AGENT' && card.agentName ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200 ring-1 ring-emerald-300/25">
                  <Bot className="h-3 w-3" aria-hidden />
                  {card.agentName}
                </span>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-white/40">Exp end</p>
            <p className={cn('font-mono tabular text-white/85', lg ? 'text-sm' : 'text-xs')}>
              {pad2(card.expiryMonth)}/{pad2(card.expiryYear % 100)}
            </p>
          </div>
        </div>
      </div>
      {footer}
    </div>
  )
}
