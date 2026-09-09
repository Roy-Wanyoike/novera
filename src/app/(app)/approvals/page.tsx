import { CheckSquare, Clock3, Hourglass, ShieldQuestion, ThumbsDown, ThumbsUp } from 'lucide-react'
import { db } from '@/lib/db'
import { requireSession } from '@/lib/session'
import { PageHeader } from '@/components/novera/page-header'
import { KpiCard } from '@/components/novera/kpi-card'
import { MoneyText } from '@/components/novera/money-text'
import { ApprovalStatusBadge } from '@/components/novera/status-badge'
import { EmptyState } from '@/components/novera/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fmtDateTime, safeJson, titleCase } from '@/lib/format'
import { ApprovalCard, type PendingApprovalView } from './approval-card'

export const metadata = { title: 'Approvals' }

export default async function ApprovalsPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  const [pending, decided, agents, approvedCount, declinedCount] = await Promise.all([
    db.approvalRequest.findMany({
      where: { organizationId: orgId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      include: { intent: true },
    }),
    db.approvalRequest.findMany({
      where: { organizationId: orgId, status: { in: ['APPROVED', 'DECLINED', 'EXPIRED'] } },
      orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
      take: 25,
    }),
    db.agent.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, avatarEmoji: true },
    }),
    db.approvalRequest.count({ where: { organizationId: orgId, status: 'APPROVED' } }),
    db.approvalRequest.count({ where: { organizationId: orgId, status: 'DECLINED' } }),
  ])

  const agentById = new Map(agents.map((a) => [a.id, a]))

  const pendingViews: PendingApprovalView[] = pending.map((ap) => {
    const payload = safeJson<Record<string, string>>(ap.payload, {})
    const agent =
      ap.requesterType === 'AGENT' ? agentById.get(ap.requesterId ?? '') : undefined
    const requesterName =
      agent?.name ??
      (ap.requesterLabel ? ap.requesterLabel.replace(/\s*\(agent\)$/, '') : 'Unknown requester')
    return {
      id: ap.id,
      requesterType: ap.requesterType,
      requesterName,
      requesterEmoji: agent?.avatarEmoji ?? null,
      action: ap.action,
      tool: payload.tool ?? ap.intent?.tool ?? null,
      description: ap.intent?.description ?? null,
      amountMinor: ap.amountMinor?.toString() ?? null,
      currency: ap.currency ?? null,
      merchant: payload.merchant ?? null,
      toWalletLabel: payload.toWalletLabel ?? null,
      policyReasons: safeJson<string[]>(ap.intent?.policyReasons, []).filter(Boolean),
      createdAt: ap.createdAt.toISOString(),
      expiresAt: ap.expiresAt?.toISOString() ?? null,
      agentId: ap.requesterType === 'AGENT' ? (ap.requesterId ?? null) : null,
    }
  })

  // Pending value grouped by currency — never fake a cross-currency sum.
  const awaitingByCurrency = new Map<string, bigint>()
  for (const ap of pending) {
    if (ap.amountMinor !== null && ap.currency) {
      awaitingByCurrency.set(
        ap.currency,
        (awaitingByCurrency.get(ap.currency) ?? BigInt(0)) + ap.amountMinor
      )
    }
  }
  const awaitingValue =
    awaitingByCurrency.size > 0 ? (
      <span className="flex flex-wrap items-baseline gap-x-2">
        {[...awaitingByCurrency.entries()].map(([currency, minor]) => (
          <MoneyText key={currency} minor={minor} currency={currency} />
        ))}
      </span>
    ) : (
      '—'
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="The human-in-the-loop queue. When an agent proposes an intent above its approval threshold, the deterministic policy engine escalates it here — nothing executes until a human decides. Every decision lands on the audit hash-chain."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Pending decisions"
          value={pending.length}
          deltaLabel="escalated by policy"
          icon={<Hourglass className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Value awaiting decision"
          value={awaitingValue}
          deltaLabel="held at the gate, not on rails"
          icon={<Clock3 className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Approved"
          value={approvedCount}
          deltaLabel="executed on the ledger"
          icon={<ThumbsUp className="h-4 w-4" aria-hidden />}
        />
        <KpiCard
          label="Declined"
          value={declinedCount}
          deltaLabel="nothing moved"
          icon={<ThumbsDown className="h-4 w-4" aria-hidden />}
        />
      </div>

      <section aria-labelledby="pending-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <ShieldQuestion className="h-4 w-4 text-primary" aria-hidden />
          <h2 id="pending-heading" className="text-base font-semibold">
            Awaiting your decision
          </h2>
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning tabular-nums">
            {pending.length}
          </span>
        </div>

        {pendingViews.length === 0 ? (
          <EmptyState
            icon={<CheckSquare className="h-6 w-6" aria-hidden />}
            title="No approvals pending — agents are operating within their autonomous limits."
            description="Propose an intent above an agent's approval threshold from its console page and it will land here for a human decision."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pendingViews.map((view) => (
              <ApprovalCard key={view.id} approval={view} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="history-heading" className="space-y-4">
        <h2 id="history-heading" className="text-base font-semibold">
          Decision history
        </h2>
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Every human decision, permanently recorded
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {decided.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={<Clock3 className="h-6 w-6" aria-hidden />}
                  title="No decisions recorded yet"
                  description="Approve or decline a request above to start the history — decisions and notes are written to the tamper-evident audit chain."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Requester</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Decided by</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {decided.map((ap) => (
                      <TableRow key={ap.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {ap.requesterLabel ?? '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {titleCase(ap.action)}
                        </TableCell>
                        <TableCell className="text-right">
                          {ap.amountMinor !== null && ap.currency ? (
                            <MoneyText minor={ap.amountMinor} currency={ap.currency} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ApprovalStatusBadge status={ap.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {ap.decidedByName ?? '—'}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <p className="truncate text-xs text-muted-foreground" title={ap.decisionNote ?? undefined}>
                            {ap.decisionNote ?? '—'}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                          {ap.decidedAt ? fmtDateTime(ap.decidedAt) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
