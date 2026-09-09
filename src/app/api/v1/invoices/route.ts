import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApiKey, okJson, errorJson, parseLimit } from '../_lib/auth'
import { serializeInvoice } from '../_lib/serialize'

/**
 * GET /api/v1/invoices?limit= — org invoices with totals and payment state.
 * Bounded like every other list endpoint (default 25, max 100).
 * Scope: payments:write | wallets:read
 */
export async function GET(req: NextRequest) {
  return withApiKey(req, ['payments:write', 'wallets:read'], async (key) => {
    const url = new URL(req.url)
    const limit = parseLimit(url.searchParams.get('limit'), 25, 100)
    if (limit === null) {
      return errorJson(400, 'INVALID_ARGUMENT', 'Query parameter "limit" must be an integer between 1 and 100.')
    }
    const invoices = await db.invoice.findMany({
      where: { organizationId: key.organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { customer: { select: { id: true, name: true, email: true } } },
    })

    return okJson({
      invoices: invoices.map(serializeInvoice),
      count: invoices.length,
    })
  })
}
