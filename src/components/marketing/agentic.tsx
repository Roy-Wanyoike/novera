import Link from 'next/link'
import { Bot, Zap, ShieldCheck, ScanFace, Scale, ArrowRight, ArrowDown, Hourglass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SectionHeader } from './section-header'
import { Reveal } from './reveal'

const FLOW = [
  {
    icon: Bot,
    step: '01',
    label: 'Agent',
    description: 'A first-class principal with an owner, a role and a scoped credential.',
    tone: 'muted' as const,
  },
  {
    icon: Zap,
    step: '02',
    label: 'Intent',
    description: 'Proposes an action — e.g. pay supplier INV-0042 for KES 148,500.',
    tone: 'muted' as const,
  },
  {
    icon: ShieldCheck,
    step: '03',
    label: 'Policy',
    description: 'Deterministic gate — fail-closed: allow, review or reject.',
    tone: 'primary' as const,
  },
  {
    icon: ScanFace,
    step: '04',
    label: 'Approval',
    description: 'Above threshold, a human decides. Below it, policy alone can clear it.',
    tone: 'warning' as const,
  },
  {
    icon: Scale,
    step: '05',
    label: 'Ledger',
    description: 'Authorized intent executes — balanced postings, full audit.',
    tone: 'success' as const,
  },
]

const KYA_POINTS = [
  {
    title: 'Agent identity',
    description: 'Every agent is onboarded like a person: an owner, a purpose, a lifecycle.',
  },
  {
    title: 'Scoped credentials',
    description: 'Agents act inside explicit scopes — never with account-wide keys.',
  },
  {
    title: 'Deterministic policy gates',
    description: 'Same intent, same inputs, same verdict — every single time.',
  },
  {
    title: 'Human approvals',
    description: 'Amounts above threshold queue for a human decision, with full context.',
  },
  {
    title: 'Complete audit trail',
    description: 'Every proposal, verdict, approval and posting lands in the hash chain.',
  },
]

const TONE_BOX = {
  muted: 'border-border bg-card text-foreground',
  primary: 'border-primary/30 bg-primary/[0.06] text-primary',
  warning: 'border-warning/30 bg-warning/[0.06] text-warning',
  success: 'border-success/30 bg-success/[0.06] text-success',
} as const

export function Agentic() {
  return (
    <section id="agents" className="scroll-mt-20 border-b border-border/60">
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-20 sm:px-6 md:py-28">
        <SectionHeader
          eyebrow="Agentic Finance"
          title={
            <>
              Know Your Agent, <span className="novera-gradient-text">not just your customer.</span>
            </>
          }
          description="AI agents that can act on money — without ever holding the keys to it."
        />

        {/* Flow: Agent → Intent → Policy → Approval → Ledger */}
        <Reveal y={24}>
          <div className="rounded-2xl border border-border bg-card/60 p-4 sm:p-6 md:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                intent lifecycle · agent:atlas · procurement
              </p>
              <span className="rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                example · KES 148,500 · above KES 100,000 threshold
              </span>
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
              {FLOW.map((node, i) => (
                <div key={node.step} className="contents">
                  <div className="flex-1 rounded-xl border p-4 md:p-5 lg:mx-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg border ${TONE_BOX[node.tone]}`}
                      >
                        <node.icon className="h-4.5 w-4.5" strokeWidth={1.8} />
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground">{node.step}</span>
                    </div>
                    <h3 className="mt-3.5 text-sm font-semibold tracking-tight">{node.label}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {node.description}
                    </p>
                  </div>
                  {i < FLOW.length - 1 ? (
                    <div
                      aria-hidden
                      className="flex shrink-0 items-center justify-center py-1 lg:px-0"
                    >
                      <div className="flex flex-col items-center gap-1 lg:flex-row lg:gap-1">
                        <ArrowDown className="h-4 w-4 text-muted-foreground/60 lg:hidden" />
                        <span className="hidden h-px w-5 border-t border-dashed border-border lg:block" />
                        <ArrowRight className="hidden h-4 w-4 text-muted-foreground/60 lg:block" />
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Live in the demo:</span> the
                  procurement agent Atlas is holding a payment above its threshold — waiting for a
                  human approval decision right now.
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5">
                <Link href="/login">
                  Decide it yourself <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </Reveal>

        {/* KYA story */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {KYA_POINTS.map((point, i) => (
            <Reveal key={point.title} delay={Math.min(i * 0.05, 0.25)} y={16}>
              <div className="h-full rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold tracking-tight">{point.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  {point.description}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
