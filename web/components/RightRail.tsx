'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'

interface ActivityEntry {
  id: string
  type?: string
  action?: string
  message?: string
  description?: string
  created_at?: string
  occurred_at?: string
}
interface WatchlistItem {
  id: string
  account_name?: string
  customer_name?: string
  reason?: string
  note?: string
  created_at?: string
}
interface LedgerSummary {
  attempted_cents: number
  recovered_cents: number
  recovery_rate: number
}
interface RetrySchedule {
  id: string
  name?: string
  status?: string
  updated_at?: string
}

function fmtMoney(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtPct(rate?: number | null): string {
  if (rate == null) return '—'
  const r = rate > 1 ? rate / 100 : rate
  return `${(r * 100).toFixed(1)}%`
}
function fmtRelative(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function RightRail() {
  const [loading, setLoading] = useState(true)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [ledger, setLedger] = useState<LedgerSummary | null>(null)
  const [schedules, setSchedules] = useState<RetrySchedule[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [a, w, l, s] = await Promise.allSettled([
          api.getActivity({ limit: 6 }),
          api.getWatchlist(),
          api.getLedgerSummary(),
          api.getSchedules(),
        ])
        if (cancelled) return
        if (a.status === 'fulfilled') {
          const val = a.value
          setActivity(Array.isArray(val) ? val : (val?.items ?? []))
        }
        if (w.status === 'fulfilled') {
          const val = w.value
          setWatchlist(Array.isArray(val) ? val : (val?.items ?? []))
        }
        if (l.status === 'fulfilled') setLedger(l.value)
        if (s.status === 'fulfilled') {
          const val = s.value
          setSchedules(Array.isArray(val) ? val : (val?.items ?? []))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label="Loading rail..." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Recovery rate</h2>
        </CardHeader>
        <CardBody>
          <div className="text-3xl font-semibold text-amber-400">{fmtPct(ledger?.recovery_rate)}</div>
          <div className="mt-1 text-xs text-zinc-500">
            {fmtMoney(ledger?.recovered_cents)} recovered of {fmtMoney(ledger?.attempted_cents)} attempted
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Recent activity</h2>
          <Link href="/dashboard/activity" className="text-xs text-amber-400 hover:text-amber-300">
            View all →
          </Link>
        </CardHeader>
        <CardBody>
          {activity.length === 0 ? (
            <p className="text-xs text-zinc-500">No recent activity recorded.</p>
          ) : (
            <ul className="space-y-3">
              {activity.slice(0, 6).map((entry) => (
                <li key={entry.id} className="text-xs">
                  <div className="text-zinc-300">
                    {entry.message || entry.description || entry.action || entry.type || 'Activity event'}
                  </div>
                  <div className="mt-0.5 text-zinc-600">{fmtRelative(entry.created_at || entry.occurred_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">At-risk watchlist</h2>
          <Link href="/dashboard/alerts" className="text-xs text-amber-400 hover:text-amber-300">
            View all →
          </Link>
        </CardHeader>
        <CardBody>
          {watchlist.length === 0 ? (
            <p className="text-xs text-zinc-500">No accounts currently flagged.</p>
          ) : (
            <ul className="space-y-3">
              {watchlist.slice(0, 5).map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-2 text-xs">
                  <span className="text-zinc-300">{item.account_name || item.customer_name || 'Account'}</span>
                  <Badge tone="amber" className="shrink-0">
                    {item.reason || item.note || 'watch'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Retry schedules</h2>
          <Link href="/dashboard/schedules" className="text-xs text-amber-400 hover:text-amber-300">
            Manage →
          </Link>
        </CardHeader>
        <CardBody>
          {schedules.length === 0 ? (
            <p className="text-xs text-zinc-500">No retry schedules configured.</p>
          ) : (
            <ul className="space-y-2">
              {schedules.slice(0, 5).map((sch) => (
                <li key={sch.id} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">{sch.name || 'Untitled schedule'}</span>
                  <Badge tone={sch.status === 'active' ? 'amber' : 'slate'}>{sch.status || 'inactive'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

export default RightRail
