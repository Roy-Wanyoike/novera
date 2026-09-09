import type { ReactNode } from 'react'
import { Hexagon } from 'lucide-react'

/**
 * PUBLIC CHECKOUT SHELL — deliberately outside the (app) group.
 * No session, no app chrome: just the Novera brand, the payment, and an
 * honest TEST MODE affordance everywhere (directive: never imply real
 * settlement in the sandbox).
 */
export default function CheckoutLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/15">
              <Hexagon className="h-4.5 w-4.5 text-primary" strokeWidth={2.2} aria-hidden />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">Novera</p>
              <p className="-mt-0.5 text-[10px] text-muted-foreground">Secure checkout</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-warning">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" aria-hidden />
            Test mode
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>

      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-1 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Powered by <span className="font-medium text-foreground">Novera</span> · programmable
            financial infrastructure
          </p>
          <p className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
            Simulated settlement — no real money moves
          </p>
        </div>
      </footer>
    </div>
  )
}
