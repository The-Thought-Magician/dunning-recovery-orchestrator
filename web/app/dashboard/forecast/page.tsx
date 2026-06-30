'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Forecast {
  id: string
  period_label: string
  projected_recovered_cents: number
  low_cents: number
  high_cents: number
  actual_recovered_cents: number | null
  created_at?: string
}

function fmtMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function defaultPeriodLabel(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  return d.toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

export default function ForecastPage() {
  const [forecasts, setForecasts] = useState<Forecast[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [runOpen, setRunOpen] = useState(false)
  const [periodLabel, setPeriodLabel] = useState(defaultPeriodLabel())
  const [running, setRunning] = useState(false)

  const [actualOpen, setActualOpen] = useState(false)
  const [actualTarget, setActualTarget] = useState<Forecast | null>(null)
  const [actualValue, setActualValue] = useState('')
  const [savingActual, setSavingActual] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = (await api.getForecasts()) as Forecast[]
      setForecasts(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forecasts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function runForecast() {
    if (!periodLabel.trim()) return
    setRunning(true)
    setActionError(null)
    try {
      await api.runForecast({ period_label: periodLabel.trim() })
      setRunOpen(false)
      setPeriodLabel(defaultPeriodLabel())
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to run forecast')
    } finally {
      setRunning(false)
    }
  }

  function openActual(f: Forecast) {
    setActualTarget(f)
    setActualValue(
      f.actual_recovered_cents !== null && f.actual_recovered_cents !== undefined
        ? String((f.actual_recovered_cents / 100).toFixed(2))
        : '',
    )
    setActionError(null)
    setActualOpen(true)
  }

  async function saveActual() {
    if (!actualTarget) return
    const dollars = parseFloat(actualValue)
    if (Number.isNaN(dollars) || dollars < 0) {
      setActionError('Enter a valid non-negative amount')
      return
    }
    setSavingActual(true)
    setActionError(null)
    try {
      await api.setForecastActual(actualTarget.id, { actual_recovered_cents: Math.round(dollars * 100) })
      setActualOpen(false)
      setActualTarget(null)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save actual')
    } finally {
      setSavingActual(false)
    }
  }

  const sorted = useMemo(
    () => [...forecasts].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')),
    [forecasts],
  )

  const totals = useMemo(() => {
    const withActual = forecasts.filter((f) => f.actual_recovered_cents !== null && f.actual_recovered_cents !== undefined)
    const projected = forecasts.reduce((s, f) => s + (f.projected_recovered_cents || 0), 0)
    const actual = withActual.reduce((s, f) => s + (f.actual_recovered_cents || 0), 0)
    const projectedForActual = withActual.reduce((s, f) => s + (f.projected_recovered_cents || 0), 0)
    const accuracy = projectedForActual > 0 ? actual / projectedForActual : null
    return { projected, actual, accuracy, withActualCount: withActual.length }
  }, [forecasts])

  if (loading) return <PageSpinner label="Loading forecasts..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Recovery Forecast</h1>
          <p className="mt-1 text-sm text-slate-400">Projected recovered revenue versus actual outcomes per period.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setRunOpen(true) }}>
            Run Forecast
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Periods Forecast" value={forecasts.length} />
        <Stat label="Total Projected" value={fmtMoney(totals.projected)} tone="emerald" />
        <Stat label="Total Actual" value={fmtMoney(totals.actual)} hint={`${totals.withActualCount} period(s) recorded`} />
        <Stat
          label="Forecast Accuracy"
          value={totals.accuracy === null ? '—' : `${(totals.accuracy * 100).toFixed(0)}%`}
          tone={totals.accuracy === null ? 'default' : totals.accuracy >= 0.9 && totals.accuracy <= 1.15 ? 'emerald' : 'amber'}
          hint="actual ÷ projected"
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Projected vs Actual</h2>
        </CardHeader>
        <CardBody>
          {sorted.length === 0 ? (
            <EmptyState
              title="No forecasts yet"
              description="Run a forecast to project recovered revenue for an upcoming period."
              action={<Button size="sm" onClick={() => setRunOpen(true)}>Run Forecast</Button>}
            />
          ) : (
            <ForecastChart forecasts={sorted} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Forecast History</h2>
        </CardHeader>
        <CardBody className="p-0">
          {sorted.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No forecasts" description="Forecasts you run will appear here." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH className="text-right">Low</TH>
                  <TH className="text-right">Projected</TH>
                  <TH className="text-right">High</TH>
                  <TH className="text-right">Actual</TH>
                  <TH className="text-right">Variance</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {[...sorted].reverse().map((f) => {
                  const hasActual = f.actual_recovered_cents !== null && f.actual_recovered_cents !== undefined
                  const variance = hasActual ? (f.actual_recovered_cents as number) - f.projected_recovered_cents : null
                  return (
                    <TR key={f.id}>
                      <TD className="font-medium text-slate-200">{f.period_label}</TD>
                      <TD className="text-right tabular-nums text-slate-500">{fmtMoney(f.low_cents)}</TD>
                      <TD className="text-right tabular-nums text-emerald-300">{fmtMoney(f.projected_recovered_cents)}</TD>
                      <TD className="text-right tabular-nums text-slate-500">{fmtMoney(f.high_cents)}</TD>
                      <TD className="text-right tabular-nums">{hasActual ? fmtMoney(f.actual_recovered_cents) : '—'}</TD>
                      <TD className="text-right tabular-nums">
                        {variance === null ? (
                          '—'
                        ) : (
                          <span className={variance >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {variance >= 0 ? '+' : ''}
                            {fmtMoney(variance)}
                          </span>
                        )}
                      </TD>
                      <TD>
                        {hasActual ? <Badge tone="emerald">Actual recorded</Badge> : <Badge tone="amber">Pending</Badge>}
                      </TD>
                      <TD className="text-right">
                        <Button variant="secondary" size="sm" onClick={() => openActual(f)}>
                          {hasActual ? 'Edit Actual' : 'Record Actual'}
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Run forecast modal */}
      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title="Run Recovery Forecast"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={runForecast} disabled={running || !periodLabel.trim()}>
              {running ? 'Running...' : 'Run Forecast'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Projects recovered revenue for the named period from your current schedules, tactics, and decline curves.
          </p>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Period Label</span>
            <input
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder="e.g. Jul 2026"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </label>
          {actionError && <p className="text-sm text-red-400">{actionError}</p>}
        </div>
      </Modal>

      {/* Record actual modal */}
      <Modal
        open={actualOpen}
        onClose={() => setActualOpen(false)}
        title={actualTarget ? `Record Actual — ${actualTarget.period_label}` : 'Record Actual'}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setActualOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveActual} disabled={savingActual}>
              {savingActual ? 'Saving...' : 'Save Actual'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {actualTarget && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Projected</span>
                <span className="tabular-nums text-emerald-300">{fmtMoney(actualTarget.projected_recovered_cents)}</span>
              </div>
              <div className="mt-1 flex justify-between text-slate-500">
                <span>Range</span>
                <span className="tabular-nums">
                  {fmtMoney(actualTarget.low_cents)} – {fmtMoney(actualTarget.high_cents)}
                </span>
              </div>
            </div>
          )}
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Actual Recovered (USD)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={actualValue}
              onChange={(e) => setActualValue(e.target.value)}
              placeholder="0.00"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </label>
          {actionError && <p className="text-sm text-red-400">{actionError}</p>}
        </div>
      </Modal>
    </div>
  )
}

function ForecastChart({ forecasts }: { forecasts: Forecast[] }) {
  const W = 720
  const H = 260
  const padL = 48
  const padB = 30
  const padT = 14
  const padR = 14
  const n = forecasts.length
  const max = Math.max(
    1,
    ...forecasts.flatMap((f) => [f.high_cents, f.projected_recovered_cents, f.actual_recovered_cents ?? 0]),
  )
  const xFor = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1))
  const yFor = (v: number) => padT + (1 - v / max) * (H - padT - padB)

  const projLine = forecasts.map((f, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(f.projected_recovered_cents)}`).join(' ')
  // confidence band polygon: highs forward, lows back
  const band =
    forecasts.map((f, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(f.high_cents)}`).join(' ') +
    ' ' +
    forecasts
      .map((f, i) => `L ${xFor(n - 1 - i)} ${yFor(forecasts[n - 1 - i].low_cents)}`)
      .join(' ') +
    ' Z'
  const actualPoints = forecasts
    .map((f, i) => ({ i, v: f.actual_recovered_cents }))
    .filter((p) => p.v !== null && p.v !== undefined) as Array<{ i: number; v: number }>

  return (
    <div className="space-y-3">
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
          {[0, 0.25, 0.5, 0.75, 1].map((g) => {
            const y = padT + (1 - g) * (H - padT - padB)
            return (
              <g key={g}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1e293b" strokeWidth={1} />
                <text x={6} y={y + 3} fill="#475569" fontSize={9}>
                  {fmtMoneyShort((g * max) / 100)}
                </text>
              </g>
            )
          })}
          {forecasts.map((f, i) => (
            <text key={f.id} x={xFor(i)} y={H - 8} fill="#64748b" fontSize={9} textAnchor="middle">
              {f.period_label}
            </text>
          ))}
          <path d={band} fill="#34d39922" stroke="none" />
          <path d={projLine} fill="none" stroke="#34d399" strokeWidth={2} />
          {forecasts.map((f, i) => (
            <circle key={f.id} cx={xFor(i)} cy={yFor(f.projected_recovered_cents)} r={3} fill="#34d399" />
          ))}
          {actualPoints.length > 1 && (
            <path
              d={actualPoints.map((p, k) => `${k === 0 ? 'M' : 'L'} ${xFor(p.i)} ${yFor(p.v)}`).join(' ')}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          )}
          {actualPoints.map((p) => (
            <circle key={`a${p.i}`} cx={xFor(p.i)} cy={yFor(p.v)} r={3.5} fill="#38bdf8" />
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-emerald-400" />
          <span className="text-xs text-slate-400">Projected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-sky-400" />
          <span className="text-xs text-slate-400">Actual</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-emerald-500/20" />
          <span className="text-xs text-slate-400">Confidence band (low–high)</span>
        </div>
      </div>
    </div>
  )
}

function fmtMoneyShort(dollars: number): string {
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}k`
  return `$${dollars.toFixed(0)}`
}
