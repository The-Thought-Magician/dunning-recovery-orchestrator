'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Forecast', href: '/dashboard/forecast' },
      { label: 'Reports', href: '/dashboard/reports' },
    ],
  },
  {
    title: 'Recovery',
    items: [
      { label: 'Inbox', href: '/dashboard/inbox' },
      { label: 'Taxonomy', href: '/dashboard/taxonomy' },
      { label: 'Routing', href: '/dashboard/routing' },
      { label: 'Tactics', href: '/dashboard/tactics' },
    ],
  },
  {
    title: 'Retry Modeling',
    items: [
      { label: 'Schedules', href: '/dashboard/schedules' },
      { label: 'Simulator', href: '/dashboard/simulator' },
      { label: 'Grace Policies', href: '/dashboard/grace' },
    ],
  },
  {
    title: 'Revenue',
    items: [
      { label: 'Ledger', href: '/dashboard/ledger' },
      { label: 'Card Updater', href: '/dashboard/card-updater' },
      { label: 'Cohorts', href: '/dashboard/cohorts' },
      { label: 'Insights', href: '/dashboard/insights' },
    ],
  },
  {
    title: 'Engagement',
    items: [
      { label: 'Dunning', href: '/dashboard/dunning' },
      { label: 'Portal', href: '/dashboard/portal' },
    ],
  },
  {
    title: 'Accounts',
    items: [
      { label: 'Subscription Book', href: '/dashboard/book' },
      { label: 'Playbooks', href: '/dashboard/playbooks' },
      { label: 'Alerts & Watchlist', href: '/dashboard/alerts' },
    ],
  },
  {
    title: 'Data',
    items: [
      { label: 'Imports & Seeder', href: '/dashboard/imports' },
      { label: 'Activity', href: '/dashboard/activity' },
      { label: 'Notifications', href: '/dashboard/notifications' },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'Settings', href: '/dashboard/settings' }],
  },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [workspaceName, setWorkspaceName] = useState('Workspace')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      if (cancelled) return
      const user = (s as any)?.data?.user
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      setWorkspaceName(user.name || user.email || 'Workspace')
      setChecking(false)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-400" />
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link href="/dashboard" className="flex items-center gap-2 px-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-sm font-black text-zinc-950">D</span>
        <span className="text-sm font-bold tracking-tight text-white">DunningRecovery<span className="text-amber-400">Orchestrator</span></span>
      </Link>
      {NAV.map((section) => (
        <div key={section.title}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{section.title}</div>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-amber-500/10 font-medium text-amber-400'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-800 bg-zinc-900/40 lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-zinc-950/80" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-zinc-800 bg-zinc-900">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white lg:hidden"
            >
              ☰
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span className="font-medium text-zinc-200">{workspaceName}</span>
            </div>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
