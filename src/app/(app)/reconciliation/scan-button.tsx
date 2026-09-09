'use client'

import { useState, useTransition } from 'react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw } from 'lucide-react'
import { runReconciliationScanAction } from './actions'

/** Triggers the kernel reconciliation scan and reports the outcome. */
export function ScanButton() {
  const [pending, startTransition] = useTransition()
  const [lastScan, setLastScan] = useState<string | null>(null)

  function runScan() {
    startTransition(async () => {
      const result = await runReconciliationScanAction()
      if (result.ok && result.summary) {
        const { compared, matched, discrepancies, newCases } = result.summary
        setLastScan(
          `${compared} compared · ${matched} matched · ${discrepancies} discrepancies · ${newCases} new cases`
        )
        toast({
          title: 'Reconciliation scan complete',
          description: `${discrepancies} discrepancies found across ${compared} payments (${newCases} new cases opened).`,
        })
      } else {
        toast({ title: 'Scan failed', description: result.message, variant: 'destructive' })
      }
    })
  }

  return (
    <div className="flex flex-col items-start sm:items-end gap-1.5">
      <Button onClick={runScan} disabled={pending} className="gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
        {pending ? 'Scanning…' : 'Run reconciliation scan'}
      </Button>
      {lastScan ? (
        <p className="text-[11px] leading-tight text-muted-foreground">{lastScan}</p>
      ) : (
        <p className="text-[11px] leading-tight text-muted-foreground">
          Compares the ledger against provider statements
        </p>
      )}
    </div>
  )
}
