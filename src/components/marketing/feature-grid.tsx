import {
  Fingerprint,
  Scale,
  ArrowLeftRight,
  Waypoints,
  ShoppingCart,
  CreditCard,
  Vault,
  Radar,
  BrainCircuit,
  Workflow,
  Bot,
  Terminal,
} from 'lucide-react'
import { SectionHeader } from './section-header'
import { Reveal } from './reveal'

const LAYERS = [
  {
    icon: Fingerprint,
    name: 'Identity',
    description: 'Users, organizations, roles and sessions — every query scoped to one org.',
  },
  {
    icon: Scale,
    name: 'Financial Kernel',
    description: 'Immutable double-entry ledger in BigInt minor units, corrected by reversals.',
  },
  {
    icon: ArrowLeftRight,
    name: 'Payments',
    description: 'The full lifecycle — risk, rail dispatch, settlement, refunds, disputes.',
  },
  {
    icon: Waypoints,
    name: 'Rails',
    description: 'M-Pesa, banks, cards and USDC behind one provider abstraction.',
  },
  {
    icon: ShoppingCart,
    name: 'Commerce & Checkout',
    description: 'Invoices, hosted checkout and automatic split rules on collection.',
  },
  {
    icon: CreditCard,
    name: 'Cards',
    description: 'Virtual cards with spend controls, auth decisioning, holds and capture.',
  },
  {
    icon: Vault,
    name: 'Treasury',
    description: 'Multi-currency wallets, held transfers, FX conversions and sweeps.',
  },
  {
    icon: Radar,
    name: 'Risk',
    description: 'Rules plus velocity limits — every intent scored ALLOW, REVIEW or DECLINE.',
  },
  {
    icon: BrainCircuit,
    name: 'Intelligence',
    description: 'Copilot, forecasts and anomaly signals that propose — never commit.',
  },
  {
    icon: Workflow,
    name: 'Programmability',
    description: 'Policy-as-code, split rules, webhooks and event-driven workflows.',
  },
  {
    icon: Bot,
    name: 'Agentic Finance',
    description: 'Know-Your-Agent: scoped credentials, policy gates, human thresholds.',
  },
  {
    icon: Terminal,
    name: 'Developer Platform',
    description: 'REST APIs, hashed API keys, signed webhooks and a deterministic sandbox.',
  },
]

export function FeatureGrid() {
  return (
    <section id="platform" className="scroll-mt-20 border-b border-border/60">
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-20 sm:px-6 md:py-28">
        <SectionHeader
          eyebrow="Platform"
          title="Twelve product layers. One deterministic core."
          description="Every layer reads from and writes to the same kernel — so the dashboard, the APIs and the agents all agree on the money."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {LAYERS.map((layer, i) => (
            <Reveal key={layer.name} delay={Math.min(i * 0.04, 0.3)} y={16}>
              <div className="group h-full rounded-xl border border-border bg-card p-5 transition-colors duration-200 hover:border-primary/35 hover:bg-accent/30">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary transition-transform duration-200 group-hover:scale-105">
                  <layer.icon className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <h3 className="mt-4 text-sm font-semibold tracking-tight">{layer.name}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {layer.description}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
