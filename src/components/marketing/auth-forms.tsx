'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { loginAction, registerAction, demoLoginAction } from '@/app/(auth)/actions'

/**
 * Client wrappers around the (auth) server actions, adding graceful error
 * capture, pending states and accessible error display via useActionState.
 * login/register actions are untouched; demoLoginAction returns an error
 * state instead of throwing so failures render inline here.
 */

type FormState = { error: string | null }

function friendlyLoginError(e: unknown): string {
  const message = e instanceof Error ? e.message : ''
  if (/required/i.test(message)) return 'Enter both your email and password to continue.'
  if (/too many failed sign-in attempts/i.test(message)) return message
  if (/suspended/i.test(message)) return 'This account is suspended. Contact your organization owner.'
  return 'Invalid email or password. New here? Jump into the interactive demo below.'
}

function friendlyRegisterError(e: unknown): string {
  const message = e instanceof Error ? e.message : ''
  if (/required|at least 8/i.test(message))
    return 'Fill in every field — passwords need at least 8 characters.'
  if (/already exists/i.test(message))
    return 'An account with this email already exists. Try signing in instead.'
  return 'We could not create your organization. Check your details and try again.'
}

function friendlyDemoError(e: unknown): string {
  const message = e instanceof Error ? e.message : ''
  if (/invalid email or password/i.test(message))
    return 'The demo account is not available here. Create an organization below to explore.'
  return 'Could not start the demo right now — please try again.'
}

/** Submit button with automatic pending state (works inside any form action). */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className={className} {...props}>
      {pending ? (
        <>
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          {pendingLabel ?? 'Working…'}
        </>
      ) : (
        children
      )}
    </Button>
  )
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="leading-relaxed">{error}</span>
    </div>
  )
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(async (_prev, formData) => {
    try {
      await loginAction(formData)
      return { error: null } // success redirects inside the action
    } catch (e) {
      return { error: friendlyLoginError(e) }
    }
  }, { error: initialError ?? null })

  const hasError = Boolean(state.error)

  return (
    <form action={formAction} className="space-y-4">
      <FormError error={state.error} />
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          aria-invalid={hasError}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          aria-invalid={hasError}
        />
      </div>
      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  )
}

export function DemoLoginForm(props: React.ComponentProps<typeof SubmitButton>) {
  const [state, formAction] = useActionState<FormState, FormData>(async (_prev, _formData) => {
    try {
      const result = await demoLoginAction()
      if (result.error) return { error: result.error }
      return { error: null } // success redirects inside the action
    } catch (e) {
      return { error: friendlyDemoError(e) }
    }
  }, { error: null })

  return (
    <form action={formAction} className="space-y-3">
      <FormError error={state.error} />
      <SubmitButton {...props} />
    </form>
  )
}

export function RegisterForm() {
  const [state, formAction] = useActionState<FormState, FormData>(async (_prev, formData) => {
    try {
      await registerAction(formData)
      return { error: null } // success redirects inside the action
    } catch (e) {
      return { error: friendlyRegisterError(e) }
    }
  }, { error: null })

  const hasError = Boolean(state.error)

  return (
    <form action={formAction} className="space-y-4">
      <FormError error={state.error} />
      <div className="space-y-2">
        <Label htmlFor="name">Full name</Label>
        <Input
          id="name"
          name="name"
          placeholder="Amina Otieno"
          autoComplete="name"
          required
          aria-invalid={hasError}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          placeholder="you@company.com"
          autoComplete="email"
          required
          aria-invalid={hasError}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="organization">Organization name</Label>
        <Input
          id="organization"
          name="organization"
          placeholder="Acme Kenya Ltd"
          autoComplete="organization"
          required
          aria-invalid={hasError}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="At least 8 characters"
          minLength={8}
          autoComplete="new-password"
          required
          aria-invalid={hasError}
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          Stored as a scrypt hash with a per-user salt. 8 characters minimum.
        </p>
      </div>
      <SubmitButton className="w-full" pendingLabel="Provisioning…">
        Create organization
      </SubmitButton>
    </form>
  )
}
