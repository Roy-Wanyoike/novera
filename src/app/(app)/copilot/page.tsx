import Link from 'next/link'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { walletSummary } from '@/lib/transfers'
import { statusMeta } from '@/lib/format'
import { WALLET_TYPE_META } from '@novera/domain'
import { PageHeader } from '@/components/novera/page-header'
import { MoneyText } from '@/components/novera/money-text'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { CopilotChat, type CopilotChatMessage } from './chat'
import {
  Sparkles,
  MessageSquare,
  Database,
  ShieldCheck,
  TrendingUp,
  HelpCircle,
  ArrowRight,
  Wallet,
} from 'lucide-react'

export const metadata = { title: 'Copilot' }

export default async function CopilotPage() {
  const session = await requireSession()
  const organizationId = session.organization.id

  // History (org-scoped), most recent 60 messages, oldest first for rendering.
  const rows = await db.copilotMessage.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 60,
  })
  const initialMessages: CopilotChatMessage[] = rows
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolName: m.toolName,
      grounding: m.grounding,
      createdAt: m.createdAt.toISOString(),
    }))

  // Current balances for the context panel (BigInt → string for the client boundary).
  // (walletSummary's evolving-array return is cast to a concrete row shape here.)
  interface WalletPanelRow {
    label: string
    type: string
    currency: string
    availableMinor: bigint
  }
  const wallets = (await walletSummary(organizationId)) as WalletPanelRow[]
  const balanceRows = wallets.map((w) => ({
    label: w.label,
    typeLabel: statusMeta(WALLET_TYPE_META, w.type).label,
    currency: w.currency,
    availableMinor: w.availableMinor.toString(),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
              <Sparkles className="h-4.5 w-4.5 text-primary" aria-hidden />
            </span>
            Financial Copilot
          </span>
        }
        description="Ask anything about your organization's money. Answers come from deterministic, org-scoped ledger queries — the model never touches the database."
        actions={
          <Badge variant="outline" className="border-success/25 bg-success/10 font-medium text-success">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            Grounded in your ledger
          </Badge>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <CopilotChat initialMessages={initialMessages} />

        {/* Context panel */}
        <aside className="flex flex-col gap-4" aria-label="Copilot context">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                How this works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 py-4">
              <ol className="space-y-3.5">
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium">1 · You ask</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Any question about balances, invoices, payments or projections.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                    <Database className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium">2 · AI proposes, tools answer</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      The model only routes your question to a deterministic query tool. It never queries the
                      ledger itself.
                    </p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium">3 · Every answer is grounded</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Prose is written from tool output only, and each reply carries its provenance chip.
                    </p>
                  </div>
                </li>
              </ol>
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5">
                <p className="text-[11px] font-medium leading-relaxed text-primary">
                  “AI proposes. Policy authorizes. The ledger records.”
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wallet className="h-4 w-4 text-primary" aria-hidden />
                Current balances
              </CardTitle>
              <CardAction>
                <Link
                  href="/wallets"
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  Wallets
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="py-2">
              {balanceRows.length === 0 ? (
                <p className="px-1 py-3 text-xs text-muted-foreground">No wallets provisioned.</p>
              ) : (
                <ul className="scroll-thin max-h-64 divide-y overflow-y-auto">
                  {balanceRows.map((w) => (
                    <li key={`${w.label}-${w.currency}`} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{w.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {w.typeLabel} · {w.currency}
                        </p>
                      </div>
                      <MoneyText minor={w.availableMinor} currency={w.currency} strong className="text-xs" />
                    </li>
                  ))}
                </ul>
              )}
              <p className="pt-2 text-[10px] leading-relaxed text-muted-foreground">
                Available = ledger balance − active holds. Pending settlement is never shown as available.
              </p>
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-sm">Provenance badges</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 py-4">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-success/25 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                  <ShieldCheck className="h-3 w-3" aria-hidden />
                  Grounded
                </span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Every figure derived from ledger rows. No model invention.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                  <TrendingUp className="h-3 w-3" aria-hidden />
                  Estimated
                </span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Projection from trailing flows — explicitly labelled.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <HelpCircle className="h-3 w-3" aria-hidden />
                  General
                </span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Conversational answer — not ledger-derived, no numbers quoted.
                </p>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
