'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { toast } from '@/hooks/use-toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MoneyText } from '@/components/novera/money-text'
import { ReconStatusBadge, ToneBadge } from '@/components/novera/status-badge'
import { EmptyState } from '@/components/novera/empty-state'
import { Scale, CheckCircle2, XCircle } from 'lucide-react'
import { dismissReconCase, resolveReconCase } from './actions'

// ── types (fully serializable — built server-side) ───────────────────

export interface DetailToken {
  kind: 'text' | 'money' | 'mono'
  text: string
  minor?: string
  currency?: string
}

export interface CaseRow {
  id: string
  typeLabel: string
  severity: string
  status: string
  providerName: string
  paymentId: string | null
  paymentReference: string | null
  createdAt: string
  ledgerTokens: DetailToken[] | null
  providerTokens: DetailToken[] | null
  resolutionNote: string | null
  resolvedBy: string | null
  resolvedAt: string | null
}

const MIN_NOTE = 10

// ── small renderers ──────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  switch (severity) {
    case 'CRITICAL':
      return (
        <ToneBadge tone="negative" className="border-danger/40 bg-danger/20 font-semibold">
          Critical
        </ToneBadge>
      )
    case 'HIGH':
      return <ToneBadge tone="negative">High</ToneBadge>
    case 'MEDIUM':
      return <ToneBadge tone="warning">Medium</ToneBadge>
    default:
      return <ToneBadge tone="neutral">Low</ToneBadge>
  }
}

