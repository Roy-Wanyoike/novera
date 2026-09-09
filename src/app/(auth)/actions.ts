'use server'

import { redirect } from 'next/navigation'
import { loginUser, createSession, registerUser } from '@/lib/auth'
import { provisionOrganization } from '@/lib/provision'

export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  if (!email || !password) throw new Error('Email and password are required')
  const user = await loginUser(email, password)
  await createSession(user.id)
  redirect('/dashboard')
}

export async function registerAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const organizationName = String(formData.get('organization') ?? '').trim() || `${name}'s Org`
  if (!name || !email || password.length < 8) {
    throw new Error('Name, email and a password of at least 8 characters are required')
  }
  const { user, organization } = await registerUser({ name, email, password, organizationName })
  await provisionOrganization(organization.id)
  await createSession(user.id, organization.id)
  redirect('/dashboard')
}

/**
 * One-click demo login. Returns an error state (never throws) so the demo
 * form can render a friendly inline message when the demo org is missing
 * or the credentials stop matching the seed.
 */
export async function demoLoginAction(): Promise<{ error: string | null }> {
  let userId: string
  try {
    const user = await loginUser('demo@novera.africa', 'novera-demo-2026')
    userId = user.id
  } catch {
    return {
      error:
        'The demo workspace is unavailable in this environment — it may not be seeded. Create an organization below to explore the product.',
    }
  }
  await createSession(userId)
  redirect('/dashboard')
}
