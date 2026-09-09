import { NextResponse } from 'next/server'

/** GET /api/v1/health — public liveness probe (no auth, no logging). */
export async function GET() {
  return NextResponse.json({
    data: {
      status: 'ok',
      mode: 'TEST',
      time: new Date().toISOString(),
      service: 'novera-api',
      version: 'v1',
    },
  })
}
