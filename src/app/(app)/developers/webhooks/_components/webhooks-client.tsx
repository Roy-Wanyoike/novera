'use client'

import { useState } from 'react'
import { Eye, EyeOff, Loader2, Pause, Play, Plus, RotateCcw, ShieldAlert, ShieldCheck, Trash2, Webhook as WebhookIcon } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { timeAgo } from '@/lib/format'
import { EVENT_NAMES } from '@novera/events'
import { CopyButton, CodeBlock } from '@/components/novera/copy-button'
import { EmptyState } from '@/components/novera/empty-state'
import { ToneBadge } from '@/components/novera/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

export interface EndpointRow {
  id: string
  url: string
  description: string | null
  events: string[]
  status: string
  secret: string
  createdAt: string
}

export interface DeliveryRow {
  id: string
  event: string
  endpointUrl: string
  status: string
  attempts: number
  responseCode: number | null
  payload: string
  signature: string
  nextAttemptAt: string | null
  deliveredAt: string | null
  createdAt: string
}

const DELIVERY_STATUS_TONE: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = {
  DELIVERED: 'positive',
  FAILED: 'warning',
  DEAD: 'negative',
  PENDING: 'neutral',
}

function maskSecret(secret: string): string {
  return `${secret.slice(0, 12)}${'•'.repeat(8)}${secret.slice(-4)}`
}

