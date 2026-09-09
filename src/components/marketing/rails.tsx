import { Smartphone, Landmark, CreditCard, Coins, Waypoints, FlaskConical } from 'lucide-react'
import { SectionHeader } from './section-header'
import { Reveal } from './reveal'

const RAILS = [
  {
    icon: Smartphone,
    name: 'M-Pesa',
    description: 'STK push, B2C disbursement and C2B confirmation flows.',
    routes: 'stk_push · b2c · c2b',
  },
  {
    icon: Landmark,
    name: 'Banks',
    description: 'EFT and RTGS style transfers with realistic processing states.',
    routes: 'eft · rtgs',
  },
  {
    icon: CreditCard,
    name: 'Cards',
    description: 'Authorization, holds, capture — with decline simulation paths.',
    routes: 'auth · capture · refund',
  },
  {
    icon: Coins,
    name: 'USDC',
    description: 'Stablecoin transfers with address validation and finality states.',
    routes: 'transfer · stablecoin',
  },
]

export function Rails() {
  return (
    <section id="rails" className="scroll-mt-20 border-b border-border/60 bg-muted/20">
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-20 sm:px-6 md:py-28">
        <SectionHeader
          eyebrow="Rails & Providers"
          title="Every rail, behind one abstraction."
          description="Route by cost, risk and availability — and swap providers without touching your integration. In this build, every provider is a deterministic TEST simulator."
        />

        <Reveal y={24}>
          <div className="space-y-4">
            {/* Gateway */}
            <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                    <Waypoints className="h-5 w-5 text-primary" strokeWidth={1.8} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight">Provider Gateway</h3>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">
                      One interface for every rail — dispatch, polling, webhooks and reconciliation.
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  deterministic routing
                </span>
              </div>
            </div>

            {/* Rails grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {RAILS.map((rail, i) => (
                <Reveal key={rail.name} delay={Math.min(i * 0.05, 0.2)} y={16}>
                  <div className="h-full rounded-xl border border-border bg-card p-5 transition-colors duration-200 hover:border-primary/35">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted/50">
                        <rail.icon className="h-5 w-5 text-foreground" strokeWidth={1.8} />
                      </div>
                      <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-warning">
                        TEST
                      </span>
                    </div>
                    <h3 className="mt-4 text-sm font-semibold tracking-tight">{rail.name}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                      {rail.description}
                    </p>
                    <p className="mt-3 font-mono text-[11px] text-muted-foreground/80">
                      {rail.routes}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>

            {/* Honesty note */}
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p>
                Sandbox reference build — deterministic TEST simulators only. Same input, same
                output, including failure paths (TIMEOUT, INSUFFICIENT_FUNDS, disputes), so every
                state machine is testable end-to-end. No real funds move.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
