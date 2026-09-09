import { Braces, KeyRound, Webhook, FlaskConical } from 'lucide-react'
import { CodePanel, tk } from './code-panel'
import { Reveal } from './reveal'

const CURL_RAW = `curl https://api.novera.africa/v1/payments \\
  -H "Authorization: Bearer nv_test_9f27c4a1e8" \\
  -H "Idempotency-Key: ik_pay_4821" \\
  -H "Content-Type: application/json" \\
  -d '{
    "rail": "MPESA",
    "destination": "254712345678",
    "amount": 100000,
    "currency": "KES"
  }'

# → 201 Created
# { "id": "pay_01J8ZK3Q9V2H", "status": "PROCESSING", "rail": "MPESA" }`

const WEBHOOK_RAW = `POST /your-endpoint
x-novera-signature: t=1767225600, v1=9f27c4a1e8…

{
  "event": "payment.settled",
  "payment": "pay_01J8ZK3Q9V2H",
  "amount": 100000,
  "currency": "KES"
}`

const PLATFORM_POINTS = [
  {
    icon: Braces,
    title: '/v1 REST APIs',
    description: 'Resources mirror the domain — payments, wallets, cards, agents, invoices.',
  },
  {
    icon: KeyRound,
    title: 'API keys',
    description: 'Hashed at rest, scoped by rate limits, revocable instantly, every call logged.',
  },
  {
    icon: Webhook,
    title: 'Signed webhooks',
    description: 'HMAC signatures with timestamps, replay protection and automatic retries.',
  },
  {
    icon: FlaskConical,
    title: 'Sandbox',
    description: 'Deterministic TEST rails reproduce every state and failure path on demand.',
  },
]

export function Developers() {
  return (
    <section id="developers" className="scroll-mt-20 border-b border-border/60">
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-20 sm:px-6 md:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Copy */}
          <Reveal className="space-y-8" y={24}>
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                Developer Platform
              </p>
              <h2 className="text-3xl font-semibold tracking-tight leading-tight text-balance md:text-4xl">
                Build on the kernel in an afternoon.
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                The same APIs the dashboard uses. Create a payment with one call — the kernel
                handles risk, policy, rail dispatch, settlement postings and webhook delivery.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {PLATFORM_POINTS.map((point) => (
                <div key={point.title} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2.5">
                    <point.icon className="h-4 w-4 text-primary" strokeWidth={1.8} />
                    <h3 className="text-sm font-semibold tracking-tight">{point.title}</h3>
                  </div>
                  <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                    {point.description}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>

          {/* Code */}
          <Reveal delay={0.1} y={24} className="space-y-4">
            <CodePanel title="create a payment" raw={CURL_RAW}>
              <span className={tk.keyword}>curl</span>{' '}
              <span className={tk.string}>https://api.novera.africa/v1/payments</span>{' '}
              <span className={tk.punct}>\</span>
              {'\n  -H '}
              <span className={tk.string}>&quot;Authorization: Bearer nv_test_9f27c4a1e8&quot;</span>{' '}
              <span className={tk.punct}>\</span>
              {'\n  -H '}
              <span className={tk.string}>&quot;Idempotency-Key: ik_pay_4821&quot;</span>{' '}
              <span className={tk.punct}>\</span>
              {'\n  -H '}
              <span className={tk.string}>&quot;Content-Type: application/json&quot;</span>{' '}
              <span className={tk.punct}>\</span>
              {'\n  -d '}
              <span className={tk.string}>&apos;{'{'}</span>
              {'\n    '}
              <span className={tk.string}>&quot;rail&quot;: &quot;MPESA&quot;,</span>
              {'\n    '}
              <span className={tk.string}>&quot;destination&quot;: &quot;254712345678&quot;,</span>
              {'\n    '}
              <span className={tk.string}>&quot;amount&quot;: </span>
              <span className={tk.number}>100000</span>
              <span className={tk.string}>,</span>
              {'\n    '}
              <span className={tk.string}>&quot;currency&quot;: &quot;KES&quot;</span>
              {'\n  '}
              <span className={tk.string}>{'}'}&apos;</span>
              {'\n\n'}
              <span className={tk.comment}>{'# → 201 Created'}</span>
              {'\n'}
              <span className={tk.comment}>
                {'# { "id": "pay_01J8ZK3Q9V2H", "status": "PROCESSING", "rail": "MPESA" }'}
              </span>
            </CodePanel>

            <CodePanel title="signed webhook delivery" raw={WEBHOOK_RAW}>
              <span className={tk.keyword}>POST</span>{' '}
              <span className={tk.string}>/your-endpoint</span>
              {'\n'}
              <span className={tk.property}>x-novera-signature</span>
              <span className={tk.punct}>: </span>
              <span className={tk.string}>t=1767225600, v1=9f27c4a1e8…</span>
              {'\n\n'}
              <span className={tk.punct}>{'{'}</span>
              {'\n  '}
              <span className={tk.string}>&quot;event&quot;</span>
              <span className={tk.punct}>: </span>
              <span className={tk.string}>&quot;payment.settled&quot;</span>
              <span className={tk.punct}>,</span>
              {'\n  '}
              <span className={tk.string}>&quot;payment&quot;</span>
              <span className={tk.punct}>: </span>
              <span className={tk.string}>&quot;pay_01J8ZK3Q9V2H&quot;</span>
              <span className={tk.punct}>,</span>
              {'\n  '}
              <span className={tk.string}>&quot;amount&quot;</span>
              <span className={tk.punct}>: </span>
              <span className={tk.number}>100000</span>
              <span className={tk.punct}>,</span>
              {'\n  '}
              <span className={tk.string}>&quot;currency&quot;</span>
              <span className={tk.punct}>: </span>
              <span className={tk.string}>&quot;KES&quot;</span>
              {'\n'}
              <span className={tk.punct}>{'}'}</span>
            </CodePanel>

            <p className="text-xs text-muted-foreground">
              Illustrative sandbox requests — amounts in minor units, exactly as the kernel stores
              them.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
