'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { SidebarNav } from '@/components/app/sidebar-nav'
import { initials } from '@/lib/format'
import { LogOut, Menu, Moon, Sun, ChevronDown, Hexagon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from '@/hooks/use-toast'

export interface TopbarUser {
  name: string
  email: string
  avatarColor: string
  organizationName: string
  organizationMode: string
  role: string
}

export function AppShell({
  user,
  children,
  balance,
}: {
  user: TopbarUser
  children: React.ReactNode
  balance?: { label: string; formatted: string } | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { theme, setTheme } = useTheme()

  async function logout() {
    startTransition(async () => {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (res.ok) {
        toast({ title: 'Signed out', description: 'Your session has been revoked.' })
        router.push('/login')
        router.refresh()
      }
    })
  }

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-4 py-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 border border-primary/25">
        <Hexagon className="h-4.5 w-4.5 text-primary" strokeWidth={2.2} />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">Novera</p>
        <p className="text-[10px] text-muted-foreground -mt-0.5">Financial Infrastructure</p>
      </div>
    </Link>
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-sidebar lg:flex">
        {brand}
        <SidebarNav />
        <div className="border-t px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn('h-1.5 w-1.5 rounded-full', 'bg-warning animate-pulse')} />
            <span>Sandbox · TEST mode</span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-60">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 backdrop-blur px-4 lg:px-6">
          {/* Mobile nav */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden h-9 w-9" aria-label="Open navigation">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              {brand}
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
              <div className="border-t px-4 py-3 text-xs text-muted-foreground">Sandbox · TEST mode</div>
            </SheetContent>
          </Sheet>

          <div className="hidden items-center gap-2 lg:flex">
            <Badge variant="outline" className="bg-warning/10 text-warning border-warning/25 font-medium">
              TEST MODE
            </Badge>
            <span className="text-xs text-muted-foreground">All funds simulated · deterministic sandbox providers</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {balance ? (
              <div className="hidden md:flex flex-col items-end mr-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{balance.label}</span>
                <span className="text-sm font-semibold tabular leading-tight">{balance.formatted}</span>
              </div>
            ) : null}

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Toggle theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Account menu"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback
                      className="text-xs font-semibold text-white"
                      style={{ backgroundColor: user.avatarColor }}
                    >
                      {initials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden sm:flex flex-col items-start leading-tight">
                    <span className="text-xs font-medium">{user.organizationName}</span>
                    <span className="text-[10px] text-muted-foreground">{user.role.toLowerCase()}</span>
                  </div>
                  <ChevronDown className="hidden sm:block h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground font-normal">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">Organization settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/audit">My audit trail</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} disabled={pending} className="text-danger focus:text-danger">
                  <LogOut className="h-4 w-4 mr-2" />
                  {pending ? 'Signing out…' : 'Sign out'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
