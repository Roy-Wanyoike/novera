import { requireSession } from '@/lib/session'
import { AppShell } from '@/components/app/app-shell'
import { walletLedgerBalance } from '@/lib/ledger'
import { db } from '@/lib/db'
import { formatMinor } from '@novera/money'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession()
  const org = await db.organization.findUnique({
    where: { id: session.organization.id },
    include: { wallets: { where: { type: 'OPERATING' } } },
  })
  const operating = org?.wallets[0]
  const balanceMinor = operating ? await walletLedgerBalance(operating.id) : 0n

  return (
    <AppShell
      user={{
        name: session.user.name,
        email: session.user.email,
        avatarColor: session.user.avatarColor,
        organizationName: session.organization.name,
        organizationMode: session.organization.mode,
        role: session.organization.role,
      }}
      balance={
        operating
          ? { label: `${operating.label} · ${operating.currency}`, formatted: formatMinor(balanceMinor, operating.currency) }
          : null
      }
    >
      {children}
    </AppShell>
  )
}
