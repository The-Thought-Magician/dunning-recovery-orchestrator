'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'

interface Notification {
  id: string
  user_id?: string
  workspace_id?: string
  title: string
  body?: string | null
  kind?: string | null
  read: boolean
  created_at?: string
}

type Tone = 'emerald' | 'amber' | 'red' | 'sky' | 'slate' | 'violet' | 'default'

function kindTone(kind?: string | null): Tone {
  switch ((kind ?? '').toLowerCase()) {
    case 'success':
    case 'recovery':
      return 'emerald'
    case 'warning':
    case 'risk':
      return 'amber'
    case 'error':
    case 'alert':
    case 'critical':
      return 'red'
    case 'info':
      return 'sky'
    default:
      return 'slate'
  }
}

function timeAgo(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

type View = 'all' | 'unread' | 'read'

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('all')
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getNotifications()
      setItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const filtered = useMemo(() => {
    const sorted = items
      .slice()
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    if (view === 'unread') return sorted.filter((n) => !n.read)
    if (view === 'read') return sorted.filter((n) => n.read)
    return sorted
  }, [items, view])

  async function markOne(n: Notification) {
    if (n.read) return
    setBusy((s) => new Set(s).add(n.id))
    // optimistic
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    try {
      await api.markNotificationRead(n.id)
    } catch (e) {
      // revert on failure
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: false } : x)))
      setError(e instanceof Error ? e.message : 'Failed to mark as read')
    } finally {
      setBusy((s) => {
        const next = new Set(s)
        next.delete(n.id)
        return next
      })
    }
  }

  async function markAll() {
    if (unreadCount === 0) return
    setMarkingAll(true)
    setError(null)
    const snapshot = items
    setItems((prev) => prev.map((x) => ({ ...x, read: true })))
    try {
      await api.markAllNotificationsRead()
      await load()
    } catch (e) {
      setItems(snapshot)
      setError(e instanceof Error ? e.message : 'Failed to mark all as read')
    } finally {
      setMarkingAll(false)
    }
  }

  if (loading) return <PageSpinner label="Loading notifications..." />

  const tabs: { key: View; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'unread', label: 'Unread', count: unreadCount },
    { key: 'read', label: 'Read', count: items.length - unreadCount },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">
            Recovery alerts, period closes, and workspace events delivered to you.
          </p>
        </div>
        <Button onClick={markAll} disabled={unreadCount === 0 || markingAll}>
          {markingAll ? 'Marking...' : `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total" value={items.length} hint="all notifications" />
        <Stat label="Unread" value={unreadCount} tone={unreadCount ? 'amber' : 'emerald'} hint="need attention" />
        <Stat label="Read" value={items.length - unreadCount} hint="acknowledged" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === t.key ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 text-xs ${view === t.key ? 'text-slate-800' : 'text-slate-600'}`}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={
                  items.length === 0
                    ? 'No notifications'
                    : view === 'unread'
                      ? 'All caught up'
                      : 'Nothing here'
                }
                description={
                  items.length === 0
                    ? 'When alerts fire or periods close, you will see them here.'
                    : view === 'unread'
                      ? 'You have read every notification. Nice work.'
                      : 'No notifications match this view.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {filtered.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-5 py-4 transition-colors ${
                    n.read ? 'opacity-70 hover:bg-slate-800/20' : 'bg-emerald-500/[0.03] hover:bg-slate-800/30'
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      n.read ? 'bg-slate-700' : 'bg-emerald-400'
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-medium ${n.read ? 'text-slate-300' : 'text-white'}`}>
                        {n.title}
                      </span>
                      {n.kind && <Badge tone={kindTone(n.kind)}>{n.kind}</Badge>}
                      <span className="text-xs text-slate-600">{timeAgo(n.created_at)}</span>
                    </div>
                    {n.body && <p className="mt-1 text-sm text-slate-400">{n.body}</p>}
                  </div>
                  {!n.read && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy.has(n.id)}
                      onClick={() => markOne(n)}
                    >
                      {busy.has(n.id) ? '...' : 'Mark read'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
