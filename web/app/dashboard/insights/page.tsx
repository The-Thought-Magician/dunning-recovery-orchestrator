'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface DeclineReason {
  code: string
  label?: string
  count: number
  mrr_cents: number
}

interface ReasonTrend {
  periods: string[]
  series: Array<{ code: string; label?: string; points: number[] }>
}

// Raw shape actually returned by GET /insights/effectiveness: a flat list of
// (reason, tactic) cells rather than reason rows with a nested tactics array.
interface EffectivenessCell {
  reason: string
  tactic: string
  attempted: number
  recovered: number
  attempted_cents: number
  recovered_cents: number
  rate: number
}

interface RawEffectiveness {
  matrix: EffectivenessCell[]
  tactics: string[]
  reasons: string[]
}

interface Effectiveness {
  matrix: Array<{
    code: string
    label?: string
    tactics: Array<{ tactic: string; attempted: number; recovered: number; rate: number }>
  }>
}

function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function heatColor(rate: number): string {
  // rate 0..1 -> emerald intensity
  if (rate <= 0) return 'bg-zinc-900/60 text-zinc-600'
  const pct = Math.min(1, Math.max(0, rate))
  if (pct >= 0.75) return 'bg-amber-500/80 text-zinc-950'
  if (pct >= 0.55) return 'bg-amber-500/55 text-zinc-950'
  if (pct >= 0.4) return 'bg-amber-500/35 text-amber-50'
  if (pct >= 0.25) return 'bg-amber-500/20 text-amber-200'
  return 'bg-amber-500/10 text-amber-300'
}

