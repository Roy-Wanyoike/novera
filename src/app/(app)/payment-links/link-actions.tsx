'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { CopyButton } from '@/components/novera/copy-button'
import { archiveLinkAction } from './actions'
import { Archive, ExternalLink, Loader2, QrCode } from 'lucide-react'

/**
 * Per-row share controls: copy path, QR dialog (server-rendered data URL),
 * and archive (with confirmation — it stops the public checkout).
 */
export function LinkRowActions({
  linkId,
  token,
  label,
  status,
  qrDataUrl,
  checkoutUrl,
}: {
  linkId: string
  token: string
  label: string
  status: string
  qrDataUrl: string | null
  checkoutUrl: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const path = `/pay/${token}`

  return (
    <div className="flex items-center justify-end gap-1">
      <CopyButton value={path} label="Copy" />

      <Dialog>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={`Show QR code for ${label}`}
          >
            <QrCode className="h-3.5 w-3.5" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>QR code — {label}</DialogTitle>
            <DialogDescription>
              Scan to open the hosted checkout. The QR encodes the full checkout URL.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR code linking to ${checkoutUrl}`}
                width={256}
                height={256}
                className="rounded-lg border bg-white p-2"
              />
            ) : (
              <p className="text-sm text-muted-foreground">QR unavailable — use the link below.</p>
            )}
            <div className="w-full space-y-2">
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <code className="truncate font-mono text-xs">{path}</code>
                <CopyButton value={path} label="Copy path" />
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span className="truncate text-xs text-muted-foreground">{checkoutUrl}</span>
                <CopyButton value={checkoutUrl} label="Copy URL" />
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={path} target="_blank" rel="noreferrer">
                Open checkout
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {status === 'ACTIVE' ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-danger"
              aria-label={`Archive link ${label}`}
              disabled={pending}
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive “{label}”?</AlertDialogTitle>
              <AlertDialogDescription>
                The public checkout at <span className="font-mono text-xs">{path}</span> will stop
                accepting payments immediately. Existing payments are unaffected. This is recorded
                in the audit log.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep active</AlertDialogCancel>
              <AlertDialogAction
                className="bg-danger text-danger-foreground hover:bg-danger/90"
                onClick={() =>
                  startTransition(async () => {
                    const result = await archiveLinkAction(linkId)
                    if (result.ok) {
                      toast({
                        title: `Link "${result.label}" archived`,
                        description: `${result.token} no longer accepts payments.`,
                      })
                      router.refresh()
                    } else {
                      toast({ title: 'Not archived', description: result.error, variant: 'destructive' })
                    }
                  })
                }
              >
                Archive link
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}
