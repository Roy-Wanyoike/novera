import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/v1/health/ready — readiness probe (public, not logged).
 *
 * Verifies the process can actually serve traffic: the database answers a
 * trivial query. Load balancers and orchestrators gate routing on this
 * endpoint (503 = do not send traffic), while liveness (/api/v1/health)
 * only answers "is the process up" and stays dependency-free.
 */
export async function GET() {
  const startedAt = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json(
      {
        data: {
          status: 'ok',
          probe: 'readiness',
          database: 'ok',
          latencyMs: Date.now() - startedAt,
          service: 'novera-api',
          version: 'v1',
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    console.error('[health/ready] database probe failed:', err)
    return NextResponse.json(
      {
        error: {
          code: 'NOT_READY',
          message: 'The service is not ready to serve traffic (database unreachable).',
          probe: 'readiness',
          database: 'error',
        },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
