'use server'

import { requireSession } from '@/lib/session'
import { createApiKey, revokeApiKey } from '@/lib/api-auth'
import { revalidatePath } from 'next/cache'

export const API_SCOPES = [
  'payments:write',
  'wallets:read',
  'balances:read',
  'transfers:write',
  'webhooks:manage',
] as const

export interface CreateKeyResult {
  ok: boolean
  error?: string
  key?: {
    id: string
    name: string
    mode: string
    secret: string // shown exactly once
    prefix: string
    scopes: string[]
  }
}

export async function createKeyAction(input: {
  name: string
  mode: string
  scopes: string[]
}): Promise<CreateKeyResult> {
  const session = await requireSession()
  const name = input.name.trim()
  const mode = input.mode === 'LIVE' ? 'LIVE' : 'TEST'
  const scopes = input.scopes.filter((s) => (API_SCOPES as readonly string[]).includes(s))

  if (name.length < 1 || name.length > 60) {
    return { ok: false, error: 'Key name must be 1–60 characters.' }
  }
  if (scopes.length === 0) {
    return { ok: false, error: 'Select at least one scope.' }
  }
  // NOTE: in this reference environment both modes hit deterministic TEST
  // rails; LIVE simply marks the key's intent and scopes.

  try {
    const key = await createApiKey(session.organization.id, name, mode, scopes, {
      id: session.user.id,
      name: session.user.name,
    })
    revalidatePath('/developers/keys')
    return { ok: true, key }
  } catch (err) {
    console.error('[developers/keys] create failed', err)
    return { ok: false, error: 'Key creation failed. Try again.' }
  }
}

export async function revokeKeyAction(keyId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession()
  try {
    await revokeApiKey(session.organization.id, keyId, {
      id: session.user.id,
      name: session.user.name,
    })
    revalidatePath('/developers/keys')
    return { ok: true }
  } catch (err) {
    console.error('[developers/keys] revoke failed', err)
    return { ok: false, error: 'Revoke failed — key not found or already revoked.' }
  }
}
