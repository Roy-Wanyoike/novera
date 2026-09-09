import Link from 'next/link'
import { ArrowRight, ChevronDown, Check, Bot, ShieldCheck, Scale, FlaskConical, KeyRound, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Reveal, Float } from './reveal'

/**
 * Landing hero — positioning + a DOM-built "kernel console" visual.
 * No images: the visual is styled DOM showing the Agent → Policy → Ledger path
 * and a balanced posting set. All figures are illustrative sandbox examples.
 */
export function Hero({ authenticated, ctaHref }: { authenticated: boolean; ctaHref: string }) {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      {/* Grid + glow background (decorative) */}
      <div
        aria-hidden
        className="grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_35%,black,transparent)]"
      />
      <div aria-hidden className="pointer-events-none absolute -top-40 right-[-12%] h-96 w-96 rounded-full bg-primary/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute top-52 left-[-15%] h-80 w-80 rounded-full bg-warning/10 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24 lg:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
          {/* Copy */}
          <div className="space-y-7">
            <Reveal>
              <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-border bg-card/70 py-1 pr-3 pl-1 text-xs text-muted-foreground backdrop-blur">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  <FlaskConical className="h-3 w-3" />
                  Sandbox build
                </span>
                <span className="pl-1">Deterministic TEST providers · no real funds move</span>
              </div>
            </Reveal>

            <Reveal delay={0.05}>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
                Programmable Financial Infrastructure
              </p>
              <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight text-balance sm:text-5xl md:text-6xl">
                AI proposes. Policy authorizes.{' '}
                <span className="novera-gradient-text">The ledger records.</span>
              </h1>
            </Reveal>

            <Reveal delay={0.1}>
              <p className="max-w-xl text-base leading-relaxed text-muted-foreground text-pretty md:text-lg">
                Novera is the financial platform for{' '}
                <span className="text-foreground font-medium">wallets, payments, cards, treasury</span>{' '}
                and <span className="text-foreground font-medium">controlled AI agents</span> — all
                running on one deterministic double-entry kernel. Every intent is policy-gated.
                Every entry balances. Every action is auditable.
              </p>
            </Reveal>

            <Reveal delay={0.15}>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-12 gap-2 px-6 text-base">
                  <Link href={ctaHref}>
                    {authenticated ? 'Open your dashboard' : 'Enter the interactive demo'}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-12 gap-2 px-6 text-base">
                  <a href="#architecture">
                    Explore the architecture
                    <ChevronDown className="h-4 w-4" />
                  </a>
                </Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                The demo is seeded with a full organization: 200 payments through the real kernel,
                4 AI agents, live policy gates and a pending approval.
              </p>
            </Reveal>
          </div>

          {/* Kernel console visual (DOM-built, illustrative) */}
          <Reveal delay={0.15} y={28}>
            <div className="relative">
              <div aria-hidden className="absolute -inset-8 rounded-3xl bg-primary/10 blur-2xl" />

              <Float className="absolute -top-5 -left-4 z-10 hidden xl:block" delay={0.4}>
                <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 font-mono text-[10px] text-muted-foreground shadow-lg backdrop-blur">
                  <KeyRound className="h-3 w-3 text-primary" />
                  idempotency-key: ik_pay_4821
                </div>
              </Float>
              <Float className="absolute -right-3 -bottom-5 z-10 hidden xl:block" delay={1.2} duration={7}>
                <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 font-mono text-[10px] text-muted-foreground shadow-lg backdrop-blur">
                  <Link2 className="h-3 w-3 text-warning" />
                  audit · hash-chained
                </div>
              </Float>

              <div className="relative overflow-hidden rounded-xl border border-border bg-card/90 shadow-2xl shadow-black/10 backdrop-blur">
                {/* Window chrome */}
                <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-danger/50" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning/50" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/50" />
                  <span className="ml-2 truncate font-mono text-[11px] text-muted-foreground">
                    novera · kernel · txn_01J8ZK3Q9V2H
                  </span>
                  <span className="ml-auto rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-warning">
                    TEST
                  </span>
                </div>

                <div className="space-y-3 p-4 font-mono text-xs sm:p-5">
                  {/* Step 1 — agent proposes */}
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-warning/30 bg-warning/10">
                      <Bot className="h-3.5 w-3.5 text-warning" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-muted-foreground">
                        <span className="text-warning">agent:atlas</span> proposes ·{' '}
                        <span className="text-foreground">pay supplier INV-0042</span>
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        scoped credential: supplier payments · KES ≤ 100,000
                      </p>
                    </div>
                  </div>

                  {/* Step 2 — policy allows */}
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10">
                      <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-muted-foreground">
                        <span className="text-primary">policy.evaluate</span> →{' '}
                        <span className="inline-flex items-center gap-1 rounded border border-success/30 bg-success/10 px-1.5 py-px text-[10px] font-semibold text-success">
                          <Check className="h-2.5 w-2.5" />
                          ALLOW
                        </span>
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        payee allowlisted ✓ amount within limit ✓ fail-closed
                      </p>
                    </div>
                  </div>

                  {/* Step 3 — ledger records */}
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-chart-2/30 bg-chart-2/10">
                        <Scale className="h-3.5 w-3.5 text-chart-2" />
                      </span>
                      <p className="text-muted-foreground">
                        ledger.post · <span className="text-chart-2">balanced entries</span>
                      </p>
                      <span className="ml-auto text-[10px] text-muted-foreground">immutable</span>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <span>Account</span>
                        <span className="w-20 text-right">Dr</span>
                        <span className="w-20 text-right">Cr</span>
                      </div>
                      <LedgerRow account="MPESA_CLEARING" dr="100,000" />
                      <LedgerRow account="WALLET:OPERATING" cr="95,200" />
                      <LedgerRow account="FEE_INCOME" cr="4,800" />
                      <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1 text-success">
                          <Check className="h-3 w-3" />
                          <span className="tabular">Σ dr 100,000 = Σ cr 100,000</span>
                        </span>
                        <span className="tabular">KES · minor units</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function LedgerRow({ account, dr, cr }: { account: string; dr?: string; cr?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-3">
      <span className="truncate text-foreground/90">{account}</span>
      <span className="tabular w-20 text-right text-success">{dr ?? '—'}</span>
      <span className="tabular w-20 text-right text-muted-foreground">{cr ?? '—'}</span>
    </div>
  )
}
