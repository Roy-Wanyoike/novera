import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApiKey, okJson, errorJson, parseLimit } from '../_lib/auth'
import { serializeTransaction } from '../_lib/serialize'

/**
 * GET /api/v1/transactions?limit= — recent ledger transactions with their
 * balanced double-entry lines. This is the authoritative money trail.
 * Scope: wallets:read | balances:read
 */
export async function GET(req: NextRequest) {
  return withApiKey(req, ['wallets:read', 'balances:read'], async (key) => {
    const limit = parseLimit(new URL(req.url).searchParams.get('limit'), 25, 100)
    if (limit === null) {
      return errorJson(400, 'INVALID_ARGUMENT', 'Query parameter "limit" must be an integer between 1 and 100.')
    }

    const txns = await db.ledgerTransaction.findMany({
      where: { organizationId: key.organizationId },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        entries: {
          orderBy: { direction: 'asc' },
          include: { account: { select: { code: true, name: true, type: true, isSystemAccount: true } } },
        },
      },
    })

    return okJson({
      transactions: txns.map(serializeTransaction),
      count: txns.length,
    })
  })
}
