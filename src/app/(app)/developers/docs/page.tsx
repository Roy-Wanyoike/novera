import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { DOMAIN_EVENTS } from '@novera/events'
import { PageHeader } from '@/components/novera/page-header'
import { CodeBlock } from '@/components/novera/copy-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MethodChip } from '../_components/method-chip'
import { BookOpen, Download, FileJson, Lock, Timer, Repeat, Braces } from 'lucide-react'

export const metadata = { title: 'API reference' }

/* ────────────────────────────────────────────────────────────────
   Static reference content (examples mirror live v1 responses).
   ──────────────────────────────────────────────────────────────── */

const AUTH_EXAMPLE = `curl http://localhost:3000/api/v1/wallets \\
  -H "Authorization: Bearer nv_test_demo0001secret"`

const ERROR_EXAMPLE = `{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded: 120 requests/min on this key.",
    "retryAfterSec": 12,
    "resetAt": "2026-09-08T16:32:39.023Z"
  }
}`

const WALLETS_RESPONSE = `{
  "data": {
    "wallets": [
      {
        "id": "cmtsvgo8q0017m4s0htskvvs4",
        "label": "Operating",
        "type": "OPERATING",
        "currency": "KES",
        "status": "ACTIVE",
        "ledgerMinor": "8621552",
        "createdAt": "2026-09-08T16:16:36.794Z"
      }
    ],
    "count": 7
  }
}`

const BALANCES_RESPONSE = `{
  "data": {
    "balances": [
      {
        "currency": "KES",
        "ledgerMinor": "-11815448",
        "availableMinor": "-11815448",
        "reservedMinor": "0",
        "walletCount": 5
      }
    ]
  }
}`

const PAYMENTS_CREATE_REQUEST = `{
  "amount": "1250.00",
  "currency": "KES",
  "method": "MPESA",
  "customerEmail": "buyer@example.com",
  "description": "Order #1024 — steel gutters",
  "idempotencyKey": "order-1024-attempt-1"
}`

const PAYMENTS_CREATE_RESPONSE = `{
  "data": {
    "reference": "pay_mtswo0a2r90epbxnx",
    "status": "SETTLED",
    "amountMinor": "125000",
    "feeMinor": "1500",
    "refundedMinor": "0",
    "currency": "KES",
    "method": "MPESA",
    "direction": "IN",
    "risk": { "decision": "ALLOW", "score": 8 },
    "provider": {
      "code": "MPESA_V1",
      "name": "Safaricom M-Pesa (sandbox)",
      "railType": "MOBILE_MONEY",
      "mode": "TEST"
    },
    "timeline": [
      { "at": "2026-09-08T16:31:51.556Z", "event": "created", "detail": "Payment intent created via MPESA" },
      { "at": "2026-09-08T16:31:51.568Z", "event": "risk_evaluated", "detail": "Risk ALLOW (score 8)" },
      { "at": "2026-09-08T16:31:51.583Z", "event": "rail_submitted", "detail": "Safaricom M-Pesa (sandbox) acknowledged" },
      { "at": "2026-09-08T16:31:51.609Z", "event": "settled", "detail": "Settled; ledger ltx_… posted" }
    ],
    "idempotencyKey": "order-1024-attempt-1",
    "createdAt": "2026-09-08T16:31:51.557Z",
    "settledAt": "2026-09-08T16:31:51.607Z"
  }
}`

const PAYMENT_DETAIL_NOTE = `curl http://localhost:3000/api/v1/payments/pay_mtswo0a2r90epbxnx \\
  -H "Authorization: Bearer nv_test_demo0001secret"`

const TRANSACTIONS_RESPONSE = `{
  "data": {
    "transactions": [
      {
        "reference": "ltx_mtsvgy4gwbgogucf",
        "description": "October payroll funding",
        "source": "TRANSFER",
        "status": "POSTED",
        "amountMinor": "980000",
        "currency": "KES",
        "actor": { "type": "USER", "label": "David Kimani" },
        "entries": [
          { "direction": "CREDIT", "amountMinor": "980000",
            "account": { "code": "WALLET:KES:PAYROLL:ptjc", "type": "ASSET" } },
          { "direction": "DEBIT", "amountMinor": "980000",
            "account": { "code": "WALLET:KES:OPERATING", "type": "ASSET" } }
        ]
      }
    ],
    "count": 1
  }
}`

