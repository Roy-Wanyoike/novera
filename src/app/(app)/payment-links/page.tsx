import Link from 'next/link'
import { headers } from 'next/headers'
import QRCode from 'qrcode'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { Money } from '@novera/money'
import { fmtDate } from '@/lib/format'
import { PageHeader } from '@/components/novera/page-header'
import { MoneyText } from '@/components/novera/money-text'
import { EmptyState } from '@/components/novera/empty-state'
import { ToneBadge } from '@/components/novera/status-badge'
import { CreateLinkDialog } from './create-link-dialog'
import { LinkRowActions } from './link-actions'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Link2 } from 'lucide-react'

export const metadata = { title: 'Payment Links' }

const TYPE_META: Record<string, { label: string; tone: 'accent' | 'info' | 'warning' | 'neutral'; hint: string }> = {
  FIXED: { label: 'Fixed', tone: 'accent', hint: 'You set the amount' },
  CUSTOM: { label: 'Custom', tone: 'info', hint: 'Customer enters the amount' },
  DONATION: { label: 'Donation', tone: 'warning', hint: 'Customer chooses any amount' },
  TIP: { label: 'Tip', tone: 'neutral', hint: 'Customer chooses any amount' },
}

const ZERO = BigInt(0)

/** Absolute origin from request headers — used for scannable QR payloads. */
async function requestOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export default async function PaymentLinksPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  const links = await db.paymentLink.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: 'desc' },
  })

  const origin = await requestOrigin()
  const qrByToken: Record<string, string> = {}
  for (const link of links) {
    try {
      qrByToken[link.token] = await QRCode.toDataURL(`${origin}/pay/${link.token}`, {
        margin: 1,
        width: 320,
        color: { dark: '#101010', light: '#ffffff' },
      })
    } catch {
      // QR generation is best-effort; the dialog shows the URL as fallback.
    }
  }

  const activeCount = links.filter((l) => l.status === 'ACTIVE').length
  const totalUses = links.reduce((a, l) => a + l.uses, 0)
  const kesRevenue = links.filter((l) => l.currency === 'KES').reduce((a, l) => a + l.revenueMinor, ZERO)
  const otherRevenue = links
    .filter((l) => l.currency !== 'KES' && l.revenueMinor > ZERO)
    .map((l) => ({ currency: l.currency, minor: l.revenueMinor }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment links"
        description="Shareable, tokenized checkout URLs. Every link runs the full kernel pipeline — risk, rail, ledger, webhooks — with no code required."
        actions={<CreateLinkDialog />}
      />

      <Card>
        <CardHeader>
          <CardTitle>All links</CardTitle>
          <CardDescription>
            {links.length === 0
              ? 'No links yet'
              : `${activeCount} active · ${links.length - activeCount} archived · ${totalUses.toLocaleString()} payments · `}
            {links.length > 0 ? (
              <span className="tabular">
                {[
                  Money.fromMinor(kesRevenue, 'KES').format(),
                  ...otherRevenue.map((r) => Money.fromMinor(r.minor, r.currency).format()),
                ].join(' + ')}{' '}
                collected via links
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {links.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                icon={<Link2 className="h-5 w-5" />}
                title="No payment links yet"
                description="Create a fixed-price product link or a donation-style link where the customer chooses the amount. Each gets a QR code you can print or share."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Link</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Uses</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="pr-6 text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {links.map((link) => {
                    const type = TYPE_META[link.type] ?? {
                      label: link.type,
                      tone: 'neutral' as const,
                      hint: '',
                    }
                    return (
                      <TableRow key={link.id} className={link.status === 'ARCHIVED' ? 'opacity-60' : undefined}>
                        <TableCell className="pl-6">
                          <Link
                            href={`/pay/${link.token}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium hover:underline"
                          >
                            {link.label}
                          </Link>
                          <p className="font-mono text-xs text-muted-foreground">/pay/{link.token}</p>
                        </TableCell>
                        <TableCell>
                          <ToneBadge tone={type.tone}>{type.label}</ToneBadge>
                        </TableCell>
                        <TableCell className="text-right">
                          {link.amountMinor !== null ? (
                            <MoneyText minor={link.amountMinor} currency={link.currency} strong />
                          ) : (
                            <span className="text-xs italic text-muted-foreground">Customer chooses</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular">{link.uses}</TableCell>
                        <TableCell className="text-right">
                          {link.revenueMinor > ZERO ? (
                            <MoneyText minor={link.revenueMinor} currency={link.currency} />
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ToneBadge tone={link.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                            {link.status === 'ACTIVE' ? 'Active' : 'Archived'}
                          </ToneBadge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDate(link.createdAt)}</TableCell>
                        <TableCell className="pr-6">
                          <LinkRowActions
                            linkId={link.id}
                            token={link.token}
                            label={link.label}
                            status={link.status}
                            qrDataUrl={qrByToken[link.token] ?? null}
                            checkoutUrl={`${origin}/pay/${link.token}`}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
