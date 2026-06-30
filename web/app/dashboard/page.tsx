'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface LedgerSummary {
  attempted_cents: number
  recovered_cents: number
  lost_cents: number
  written_off_cents: number
  recovery_rate: number
}
interface BookHealth {
  active: number
  at_risk: number
  in_dunning: number
  churned_involuntary: number
  recovered: number
}
interface GapReport {
  total_at_risk_cents: number
  by_month: Array<{ month: string; at_risk_cents: number }>
  by_brand: Array<{ brand: string; at_risk_cents: number }>
  rows: unknown[]
}
interface DeclineReason {
  code: string
  label: string
  count: number
  mrr_cents: number
}
interface Forecast {
  id: string
  period_label: string
  projected_recovered_cents: number
  low_cents: number
  high_cents: number
  actual_recovered_cents: number | null
}

function fmtMoney(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtPct(rate?: number | null): string {
  if (rate == null) return '—'
  // rate may arrive as 0-1 or 0-100; normalize to 0-1 if it looks like a fraction.
  const r = rate > 1 ? rate / 100 : rate
  return `${(r * 100).toFixed(1)}%`
}

export default function DashboardOverviewPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ledger, setLedger] = useState<LedgerSummary | null>(null)
  const [health, setHealth] = useState<BookHealth | null>(null)
  const [gap, setGap] = useState<GapReport | null>(null)
  const [reasons, setReasons] = useState<DeclineReason[]>([])
  const [forecasts, setForecasts] = useState<Forecast[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [l, h, g, r, f] = await Promise.all([
          api.getLedgerSummary() as Promise<LedgerSummary>,
          api.getBookHealth() as Promise<BookHealth>,
          api.getCardGapReport() as Promise<GapReport>,
          api.getDeclineReasons() as Promise<DeclineReason[]>,
          api.getForecasts() as Promise<Forecast[]>,
        ])
        if (cancelled) return
        setLedger(l)
        setHealth(h)
        setGap(g)
        setReasons(Array.isArray(r) ? r : [])
        setForecasts(Array.isArray(f) ? f : [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) return <PageSpinner label="Loading recovery overview..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          title="Could not load the dashboard"
          description={error}
          action={
            <Button onClick={() => location.reload()} variant="secondary">
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  const totalAccounts = health
    ? health.active + health.at_risk + health.in_dunning + health.churned_involuntary + health.recovered
    : 0

  const topReasons = [...reasons].sort((a, b) => b.count - a.count).slice(0, 6)
  const maxReasonCount = topReasons.reduce((m, r) => Math.max(m, r.count), 0) || 1

  const latestForecast = forecasts.length ? forecasts[forecasts.length - 1] : null

  const healthSegments = health
    ? [
        { label: 'Active', value: health.active, tone: 'bg-emerald-500' },
        { label: 'At risk', value: health.at_risk, tone: 'bg-amber-500' },
        { label: 'In dunning', value: health.in_dunning, tone: 'bg-sky-500' },
        { label: 'Recovered', value: health.recovered, tone: 'bg-emerald-400' },
        { label: 'Churned', value: health.churned_involuntary, tone: 'bg-red-500' },
      ]
    : []

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Recovery overview</h1>
          <p className="mt-1 text-sm text-slate-400">
            Recovered revenue, book health, and at-risk MRR across your subscription book.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/inbox">
            <Button variant="primary">Open failed-charge inbox</Button>
          </Link>
          <Link href="/dashboard/ledger">
            <Button variant="secondary">View ledger</Button>
          </Link>
        </div>
      </div>

      {/* Ledger KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Recovered revenue"
          value={fmtMoney(ledger?.recovered_cents)}
          tone="emerald"
          hint={`${fmtPct(ledger?.recovery_rate)} recovery rate`}
        />
        <Stat label="Attempted" value={fmtMoney(ledger?.attempted_cents)} hint="Total in dunning" />
        <Stat label="Lost" value={fmtMoney(ledger?.lost_cents)} tone="red" hint="Unrecovered to date" />
        <Stat
          label="At-risk MRR"
          value={fmtMoney(gap?.total_at_risk_cents)}
          tone="amber"
          hint="Cards expiring without coverage"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Book health */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Book health</h2>
            <Link href="/dashboard/book" className="text-xs text-emerald-400 hover:text-emerald-300">
              View book →
            </Link>
          </CardHeader>
          <CardBody className="space-y-4">
            {totalAccounts === 0 ? (
              <EmptyState
                title="No accounts yet"
                description="Seed sample data or import your subscription book to see health."
                action={
                  <Link href="/dashboard/imports">
                    <Button size="sm" variant="secondary">
                      Import or seed data
                    </Button>
                  </Link>
                }
              />
            ) : (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  {healthSegments.map((s) =>
                    s.value > 0 ? (
                      <div
                        key={s.label}
                        className={s.tone}
                        style={{ width: `${(s.value / totalAccounts) * 100}%` }}
                        title={`${s.label}: ${s.value}`}
                      />
                    ) : null
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  {healthSegments.map((s) => (
                    <div key={s.label} className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${s.tone}`} />
                        <span className="text-[11px] uppercase tracking-wide text-slate-500">{s.label}</span>
                      </div>
                      <div className="mt-1 text-lg font-semibold text-white">{s.value}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {/* Forecast snapshot */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Forecast</h2>
            <Link href="/dashboard/forecast" className="text-xs text-emerald-400 hover:text-emerald-300">
              Detail →
            </Link>
          </CardHeader>
          <CardBody className="space-y-3">
            {!latestForecast ? (
              <EmptyState
                title="No forecast yet"
                description="Run a forecast to project next-period recovered revenue."
              />
            ) : (
              <>
                <div className="text-xs uppercase tracking-wide text-slate-500">{latestForecast.period_label}</div>
                <div className="text-3xl font-semibold text-emerald-400">
                  {fmtMoney(latestForecast.projected_recovered_cents)}
                </div>
                <div className="text-xs text-slate-500">
                  Range {fmtMoney(latestForecast.low_cents)} – {fmtMoney(latestForecast.high_cents)}
                </div>
                {/* simple low / projected / high bar */}
                <div className="space-y-1.5 pt-2">
                  {(() => {
                    const hi = latestForecast.high_cents || 1
                    const seg = (v: number) => `${Math.min(100, (v / hi) * 100)}%`
                    return (
                      <>
                        <Bar label="Low" width={seg(latestForecast.low_cents)} tone="bg-slate-600" />
                        <Bar
                          label="Projected"
                          width={seg(latestForecast.projected_recovered_cents)}
                          tone="bg-emerald-500"
                        />
                        <Bar label="High" width={seg(latestForecast.high_cents)} tone="bg-emerald-400/50" />
                        {latestForecast.actual_recovered_cents != null && (
                          <Bar
                            label="Actual"
                            width={seg(latestForecast.actual_recovered_cents)}
                            tone="bg-sky-500"
                          />
                        )}
                      </>
                    )
                  })()}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top decline reasons */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Top decline reasons</h2>
            <Link href="/dashboard/insights" className="text-xs text-emerald-400 hover:text-emerald-300">
              Insights →
            </Link>
          </CardHeader>
          <CardBody>
            {topReasons.length === 0 ? (
              <EmptyState title="No declines recorded" description="Decline reasons appear as failed charges arrive." />
            ) : (
              <div className="space-y-3">
                {topReasons.map((r) => (
                  <div key={r.code}>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Badge tone="slate">{r.code}</Badge>
                        <span className="text-slate-300">{r.label}</span>
                      </div>
                      <span className="text-slate-400">
                        {r.count} · {fmtMoney(r.mrr_cents)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-amber-500"
                        style={{ width: `${(r.count / maxReasonCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* At-risk MRR breakdown */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">At-risk MRR by card brand</h2>
            <Link href="/dashboard/card-updater" className="text-xs text-emerald-400 hover:text-emerald-300">
              Card updater →
            </Link>
          </CardHeader>
          <CardBody>
            {!gap || (gap.by_brand?.length ?? 0) === 0 ? (
              <EmptyState
                title="No coverage gaps"
                description="Recompute card coverage to surface expiring cards and at-risk MRR."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Brand</TH>
                    <TH className="text-right">At-risk MRR</TH>
                  </TR>
                </THead>
                <TBody>
                  {[...gap.by_brand]
                    .sort((a, b) => b.at_risk_cents - a.at_risk_cents)
                    .map((b) => (
                      <TR key={b.brand}>
                        <TD className="capitalize">{b.brand || 'Unknown'}</TD>
                        <TD className="text-right font-medium text-amber-400">{fmtMoney(b.at_risk_cents)}</TD>
                      </TR>
                    ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function Bar({ label, width, tone }: { label: string; width: string; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-slate-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width }} />
      </div>
    </div>
  )
}
