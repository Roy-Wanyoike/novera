import { CircleCheck, Coins, KeyRound, BookLock, Scale } from 'lucide-react'
import { CodePanel, tk } from './code-panel'
import { Reveal } from './reveal'

const KERNEL_RAW = `// settlePayment(pay_01J8ZK3Q9V2H) — rail: MPESA, currency: KES
await postTransaction({
  journal: 'MPESA_IN',
  idempotencyKey: 'ik_pay_4821',   // replays return the original txn
  entries: [
    { account: 'MPESA_CLEARING',   dr: 100_000n, cr: 0n },
    { account: 'WALLET:OPERATING', dr: 0n,       cr: 95_200n },
    { account: 'FEE_INCOME',       dr: 0n,       cr: 4_800n },
  ],
})

// kernel invariant — enforced on every post:
// SUM(debits) === SUM(credits) === 100_000n`

const PRINCIPLES = [
  {
    icon: Coins,
    title: 'Integer minor units',
    description:
      'Every amount is a BigInt count of the smallest currency unit. Floating-point never touches money.',
  },
  {
    icon: KeyRound,
    title: 'Idempotency keys',
    description:
      'Every money-moving operation carries one. Replays return the original result — never a double charge.',
  },
  {
    icon: BookLock,
    title: 'Immutable postings',
    description:
      'History is never edited. Corrections post explicit reversal entries that keep the story honest.',
  },
  {
    icon: Scale,
    title: 'Balanced or rejected',
    description:
      'A posting whose debits do not equal its credits is refused at the door. Trial balance runs per currency.',
  },
]

export function Kernel() {
  return (
    <section id="kernel" className="scroll-mt-20 border-b border-border/60 bg-muted/20">
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-20 sm:px-6 md:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Copy */}
          <Reveal className="order-2 space-y-8 lg:order-1" y={24}>
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                Financial Kernel
              </p>
              <h2 className="text-3xl font-semibold tracking-tight leading-tight text-balance md:text-4xl">
                A ledger you can audit <span className="novera-gradient-text">line by line.</span>
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                The kernel is the heart of Novera — a strict double-entry engine that settles the
                same payment the same way, every time. Collect 100,000 from M-Pesa, credit the
                operating wallet 95,200 and fee income 4,800: the entries must balance to the
                minor unit or the post is rejected.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {PRINCIPLES.map((principle) => (
                <div
                  key={principle.title}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <principle.icon className="h-4 w-4 text-primary" strokeWidth={1.8} />
                    <h3 className="text-sm font-semibold tracking-tight">{principle.title}</h3>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                    {principle.description}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>

          {/* Code */}
          <Reveal className="order-1 lg:order-2" delay={0.1} y={24}>
            <CodePanel
              title="kernel/postings.ts"
              raw={KERNEL_RAW}
              footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-emerald-400">
                    <CircleCheck className="h-3.5 w-3.5" />
                    invariant · Σ debits = Σ credits
                  </span>
                  <span className="tabular text-zinc-500">
                    100,000n = 100,000n · KES minor units
                  </span>
                </div>
              }
            >
              <span className={tk.comment}>
                {'// settlePayment(pay_01J8ZK3Q9V2H) — rail: MPESA, currency: KES'}
              </span>
              {'\n'}
              <span className={tk.keyword}>await</span>{' '}
              <span className={tk.property}>postTransaction</span>
              <span className={tk.punct}>({'{'}</span>
              {'\n  '}
              <span className={tk.property}>journal</span>
              <span className={tk.punct}>:</span> <span className={tk.string}>&apos;MPESA_IN&apos;</span>
              <span className={tk.punct}>,</span>
              {'\n  '}
              <span className={tk.property}>idempotencyKey</span>
              <span className={tk.punct}>:</span> <span className={tk.string}>&apos;ik_pay_4821&apos;</span>
              <span className={tk.punct}>,</span> <span className={tk.comment}>{'// replays return the original txn'}</span>
              {'\n  '}
              <span className={tk.property}>entries</span>
              <span className={tk.punct}>: [</span>
              {'\n    '}
              <span className={tk.punct}>{'{ '}</span>
              <span className={tk.property}>account</span>
              <span className={tk.punct}>:</span> <span className={tk.string}>&apos;MPESA_CLEARING&apos;</span>
              <span className={tk.punct}>,</span> <span className={tk.property}>dr</span>
              <span className={tk.punct}>:</span> <span className={tk.dr}>100_000n</span>
              <span className={tk.punct}>,</span> <span className={tk.property}>cr</span>
              <span className={tk.punct}>:</span> <span className={tk.cr}>0n</span>
              <span className={tk.punct}>{' },'}</span>
              {'\n    '}
              <span className={tk.punct}>{'{ '}</span>
              <span className={tk.property}>account</span>
              <span className={tk.punct}>:</span> <span className={tk.string}>&apos;WALLET:OPERATING&apos;</span>
              <span className={tk.punct}>,</span> <span className={tk.property}>dr</span>
              <span className={tk.punct}>:</span> <span className={tk.dr}>0n</span>
              <span className={tk.punct}>,</span> <span className={tk.property}>cr</span>
              <span className={tk.punct}>:</span> <span className={tk.cr}>95_200n</span>
              <span className={tk.punct}>{' },'}</span>
              {'\n    '}
              <span className={tk.punct}>{'{ '}</span>
              <span className={tk.property}>account</span>
              <span className={tk.punct}>:</span> <span className={tk.string}>&apos;FEE_INCOME&apos;</span>
              <span className={tk.punct}>,</span> <span className={tk.property}>dr</span>
              <span className={tk.punct}>:</span> <span className={tk.dr}>0n</span>
              <span className={tk.punct}>,</span> <span className={tk.property}>cr</span>
              <span className={tk.punct}>:</span> <span className={tk.cr}>4_800n</span>
              <span className={tk.punct}>{' },'}</span>
              {'\n  '}
              <span className={tk.punct}>],</span>
              {'\n'}
              <span className={tk.punct}>{'})'}</span>
              {'\n\n'}
              <span className={tk.comment}>{'// kernel invariant — enforced on every post:'}</span>
              {'\n'}
              <span className={tk.comment}>
                {'// SUM(debits) === SUM(credits) === 100_000n'}
              </span>
            </CodePanel>

            <p className="mt-3 text-xs text-muted-foreground">
              Illustrative snippet from the reference kernel — the same code path the demo runs.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
