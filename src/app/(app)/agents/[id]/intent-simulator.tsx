'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FlaskConical,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MoneyText } from '@/components/novera/money-text'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { simulateAgentIntent, type SimulatorResult } from '../actions'
import { AGENT_TOOLS_LIST, TOOL_LABELS, isMoneyTool } from '../labels'

interface IntentSimulatorProps {
  agentId: string
  agentName: string
  agentEmoji: string
  agentStatus: string
  scopes: string[]
  baseCurrency: string
}

function ResultPanel({ result }: { result: SimulatorResult }) {
  const reasons = (result.policyReasons ?? []).filter(Boolean)

  if (!result.ok) {
    return (
      <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-4" role="alert">
        <p className="flex items-center gap-2 text-sm font-medium text-danger">
          <XCircle className="h-4 w-4" aria-hidden />
          Simulation failed
        </p>
        <p className="text-xs text-danger/90">{result.error}</p>
      </div>
    )
  }

  const shell =
    result.status === 'EXECUTED'
      ? 'border-success/40 bg-success/10'
      : result.status === 'PENDING_APPROVAL'
        ? 'border-warning/40 bg-warning/10'
        : 'border-danger/40 bg-danger/10'

  const icon =
    result.status === 'EXECUTED' ? (
      <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
    ) : result.status === 'PENDING_APPROVAL' ? (
      <Clock3 className="h-4 w-4 text-warning" aria-hidden />
    ) : (
      <ShieldAlert className="h-4 w-4 text-danger" aria-hidden />
    )

  const headline =
    result.status === 'EXECUTED'
      ? 'Policy ALLOW — intent executed on the ledger'
      : result.status === 'PENDING_APPROVAL'
        ? 'Policy REQUIRE_APPROVAL — escalated to a human'
        : result.status === 'POLICY_DENIED'
          ? 'Policy DECLINE — nothing moved'
          : result.status === 'EXECUTION_FAILED'
            ? 'Execution failed — the policy allowed it, the ledger did not'
            : result.status === 'REJECTED'
              ? 'Rejected by a human decision'
              : `Intent ${(result.status ?? 'recorded').toLowerCase().replace(/_/g, ' ')}`

  return (
    <div className={cn('space-y-3 rounded-lg border p-4', shell)} role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium">{icon}{headline}</p>

      <p className="text-xs text-muted-foreground">
        The deterministic policy engine evaluated this intent against the agent&apos;s guardrails —
        no LLM judgment was involved in the decision.
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {result.amountMinor ? (
          <span className="tabular">
            <MoneyText minor={result.amountMinor} currency={result.currency ?? 'KES'} strong />
          </span>
        ) : (
          <span className="text-muted-foreground">non-monetary intent</span>
        )}
        {result.ledgerTransactionId ? (
          <Link
            href={`/transactions?ref=${result.ledgerReference ?? result.ledgerTransactionId}`}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-primary underline-offset-2 hover:underline"
          >
            ledger entry recorded
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
      </div>

      {reasons.length > 0 ? (
        <ul className="space-y-1 rounded-md border bg-background/60 p-3">
          <li className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Policy engine reasons
          </li>
          {reasons.map((reason, i) => (
            <li
              key={i}
              className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground"
            >
              <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary/60" />
              {reason}
            </li>
          ))}
        </ul>
      ) : null}

      {result.failureReason ? (
        <p className="text-xs text-danger">{result.failureReason}</p>
      ) : null}

      {result.status === 'PENDING_APPROVAL' ? (
        <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
          <Link href="/approvals">
            Open the approval queue
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

/**
 * The interactive demo: propose an intent as the agent and watch the
 * deterministic gate decide — ALLOW executes, REQUIRE_APPROVAL escalates,
 * DECLINE refuses. Actor is labeled as a human at the console.
 */
export function IntentSimulator({
  agentId,
  agentName,
  agentEmoji,
  agentStatus,
  scopes,
  baseCurrency,
}: IntentSimulatorProps) {
  const router = useRouter()
  const [tool, setTool] = useState(scopes[0] ?? AGENT_TOOLS_LIST[0])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [merchant, setMerchant] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SimulatorResult | null>(null)

  const moneyTool = isMoneyTool(tool)

  if (agentStatus !== 'ACTIVE') {
    return (
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4 text-primary" aria-hidden />
            Intent simulator
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Propose an intent as {agentEmoji} {agentName} and watch the policy engine decide.
          </p>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
            This agent is {agentStatus.toLowerCase()} — the policy engine rejects every intent it
            proposes. Resume the agent to simulate proposals.
          </p>
        </CardContent>
      </Card>
    )
  }

  const submit = async () => {
    setResult(null)
    if (description.trim().length < 3) {
      setResult({ ok: false, error: 'Describe the intent (3+ characters) — this is what auditors will read.' })
      return
    }
    if (moneyTool && !amount.trim()) {
      setResult({ ok: false, error: 'Money-moving tools need an amount — enter one to see the ceilings bite.' })
      return
    }
    setSubmitting(true)
    try {
      const res = await simulateAgentIntent(agentId, {
        tool,
        description,
        amountMajor: amount,
        merchant,
        currency: baseCurrency,
      })
      setResult(res)
      if (res.ok) {
        if (res.status === 'EXECUTED') {
          toast({
            title: 'Intent executed on the ledger',
            description: 'Policy ALLOW — posted as a balanced double-entry transaction.',
          })
        } else if (res.status === 'PENDING_APPROVAL') {
          toast({
            title: 'Policy escalated — approval required',
            description: 'An ApprovalRequest is waiting in the human queue.',
          })
        } else {
          toast({
            title: 'Policy denied the intent',
            description: 'The deterministic guardrails refused it — nothing moved.',
            variant: 'destructive',
          })
        }
        router.refresh()
      } else {
        toast({ title: 'Simulation failed', description: res.error, variant: 'destructive' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Simulation failed.'
      setResult({ ok: false, error: message })
      toast({ title: 'Simulation failed', description: message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-primary" aria-hidden />
          Intent simulator
          <span className="text-xs font-normal text-muted-foreground">
            propose an intent as {agentEmoji} {agentName}
          </span>
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Step into the agent&apos;s shoes. The proposal runs through the real deterministic policy
          engine — ALLOW executes on the ledger, amounts above the threshold escalate to a human,
          violations are denied. The audit actor is labeled{' '}
          <span className="font-mono text-[11px]">Console (human simulating agent)</span>.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sim-tool">Tool</Label>
            <Select value={tool} onValueChange={setTool}>
              <SelectTrigger id="sim-tool" className="w-full">
                <SelectValue placeholder="Pick a tool" />
              </SelectTrigger>
              <SelectContent>
                {AGENT_TOOLS_LIST.map((t) => (
                  <SelectItem key={t} value={t}>
                    <span className="flex items-center justify-between gap-3">
                      <span>{TOOL_LABELS[t] ?? t}</span>
                      <span
                        className={cn(
                          'text-[10px]',
                          scopes.includes(t) ? 'text-success' : 'text-muted-foreground/70'
                        )}
                      >
                        {scopes.includes(t) ? 'granted' : 'not granted'}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {scopes.includes(tool)
                ? 'In this agent’s scope — within policy it may pass.'
                : 'Not in this agent’s scope — expect a deterministic DENY.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sim-description">Description</Label>
            <Input
              id="sim-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                moneyTool
                  ? 'e.g. Pay Kikwetu Suppliers for 14 office chairs'
                  : 'e.g. Weekly cash-position summary with forecast'
              }
              maxLength={200}
            />
          </div>

          {moneyTool ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="sim-amount">Amount ({baseCurrency})</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                    {baseCurrency}
                  </span>
                  <Input
                    id="sim-amount"
                    inputMode="decimal"
                    placeholder="38500.00"
                    className="pl-12 tabular-nums"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Try values above the ceilings to watch the gate refuse.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sim-merchant">Merchant</Label>
                <Input
                  id="sim-merchant"
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="e.g. Kikwetu Suppliers"
                  maxLength={80}
                  autoComplete="off"
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void submit()} disabled={submitting} className="gap-2">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Propose intent
          </Button>
          <p className="text-[11px] text-muted-foreground">
            The LLM never decides — the policy engine does, deterministically, every time.
          </p>
        </div>

        {result ? <ResultPanel result={result} /> : null}
      </CardContent>
    </Card>
  )
}