export function WebhooksClient({
  endpoints,
  deliveries,
  demoSignature,
}: {
  endpoints: EndpointRow[]
  deliveries: DeliveryRow[]
  demoSignature: { secret: string; timestamp: string; payload: string; signature: string }
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [addOpen, setAddOpen] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<{ url: string; secret: string; events: string[] } | null>(null)
  const [payloadView, setPayloadView] = useState<DeliveryRow | null>(null)
  const [replayingId, setReplayingId] = useState<string | null>(null)

  // endpoint management
  const [busyEndpointId, setBusyEndpointId] = useState<string | null>(null)

  // add-endpoint form
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [events, setEvents] = useState<string[]>(['payment.settled'])
  const [adding, setAdding] = useState(false)

  // signature verifier
  const [vSecret, setVSecret] = useState(demoSignature.secret)
  const [vTimestamp, setVTimestamp] = useState(demoSignature.timestamp)
  const [vPayload, setVPayload] = useState(demoSignature.payload)
  const [vSignature, setVSignature] = useState(demoSignature.signature)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; error?: string } | null>(null)

  async function handleAddEndpoint() {
    setAdding(true)
    try {
      const { addEndpointAction } = await import('../actions')
      const res = await addEndpointAction({ url, description, events })
      if (!res.ok || !res.endpoint) {
        toast({ title: 'Could not add endpoint', description: res.error, variant: 'destructive' })
        return
      }
      setCreatedSecret({ url: res.endpoint.url, secret: res.endpoint.secret, events: res.endpoint.events })
      setAddOpen(false)
      setUrl('')
      setDescription('')
      setEvents(['payment.settled'])
      toast({ title: 'Endpoint registered', description: 'Copy the signing secret now — it is shown only once.' })
    } finally {
      setAdding(false)
    }
  }

  async function handleToggleEndpoint(endpoint: EndpointRow, status: 'ACTIVE' | 'PAUSED') {
    setBusyEndpointId(endpoint.id)
    try {
      const { setEndpointStatusAction } = await import('../actions')
      const res = await setEndpointStatusAction(endpoint.id, status)
      if (!res.ok) {
        toast({ title: 'Could not update endpoint', description: res.error, variant: 'destructive' })
        return
      }
      toast({
        title: status === 'PAUSED' ? 'Endpoint disabled' : 'Endpoint enabled',
        description:
          status === 'PAUSED'
            ? 'Deliveries to this URL are paused — events will not be sent until it is enabled.'
            : `${endpoint.url} is receiving events again.`,
      })
    } finally {
      setBusyEndpointId(null)
    }
  }

  async function handleDeleteEndpoint(endpoint: EndpointRow) {
    setBusyEndpointId(endpoint.id)
    try {
      const { deleteEndpointAction } = await import('../actions')
      const res = await deleteEndpointAction(endpoint.id)
      if (!res.ok) {
        toast({ title: 'Could not delete endpoint', description: res.error, variant: 'destructive' })
        return
      }
      toast({
        title: 'Endpoint deleted',
        description: 'Its delivery history was removed with it; the deletion is on the audit chain.',
      })
    } finally {
      setBusyEndpointId(null)
    }
  }

  async function handleReplay(d: DeliveryRow) {
    setReplayingId(d.id)
    try {
      const { replayDeliveryAction } = await import('../actions')
      const res = await replayDeliveryAction(d.id)
      if (!res.ok) {
        toast({ title: 'Replay failed', description: res.error, variant: 'destructive' })
        return
      }
      if (res.delivered) {
        toast({ title: 'Replayed successfully', description: `${d.event} was delivered again (HTTP 200).` })
      } else {
        toast({ title: 'Replay attempted', description: `${d.event} retry failed (HTTP 500) — attempts incremented.`, variant: 'destructive' })
      }
    } finally {
      setReplayingId(null)
    }
  }

  async function handleVerify() {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const { verifySignatureAction } = await import('../actions')
      const res = await verifySignatureAction({
        secret: vSecret,
        timestamp: vTimestamp,
        payload: vPayload,
        signature: vSignature,
      })
      setVerifyResult(res)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Endpoints ─────────────────────────────────────────── */}
      <section className="space-y-4" aria-label="Webhook endpoints">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Endpoints</h2>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Add endpoint
          </Button>
        </div>

        {endpoints.length === 0 ? (
          <EmptyState
            icon={<WebhookIcon className="h-5 w-5" aria-hidden />}
            title="No webhook endpoints"
            description="Register an HTTPS URL to receive signed events whenever payments settle, invoices get paid, risk reviews trigger and more."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {endpoints.map((e) => (
              <div key={e.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <code className="min-w-0 break-all font-mono text-xs" title={e.url}>{e.url}</code>
                  <ToneBadge tone={e.status === 'ACTIVE' ? 'positive' : 'neutral'}>{e.status}</ToneBadge>
                </div>
                {e.description ? <p className="mt-1 text-xs text-muted-foreground">{e.description}</p> : null}
                <div className="mt-3 flex flex-wrap gap-1">
                  {e.events.map((ev) => (
                    <Badge key={ev} variant="outline" className={cn('font-mono text-[9px]', ev === '*' ? 'text-primary border-primary/30' : 'text-muted-foreground')}>
                      {ev}
                    </Badge>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-1 border-t pt-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {revealed[e.id] ? e.secret : maskSecret(e.secret)}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 px-0"
                    onClick={() => setRevealed((r) => ({ ...r, [e.id]: !r[e.id] }))}
                    aria-label={revealed[e.id] ? 'Hide signing secret' : 'Reveal signing secret'}
                  >
                    {revealed[e.id] ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                  </Button>
                  {revealed[e.id] ? <CopyButton value={e.secret} className="h-7 w-7 px-0" /> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  {busyEndpointId === e.id ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      Working…
                    </span>
                  ) : e.status === 'ACTIVE' ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          aria-label={`Disable endpoint ${e.url}`}
                        >
                          <Pause className="h-3.5 w-3.5" aria-hidden />
                          Disable
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Disable this endpoint?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Events will stop being delivered to{' '}
                            <span className="break-all font-mono text-xs">{e.url}</span> until it is
                            re-enabled. Future events are not queued — check your systems after
                            resuming. The endpoint, secret and delivery history are kept.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep active</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void handleToggleEndpoint(e, 'PAUSED')}>
                            Disable endpoint
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => void handleToggleEndpoint(e, 'ACTIVE')}
                      aria-label={`Enable endpoint ${e.url}`}
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden />
                      Enable
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 border-danger/40 px-2 text-xs text-danger hover:bg-danger/10 hover:text-danger"
                        aria-label={`Delete endpoint ${e.url}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <Trash2 className="h-5 w-5 text-danger" aria-hidden />
                          Delete this endpoint?
                        </AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-2">
                            <span className="block">
                              <span className="break-all font-mono text-xs">{e.url}</span> will be
                              removed permanently, together with its entire delivery history and its
                              signing secret. Events will no longer be sent to this URL.
                            </span>
                            <span className="block">
                              The deletion is recorded on the tamper-evident audit chain, but it
                              cannot be undone — re-registering the URL generates a new secret.
                            </span>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep endpoint</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-danger text-white hover:bg-danger/90"
                          onClick={() => void handleDeleteEndpoint(e)}
                        >
                          Delete endpoint
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Deliveries ────────────────────────────────────────── */}
      <section className="space-y-4" aria-label="Webhook deliveries">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent deliveries</h2>
        {deliveries.length === 0 ? (
          <EmptyState
            icon={<WebhookIcon className="h-5 w-5" aria-hidden />}
            title="No deliveries yet"
            description="Events are delivered as money moves through the kernel — create a payment to see the first one."
          />
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-96 overflow-y-auto scroll-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead className="text-right">HTTP</TableHead>
                    <TableHead>Next retry</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="w-40 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <code className="font-mono text-xs">{d.event}</code>
                      </TableCell>
                      <TableCell className="max-w-44 truncate text-xs text-muted-foreground" title={d.endpointUrl}>
                        {d.endpointUrl.replace(/^https?:\/\//, '')}
                      </TableCell>
                      <TableCell>
                        <ToneBadge tone={DELIVERY_STATUS_TONE[d.status] ?? 'neutral'}>{d.status}</ToneBadge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{d.attempts}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {d.responseCode === null ? '—' : (
                          <span className={d.responseCode < 400 ? 'text-success' : 'text-danger'}>{d.responseCode}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {d.nextAttemptAt ? timeAgo(d.nextAttemptAt).replace(' ago', '') : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {timeAgo(d.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setPayloadView(d)}>
                            Payload
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => handleReplay(d)}
                            disabled={replayingId === d.id}
                            aria-label={`Replay ${d.event} delivery`}
                          >
                            {replayingId === d.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                            )}
                            Replay
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>

      {/* ── Signature verifier ────────────────────────────────── */}
      <section className="space-y-4" aria-label="Signature verifier">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Signature verifier</h2>
        <div className="rounded-lg border p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-semibold">Verify before you trust</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Deliveries are signed with HMAC-SHA256 over{' '}
                <code className="rounded bg-muted px-1 font-mono">{'${timestamp}.${body}'}</code> using the endpoint
                secret. Paste a real delivery — or start from the pre-filled example and tamper with the payload to see
                verification fail.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="verify-secret">Signing secret</Label>
                <Input id="verify-secret" value={vSecret} onChange={(e) => setVSecret(e.target.value)} className="font-mono text-xs" autoComplete="off" spellCheck={false} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="verify-timestamp">Timestamp (unix seconds)</Label>
                <Input id="verify-timestamp" value={vTimestamp} onChange={(e) => setVTimestamp(e.target.value)} className="font-mono text-xs" autoComplete="off" spellCheck={false} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="verify-signature">Signature (hex)</Label>
                <Input id="verify-signature" value={vSignature} onChange={(e) => setVSignature(e.target.value)} className="font-mono text-xs" autoComplete="off" spellCheck={false} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="verify-payload">Payload (raw body)</Label>
              <Textarea
                id="verify-payload"
                value={vPayload}
                onChange={(e) => setVPayload(e.target.value)}
                rows={11}
                className="scroll-thin font-mono text-xs"
                spellCheck={false}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={handleVerify} disabled={verifying}>
              {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-2 h-4 w-4" aria-hidden />}
              Verify signature
            </Button>
            {verifyResult ? (
              verifyResult.valid ? (
                <span className="inline-flex items-center gap-2 rounded-md border border-success/25 bg-success/10 px-3 py-1.5 text-sm font-medium text-success" role="status">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  VALID — payload is authentic
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-md border border-danger/25 bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger" role="alert">
                  <ShieldAlert className="h-4 w-4" aria-hidden />
                  INVALID{verifyResult.error ? ` — ${verifyResult.error}` : ' — signature does not match'}
                </span>
              )
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Add endpoint dialog ───────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add webhook endpoint</DialogTitle>
            <DialogDescription>
              Events matching your selection are POSTed to this URL with an HMAC-SHA256 signature. The signing secret is
              shown once after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wh-url">URL (HTTPS)</Label>
              <Input
                id="wh-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.yourapp.com/hooks/novera"
                type="url"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wh-desc">Description (optional)</Label>
              <Input
                id="wh-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Production order events"
                maxLength={200}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Events</legend>
              <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto scroll-thin pr-1 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
                  <Checkbox
                    checked={events.includes('*')}
                    onCheckedChange={(checked) => setEvents((prev) => (checked ? ['*'] : prev.filter((x) => x !== '*')))}
                    aria-label="All events"
                  />
                  <code className="font-mono text-xs text-primary">* (all events)</code>
                </label>
                {EVENT_NAMES.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox
                      checked={events.includes(ev)}
                      onCheckedChange={(checked) =>
                        setEvents((prev) => {
                          const withoutStar = prev.filter((x) => x !== '*' && x !== ev)
                          return checked ? [...withoutStar, ev] : withoutStar
                        })
                      }
                      aria-label={`Event ${ev}`}
                    />
                    <code className="truncate font-mono text-xs">{ev}</code>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{events.length} event(s) selected</p>
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddEndpoint} disabled={adding || url.trim().length === 0}>
              {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Register endpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Endpoint secret shown once ────────────────────────── */}
      <AlertDialog open={createdSecret !== null} onOpenChange={(open) => !open && setCreatedSecret(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-warning" aria-hidden />
              Store this signing secret now
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  The signing secret for <strong className="break-all">{createdSecret?.url}</strong> is shown only once.
                  It never leaves this dialog again — losing it means re-registering the endpoint.
                </p>
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs">{createdSecret?.secret}</code>
                  {createdSecret ? <CopyButton value={createdSecret.secret} label="Copy" /> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {createdSecret?.events.map((ev) => (
                    <Badge key={ev} variant="outline" className="font-mono text-[9px] text-muted-foreground">{ev}</Badge>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setCreatedSecret(null)}>I stored it securely</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Payload viewer ───────────────────────────────────── */}
      <Dialog open={payloadView !== null} onOpenChange={(open) => !open && setPayloadView(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="break-all font-mono text-sm">{payloadView?.event}</DialogTitle>
            <DialogDescription>
              The raw POST body for this delivery, with its HMAC-SHA256 signature. Verify{' '}
              <code className="rounded bg-muted px-1 font-mono">{'${timestamp}.${body}'}</code> before trusting it.
            </DialogDescription>
          </DialogHeader>
          {payloadView ? (
            <div className="space-y-3">
              <CodeBlock
                language="json"
                code={(() => {
                  try {
                    return JSON.stringify(JSON.parse(payloadView.payload), null, 2)
                  } catch {
                    return payloadView.payload
                  }
                })()}
              />
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Signature (hex)</p>
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2.5">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground">{payloadView.signature}</code>
                  <CopyButton value={payloadView.signature} className="h-7 w-7 px-0" />
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
