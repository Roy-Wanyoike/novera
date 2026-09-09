import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Hexagon, ShieldCheck, Lock, Zap, Sparkles, ArrowRight } from 'lucide-react'
import { DemoLoginForm, LoginForm } from '@/components/marketing/auth-forms'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await getSessionUser()
  if (session) redirect('/dashboard')
  const { error } = await searchParams

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between relative overflow-hidden bg-sidebar border-r p-10">
        <div className="grid-bg absolute inset-0 opacity-60" />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative">
          <Link
            href="/"
            className="flex w-fit items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 border border-primary/25">
              <Hexagon className="h-5 w-5 text-primary" strokeWidth={2.2} />
            </div>
            <span className="text-lg font-semibold tracking-tight">Novera</span>
          </Link>
        </div>
        <div className="relative space-y-8 max-w-md">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight leading-tight">
              AI proposes.
              <br />
              <span className="novera-gradient-text">Policy authorizes.</span>
              <br />
              The ledger records.
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Programmable financial infrastructure — wallets, payments, cards, treasury and
              controlled AI agents on a deterministic double-entry kernel.
            </p>
          </div>
          <div className="space-y-4">
            {[
              { icon: Lock, text: 'Double-entry ledger — every debit has a credit, every record is immutable' },
              { icon: ShieldCheck, text: 'Deterministic policy engine gates every AI financial action' },
              { icon: Zap, text: 'M-Pesa, bank, card and USDC rails behind one provider abstraction' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-3 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 mt-0.5 text-primary shrink-0" aria-hidden />
                <span className="leading-relaxed">{text}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-muted-foreground">
          Sandbox environment · deterministic TEST providers · no real funds move
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex items-center justify-center bg-muted/20 p-6 sm:p-10">
        <Card className="w-full max-w-sm border-border/80 shadow-lg">
          <CardHeader>
            <div className="lg:hidden mb-3">
              <Link
                href="/"
                className="flex w-fit items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              >
                <Hexagon className="h-5 w-5 text-primary" aria-hidden />
                <span className="font-semibold tracking-tight">Novera</span>
              </Link>
            </div>
            <CardTitle className="text-xl tracking-tight">Sign in to Novera</CardTitle>
            <CardDescription>Access your organization&apos;s financial workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <LoginForm initialError={error} />

            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden>
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Demo login — highlighted for prominence */}
            <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                No account? Jump straight in.
              </div>
              <DemoLoginForm
                variant="outline"
                className="w-full h-11 gap-2 border-primary/40 bg-background hover:bg-primary/10 hover:text-primary"
                pendingLabel="Loading demo…"
              >
                Enter the interactive demo
                <ArrowRight className="h-4 w-4" aria-hidden />
              </DemoLoginForm>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Instant access to the seeded organization: 200 payments through the real kernel,
                4 AI agents, and a pending approval awaiting a decision.
              </p>
            </div>

            <p className="text-center text-sm text-muted-foreground">
              Building something new?{' '}
              <Link
                href="/register"
                className="text-primary font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Create an organization
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