export default function InsightsPage() {
  const [reasons, setReasons] = useState<DeclineReason[]>([])
  const [trend, setTrend] = useState<ReasonTrend | null>(null)
  const [effectiveness, setEffectiveness] = useState<Effectiveness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'count' | 'mrr'>('count')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [r, tRaw, eRaw] = await Promise.all([
        api.getDeclineReasons() as Promise<DeclineReason[]>,
        api.getReasonTrend() as Promise<{
          periods?: string[]
          series?: Array<{ code: string; label?: string; counts?: number[]; points?: number[] }>
        }>,
        api.getEffectiveness() as Promise<RawEffectiveness>,
      ])
      setReasons(Array.isArray(r) ? r : [])

      // Backend returns per-series counts as `counts`, not `points`; normalize here.
      const periods = tRaw && Array.isArray(tRaw.periods) ? tRaw.periods : []
      const series = (tRaw?.series ?? []).map((s) => ({
        code: s.code,
        label: s.label,
        points: s.points ?? s.counts ?? [],
      }))
      setTrend({ periods, series })

      // Backend returns a flat list of (reason, tactic) cells, not reason rows
      // with a nested tactics array. Group them here to match what the UI needs.
      const cells = eRaw && Array.isArray(eRaw.matrix) ? eRaw.matrix : []
      const byReason = new Map<string, Effectiveness['matrix'][number]>()
      for (const cell of cells) {
        const code = cell.reason ?? 'unknown'
        let row = byReason.get(code)
        if (!row) {
          row = { code, tactics: [] }
          byReason.set(code, row)
        }
        row.tactics.push({
          tactic: cell.tactic,
          attempted: cell.attempted ?? 0,
          recovered: cell.recovered ?? 0,
          rate: cell.rate ?? 0,
        })
      }
      setEffectiveness({ matrix: Array.from(byReason.values()) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filteredReasons = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = reasons.filter(
      (r) => !q || r.code.toLowerCase().includes(q) || (r.label ?? '').toLowerCase().includes(q),
    )
    return [...list].sort((a, b) => (sortKey === 'count' ? b.count - a.count : b.mrr_cents - a.mrr_cents))
  }, [reasons, search, sortKey])

  const totals = useMemo(() => {
    const totalCount = reasons.reduce((s, r) => s + (r.count || 0), 0)
    const totalMrr = reasons.reduce((s, r) => s + (r.mrr_cents || 0), 0)
    const top = [...reasons].sort((a, b) => b.count - a.count)[0]
    return { totalCount, totalMrr, top, distinct: reasons.length }
  }, [reasons])

  // tactic columns across the effectiveness matrix
  const tacticColumns = useMemo(() => {
    const set = new Set<string>()
    ;(effectiveness?.matrix ?? []).forEach((row) => (row.tactics ?? []).forEach((t) => set.add(t.tactic)))
    return Array.from(set)
  }, [effectiveness])

  if (loading) return <PageSpinner label="Loading insights..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Decline Reason Insights</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Where involuntary churn comes from, how reasons trend, and which tactics recover them.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Distinct Reasons" value={totals.distinct} />
        <Stat label="Failed Charges" value={totals.totalCount.toLocaleString()} />
        <Stat label="MRR At Risk" value={fmtMoney(totals.totalMrr)} tone="amber" />
        <Stat
          label="Top Reason"
          value={totals.top ? totals.top.label || totals.top.code : '—'}
          hint={totals.top ? `${totals.top.count} charges` : undefined}
        />
      </div>

      {/* Decline reasons table */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Top Decline Reasons</h2>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or label..."
              className="w-48 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as 'count' | 'mrr')}
              className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
            >
              <option value="count">Sort by Count</option>
              <option value="mrr">Sort by MRR</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredReasons.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No decline reasons yet"
                description="Once failed charges are imported or seeded, the reason breakdown will appear here."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Label</TH>
                  <TH className="text-right">Charges</TH>
                  <TH className="text-right">MRR At Risk</TH>
                  <TH className="w-1/4">Share</TH>
                </TR>
              </THead>
              <TBody>
                {filteredReasons.map((r) => {
                  const share = totals.totalCount > 0 ? r.count / totals.totalCount : 0
                  return (
                    <TR key={r.code}>
                      <TD>
                        <span className="font-mono text-xs text-amber-300">{r.code}</span>
                      </TD>
                      <TD>{r.label || '—'}</TD>
                      <TD className="text-right tabular-nums">{r.count.toLocaleString()}</TD>
                      <TD className="text-right tabular-nums text-amber-300">{fmtMoney(r.mrr_cents)}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-amber-500"
                              style={{ width: `${Math.max(2, share * 100)}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs text-zinc-500">
                            {(share * 100).toFixed(0)}%
                          </span>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Reason trend */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Reason Trend Over Time</h2>
        </CardHeader>
        <CardBody>
          {!trend || trend.periods.length === 0 || trend.series.length === 0 ? (
            <EmptyState title="No trend data" description="Reason trends populate as charges accumulate across periods." />
          ) : (
            <TrendChart trend={trend} />
          )}
        </CardBody>
      </Card>

      {/* Effectiveness matrix */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Reason → Tactic Effectiveness Matrix</h2>
          <p className="mt-1 text-xs text-zinc-500">Recovery rate of each tactic per decline reason. Greener = higher recovery.</p>
        </CardHeader>
        <CardBody className="p-0">
          {!effectiveness || effectiveness.matrix.length === 0 || tacticColumns.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No effectiveness data"
                description="The matrix builds up once tactics have been applied to failed charges and outcomes recorded."
              />
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="sticky left-0 z-10 bg-zinc-900/60 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Reason
                    </th>
                    {tacticColumns.map((t) => (
                      <th
                        key={t}
                        className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      >
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {effectiveness.matrix.map((row) => {
                    const byTactic = new Map((row.tactics ?? []).map((t) => [t.tactic, t]))
                    return (
                      <tr key={row.code} className="hover:bg-zinc-800/20">
                        <td className="sticky left-0 z-10 bg-zinc-900/60 px-4 py-2">
                          <div className="font-mono text-xs text-amber-300">{row.code}</div>
                          {row.label && <div className="text-xs text-zinc-500">{row.label}</div>}
                        </td>
                        {tacticColumns.map((t) => {
                          const cell = byTactic.get(t)
                          if (!cell || cell.attempted === 0) {
                            return (
                              <td key={t} className="px-2 py-2 text-center">
                                <div className="rounded-md bg-zinc-900/60 px-2 py-2 text-xs text-zinc-600">—</div>
                              </td>
                            )
                          }
                          return (
                            <td key={t} className="px-2 py-2 text-center">
                              <div className={`rounded-md px-2 py-2 ${heatColor(cell.rate)}`} title={`${cell.recovered}/${cell.attempted} recovered`}>
                                <div className="text-sm font-semibold tabular-nums">{(cell.rate * 100).toFixed(0)}%</div>
                                <div className="text-[10px] opacity-80">{cell.recovered}/{cell.attempted}</div>
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function TrendChart({ trend }: { trend: ReasonTrend }) {
  const palette = ['#34d399', '#38bdf8', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#fb7185', '#a3e635']
  const series = trend.series.slice(0, palette.length).map((s) => ({ ...s, points: s.points ?? [] }))
  const max = Math.max(
    1,
    ...series.flatMap((s) => s.points),
  )
  const W = 720
  const H = 240
  const padL = 36
  const padB = 28
  const padT = 12
  const padR = 12
  const n = trend.periods.length
  const xFor = (i: number) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1))
  const yFor = (v: number) => padT + (1 - v / max) * (H - padT - padB)

  return (
    <div className="space-y-3">
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
          {/* gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((g) => {
            const y = padT + (1 - g) * (H - padT - padB)
            return (
              <g key={g}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1e293b" strokeWidth={1} />
                <text x={4} y={y + 3} fill="#475569" fontSize={9}>
                  {Math.round(g * max)}
                </text>
              </g>
            )
          })}
          {/* x labels */}
          {trend.periods.map((p, i) => (
            <text key={p + i} x={xFor(i)} y={H - 8} fill="#64748b" fontSize={9} textAnchor="middle">
              {p}
            </text>
          ))}
          {/* lines */}
          {series.map((s, si) => {
            const d = s.points
              .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(v)}`)
              .join(' ')
            return (
              <g key={s.code}>
                <path d={d} fill="none" stroke={palette[si]} strokeWidth={2} />
                {s.points.map((v, i) => (
                  <circle key={i} cx={xFor(i)} cy={yFor(v)} r={2.5} fill={palette[si]} />
                ))}
              </g>
            )
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-3">
        {series.map((s, si) => (
          <div key={s.code} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[si] }} />
            <span className="text-xs text-zinc-400">{s.label || s.code}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
