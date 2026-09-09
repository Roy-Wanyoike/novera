import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { walletLedgerBalance } from '@/lib/ledger'
import { withApiKey, okJson } from '../_lib/auth'
import { serializeWallet, type WalletLike } from '../_lib/serialize'

/**
 * GET /api/v1/wallets — list the organization's wallets with their
 * authoritative double-entry ledger balance (BigInt → decimal string).
 * Scope: wallets:read
 */
export async function GET(req: NextRequest) {
  return withApiKey(req, ['wallets:read'], async (key) => {
    const wallets = await db.wallet.findMany({
      where: { organizationId: key.organizationId },
      orderBy: [{ type: 'asc' }, { label: 'asc' }],
    })

    const data: ReturnType<typeof serializeWallet>[] = []
    for (const w of wallets) {
      const ledgerMinor = await walletLedgerBalance(w.id)
      data.push(serializeWallet(w, ledgerMinor))
    }

    return okJson({ wallets: data, count: data.length })
  })
}
