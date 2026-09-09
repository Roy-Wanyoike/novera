import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { safeJson } from '@/lib/format'
import { PageHeader } from '@/components/novera/page-header'
import { KeysClient, type KeyRow } from './_components/keys-client'

export const metadata = { title: 'API keys' }

export default async function KeysPage() {
  const session = await requireSession()
  const keys = await db.apiKey.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: 'desc' },
  })

  const rows: KeyRow[] = keys.map((k) => ({
    id: k.id,
    name: k.name,
    mode: k.mode,
    prefix: k.prefix,
    lastFour: k.lastFour,
    scopes: safeJson<string[]>(k.scopes, []),
    requestCount: k.requestCount,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    status: k.status,
    createdAt: k.createdAt.toISOString(),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="API keys"
        description="Bearer keys for the /api/v1 surface. Only the sha256 hash is persisted — the secret is shown once at creation and can never be recovered."
      />
      <KeysClient rows={rows} />
    </div>
  )
}