const WEBHOOK_DELIVERY = `POST https://api.yourapp.com/hooks/novera
Novera-Timestamp: 1760000000
Novera-Signature: 9f2c6a5d8e1b4f7a0c3d6e9f2a5b8c1d4e7f0a3b6c9d2e5f8a1b4c7d0e3f6a9

{
  "id": "wh_mtswo0a2r90epbxnx",
  "event": "payment.settled",
  "createdAt": "2026-09-08T16:31:51.610Z",
  "data": {
    "reference": "pay_mtswo0a2r90epbxnx",
    "amountMinor": "125000",
    "currency": "KES",
    "settledAt": "2026-09-08T16:31:51.607Z",
    "ledgerTransactionRef": "ltx_mtswo0a419oqhbolc"
  }
}`

const ERROR_CODES: { code: string; http: string; when: string }[] = [
  { code: 'UNAUTHENTICATED', http: '401', when: 'Missing, malformed, invalid or revoked Bearer key.' },
  { code: 'INSUFFICIENT_SCOPE', http: '403', when: 'The key lacks a scope the endpoint accepts.' },
  { code: 'NOT_FOUND', http: '404', when: 'Resource does not exist in the calling organization.' },
  { code: 'INVALID_ARGUMENT', http: '400', when: 'Malformed body, bad decimal amount, unknown method/status or bad query parameter.' },
  { code: 'PAYMENT_ERROR', http: '422', when: 'The payment engine rejected the request (e.g. no provider for the method, idempotencyKey collision).' },
  { code: 'RATE_LIMITED', http: '429', when: 'More than the per-key requests/min. Retry after resetAt.' },
  { code: 'INTERNAL', http: '500', when: 'Unexpected failure — correlated in the request log.' },
]

