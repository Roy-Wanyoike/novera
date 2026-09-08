import { CopyButton } from '@/components/novera/copy-button'
import { cn } from '@/lib/utils'

/**
 * Always-dark code panel for marketing snippets (Stripe-docs style).
 * `children` carries hand-highlighted spans; `raw` is the plain text used for copy.
 */
export function CodePanel({
  title,
  raw,
  children,
  footer,
  className,
}: {
  title: string
  raw: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/20',
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          </span>
          <span className="ml-1 font-mono text-[11px] text-zinc-400">{title}</span>
        </div>
        <CopyButton value={raw} label="Copy" className="h-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" />
      </div>
      <pre className="scroll-thin overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-zinc-300 sm:p-5 sm:text-[13px]">
        <code>{children}</code>
      </pre>
      {footer ? (
        <div className="border-t border-zinc-800 px-4 py-2.5 font-mono text-[11px]">{footer}</div>
      ) : null}
    </div>
  )
}

/* Token classes for hand-highlighted snippets */
export const tk = {
  comment: 'text-zinc-500 italic',
  keyword: 'text-rose-400',
  property: 'text-zinc-100',
  string: 'text-amber-300',
  number: 'text-teal-300',
  dr: 'text-emerald-400',
  cr: 'text-teal-300',
  invariant: 'text-emerald-400',
  punct: 'text-zinc-500',
} as const
