import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { METHOD_META, RAIL_TYPE_LABEL, RISK_DECISION_META } from '@novera/domain'
import { Money } from '@novera/money'
import { fmtDateTime, safeJson, timeAgo, titleCase } from '@/lib/format'
import { PaymentStatusBadge, StatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { MoneyText } from '@/components/novera/money-text'
import { CopyButton } from '@/components/novera/copy-button'
import { RetryPaymentButton, RefundPaymentDialog, MarkDisputedDialog } from './payment-actions'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  FilePlus2,
  Receipt,
  Send,
  ShieldAlert,
  ShieldCheck,
  Undo2,
  XCircle,
  Zap,
} from 'lucide-react'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Payment ${id.slice(0, 12)}…` }
}

interface TimelineEvent {
  at: string
  event: string
  detail: string
}

const ZERO = BigInt(0)

/** Event → icon + tone for the transparency timeline. */
const EVENT_META: Record<string, { icon: React.ElementType; tone: string }> = {
  created: { icon: FilePlus2, tone: 'text-muted-foreground' },
  risk_evaluated: { icon: ShieldCheck, tone: 'text-primary' },
  authorized: { icon: Zap, tone: 'text-primary' },
  pending: { icon: Clock, tone: 'text-warning' },
  rail_submitted: { icon: Send, tone: 'text-primary' },
  settled: { icon: CheckCircle2, tone: 'text-success' },
  failed: { icon: XCircle, tone: 'text-danger' },
  refunded: { icon: Undo2, tone: 'text-warning' },
  disputed: { icon: ShieldAlert, tone: 'text-danger' },
}

const RECON_TONE: Record<string, 'positive' | 'negative' | 'neutral' | 'warning'> = {
  MATCHED: 'positive',
  RESOLVED: 'positive',
  UNMATCHED: 'neutral',
  DISCREPANCY: 'negative',
}

const DELIVERY_TONE: Record<string, 'positive' | 'negative' | 'warning'> = {
  DELIVERED: 'positive',
  FAILED: 'negative',
  DEAD: 'negative',
  PENDING: 'warning',
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params

  const payment = await db.payment.findFirst({
    where: { id, organizationId: session.organization.id },
    include: {
      provider: true,
      invoice: { select: { id: true, number: true, status: true } },
      paymentLink: { select: { id: true, token: true, label: true } },
      ledgerTransaction: { select: { id: true, reference: true, source: true } },
      riskEvaluations: { orderBy: { createdAt: 'desc' }, take: 1 },
      providerTransactions: { orderBy: { createdAt: 'desc' } },
      webhookDeliveries: { orderBy: { createdAt: 'desc' }, take: 10, include: { endpoint: { select: { url: true } } } },
    },
  })
  if (!payment) notFound()

  const timeline = safeJson<TimelineEvent[]>(payment.timeline, []).slice().reverse() // newest first
  const risk = payment.riskEvaluations[0] ?? null
  const riskReasons = risk ? safeJson<string[]>(risk.reasons, []) : []
  const netMinor = payment.amountMinor - payment.feeMinor
  const remainingRefundMinor = payment.amountMinor - payment.refundedMinor
  const remainingRefundMajor = Money.fromMinor(remainingRefundMinor, payment.currency).toMajorString()
  const methodLabel = METHOD_META[payment.method]?.label ?? titleCase(payment.method)
  const railLabel = METHOD_META[payment.method]?.rail

  const canRetry = payment.status === 'FAILED'
  const canRefund = payment.status === 'SETTLED'
  const canDispute = payment.status === 'SETTLED'

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground">
          <Link href="/payments">
            <ArrowLeft className="h-4 w-4" />
            Payments
          </Link>
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-mono text-xl font-semibold tracking-tight">{payment.reference}</h1>
              <PaymentStatusBadge status={payment.status} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                {payment.direction === 'IN' ? (
                  <ArrowDownLeft className="h-3.5 w-3.5 text-success" />
                ) : (
                  <ArrowUpRight className="h-3.5 w-3.5 text-warning" />
                )}
                {payment.direction === 'IN' ? 'Collection' : 'Payout'} · {methodLabel}
                {railLabel ? ` (${RAIL_TYPE_LABEL[railLabel] ?? railLabel})` : null}
              </span>
              <span aria-hidden>·</span>
              <time dateTime={payment.createdAt.toISOString()}>{fmtDateTime(payment.createdAt)}</time>
            </div>
            {payment.description ? (
              <p className="max-w-2xl text-sm text-muted-foreground">{payment.description}</p>
            ) : null}
          </div>

          <div className="text-right">
            <MoneyText minor={payment.amountMinor} currency={payment.currency} strong className="text-3xl" />
            {payment.feeMinor > ZERO ? (
              <p className="mt-1 text-xs text-muted-foreground">
                fee <MoneyText minor={payment.feeMinor} currency={payment.currency} muted /> · net{' '}
                <MoneyText minor={netMinor} currency={payment.currency} muted />
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">no processing fee</p>
            )}
          </div>
        </div>

        {/* ── Actions — only what is legal in this state ── */}
        <div className="flex flex-wrap items-center gap-2">
          {canRetry ? <RetryPaymentButton paymentId={payment.id} /> : null}
          {canRefund ? (
            <RefundPaymentDialog
              paymentId={payment.id}
              currency={payment.currency}
              remainingMinor={remainingRefundMinor.toString()}
              remainingMajor={remainingRefundMajor}
            />
          ) : null}
          {canDispute ? <MarkDisputedDialog paymentId={payment.id} reference={payment.reference} /> : null}
          {!canRetry && !canRefund && !canDispute ? (
            <p className="text-xs text-muted-foreground">
              No manual action is legal in status {payment.status.toLowerCase()} — the state machine
              decides what happens next.
            </p>
          ) : null}
        </div>
        {payment.failureReason ? (
          <p className="rounded-lg border border-danger/25 bg-danger/10 px-4 py-2.5 text-sm text-danger">
            Failure reason: {payment.failureReason}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Timeline — what happened, when, and why ── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Lifecycle timeline</CardTitle>
            <CardDescription>
              Every state transition, risk decision and rail acknowledgment — the same trail the
              audit chain stores.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No timeline events recorded.</p>
            ) : (
              <ol className="relative ml-2 space-y-6">
                <span className="absolute bottom-3 left-[11px] top-3 w-px bg-border" aria-hidden />
                {timeline.map((ev, i) => {
                  const meta = EVENT_META[ev.event] ?? { icon: Receipt, tone: 'text-muted-foreground' }
                  const Icon = meta.icon
                  return (
                    <li key={`${ev.at}-${i}`} className="relative flex gap-4">
                      <span
                        className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background ${meta.tone}`}
                        aria-hidden
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1 pb-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <p className="text-sm font-medium">{titleCase(ev.event)}</p>
                          <time className="text-xs text-muted-foreground" dateTime={ev.at}>
                            {fmtDateTime(ev.at)}
                            <span className="ml-1.5" title={fmtDateTime(ev.at)}>
                              ({timeAgo(ev.at)})
                            </span>
                          </time>
                        </div>
                        <p className="text-sm leading-relaxed break-words text-muted-foreground">{ev.detail}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* ── Facts + risk ── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Facts</CardTitle>
              <CardDescription>Exactly what the kernel knows — nothing inferred.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <Fact label="Provider">
                  {payment.provider ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{payment.provider.name}</span>
                      <ToneBadge tone="warning">{payment.provider.mode}</ToneBadge>
                    </span>
                  ) : (
                    '—'
                  )}
                </Fact>
                <Fact label="Provider reference">
                  {payment.providerReference ? (
                    <span className="flex items-center gap-1.5">
                      <code className="font-mono text-xs">{payment.providerReference}</code>
                      <CopyButton value={payment.providerReference} label="Copy" />
                    </span>
                  ) : (
                    '—'
                  )}
                </Fact>
                <Fact label="Ledger transaction">
                  {payment.ledgerTransaction ? (
                    <Button asChild variant="link" size="sm" className="h-auto gap-1 p-0 text-sm font-normal">
                      <Link href="/transactions">
                        <span className="font-mono text-xs">{payment.ledgerTransaction.reference}</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-muted-foreground">— (no ledger leg yet)</span>
                  )}
                </Fact>
                <Fact label="Invoice">
                  {payment.invoice ? (
                    <Button asChild variant="link" size="sm" className="h-auto gap-1 p-0 text-sm font-normal">
                      <Link href={`/invoices/${payment.invoice.id}`}>
                        {payment.invoice.number}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </Button>
                  ) : (
                    '—'
                  )}
                </Fact>
                <Fact label="Payment link">
                  {payment.paymentLink ? (
                    <Button asChild variant="link" size="sm" className="h-auto gap-1 p-0 text-sm font-normal">
                      <Link href={`/pay/${payment.paymentLink.token}`} target="_blank" rel="noreferrer">
                        {payment.paymentLink.label}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </Button>
                  ) : (
                    '—'
                  )}
                </Fact>
                <Fact label="Customer">
                  {payment.customerName || payment.customerEmail ? (
                    <span>
                      {payment.customerName ?? '—'}
                      {payment.customerEmail ? (
                        <span className="block text-xs text-muted-foreground">{payment.customerEmail}</span>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  )}
                </Fact>
                <Fact label="Fee">
                  <MoneyText minor={payment.feeMinor} currency={payment.currency} muted />
                </Fact>
                <Fact label="Refunded so far">
                  {payment.refundedMinor > ZERO ? (
                    <MoneyText minor={payment.refundedMinor} currency={payment.currency} muted />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Fact>
                <Fact label="Idempotency key">
                  {payment.idempotencyKey ? (
                    <span className="flex items-center gap-1.5">
                      <code className="font-mono text-xs">{payment.idempotencyKey}</code>
                      <CopyButton value={payment.idempotencyKey} label="Copy" />
                    </span>
                  ) : (
                    '—'
                  )}
                </Fact>
              </dl>
            </CardContent>
          </Card>

          {/* Risk evaluation */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Risk evaluation
              </CardTitle>
              <CardDescription>Decision made before any money moved.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {risk ? (
                <>
                  <div className="flex items-center gap-2">
                    <StatusBadge meta={RISK_DECISION_META} status={risk.decision} />
                    <span className="text-sm tabular text-muted-foreground">score {risk.score}</span>
                  </div>
                  {riskReasons.length > 0 ? (
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {riskReasons.map((r, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                          <span className="leading-relaxed">{r}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="text-xs text-muted-foreground">Evaluated {fmtDateTime(risk.createdAt)}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Related records ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provider transactions</CardTitle>
            <CardDescription>
              The provider&rsquo;s own statement of what happened on their rail — reconciliation
              compares this against the Novera ledger.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {payment.providerTransactions.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No rail submissions recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">External reference</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Recon</TableHead>
                      <TableHead className="pr-6 text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payment.providerTransactions.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="pl-6 font-mono text-xs">{t.externalReference}</TableCell>
                        <TableCell>
                          <ToneBadge tone={t.status === 'SETTLED' ? 'positive' : t.status === 'FAILED' ? 'negative' : 'neutral'}>
                            {titleCase(t.status)}
                          </ToneBadge>
                        </TableCell>
                        <TableCell>
                          <ToneBadge tone={RECON_TONE[t.reconciliationStatus] ?? 'neutral'}>
                            {titleCase(t.reconciliationStatus)}
                          </ToneBadge>
                        </TableCell>
                        <TableCell className="pr-6 text-right text-xs text-muted-foreground" title={fmtDateTime(t.createdAt)}>
                          {timeAgo(t.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Webhook deliveries</CardTitle>
            <CardDescription>
              Signed events emitted for this payment to your endpoints, with retry counts.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {payment.webhookDeliveries.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No webhook events emitted.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Event</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Attempts</TableHead>
                      <TableHead className="pr-6 text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payment.webhookDeliveries.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="pl-6">
                          <code className="font-mono text-xs">{d.event}</code>
                          <p className="max-w-52 truncate text-xs text-muted-foreground">{d.endpoint.url}</p>
                        </TableCell>
                        <TableCell>
                          <ToneBadge tone={DELIVERY_TONE[d.status] ?? 'neutral'}>{titleCase(d.status)}</ToneBadge>
                        </TableCell>
                        <TableCell className="text-right tabular">{d.attempts}</TableCell>
                        <TableCell className="pr-6 text-right text-xs text-muted-foreground" title={fmtDateTime(d.createdAt)}>
                          {timeAgo(d.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
