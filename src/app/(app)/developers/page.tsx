import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { pct } from '@/lib/format'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { CodeBlock } from '@/components/novera/copy-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { MethodChip } from './_components/method-chip'
import {
  KeyRound, ScrollText, Webhook, BookOpen, FlaskConical, Activity, CheckCircle2, Server, ShieldCheck,
} from 'lucide-react'

export const metadata = { title: 'Developers' }

const ENDPOINT_GROUPS: {
  title: string
  description: string
  endpoints: { method: string; path: string; summary: string; scope: string }[]
}[] = [
  {
    title: 'Wallets & balances',
    description: 'The authoritative double-entry ledger, read-only over the API.',
    endpoints: [
      { method: 'GET', path: '/api/v1/wallets', summary: 'List org wallets with ledger balances', scope: 'wallets:read' },
      { method: 'GET', path: '/api/v1/balances', summary: 'Per-currency ledger vs available (net of holds)', scope: 'balances:read' },
    ],
  },
  {
    title: 'Payments',
    description: 'Create intents that run risk → rail → ledger → webhooks, end to end.',
    endpoints: [
      { method: 'GET', path: '/api/v1/payments', summary: 'List payments (filters: status, limit)', scope: 'payments:write' },
      { method: 'POST', path: '/api/v1/payments', summary: 'Create a payment with idempotency', scope: 'payments:write' },
      { method: 'GET', path: '/api/v1/payments/{id}', summary: 'Retrieve by id or pay_ reference (timeline, risk, provider)', scope: 'payments:write' },
    ],
  },
  {
    title: 'Ledger',
    description: 'Every balanced posting with its debit/credit lines.',
    endpoints: [
      { method: 'GET', path: '/api/v1/transactions', summary: 'Recent ledger transactions with entries', scope: 'wallets:read' },
    ],
  },
  {
    title: 'Invoices',
    description: 'Billing documents with live payment state.',
    endpoints: [
      { method: 'GET', path: '/api/v1/invoices', summary: 'List invoices with totals and paid amounts', scope: 'payments:write' },
    ],
  },
  {
    title: 'Webhooks',
    description: 'Signed outbound events you can replay and verify.',
    endpoints: [
      { method: 'GET', path: '/api/v1/webhooks/endpoints', summary: 'List registered endpoints', scope: 'webhooks:manage' },
      { method: 'POST', path: '/api/v1/webhooks/endpoints', summary: 'Register an endpoint (secret shown once)', scope: 'webhooks:manage' },
    ],
  },
  {
    title: 'Platform',
    description: 'Liveness and the machine-readable contract.',
    endpoints: [
      { method: 'GET', path: '/api/v1/health', summary: 'Liveness probe (no auth)', scope: 'public' },
      { method: 'GET', path: '/api/v1/openapi.json', summary: 'OpenAPI 3.1 document (no auth)', scope: 'public' },
    ],
  },
]

const QUICKSTART_PAYMENT = `curl -X POST http://localhost:3000/api/v1/payments \\
  -H "Authorization: Bearer nv_test_demo0001secret" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "1250.00",
    "currency": "KES",
    "method": "MPESA",
    "customerEmail": "buyer@example.com",
    "description": "Order #1024 — steel gutters",
    "idempotencyKey": "order-1024-attempt-1"
  }'`

const QUICKSTART_RESPONSE = `{
  "data": {
    "reference": "pay_mtswo0a2r90epbxnx",
    "status": "SETTLED",
    "amountMinor": "125000",
    "currency": "KES",
    "method": "MPESA",
    "risk": { "decision": "ALLOW", "score": 8 },
    "provider": { "code": "MPESA_V1", "mode": "TEST" },
    "timeline": [
      { "event": "created",       "detail": "Payment intent created via MPESA" },
      { "event": "risk_evaluated","detail": "Risk ALLOW (score 8)" },
      { "event": "rail_submitted","detail": "Safaricom M-Pesa (sandbox) acknowledged" },
      { "event": "settled",       "detail": "ledger ltx_… posted" }
    ]
  }
}`

const WEBHOOK_VERIFY = `import { createHmac, timingSafeEqual } from 'node:crypto'

// Every delivery POSTs the raw body with two headers:
//   Novera-Timestamp: 1760000000
//   Novera-Signature: <hex hmac>
export function verifyNoveraSignature({ secret, timestamp, body, signature }) {
  const expected = createHmac('sha256', secret)
    .update(\`\${timestamp}.\${body}\`)   // timestamp + "." + raw body
    .digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}`

const LINK_CARDS = [
  { href: '/developers/keys', icon: KeyRound, title: 'API keys', description: 'Create TEST/LIVE keys, scope them, revoke on demand.' },
  { href: '/developers/logs', icon: ScrollText, title: 'Request logs', description: 'Every authenticated call: status, latency, error code.' },
  { href: '/developers/webhooks', icon: Webhook, title: 'Webhooks', description: 'Endpoints, delivery history, replay and the signature verifier.' },
  { href: '/developers/docs', icon: BookOpen, title: 'API reference', description: 'Full endpoint reference, event catalog and error codes.' },
]

