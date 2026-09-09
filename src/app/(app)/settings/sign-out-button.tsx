'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'

/** Ends the current session — same endpoint the account menu uses. */
export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (res.ok) {
        toast({ title: 'Signed out', description: 'Your session has been revoked.' })
        router.push('/login')
        router.refresh()
      } else {
        toast({ title: 'Could not sign out', description: 'Please try again.', variant: 'destructive' })
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full gap-1.5 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
      onClick={() => void signOut()}
      disabled={pending}
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {pending ? 'Signing out…' : 'Sign out of this session'}
    </Button>
  )
}
