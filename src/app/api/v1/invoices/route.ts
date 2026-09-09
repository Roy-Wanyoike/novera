import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApiKey, okJson } from '../_lib/auth'
import { serializeInvoice } from '../_lib/serialize'

/**
 * GET /api/v1/invoices — org invoices with totals and payment state.
 * Scope: payments:write | wallets:read
 */
export async function GET(req: NextRequest) {
  return withApiKey(req, ['payments:write', 'wallets:read'], async (key) => {
    const invoices = await db.invoice.findMany({
      where: { organizationId: key.organizationId },
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { id: true, name: true, email: true } } },
    })

    return okJson({
      invoices: invoices.map(serializeInvoice),
      count: invoices.length,
    })
  })
}