export default async function DevelopersPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const [activeKeys, logs7d, ok7d, endpoints, deliveries, delivered] = await Promise.all([
    db.apiKey.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
    db.apiRequestLog.count({ where: { organizationId: orgId, createdAt: { gte: since } } }),
    db.apiRequestLog.count({ where: { organizationId: orgId, createdAt: { gte: since }, status: { lt: 400 } } }),
    db.webhookEndpoint.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
    db.webhookDelivery.count({ where: { organizationId: orgId } }),
    db.webhookDelivery.count({ where: { organizationId: orgId, status: 'DELIVERED' } }),
  ])

  const apiSuccessPct = pct(ok7d, logs7d)
  const deliverySuccessPct = pct(delivered, deliveries)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Developers"
        description="Programmable access to the Novera financial kernel — a versioned REST API, scoped API keys, signed webhooks and full request observability."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/developers/docs">
                <BookOpen className="mr-2 h-4 w-4" aria-hidden />
                API reference
              </Link>
            </Button>
            <Button asChild>
              <Link href="/developers/keys">
                <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                Create a key
              </Link>
            </Button>
          </>
        }
      />

      <Alert className="border-primary/25 bg-primary/5">
        <FlaskConical className="h-4 w-4 text-primary" aria-hidden />
        <AlertTitle>Sandbox — TEST mode</AlertTitle>
        <AlertDescription>
          This organization runs in <strong>TEST mode</strong>: every provider is a deterministic simulator and no real
          settlement occurs. TEST and LIVE keys hit the same rails here — LIVE keys simply carry production scopes.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Active API keys" value={activeKeys} hint="TEST + LIVE" icon={<KeyRound className="h-4 w-4" aria-hidden />} />
        <KpiCard label="Requests (7d)" value={logs7d} hint="logged per key" icon={<Activity className="h-4 w-4" aria-hidden />} />
        <KpiCard label="API success (7d)" value={`${apiSuccessPct.toFixed(1)}%`} hint="2xx / total" icon={<CheckCircle2 className="h-4 w-4" aria-hidden />} />
        <KpiCard
          label="Webhook delivery"
          value={deliveries === 0 ? '—' : `${deliverySuccessPct.toFixed(1)}%`}
          hint={`${delivered}/${deliveries} delivered`}
          icon={<Webhook className="h-4 w-4" aria-hidden />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Server className="h-4 w-4 text-primary" aria-hidden />
                Quickstart
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Three steps from zero to a settled, ledger-recorded payment.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] text-primary">1</span>
                  Get a sandbox key
                </p>
                <p className="text-sm text-muted-foreground">
                  Create keys in <Link href="/developers/keys" className="text-primary underline-offset-4 hover:underline">API keys</Link>.
                  The demo org ships with a seeded TEST key:
                </p>
                <CodeBlock language="key" code="nv_test_demo0001secret" />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] text-primary">2</span>
                  Create a payment (idempotent)
                </p>
                <p className="text-sm text-muted-foreground">
                  Send an <code className="rounded bg-muted px-1 font-mono text-xs">idempotencyKey</code> — replaying it
                  returns the original payment instead of double-charging.
                </p>
                <CodeBlock language="bash" code={QUICKSTART_PAYMENT} />
                <CodeBlock language="json" code={QUICKSTART_RESPONSE} />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">
                  <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] text-primary">3</span>
                  Receive webhooks, verify signatures
                </p>
                <p className="text-sm text-muted-foreground">
                  Every event is HMAC-SHA256 signed over <code className="rounded bg-muted px-1 font-mono text-xs">timestamp.body</code>.
                  Reject anything that fails this check.
                </p>
                <CodeBlock language="javascript" code={WEBHOOK_VERIFY} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">API surface</CardTitle>
              <p className="text-sm text-muted-foreground">
                Base URL <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">/api/v1</code> · JSON
                envelopes <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{'{data}'}</code> /{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{'{error}'}</code> · amounts are exact
                minor-unit strings.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {ENDPOINT_GROUPS.map((group) => (
                <div key={group.title} className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">{group.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
                  <ul className="mt-3 space-y-2">
                    {group.endpoints.map((ep) => (
                      <li key={`${ep.method}-${ep.path}`} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <MethodChip method={ep.method} />
                          <code className="truncate font-mono text-xs">{ep.path}</code>
                        </div>
                        <div className="flex items-center gap-2 pl-16">
                          <span className="text-xs text-muted-foreground">{ep.summary}</span>
                          <Badge variant="outline" className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">
                            {ep.scope}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Guardrails</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="font-medium">Bearer auth, hashed at rest</p>
                  <p className="text-muted-foreground">
                    Only the sha256 hash of a key is persisted — the secret is shown exactly once at creation.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="font-medium">Rate limits</p>
                  <p className="text-muted-foreground">
                    120 requests/min per key by default; 429 responses carry{' '}
                    <code className="rounded bg-muted px-1 font-mono text-xs">resetAt</code> and{' '}
                    <code className="rounded bg-muted px-1 font-mono text-xs">Retry-After</code>.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="font-medium">Idempotency</p>
                  <p className="text-muted-foreground">
                    POST endpoints accept an idempotency key; the ledger itself is idempotent at the posting level.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {LINK_CARDS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-muted p-2 text-muted-foreground transition-colors group-hover:text-primary">
                    <card.icon className="h-4 w-4" aria-hidden />
                  </div>
                  <p className="text-sm font-semibold group-hover:text-primary">{card.title}</p>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{card.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
