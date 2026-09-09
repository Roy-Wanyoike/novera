import { redirect } from 'next/navigation'
import { getSessionUser, type SessionUser } from '@/lib/auth'

/**
 * Server-side session guard for every authenticated route and action.
 * Never trust the client — authorization is resolved per request.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSessionUser()
  if (!session) redirect('/login')
  return session
}

export async function optionalSession(): Promise<SessionUser | null> {
  return getSessionUser()
}
