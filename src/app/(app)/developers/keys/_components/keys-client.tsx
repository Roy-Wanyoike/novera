'use client'

import { useState, useTransition } from 'react'
import { KeyRound, Loader2, Plus, ShieldAlert, ShieldOff } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { timeAgo } from '@/lib/format'
import { CopyButton } from '@/components/novera/copy-button'
import { EmptyState } from '@/components/novera/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export interface KeyRow {
  id: string
  name: string
  mode: string
  prefix: string
  lastFour: string
  scopes: string[]
  requestCount: number
  lastUsedAt: string | null
  status: string
  createdAt: string
}

const ALL_SCOPES = ['payments:write', 'wallets:read', 'balances:read', 'transfers:write', 'webhooks:manage'] as const

function ModeBadge({ mode }: { mode: string }) {
  return mode === 'LIVE' ? (
    <Badge variant="outline" className="font-mono text-[10px] text-warning border-warning/30 bg-warning/10">LIVE</Badge>
  ) : (
    <Badge variant="outline" className="font-mono text-[10px] text-success border-success/25 bg-success/10">TEST</Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  return status === 'ACTIVE' ? (
    <Badge variant="outline" className="text-[10px] text-success border-success/25 bg-success/10">ACTIVE</Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">REVOKED</Badge>
  )
}

export function KeysClient({ rows }: { rows: KeyRow[] }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<KeyRow | null>(null)
  const [createdSecret, setCreatedSecret] = useState<{ name: string; mode: string; secret: string; scopes: string[] } | null>(null)

  // create form state
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'TEST' | 'LIVE'>('TEST')
  const [scopes, setScopes] = useState<string[]>(['wallets:read'])
  const [creating, setCreating] = useState(false)
  const [revoking, startRevoking] = useTransition()

  async function handleCreate() {
    if (scopes.length === 0) {
      toast({ title: 'Select at least one scope', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const { createKeyAction } = await import('../actions')
      const res = await createKeyAction({ name, mode, scopes })
      if (!res.ok || !res.key) {
        toast({ title: 'Could not create key', description: res.error, variant: 'destructive' })
        return
      }
      setCreatedSecret({ name: res.key.name, mode: res.key.mode, secret: res.key.secret, scopes: res.key.scopes })
      setCreateOpen(false)
      setName('')
      setScopes(['wallets:read'])
      toast({ title: `Key “${res.key.name}” created`, description: 'Copy the secret now — it is shown only once.' })
    } finally {
      setCreating(false)
    }
  }

  function handleRevoke() {
    const target = revokeTarget
    if (!target) return
    startRevoking(async () => {
      const { revokeKeyAction } = await import('../actions')
      const res = await revokeKeyAction(target.id)
      if (res.ok) {
        toast({ title: `Key “${target.name}” revoked`, description: 'Requests using it will now receive 401.' })
      } else {
        toast({ title: 'Revoke failed', description: res.error, variant: 'destructive' })
      }
      setRevokeTarget(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Create key
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-5 w-5" aria-hidden />}
          title="No API keys yet"
          description="Create a key to authenticate requests against /api/v1. Start with a TEST key and the wallets:read scope."
        />
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((k) => {
                const masked = `${k.prefix}…${k.lastFour}`
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell><ModeBadge mode={k.mode} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <code className="font-mono text-xs">{masked}</code>
                        <CopyButton value={masked} label={undefined} className="h-6 w-6 px-0" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-64 flex-wrap gap-1">
                        {k.scopes.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          k.scopes.map((s) => (
                            <Badge key={s} variant="outline" className="font-mono text-[9px] text-muted-foreground">
                              {s}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{k.requestCount.toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'never'}
                    </TableCell>
                    <TableCell><StatusBadge status={k.status} /></TableCell>
                    <TableCell className="text-right">
                      {k.status === 'ACTIVE' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-danger hover:text-danger hover:bg-danger/10"
                          onClick={() => setRevokeTarget(k)}
                          aria-label={`Revoke key ${k.name}`}
                        >
                          <ShieldOff className="mr-1 h-3.5 w-3.5" aria-hidden />
                          Revoke
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create key dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The secret is displayed once. Only its sha256 hash is stored server-side.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Checkout backend"
                maxLength={60}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-mode">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v === 'LIVE' ? 'LIVE' : 'TEST')}>
                <SelectTrigger id="key-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEST">TEST — sandbox rails (recommended)</SelectItem>
                  <SelectItem value="LIVE">LIVE — production scopes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Scopes</legend>
              <div className="grid gap-2">
                {ALL_SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox
                      checked={scopes.includes(s)}
                      onCheckedChange={(checked) =>
                        setScopes((prev) => (checked ? [...prev, s] : prev.filter((x) => x !== s)))
                      }
                      aria-label={`Scope ${s}`}
                    />
                    <code className="font-mono text-xs">{s}</code>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">A key needs at least one scope. Write scopes imply read for the same family.</p>
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || name.trim().length === 0}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Secret shown once */}
      <AlertDialog open={createdSecret !== null} onOpenChange={(open) => !open && setCreatedSecret(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-warning" aria-hidden />
              Store this secret now
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This is the only time the full key for{' '}
                  <strong>{createdSecret?.name}</strong> ({createdSecret?.mode}) is shown. Only the sha256 hash is
                  persisted — if you lose it, revoke the key and create a new one.
                </p>
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs">{createdSecret?.secret}</code>
                  {createdSecret ? <CopyButton value={createdSecret.secret} label="Copy" /> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {createdSecret?.scopes.map((s) => (
                    <Badge key={s} variant="outline" className="font-mono text-[9px] text-muted-foreground">{s}</Badge>
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

      {/* Revoke confirm */}
      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke “{revokeTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Applications using this key will immediately receive 401 UNAUTHENTICATED. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep key</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
