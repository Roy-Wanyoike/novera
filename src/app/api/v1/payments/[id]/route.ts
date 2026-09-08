import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withApiKey, okJson, errorJson } from '../../_lib/auth'
import { serializePayment } from '../../_lib/serialize'

/**
 * GET /api/v1/payments/{id} — retrieve a single org-scoped payment.
 * `id` accepts either the internal id or the human reference (pay_xxx).
 * Includes the full timeline, risk evaluation and provider details.
 * Scope: payments:write | wallets:read
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withApiKey(req, ['payments:write', 'wallets:read'], async (key) => {
    const { id } = await ctx.params
    if (!id || id.length > 64) {
      return errorJson(400, 'INVALID_ARGUMENT', 'Invalid payment identifier.')
    }

    const payment = await db.payment.findFirst({
      where: {
        organizationId: key.organizationId,
        OR: [{ id }, { reference: id }],
      },
      include: { provider: true },
    })
    if (!payment) {
      return errorJson(404, 'NOT_FOUND', `No payment found for id/reference "${id}" in this organization.`)
    }

    return okJson(serializePayment(payment))
  })
}
