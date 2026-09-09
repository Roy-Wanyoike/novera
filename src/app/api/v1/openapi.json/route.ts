import { NextResponse } from 'next/server'
import { openApiSpec } from '../_lib/openapi'

/** GET /api/v1/openapi.json — the machine-readable contract (no auth). */
export async function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      'Cache-Control': 'public, max-age=60',
    },
  })
}