function TokenList({ tokens }: { tokens: DetailToken[] | null }) {
  if (!tokens) return <span className="text-xs text-muted-foreground">no record</span>
  return (
    <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
      {tokens.map((t, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 ? <span className="text-muted-foreground/50" aria-hidden>·</span> : null}
          {t.kind === 'money' ? (
            <MoneyText minor={t.minor ?? '0'} currency={t.currency ?? 'KES'} muted className="text-xs" />
          ) : (
            <span className={t.kind === 'mono' ? 'font-mono text-xs text-muted-foreground' : 'text-xs'}>
              {t.text}
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

function DetailCompare({ ledger, provider }: { ledger: DetailToken[] | null; provider: DetailToken[] | null }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          Ledger
        </span>
        <TokenList tokens={ledger} />
      </div>
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          Provider
        </span>
        <TokenList tokens={provider} />
      </div>
    </div>
  )
}

// ── resolution dialogs ───────────────────────────────────────────────

interface DialogTarget {
  row: CaseRow
  mode: 'resolve' | 'dismiss'
}

function ResolutionDialogs({
  target,
  onClose,
}: {
  target: DialogTarget | null
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [note, setNote] = useState('')

  const mode = target?.mode
  const row = target?.row ?? null
  const valid = note.trim().length >= MIN_NOTE

  function submit() {
    if (!row || !mode) return
    const caseId = row.id
    const value = note
    onClose()
    startTransition(async () => {
      const result =
        mode === 'resolve' ? await resolveReconCase(caseId, value) : await dismissReconCase(caseId, value)
      if (result.ok) {
        toast({
          title: mode === 'resolve' ? 'Case resolved' : 'Case dismissed',
          description: result.message,
        })
      } else {
        toast({ title: 'Action failed', description: result.message, variant: 'destructive' })
      }
    })
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'resolve' ? 'Resolve case' : mode === 'dismiss' ? 'Dismiss case' : ''}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5">
              {row ? (
                <>
                  <span className="block">
                    <span className="font-medium text-foreground">{row.typeLabel}</span> · {row.providerName}
                    {row.paymentReference ? (
                      <>
                        {' '}
                        on <span className="font-mono text-xs">{row.paymentReference}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="block">
                    {mode === 'resolve'
                      ? 'Resolving records your note in the audit trail and marks the provider statement RESOLVED. The ledger itself is never silently rewritten.'
                      : 'Dismissing closes the case as not requiring repair. The reason is recorded in the audit trail.'}
                  </span>
                </>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="recon-note">
            {mode === 'resolve' ? 'Resolution note' : 'Dismissal reason'}
          </Label>
          <Textarea
            id="recon-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              mode === 'resolve'
                ? 'e.g. Confirmed with provider statement export — amount corrected upstream, ledger stands.'
                : 'e.g. Provider confirmed test-rail artifact; no funds involved.'
            }
            rows={3}
            aria-describedby="recon-note-hint"
          />
          <p id="recon-note-hint" className="text-xs text-muted-foreground">
            {note.trim().length}/{MIN_NOTE} characters minimum · written to the tamper-evident audit trail
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || pending}
            variant={mode === 'dismiss' ? 'outline' : 'default'}
            className={mode === 'dismiss' ? 'border-danger/30 text-danger hover:bg-danger/10 hover:text-danger' : ''}
          >
            {pending ? 'Recording…' : mode === 'resolve' ? 'Resolve case' : 'Dismiss case'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── the ops queue ────────────────────────────────────────────────────

export function ReconCases({ queue, history }: { queue: CaseRow[]; history: CaseRow[] }) {
  const [target, setTarget] = useState<DialogTarget | null>(null)
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'RESOLVED' | 'DISMISSED'>('ALL')

  const filteredHistory = history.filter((c) => historyFilter === 'ALL' || c.status === historyFilter)

  function openDialog(row: CaseRow, mode: 'resolve' | 'dismiss') {
    setTarget({ row, mode })
  }

  return (
    <div className="space-y-4">
      {/* key forces a fresh dialog state per target — note/reset included */}
      <ResolutionDialogs
        key={target ? `${target.mode}:${target.row.id}` : 'none'}
        target={target}
        onClose={() => setTarget(null)}
      />

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Open queue ({queue.length})</TabsTrigger>
          <TabsTrigger value="history">History ({history.length})</TabsTrigger>
        </TabsList>

        {/* ── open cases (the ops queue) ── */}
        <TabsContent value="queue" className="mt-4">
          {queue.length === 0 ? (
            <EmptyState
              icon={<Scale className="h-5 w-5" />}
              title="No open cases"
              description="Run a reconciliation scan to compare the ledger against provider statements — discrepancies land here."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Detail · Ledger vs Provider</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Opened</TableHead>
                    <TableHead className="pr-4 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="pl-4">
                        <div className="text-sm font-medium">{c.typeLabel}</div>
                        <ReconStatusBadge status={c.status} />
                      </TableCell>
                      <TableCell>
                        <SeverityBadge severity={c.severity} />
                      </TableCell>
                      <TableCell className="max-w-sm whitespace-normal">
                        <DetailCompare ledger={c.ledgerTokens} provider={c.providerTokens} />
                      </TableCell>
                      <TableCell className="text-sm">{c.providerName}</TableCell>
                      <TableCell>
                        {c.paymentId && c.paymentReference ? (
                          <Link
                            href={`/payments/${c.paymentId}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {c.paymentReference}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {c.createdAt}
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            className="h-8 gap-1.5"
                            onClick={() => openDialog(c, 'resolve')}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                            Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5"
                            onClick={() => openDialog(c, 'dismiss')}
                          >
                            <XCircle className="h-3.5 w-3.5" aria-hidden />
                            Dismiss
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── resolved / dismissed history ── */}
        <TabsContent value="history" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Show:</span>
            <Select
              value={historyFilter}
              onValueChange={(v) => setHistoryFilter(v as 'ALL' | 'RESOLVED' | 'DISMISSED')}
            >
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter history by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All closed</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="DISMISSED">Dismissed</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">
              {filteredHistory.length} of {history.length} shown
            </span>
          </div>

          {filteredHistory.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 className="h-5 w-5" />}
              title="No closed cases yet"
              description="Resolved and dismissed cases accumulate here with their resolution notes and operators."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Type</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="max-w-sm">Resolution</TableHead>
                    <TableHead className="pr-4 text-right">Closed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHistory.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="pl-4 text-sm font-medium">{c.typeLabel}</TableCell>
                      <TableCell>
                        <SeverityBadge severity={c.severity} />
                      </TableCell>
                      <TableCell>
                        <ReconStatusBadge status={c.status} />
                      </TableCell>
                      <TableCell>
                        {c.paymentId && c.paymentReference ? (
                          <Link
                            href={`/payments/${c.paymentId}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {c.paymentReference}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-sm whitespace-normal">
                        <div className="text-xs leading-snug">
                          {c.resolutionNote ?? '—'}
                          {c.resolvedBy ? (
                            <span className="block text-muted-foreground">by {c.resolvedBy}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="pr-4 whitespace-nowrap text-right text-xs text-muted-foreground">
                        {c.resolvedAt ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
