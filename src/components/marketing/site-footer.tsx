import Link from 'next/link'
import { Hexagon } from 'lucide-react'

const FOOT_LINKS = [
  { href: '/login', label: 'Sign in' },
  { href: '/register', label: 'Create organization' },
  { href: '/#architecture', label: 'Architecture' },
  { href: '/#agents', label: 'Agents' },
  { href: '/#developers', label: 'Developers' },
]

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60 bg-muted/20">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6 md:py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm space-y-3">
            <Link
              href="/"
              className="flex w-fit items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/15">
                <Hexagon className="h-4.5 w-4.5 text-primary" strokeWidth={2.2} />
              </div>
              <span className="text-base font-semibold tracking-tight">Novera</span>
            </Link>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Programmable financial infrastructure.{' '}
              <span className="text-foreground/80">AI proposes. Policy authorizes. The ledger records.</span>
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-3 sm:grid-cols-3">
            {FOOT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Sandbox reference build — deterministic TEST providers, no real funds move.
          </p>
          <p className="tabular">Every debit has a credit.</p>
        </div>
      </div>
    </footer>
  )
}