const ENDPOINTS: {
  method: string
  path: string
  scope: string
  summary: string
  params?: { name: string; in: string; description: string }[]
  request?: string
  requestLabel?: string
  response: string
  notes?: string[]
}[] = [
  {
    method: 'GET',
    path: '/api/v1/wallets',
    scope: 'wallets:read',
    summary: 'List every wallet with its authoritative ledger balance.',
    response: WALLETS_RESPONSE,
  },
  {
    method: 'GET',
    path: '/api/v1/balances',
    scope: 'balances:read | wallets:read',
    summary: 'Per-currency ledger vs available balance (net of active holds).',
    response: BALANCES_RESPONSE,
    notes: ['Pending funds are never reported as available — availableMinor = ledger − active holds.'],
  },
  {
    method: 'GET',
    path: '/api/v1/payments',
    scope: 'payments:write | wallets:read',
    summary: 'List payment intents, newest first.',
    params: [
      { name: 'status', in: 'query', description: 'Filter by status: CREATED, AUTHORIZED, PROCESSING, PENDING, SETTLED, FAILED, CANCELLED, REFUNDED, REVERSED, DISPUTED.' },
      { name: 'limit', in: 'query', description: '1–100, default 25.' },
    ],
    response: PAYMENTS_CREATE_RESPONSE,
    notes: ['Each item is the payment summary shape (no timeline).'],
  },
  {
    method: 'POST',
    path: '/api/v1/payments',
    scope: 'payments:write',
    summary: 'Create a payment. Risk runs before the rail; settlement posts balanced ledger entries and emits webhooks.',
    request: PAYMENTS_CREATE_REQUEST,
    requestLabel: 'request body',
    response: PAYMENTS_CREATE_RESPONSE,
    notes: [
      'amount is a decimal string parsed exactly (Money.fromMajor) — floats are never accepted.',
      'A DECLINED or FAILED payment still returns 201: inspect status + failureReason. No fake success.',
      'Replaying idempotencyKey returns the original payment with HTTP 200.',
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/payments/{id}',
    scope: 'payments:write | wallets:read',
    summary: 'Retrieve one payment with full timeline, risk evaluation and provider details.',
    params: [{ name: 'id', in: 'path', description: 'Internal id or the pay_… reference.' }],
    request: PAYMENT_DETAIL_NOTE,
    requestLabel: 'curl',
    response: PAYMENTS_CREATE_RESPONSE,
  },
  {
    method: 'GET',
    path: '/api/v1/transactions',
    scope: 'wallets:read | balances:read',
    summary: 'Recent double-entry postings with their debit/credit lines.',
    params: [{ name: 'limit', in: 'query', description: '1–100, default 25.' }],
    response: TRANSACTIONS_RESPONSE,
  },
  {
    method: 'GET',
    path: '/api/v1/invoices',
    scope: 'payments:write | wallets:read',
    summary: 'List invoices with totals, customer and payment state.',
    response: TRANSACTIONS_RESPONSE,
    notes: ['All amount fields are minor-unit strings; amountPaidMinor only counts settled payments.'],
  },
  {
    method: 'GET',
    path: '/api/v1/webhooks/endpoints',
    scope: 'webhooks:manage',
    summary: 'List registered endpoints. Secrets are never returned on read.',
    response: `{
  "data": {
    "endpoints": [
      {
        "url": "https://ops.acme.example/hooks/novera",
        "events": ["payment.settled", "payment.failed", "payment.refunded", "invoice.paid"],
        "status": "ACTIVE"
      }
    ],
    "count": 1
  }
}`,
  },
  {
    method: 'POST',
    path: '/api/v1/webhooks/endpoints',
    scope: 'webhooks:manage',
    summary: 'Register an HTTPS endpoint. The signing secret is returned exactly once.',
    request: `{
  "url": "https://api.yourapp.com/hooks/novera",
  "events": ["payment.settled", "payment.failed"],
  "description": "Production order events"
}`,
    requestLabel: 'request body',
    response: `{
  "data": {
    "url": "https://api.yourapp.com/hooks/novera",
    "events": ["payment.settled", "payment.failed"],
    "status": "ACTIVE",
    "secret": "nvwhsec_rt0rwvmnhrpetjq1egoj9l9b"
  }
}`,
    notes: ['Use "*" as the sole event to subscribe to everything.'],
  },
]

const EVENT_CHANNELS = [...new Set(DOMAIN_EVENTS.map((e) => e.channel))].sort()

function DocH2({ id, icon: Icon, children }: { id: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2.5 border-t pt-8 text-lg font-semibold tracking-tight scroll-mt-24">
      <Icon className="h-5 w-5 text-primary" aria-hidden />
      {children}
    </h2>
  )
}

export default async function DocsPage() {
  await requireSession()

  return (
    <div className="space-y-6">
      <PageHeader
        title="API reference"
        description="Novera API v1 — key-authenticated, JSON, idempotent. Every response is {data} on success or {error:{code, message}} on failure."
        actions={
          <Button variant="outline" asChild>
            <a href="/api/v1/openapi.json" download="novera-openapi.json">
              <Download className="mr-2 h-4 w-4" aria-hidden />
              OpenAPI 3.1 spec
            </a>
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5 text-sm">
          <span className="flex items-center gap-2">
            <span className="font-medium">Base URL</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">http://localhost:3000/api/v1</code>
          </span>
          <span className="flex items-center gap-2">
            <span className="font-medium">Format</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">JSON</code>
          </span>
          <span className="flex items-center gap-2">
            <span className="font-medium">Money</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">minor-unit strings</code>
          </span>
          <span className="flex items-center gap-2">
            <span className="font-medium">Spec</span>
            <a href="/api/v1/openapi.json" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline" target="_blank" rel="noreferrer">
              <FileJson className="h-3.5 w-3.5" aria-hidden />
              openapi.json
            </a>
          </span>
          <Badge variant="outline" className="ml-auto font-mono text-[10px] text-success border-success/25 bg-success/10">
            TEST MODE
          </Badge>
        </CardContent>
      </Card>

      <DocH2 id="authentication" icon={Lock}>Authentication</DocH2>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            All requests (except <code className="rounded bg-muted px-1 font-mono text-xs">/health</code> and{' '}
            <code className="rounded bg-muted px-1 font-mono text-xs">/openapi.json</code>) authenticate with a Bearer
            API key created in <Link href="/developers/keys" className="text-primary underline-offset-4 hover:underline">API keys</Link>:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Keys look like <code className="rounded bg-muted px-1 font-mono text-xs">nv_test_…</code> / <code className="rounded bg-muted px-1 font-mono text-xs">nv_live_…</code>.</li>
            <li>Only the sha256 hash is persisted — the secret is shown once at creation.</li>
            <li>Revoking a key is immediate: subsequent calls receive 401 UNAUTHENTICATED.</li>
            <li>Scopes are any-of per endpoint; create keys with the minimum set you need.</li>
          </ul>
        </div>
        <CodeBlock language="bash" code={AUTH_EXAMPLE} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Timer className="h-4 w-4 text-primary" aria-hidden />Rate limits</CardTitle></CardHeader>
          <CardContent className="text-xs leading-relaxed text-muted-foreground">
            120 requests/min per key (default). 429 responses carry <code className="font-mono">retryAfterSec</code>,{' '}
            <code className="font-mono">resetAt</code> and a <code className="font-mono">Retry-After</code> header.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Repeat className="h-4 w-4 text-primary" aria-hidden />Idempotency</CardTitle></CardHeader>
          <CardContent className="text-xs leading-relaxed text-muted-foreground">
            POST /payments accepts <code className="font-mono">idempotencyKey</code> (body or Idempotency-Key header).
            Replays return the original payment — the ledger is idempotent at posting level too.
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Braces className="h-4 w-4 text-primary" aria-hidden />Envelopes</CardTitle></CardHeader>
          <CardContent className="text-xs leading-relaxed text-muted-foreground">
            Success: <code className="font-mono">{'{ "data": … }'}</code>. Failure: <code className="font-mono">{'{ "error": { "code", "message" } }'}</code>{' '}
            with a consistent code set (see error table).
          </CardContent>
        </Card>
      </div>
      <CodeBlock language="json" code={ERROR_EXAMPLE} />

      <DocH2 id="endpoints" icon={BookOpen}>Endpoints</DocH2>
      <div className="space-y-4">
        {ENDPOINTS.map((ep) => (
          <Card key={`${ep.method}-${ep.path}`} id={`endpoint-${ep.method.toLowerCase()}-${ep.path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`}>
            <CardHeader className="gap-3 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <MethodChip method={ep.method} />
                <code className="break-all font-mono text-sm">{ep.path}</code>
                <Badge variant="outline" className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">{ep.scope}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{ep.summary}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {ep.params ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 text-xs">Parameter</TableHead>
                      <TableHead className="h-8 text-xs">In</TableHead>
                      <TableHead className="h-8 text-xs">Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ep.params.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell className="py-2 font-mono text-xs">{p.name}</TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground">{p.in}</TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground">{p.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
              {ep.request ? <CodeBlock code={ep.request} language={ep.requestLabel === 'curl' ? 'bash' : 'json'} /> : null}
              <CodeBlock code={ep.response} language="json" />
              {ep.notes ? (
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {ep.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <DocH2 id="webhooks" icon={BookOpen}>Webhooks</DocH2>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          Register HTTPS endpoints in <Link href="/developers/webhooks" className="text-primary underline-offset-4 hover:underline">Webhooks</Link>{' '}
          (or via the API). Matching events are POSTed with two headers — a unix timestamp and the HMAC-SHA256
          signature computed over <code className="rounded bg-muted px-1 font-mono text-xs">{'${timestamp}.${body}'}</code>{' '}
          with the endpoint secret:
        </p>
      </div>
      <CodeBlock language="http" code={WEBHOOK_DELIVERY} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border p-4 text-sm">
          <p className="font-medium">Retry policy</p>
          <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
            <li>Failed deliveries retry up to 3 times (30s backoff), then dead-letter as <code className="font-mono">DEAD</code>.</li>
            <li>Every attempt is recorded — inspect history and replay any delivery from the portal.</li>
            <li>Respond 2xx quickly; anything else counts as a failure.</li>
          </ul>
        </div>
        <div className="space-y-3 rounded-lg border p-4 text-sm">
          <p className="font-medium">Verification</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Recompute the HMAC over <code className="font-mono">{'${timestamp}.${body}'}</code> and compare with{' '}
            <code className="font-mono">timingSafeEqual</code>. The portal ships an interactive verifier — paste a
            payload, secret and signature to see it in action.
          </p>
        </div>
      </div>

      <h3 className="text-base font-semibold tracking-tight">Event catalog</h3>
      <p className="text-sm text-muted-foreground">
        {DOMAIN_EVENTS.length} domain events across {EVENT_CHANNELS.length} channels. Subscribe by exact name, or{' '}
        <code className="rounded bg-muted px-1 font-mono text-xs">*</code> for everything.
      </p>
      <div className="space-y-4">
        {EVENT_CHANNELS.map((channel) => (
          <div key={channel} className="rounded-lg border">
            <div className="border-b px-4 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{channel}</p>
            </div>
            <div className="divide-y">
              {DOMAIN_EVENTS.filter((e) => e.channel === channel).map((e) => (
                <div key={e.name} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,220px)_1fr]">
                  <code className="font-mono text-xs text-primary">{e.name}</code>
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">{e.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {e.payloadFields.map((f) => (
                        <Badge key={f} variant="outline" className="font-mono text-[9px] text-muted-foreground">{f}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <DocH2 id="errors" icon={BookOpen}>Error codes</DocH2>
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>HTTP</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ERROR_CODES.map((e) => (
              <TableRow key={e.code}>
                <TableCell className="font-mono text-xs text-primary">{e.code}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{e.http}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{e.when}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
