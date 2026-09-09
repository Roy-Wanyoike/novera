import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { minorToMajorString } from '@novera/money'
import { PageHeader } from '@/components/novera/page-header'
import { MoneyText } from '@/components/novera/money-text'
import { EmptyState } from '@/components/novera/empty-state'
import { ToneBadge } from '@/components/novera/status-badge'
import { safeJson, fmtDate, fmtDateTime, timeAgo, pct, titleCase } from '@/lib/format'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CreditCard, Gauge, Lock, ReceiptText, ShieldCheck } from 'lucide-react'
import { CardVisual } from '../card-visual'
import { CardControls } from './card-controls'
import { AuthSimulator } from './auth-simulator'

export const metadata = { title: 'Card — Novera' }

interface AuthRow {
  id: string
  merchantName: string
  mcc: string
  amountMinor: string
  currency: string
  country: string
  channel: string
  decision: string
  declineReason: string | null
  riskScore: number
  createdAt: string
}

function SpendMeter({
  label,
  usedMinor,
  limitMinor,
  currency,
}: {
  label: string
  usedMinor: bigint
  limitMinor: bigint | null
  currency: string
}) {
  const ratio = limitMinor !== null ? Math.min(100, pct(usedMinor, limitMinor)) : 0
  const over = limitMinor !== null && usedMinor > limitMinor
  const nearLimit = limitMinor !== null && !over && ratio >= 85
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          <MoneyText minor={usedMinor} currency={currency} strong className="text-sm" />
          {limitMinor !== null ? (
            <>
              {' of '}
              <MoneyText minor={limitMinor} currency={currency} />
            </>
          ) : (
            <span> · no limit</span>
          )}
        </p>
      </div>
      {limitMinor !== null ? (
        <Progress
          value={ratio}
          aria-label={`${label} spend ${ratio}% of limit`}
          className={over ? 'h-2 [&>div]:bg-danger' : nearLimit ? 'h-2 [&>div]:bg-warning' : 'h-2'}
        />
      ) : (
        <div className="h-2 rounded-full bg-muted" aria-hidden />
      )}
      {over ? <p className="text-xs text-danger">Limit exceeded — further authorizations will decline.</p> : null}
    </div>
  )
}

