'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Wallet, ArrowLeftRight, Landmark, CreditCard, Receipt,
  Users, Link2, QrCode, ShieldAlert, Scale, Bot, CheckSquare, GitBranch,
  Code2, History, Settings, Sparkles, TrendingUp,
} from 'lucide-react'

export const NAV_SECTIONS: {
  label: string
  items: { href: string; label: string; icon: React.ElementType; badge?: string }[]
}[] = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/copilot', label: 'Copilot', icon: Sparkles, badge: 'AI' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/wallets', label: 'Wallets', icon: Wallet },
      { href: '/transactions', label: 'Ledger', icon: ArrowLeftRight },
      { href: '/treasury', label: 'Treasury', icon: Landmark },
      { href: '/fx', label: 'FX', icon: TrendingUp },
    ],
  },
  {
    label: 'Payments',
    items: [
      { href: '/payments', label: 'Payments', icon: Receipt },
      { href: '/payment-links', label: 'Payment Links', icon: Link2 },
      { href: '/invoices', label: 'Invoices', icon: QrCode },
      { href: '/customers', label: 'Customers', icon: Users },
    ],
  },
  {
    label: 'Spend',
    items: [{ href: '/cards', label: 'Cards', icon: CreditCard }],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/agents', label: 'Agents', icon: Bot, badge: 'KYA' },
      { href: '/approvals', label: 'Approvals', icon: CheckSquare },
      { href: '/rules', label: 'Rules', icon: GitBranch },
    ],
  },
  {
    label: 'Risk & Ops',
    items: [
      { href: '/risk', label: 'Risk', icon: ShieldAlert },
      { href: '/reconciliation', label: 'Reconciliation', icon: Scale },
      { href: '/audit', label: 'Audit', icon: History },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/developers', label: 'Developers', icon: Code2 },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav className="scroll-thin flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="mb-5">
          <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground')} />
                    <span className="truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
