import Link from 'next/link'
import { Hexagon, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

const NAV_LINKS = [
  { href: '/#architecture', label: 'Architecture' },
  { href: '/#platform', label: 'Platform' },
  { href: '/#kernel', label: 'Kernel' },
  { href: '/#agents', label: 'Agents' },
  { href: '/#rails', label: 'Rails' },
  { href: '/#developers', label: 'Developers' },
]

/** Sticky public-site header. Server component — no interactivity needed. */
export function SiteHeader({ authenticated }: { authenticated: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          aria-label="Novera home"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/15">
            <Hexagon className="h-4.5 w-4.5 text-primary" strokeWidth={2.2} />
          </div>
          <span className="text-base font-semibold tracking-tight">Novera</span>
          <span className="ml-1 hidden rounded-full border border-border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline">
            TEST
          </span>
        </Link>

        <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {authenticated ? (
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/dashboard">
                Open dashboard <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm" className="gap-1.5">
                <Link href="/login">
                  Enter the demo <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