export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params

  const card = await db.card.findFirst({
    where: { id, organizationId: session.organization.id },
    include: {
      wallet: { select: { id: true, label: true, currency: true } },
      agent: { select: { id: true, name: true, role: true } },
      authorizations: {
        orderBy: { createdAt: 'desc' },
        take: 15,
      },
    },
  })
  if (!card) notFound()

  const mccAllowlist = safeJson<string[]>(card.mccAllowlist, [])
  const merchantAllowlist = safeJson<string[]>(card.merchantAllowlist, [])
  const countryAllowlist = safeJson<string[]>(card.countryAllowlist, [])

  const data = {
    id: card.id,
    label: card.label,
    type: card.type,
    status: card.status,
    brand: card.brand,
    last4: card.last4,
    expiryMonth: card.expiryMonth,
    expiryYear: card.expiryYear,
    currency: card.currency,
    holderName: card.holderName,
    perTxnLimitMinor: card.perTxnLimitMinor?.toString() ?? null,
    dailyLimitMinor: card.dailyLimitMinor?.toString() ?? null,
    monthlyLimitMinor: card.monthlyLimitMinor?.toString() ?? null,
    perTxnLimitMajor: card.perTxnLimitMinor !== null ? minorToMajorString(card.perTxnLimitMinor, card.currency) : null,
    dailyLimitMajor: card.dailyLimitMinor !== null ? minorToMajorString(card.dailyLimitMinor, card.currency) : null,
    monthlyLimitMajor: card.monthlyLimitMinor !== null ? minorToMajorString(card.monthlyLimitMinor, card.currency) : null,
    mccAllowlist,
    merchantAllowlist,
    countryAllowlist,
    allowOnline: card.allowOnline,
    allowContactless: card.allowContactless,
    allowAtm: card.allowAtm,
    allowInternational: card.allowInternational,
    spendTodayMinor: card.spendTodayMinor.toString(),
    spendMonthMinor: card.spendMonthMinor.toString(),
    lastUsedAt: card.lastUsedAt?.toISOString() ?? null,
    createdAt: card.createdAt.toISOString(),
    walletId: card.walletId,
    walletLabel: card.wallet?.label ?? null,
    agentId: card.agentId,
    agentName: card.agent?.name ?? null,
    agentRole: card.agent?.role ?? null,
  }

  const auths: AuthRow[] = card.authorizations.map((a) => ({
    id: a.id,
    merchantName: a.merchantName,
    mcc: a.mcc,
    amountMinor: a.amountMinor.toString(),
    currency: a.currency,
    country: a.country,
    channel: a.channel,
    decision: a.decision,
    declineReason: a.declineReason,
    riskScore: a.riskScore,
    createdAt: a.createdAt.toISOString(),
  }))

  const todayDeclines = auths.filter((a) => new Date(a.createdAt).toDateString() === new Date().toDateString() && a.decision === 'DECLINED').length

  return (
    <div className="space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/cards">Cards</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>•••• {card.last4}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={card.label}
        description={
          <>
            {card.holderName} · {card.currency} card funded from{' '}
            {card.wallet ? <Link href={`/wallets/${card.wallet.id}`} className="underline underline-offset-2 hover:text-primary">{card.wallet.label}</Link> : 'no wallet'} ·
            issued {fmtDate(card.createdAt)}
          </>
        }
      />

      {/* hero + controls */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-6">
          <CardVisual
            card={{
              label: card.label,
              holderName: card.holderName,
              last4: card.last4,
              expiryMonth: card.expiryMonth,
              expiryYear: card.expiryYear,
              status: card.status,
              type: card.type,
              currency: card.currency,
              agentName: card.agent?.name ?? null,
            }}
            size="lg"
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
                Spend meters
              </CardTitle>
              <CardDescription>Hard controls enforced synchronously on every authorization.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <SpendMeter label="Today" usedMinor={card.spendTodayMinor} limitMinor={card.dailyLimitMinor} currency={card.currency} />
              <SpendMeter label="This month" usedMinor={card.spendMonthMinor} limitMinor={card.monthlyLimitMinor} currency={card.currency} />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3 shrink-0" aria-hidden />
                PAN/CVV never stored — tokenized issuance, only •••• {card.last4} is retained.
              </p>
            </CardContent>
          </Card>
        </div>

        <CardControls card={data} />
      </div>

      {/* simulator + feed */}
      <div className="grid gap-6 xl:grid-cols-2">
        <AuthSimulator
          cardId={card.id}
          currency={card.currency}
          status={card.status}
          last4={card.last4}
          controls={{
            perTxnLimitMinor: data.perTxnLimitMinor,
            dailyLimitMinor: data.dailyLimitMinor,
            monthlyLimitMinor: data.monthlyLimitMinor,
            mccAllowlist,
            merchantAllowlist,
            countryAllowlist,
            allowOnline: card.allowOnline,
            allowContactless: card.allowContactless,
            allowAtm: card.allowAtm,
            allowInternational: card.allowInternational,
          }}
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText className="h-4 w-4 text-muted-foreground" aria-hidden />
              Recent authorizations
            </CardTitle>
            <CardDescription>
              Every attempt is recorded with its full decision trail.{todayDeclines > 0 ? ` ${todayDeclines} decline${todayDeclines > 1 ? 's' : ''} today.` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {auths.length === 0 ? (
              <EmptyState
                icon={<CreditCard className="h-6 w-6" aria-hidden />}
                title="No authorizations yet"
                description="Run the simulator to send an authorization through the real decisioning pipeline — controls, risk, hold, capture and ledger."
                className="border-0 p-6"
              />
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead>Merchant</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead className="text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auths.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <p className="font-medium leading-tight">{a.merchantName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            MCC {a.mcc} · {a.country}
                            {a.declineReason ? <span className="text-danger"> · {a.declineReason}</span> : null}
                          </p>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{titleCase(a.channel)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <MoneyText minor={a.amountMinor} currency={a.currency} strong />
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              a.riskScore >= 60 ? 'text-xs font-medium text-danger' : a.riskScore >= 30 ? 'text-xs font-medium text-warning' : 'text-xs text-muted-foreground'
                            }
                          >
                            {a.riskScore}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ToneBadge tone={a.decision === 'APPROVED' ? 'positive' : 'negative'}>
                            {titleCase(a.decision)}
                          </ToneBadge>
                        </TableCell>
                        <TableCell className="text-right">
                          <p className="text-xs leading-tight">{timeAgo(a.createdAt)}</p>
                          <p className="text-[10px] text-muted-foreground">{fmtDateTime(a.createdAt)}</p>
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

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden />
        TEST network — deterministic simulator. Approvals place a hold and post the ledger leg immediately (single-phase capture); declines move no funds.
      </p>

      <p className="sr-only">
        Card detail for {card.label}, status {card.status}, {auths.length} recent authorizations.
        Last used {card.lastUsedAt ? fmtDate(card.lastUsedAt) : 'never'}.
      </p>
    </div>
  )
}
