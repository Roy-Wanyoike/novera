import Link from 'next/link'
import { Hexagon, Compass, ArrowLeft } from 'lucide-react'
import { optionalSession } from '@/lib/session'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Page not found' }

/** Branded root 404 — rendered inside the root layout's theme. */
export default async function NotFound() {
  const session = await optionalSession()
  const homeHref = session ? '/dashboard' : '/'
  const homeLabel = session ? 'Back to dashboard' : 'Back to home'

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center space-y-4 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-primary/25 bg-primary/15">
            <Hexagon className="h-5 w-5 text-primary" strokeWidth={2.2} aria-hidden />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-xl tracking-tight">Page not found</CardTitle>
            <CardDescription className="leading-relaxed">
              The page you are looking for does not exist, has moved, or lives in an organization
              you do not have access to.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
            <Compass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="leading-relaxed">
              Every Novera route is organization-scoped — deep links only resolve for resources
              inside your active organization.
            </span>
          </div>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild className="gap-1.5">
              <Link href={homeHref}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {homeLabel}
              </Link>
            </Button>
            {!session ? (
              <Button asChild variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            ) : null}
          </div>
          <p className="text-center font-mono text-[11px] text-muted-foreground">404</p>
        </CardContent>
      </Card>
    </div>
  )
}
