'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateOrganizationProfile } from './actions'

/**
 * Curated timezone choices — validated server-side against ICU, so this
 * list is UX, not a security boundary. The org's current timezone is
 * always included even when it is not curated.
 */
const TIMEZONE_CHOICES = [
  'Africa/Nairobi',
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Africa/Kampala',
  'Africa/Dar_es_Salaam',
  'Africa/Kigali',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Singapore',
  'UTC',
]

export function OrganizationForm({
  canEdit,
  initial,
}: {
  canEdit: boolean
  initial: { name: string; country: string; timezone: string }
}) {
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [country, setCountry] = useState(initial.country)
  const [timezone, setTimezone] = useState(initial.timezone)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timezoneOptions = TIMEZONE_CHOICES.includes(initial.timezone)
    ? TIMEZONE_CHOICES
    : [initial.timezone, ...TIMEZONE_CHOICES]
  const dirty = name !== initial.name || country !== initial.country || timezone !== initial.timezone

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const result = await updateOrganizationProfile({ name, country, timezone })
      if (result.ok) {
        toast({
          title: 'Organization updated',
          description: 'The change is recorded on the tamper-evident audit chain.',
        })
        router.refresh()
      } else {
        setError(result.error)
      }
    } catch {
      setError('Unexpected error — please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="org-name">Organization name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending || !canEdit}
            required
            minLength={2}
            maxLength={80}
            autoComplete="organization"
          />
          <p className="text-xs text-muted-foreground">Shown on invoices, checkout pages and receipts.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-country">Country (ISO code)</Label>
          <Input
            id="org-country"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            disabled={pending || !canEdit}
            required
            maxLength={2}
            placeholder="KE"
            className="font-mono uppercase"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">Two letters, e.g. KE, UG, TZ, NG.</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="org-timezone">Reporting timezone</Label>
        <Select
          value={timezone}
          onValueChange={setTimezone}
          disabled={pending || !canEdit}
        >
          <SelectTrigger id="org-timezone" className="h-9 text-sm" aria-label="Reporting timezone">
            <SelectValue placeholder="Select a timezone" />
          </SelectTrigger>
          <SelectContent>
            {timezoneOptions.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Dates across the dashboard currently render in Africa/Nairobi; this value is the org&apos;s
          canonical reporting timezone.
        </p>
      </div>

      {canEdit ? (
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={pending || !dirty} className="gap-1.5">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            Save changes
          </Button>
          {dirty ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => {
              setName(initial.name)
              setCountry(initial.country)
              setTimezone(initial.timezone)
              setError(null)
            }}>
              Reset
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Profile editing is limited to owners and admins — this section is read-only for your
          role.
        </p>
      )}
    </form>
  )
}
