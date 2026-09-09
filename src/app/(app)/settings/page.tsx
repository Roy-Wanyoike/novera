import { requireSession } from '@/lib/session'
import { db } from '@/lib/db'
import { fmtDate, fmtDateTime, initials } from '@/lib/format'
import { PageHeader } from '@/components/novera/page-header'
import { ToneBadge } from '@/components/novera/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CalendarDays, FlaskConical, Globe2, LogOut, ShieldCheck, Users } from 'lucide-react'
import { OrganizationForm } from './organization-form'
import { SignOutButton } from './sign-out-button'

export const metadata = { title: 'Settings' }

const ROLE_TONE: Record<string, 'positive' | 'neutral'> = {
  OWNER: 'positive',
  ADMIN: 'positive',
}

export default async function SettingsPage() {
  const session = await requireSession()
  const orgId = session.organization.id

  const [organization, memberships, currentSession] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId } }),
    db.membership.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { name: true, email: true, avatarColor: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.session.findUnique({ where: { id: session.sessionId } }),
  ])

  if (!organization) return null

  const canEdit = ['OWNER', 'ADMIN'].includes(session.organization.role)
  const isTestMode = organization.mode === 'TEST'
  const expiresAt = currentSession?.expiresAt ?? null
  const expiresInDays =
    expiresAt !== null ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)) : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Organization profile, members and your active session. Every profile change is written to the tamper-evident audit chain."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Organization ── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="h-4 w-4 text-primary" aria-hidden />
              Organization
            </CardTitle>
            <CardDescription>
              Profile facts plus the editable fields. The slug identifies the organization and is
              immutable; switching TEST→LIVE is a compliance workflow handled by Novera, not a
              toggle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-4">
              <div className="space-y-0.5">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Slug
                </dt>
                <dd className="font-mono">{organization.slug}</dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Type
                </dt>
                <dd className="truncate">{organization.type.toLowerCase()}</dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Mode
                </dt>
                <dd>
                  <ToneBadge tone={isTestMode ? 'warning' : 'positive'}>{organization.mode}</ToneBadge>
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Created
                </dt>
                <dd className="truncate" title={fmtDateTime(organization.createdAt)}>
                  {fmtDate(organization.createdAt)}
                </dd>
              </div>
            </dl>

            <OrganizationForm
              canEdit={canEdit}
              initial={{
                name: organization.name,
                country: organization.country,
                timezone: organization.timezone,
              }}
            />
          </CardContent>
        </Card>

        {/* ── Session ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
              Session
            </CardTitle>
            <CardDescription>Who is signed in, and for how long the session is valid.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback
                  className="text-xs font-semibold text-white"
                  style={{ backgroundColor: session.user.avatarColor }}
                >
                  {initials(session.user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
              </div>
            </div>

            <dl className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Signed in</dt>
                <dd>{fmtDateTime(currentSession?.createdAt ?? null)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Expires</dt>
                <dd className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {fmtDateTime(expiresAt)}
                  {expiresInDays !== null ? (
                    <span className="text-muted-foreground">({expiresInDays}d left)</span>
                  ) : null}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Your role</dt>
                <dd>
                  <Badge variant="outline" className="font-medium">
                    {session.organization.role}
                  </Badge>
                </dd>
              </div>
            </dl>

            {isTestMode ? (
              <Alert className="border-warning/30 bg-warning/10">
                <FlaskConical className="h-4 w-4 text-warning" aria-hidden />
                <AlertTitle className="text-sm">Sandbox — TEST mode</AlertTitle>
                <AlertDescription className="text-xs leading-relaxed">
                  This organization runs in TEST mode: every provider is a deterministic simulator
                  and no real funds move. LIVE mode is a separate compliance-gated workflow.
                </AlertDescription>
              </Alert>
            ) : null}

            <SignOutButton />
          </CardContent>
        </Card>
      </div>

      {/* ── Members ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" aria-hidden />
            Members
          </CardTitle>
          <CardDescription>
            People with access to this organization. Roles scope what each member can act on —
            money-moving actions always land on the audit chain with the actor attached.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="pr-6">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {memberships.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback
                            className="text-[10px] font-semibold text-white"
                            style={{ backgroundColor: m.user.avatarColor }}
                          >
                            {initials(m.user.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{m.user.name}</span>
                        {m.userId === session.user.id ? (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            you
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.user.email}</TableCell>
                    <TableCell>
                      <ToneBadge tone={ROLE_TONE[m.role] ?? 'neutral'}>{m.role}</ToneBadge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground" title={fmtDateTime(m.createdAt)}>
                      {fmtDate(m.createdAt)}
                    </TableCell>
                    <TableCell className="pr-6">
                      <ToneBadge tone={m.user.status === 'ACTIVE' ? 'positive' : 'negative'}>
                        {m.user.status}
                      </ToneBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="px-6 py-4 text-xs text-muted-foreground">
            {memberships.length} member{memberships.length === 1 ? '' : 's'} · inviting and removing
            members is handled by organization owners during onboarding.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
