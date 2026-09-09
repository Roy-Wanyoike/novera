import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Hexagon, Lock, ShieldCheck, Zap, Check } from 'lucide-react'
import { RegisterForm } from '@/components/marketing/auth-forms'

export const metadata = { title: 'Create account' }

export default async function RegisterPage() {
  const session = await getSessionUser()
  if (session) redirect('/dashboard')

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between relative overflow-hidden bg-sidebar border-r p-10">
        <div className="grid-bg absolute inset-0 opacity-60" />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
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
              Provision a financial{' '}
              <span className="novera-gradient-text">organization in seconds.</span>
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Your organization gets everything the demo has — on a deterministic
              double-entry kernel, in TEST mode.
            </p>
          </div>
          <div className="space-y-4">
            {[
              'A KES operating wallet with an opening balance',
              'The standard chart of accounts, including fee income',
              'The default risk rule set and payment policies',
            ].map((text) => (
              <div key={text} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                  <Check className="h-3 w-3 text-primary" aria-hidden />
                </span>
                <span className="leading-relaxed">{text}</span>
              </div>
            ))}
          </div>
          <div className="space-y-4">
            {[
              { icon: Lock, text: 'Passwords are stored as scrypt hashes with per-user salts' },
              { icon: ShieldCheck, text: 'Every query is scoped to your organization — no cross-tenant reads' },
              { icon: Zap, text: 'Start in the sandbox, on deterministic TEST providers' },
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
        <div className="w-full max-w-sm space-y-6">
          <div className="lg:hidden">
            <Link
              href="/"
              className="flex w-fit items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              <Hexagon className="h-5 w-5 text-primary" aria-hidden />
              <span className="font-semibold tracking-tight">Novera</span>
            </Link>
          </div>
          <Card className="border-border/80 shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl tracking-tight">Create your organization</CardTitle>
              <CardDescription>
                You&apos;ll be the OWNER — wallets, accounts and policies are provisioned instantly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RegisterForm />
              <p className="mt-5 text-center text-sm text-muted-foreground">
                Already registered?{' '}
                <Link
                  href="/login"
                  className="text-primary font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Sign in
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
