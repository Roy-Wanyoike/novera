'use client'

import { useTransition } from 'react'
import { activateRule, archiveRule } from './actions'
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
import { Archive, CheckCheck, Loader2 } from 'lucide-react'

export function RuleActions({
  ruleId,
  name,
  status,
}: {
  ruleId: string
  name: string
  status: string
}) {
  const [isPending, startTransition] = useTransition()

  function handleActivate() {
    startTransition(async () => {
      const result = await activateRule(ruleId)
      if (result.ok) {
        toast({
          title: 'Rule activated',
          description: `"${name}" now executes on matching settlements. The approval is recorded in the audit chain.`,
        })
      } else {
        toast({ title: 'Activation failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveRule(ruleId)
      if (result.ok) {
        toast({
          title: 'Rule archived',
          description: `"${name}" will no longer execute. Existing ledger history is preserved.`,
        })
      } else {
        toast({ title: 'Archive failed', description: result.error, variant: 'destructive' })
      }
    })
  }

  return (
    <div className="flex justify-end gap-2">
      {status === 'DRAFT' ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="mr-2 h-3.5 w-3.5" />}
              Approve & activate
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve activation of “{name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                Once active, this rule executes on every matching settlement — money moves across wallets exactly as
                allocated, with no further confirmation step. Your name will be recorded as the approver in the
                tamper-evident audit chain.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleActivate}>Approve & activate</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {status !== 'ARCHIVED' ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" disabled={isPending} className="text-muted-foreground hover:text-danger">
              <Archive className="mr-2 h-3.5 w-3.5" />
              Archive
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive “{name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The rule stops executing immediately. Posted split history stays in the ledger untouched — archiving
                never rewrites the past.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleArchive}>Archive rule</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}
