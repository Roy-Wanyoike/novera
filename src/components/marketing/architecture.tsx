import { BrainCircuit, ShieldCheck, Landmark, ArrowDown } from 'lucide-react'
import { SectionHeader } from './section-header'
import { Reveal } from './reveal'

/**
 * The three-plane architecture — Novera's key differentiator.
 * Intelligence (probabilistic) → Control (deterministic) → Financial Execution (deterministic).
 */
export function Architecture() {
  return (
    <section id="architecture" className="scroll-mt-20 border-b border-border/60 bg-muted/20">
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-20 sm:px-6 md:py-28">
        <SectionHeader
          eyebrow="Architecture"
          title={
            <>
              One system. <span className="novera-gradient-text">Three planes.</span>
            </>
          }
          description="Agents and models can propose. Policy decides. The kernel executes. Money never moves on a guess."
        />

        <div className="grid gap-10 lg:grid-cols-5 lg:gap-14">
          {/* Planes visual */}
          <Reveal className="lg:col-span-3" y={24}>
            <div className="space-y-0">
              <Plane
                index="01"
                name="Intelligence Plane"
                nature="PROBABILISTIC"
                tone="warning"
                icon={BrainCircuit}
                tagline="Proposes intents — never touches money."
                components={['AI Agents', 'Copilot', 'Forecasts', 'Anomaly Signals']}
              />
              <FlowArrow
                tone="warning"
                label="INTENT"
                caption="proposed · carries no authority"
              />
              <Plane
                index="02"
                name="Control Plane"
                nature="DETERMINISTIC"
                tone="primary"
                icon={ShieldCheck}
                tagline="Allows or rejects — fails closed."
                components={['Identity', 'Policy', 'Risk', 'Limits', 'Approvals']}
              />
              <FlowArrow
                tone="primary"
                label="AUTHORIZED INTENT"
                caption="allowed by policy · ready to execute"
              />
              <Plane
                index="03"
                name="Financial Execution Plane"
                nature="DETERMINISTIC"
                tone="teal"
                icon={Landmark}
                tagline="Executes and accounts — every debit has a credit."
                components={['Double-Entry Ledger', 'Payments', 'Rails', 'Settlement']}
              />
            </div>
          </Reveal>

          {/* Why separate the planes */}
          <Reveal className="lg:col-span-2" delay={0.1} y={24}>
            <div className="space-y-6 lg:sticky lg:top-24">
              <div className="rounded-xl border border-border bg-card p-6">
                <h3 className="text-lg font-semibold tracking-tight">
                  Why separate probabilistic AI from deterministic money?
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Large models are brilliant at proposing the next best action — and unreliable as
                  the last line of defense for funds. Novera refuses to let probability touch the
                  balance. Every proposal crosses a deterministic control plane: the same intent,
                  the same policy inputs, always the same verdict. Only authorized intents reach
                  the kernel, which posts balanced, idempotent, immutable entries. The result is an
                  agentic system whose money path is reproducible and auditable line by line.
                </p>
              </div>

              <ul className="space-y-3">
                {[
                  'Agents hold scoped credentials — never account-wide keys.',
                  'Policy is code: versioned, testable, and fail-closed by default.',
                  'The ledger only accepts authorized, balanced postings.',
                  'Every decision lands in a hash-chained audit log.',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                    <span
                      aria-hidden
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

const TONES = {
  warning: {
    iconBox: 'border-warning/30 bg-warning/10 text-warning',
    label: 'text-warning',
    nature: 'border-warning/30 bg-warning/10 text-warning',
    panel: 'border-warning/25 from-warning/[0.07]',
  },
  primary: {
    iconBox: 'border-primary/30 bg-primary/10 text-primary',
    label: 'text-primary',
    nature: 'border-primary/30 bg-primary/10 text-primary',
    panel: 'border-primary/25 from-primary/[0.07]',
  },
  teal: {
    iconBox: 'border-chart-2/30 bg-chart-2/10 text-chart-2',
    label: 'text-chart-2',
    nature: 'border-chart-2/30 bg-chart-2/10 text-chart-2',
    panel: 'border-chart-2/25 from-chart-2/[0.07]',
  },
} as const

function Plane({
  index,
  name,
  nature,
  tone,
  icon: Icon,
  tagline,
  components,
}: {
  index: string
  name: string
  nature: string
  tone: keyof typeof TONES
  icon: React.ComponentType<{ className?: string }>
  tagline: string
  components: string[]
}) {
  const t = TONES[tone]
  return (
    <div
      className={`relative rounded-xl border bg-gradient-to-b to-transparent p-5 md:p-6 ${t.panel} bg-card`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${t.iconBox}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className={`font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${t.label}`}>
              Plane {index}
            </p>
            <h3 className="mt-0.5 text-base font-semibold tracking-tight md:text-lg">{name}</h3>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider ${t.nature}`}
        >
          {nature}
        </span>
      </div>
      <p className="mt-3.5 text-sm text-muted-foreground">{tagline}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {components.map((component) => (
          <span
            key={component}
            className="rounded-md border border-border bg-background/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
          >
            {component}
          </span>
        ))}
      </div>
    </div>
  )
}

function FlowArrow({
  tone,
  label,
  caption,
}: {
  tone: 'warning' | 'primary'
  label: string
  caption: string
}) {
  const toneClasses =
    tone === 'warning'
      ? 'border-warning/35 bg-warning/10 text-warning'
      : 'border-primary/35 bg-primary/10 text-primary'
  const lineClasses =
    tone === 'warning' ? 'via-warning/35 to-warning/60' : 'via-primary/35 to-primary/60'
  return (
    <div
      aria-hidden
      className="flex items-center justify-center gap-2 py-2.5 pl-2 md:gap-3 md:py-3"
    >
      <div className={`h-px w-8 bg-gradient-to-r from-transparent ${lineClasses} md:w-24`} />
      <div className="flex items-center gap-1.5">
        <div className="h-5 w-px bg-gradient-to-b from-transparent to-border" />
        <ArrowDown className={`h-3.5 w-3.5 ${tone === 'warning' ? 'text-warning' : 'text-primary'}`} />
        <div className="h-5 w-px bg-gradient-to-t from-transparent to-border" />
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider ${toneClasses}`}
        >
          {label}
        </span>
        <span className="hidden text-[11px] text-muted-foreground md:inline">{caption}</span>
      </div>
      <div className={`h-px w-8 bg-gradient-to-l from-transparent ${lineClasses} md:w-24`} />
    </div>
  )
}
