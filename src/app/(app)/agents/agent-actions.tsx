'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, Loader2, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { revokeAgent, setAgentStatus, type ActionResult } from './actions'

interface AgentActionsProps {
  agentId: string
  name: string
  status: string
  /** Footer-of-card rendering uses small ghost buttons. */
  compact?: boolean
}

/**
 * Pause / resume / revoke controls. Every transition is a server action that
 * re-records audit — the human is always the authority over agent state.
 */
export function AgentActions({ agentId, name, status, compact = false }: AgentActionsProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [revoking, setRevoking] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const busy = pending || revoking

  const run = (fn: () => Promise<ActionResult>, success: { title: string; description?: string }) => {
    startTransition(async () => {
      const res = await fn()
      if (res.ok) {
        toast({ title: success.title, description: success.description })
        router.refresh()
      } else {
        toast({ title: 'Action failed', description: res.error, variant: 'destructive' })
      }
    })
  }

  if (status === 'REVOKED') {
    return (
      <p className="text-xs text-muted-foreground" role="note">
        Revoked — credentials invalidated. Registration of a replacement agent is audited separately.
      </p>
    )
  }

  const toggle = () =>
    run(
      () => setAgentStatus(agentId, status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'),
      status === 'ACTIVE'
        ? {
            title: `${name} paused`,
            description: 'The policy engine now rejects every intent this agent proposes.',
          }
        : {
            title: `${name} resumed`,
            description: 'Intents flow through the deterministic policy gate again.',
          }
    )

  const doRevoke = async () => {
    setRevoking(true)
    try {
      const res = await revokeAgent(agentId)
      if (res.ok) {
        toast({
          title: `${name} revoked`,
          description: 'Credential is dead, intents are rejected, the audit trail is permanent.',
        })
        router.refresh()
      } else {
        toast({ title: 'Revoke failed', description: res.error, variant: 'destructive' })
      }
    } finally {
      setRevoking(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size={compact ? 'sm' : 'default'}
        className={compact ? 'h-8 gap-1.5' : 'gap-2'}
        onClick={toggle}
        disabled={busy}
        aria-label={status === 'ACTIVE' ? `Pause ${name}` : `Resume ${name}`}
      >
        {pending ? (
          <Loader2 className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4', 'animate-spin')} aria-hidden />
        ) : status === 'ACTIVE' ? (
          <Pause className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
        ) : (
          <Play className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
        )}
        {status === 'ACTIVE' ? 'Pause' : 'Resume'}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={compact ? 'sm' : 'default'}
            className={`gap-1.5 text-danger hover:text-danger hover:bg-danger/10 ${compact ? 'h-8' : ''}`}
            disabled={busy}
            aria-label={`Revoke ${name}`}
          >
            <Ban className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
            Revoke
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Revocation is terminal. Its credential dies immediately, every pending intent is frozen
              out of execution, and the action is written to the audit hash-chain. There is no
              un-revoke — you would register a new agent instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Keep agent</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-danger-foreground hover:bg-danger/90"
              disabled={revoking}
              onClick={(e) => {
                e.preventDefault()
                void doRevoke()
              }}
            >
              {revoking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Revoke permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
