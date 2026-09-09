'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/audit'

/**
 * SETTINGS — organization profile mutations.
 *
 * Only OWNER/ADMIN members may edit the organization profile; every change
 * is written to the tamper-evident audit chain with before/after values.
 * The slug is immutable (it identifies the org), mode changes require a
 * support workflow (TEST→LIVE is a compliance boundary, not a UI toggle).
 */

export type SettingsActionResult = { ok: true } | { ok: false; error: string }

export interface OrganizationProfileInput {
  name: string
  country: string
  timezone: string
}

const TIMEZONE_PATTERN = /^UTC$|^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/

/** True only for timezones the ICU database accepts (no drift, no guesswork). */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-KE', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export async function updateOrganizationProfile(
  input: OrganizationProfileInput
): Promise<SettingsActionResult> {
  const session = await requireSession()
  const orgId = session.organization.id

  if (!['OWNER', 'ADMIN'].includes(session.organization.role)) {
    return { ok: false, error: 'Only owners and admins can change organization settings.' }
  }

  const name = (input.name ?? '').trim()
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: 'Organization name must be 2–80 characters.' }
  }

  const country = (input.country ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) {
    return { ok: false, error: 'Country must be a two-letter ISO code, e.g. KE.' }
  }

  const timezone = (input.timezone ?? '').trim()
  if (!TIMEZONE_PATTERN.test(timezone) || !isValidTimezone(timezone)) {
    return { ok: false, error: 'Enter a valid IANA timezone, e.g. Africa/Nairobi.' }
  }

  const current = await db.organization.findFirst({
    where: { id: orgId },
    select: { name: true, country: true, timezone: true },
  })
  if (!current) {
    return { ok: false, error: 'Organization not found.' }
  }
  if (current.name === name && current.country === country && current.timezone === timezone) {
    return { ok: true }
  }

  await db.organization.update({
    where: { id: orgId },
    data: { name, country, timezone },
  })
  await recordAudit({
    organizationId: orgId,
    actorType: 'USER',
    actorId: session.user.id,
    actorLabel: session.user.name,
    action: 'settings.organization.updated',
    resourceType: 'Organization',
    resourceId: orgId,
    description: `Organization profile updated by ${session.user.name}`,
    metadata: {
      before: { name: current.name, country: current.country, timezone: current.timezone },
      after: { name, country, timezone },
      via: 'settings-ui',
    },
  })
  revalidatePath('/settings')
  return { ok: true }
}
