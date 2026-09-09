import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { walletBalancesForOrg } from '@/lib/ledger'
import { withApiKey, okJson } from '../_lib/auth'
import { serializeWallet, type WalletLike } from '../_lib/serialize'

/**
 * GET /api/v1/wallets — list the organization's wallets with their
 * authoritative double-entry ledger balance (BigInt → decimal string).
 * One grouped query for every balance (no per-wallet N+1).
 * Scope: wallets:read
 */
export async function GET(req: NextRequest) {
  return withApiKey(req, ['wallets:read'], async (key) => {
    const wallets = await db.wallet.findMany({
      where: { organizationId: key.organizationId },
      orderBy: [{ type: 'asc' }, { label: 'asc' }],
    })

    const balances = await walletBalancesForOrg(key.organizationId)
    const data = wallets.map((w) => serializeWallet(w, balances.get(w.id) ?? 0n))

    return okJson({ wallets: data, count: data.length })
  })
}
