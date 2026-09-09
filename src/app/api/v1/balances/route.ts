import type { NextRequest } from 'next/server'
import { walletSummary } from '@/lib/transfers'
import { withApiKey, okJson } from '../_lib/auth'
import { serializeWallet, type WalletLike } from '../_lib/serialize'

interface SummaryRow extends WalletLike {
  ledgerBalanceMinor: bigint
  availableMinor: bigint
  reservedMinor: bigint
  formatted: string
}

/**
 * GET /api/v1/balances — per-currency balances derived from walletSummary:
 * ledger balance vs available (ledger − active holds). Pending funds are
 * never reported as available. Scope: balances:read | wallets:read
 */
export async function GET(req: NextRequest) {
  return withApiKey(req, ['balances:read', 'wallets:read'], async (key) => {
    const wallets = (await walletSummary(key.organizationId)) as SummaryRow[]

    // Aggregate per currency — every amount stays an exact BigInt until
    // the final string conversion.
    const byCurrency = new Map<string, { ledgerMinor: bigint; availableMinor: bigint; walletCount: number }>()
    for (const w of wallets) {
      const cur = byCurrency.get(w.currency) ?? {
        ledgerMinor: BigInt(0),
        availableMinor: BigInt(0),
        walletCount: 0,
      }
      cur.ledgerMinor += w.ledgerBalanceMinor
      cur.availableMinor += w.availableMinor
      cur.walletCount += 1
      byCurrency.set(w.currency, cur)
    }

    const data = [...byCurrency.entries()]
      .map(([currency, b]) => ({
        currency,
        ledgerMinor: b.ledgerMinor.toString(),
        availableMinor: b.availableMinor.toString(),
        reservedMinor: (b.ledgerMinor - b.availableMinor).toString(),
        walletCount: b.walletCount,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency))

    return okJson({ balances: data })
  })
}
