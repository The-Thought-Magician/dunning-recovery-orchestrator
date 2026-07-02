'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface RetrySchedule {
  id: string
  name: string
  offsets?: number[]
  is_default?: boolean
}

interface CurvePoint {
  hour?: number
  attempt?: number
  cumulative_rate?: number
  recovered_cents?: number
}

interface RetrySimulation {
  id: string
  schedule_id: string
  name: string
  projected_recovered_cents: number
  projected_recovery_rate: number
  curve: CurvePoint[] | null
  results: unknown
  created_at?: string
}

interface CompareRow {
  schedule_id: string
  projected_recovered_cents: number
  projected_recovery_rate: number
}

function dollars(cents: number | undefined | null): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function pct(rate: number | undefined | null): string {
  const r = rate ?? 0
  const v = r <= 1 ? r * 100 : r
  return `${v.toFixed(1)}%`
}

function normalizeCurve(curve: RetrySimulation['curve']): CurvePoint[] {
  if (!Array.isArray(curve)) return []
  return curve
}

function RecoveryCurve({ curve }: { curve: CurvePoint[] }) {
  if (curve.length === 0) {
    return <p className="py-6 text-center text-sm text-zinc-500">No curve data for this run.</p>
  }
  const W = 600
  const H = 180
  const pad = 24
  const rates = curve.map((p) => {
    const r = p.cumulative_rate ?? 0
    return r <= 1 ? r * 100 : r
  })
  const maxRate = Math.max(...rates, 1)
  const n = curve.length
  const points = rates.map((r, i) => {
    const x = pad + (n === 1 ? 0 : (i / (n - 1)) * (W - 2 * pad))
    const y = H - pad - (r / maxRate) * (H - 2 * pad)
    return { x, y, r }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${path} L${points[points.length - 1].x.toFixed(1)},${H - pad} L${points[0].x.toFixed(1)},${H - pad} Z`
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 360 }}>
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={pad}
            x2={W - pad}
            y1={H - pad - f * (H - 2 * pad)}
            y2={H - pad - f * (H - 2 * pad)}
            stroke="#1e293b"
            strokeWidth={1}
          />
        ))}
        <path d={area} fill="url(#grad)" opacity={0.25} />
        <path d={path} fill="none" stroke="#34d399" strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="#34d399" />
        ))}
        <defs>
          <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#0f172a" stopOpacity={0} />
          </linearGradient>
        </defs>
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>Attempt 1</span>
        <span>Cumulative recovery rate (peak {pct(maxRate / 100)})</span>
        <span>Attempt {n}</span>
      </div>
    </div>
  )
}

export default function SimulatorPage() {
  const [schedules, setSchedules] = useState<RetrySchedule[]>([])
  const [simulations, setSimulations] = useState<RetrySimulation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [runOpen, setRunOpen] = useState(false)
  const [runScheduleId, setRunScheduleId] = useState('')
  const [runName, setRunName] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareResults, setCompareResults] = useState<CompareRow[] | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sch, sims] = await Promise.all([api.getSchedules(), api.getSimulations()])
      const schList: RetrySchedule[] = Array.isArray(sch) ? sch : []
      const simList: RetrySimulation[] = Array.isArray(sims) ? sims : []
      setSchedules(schList)
      setSimulations(simList)
      if (simList.length > 0) {
        setSelectedId((cur) => cur ?? simList[0].id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load simulator data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const scheduleName = useCallback(
    (id: string) => schedules.find((s) => s.id === id)?.name ?? id.slice(0, 8),
    [schedules],
  )

  const openRun = () => {
    setRunScheduleId(schedules[0]?.id ?? '')
    setRunName('')
    setRunError(null)
    setRunOpen(true)
  }

  const runSim = async () => {
    setRunError(null)
    if (!runScheduleId) {
      setRunError('Select a schedule to simulate')
      return
    }
    const name = runName.trim() || `${scheduleName(runScheduleId)} run`
    setRunning(true)
    try {
      await api.runSimulation({ schedule_id: runScheduleId, name })
      setRunOpen(false)
      await load()
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Failed to run simulation')
    } finally {
      setRunning(false)
    }
  }

  const removeSim = async (s: RetrySimulation) => {
    if (!confirm(`Delete simulation "${s.name}"?`)) return
    try {
      await api.deleteSimulation(s.id)
      setCompareIds((ids) => ids.filter((id) => id !== s.id))
      if (selectedId === s.id) setSelectedId(null)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete simulation')
    }
  }

  const toggleCompare = (id: string) => {
    setCompareResults(null)
    setCompareIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  const runCompare = async () => {
    setCompareError(null)
    const scheduleIds = Array.from(
      new Set(
        compareIds
          .map((simId) => simulations.find((s) => s.id === simId)?.schedule_id)
          .filter((x): x is string => !!x),
      ),
    )
    if (scheduleIds.length < 2) {
      setCompareError('Select simulations covering at least 2 distinct schedules')
      return
    }
    setComparing(true)
    try {
      const res = await api.compareSimulations({ schedule_ids: scheduleIds })
      const rows: CompareRow[] = Array.isArray(res?.results) ? res.results : []
      setCompareResults(rows)
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : 'Failed to compare')
    } finally {
      setComparing(false)
    }
  }

  const selected = useMemo(
    () => simulations.find((s) => s.id === selectedId) ?? null,
    [simulations, selectedId],
  )

  const best = useMemo(() => {
    if (simulations.length === 0) return null
    return simulations.reduce((a, b) =>
      (b.projected_recovered_cents ?? 0) > (a.projected_recovered_cents ?? 0) ? b : a,
    )
  }, [simulations])

  const totalProjected = useMemo(
    () => simulations.reduce((acc, s) => acc + (s.projected_recovered_cents ?? 0), 0),
    [simulations],
  )

  const maxCompare = useMemo(() => {
    if (!compareResults || compareResults.length === 0) return 1
    return Math.max(...compareResults.map((r) => r.projected_recovered_cents ?? 0), 1)
  }, [compareResults])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Retry Simulator</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Run retry simulations against your open failed charges, inspect the recovery curve, and
            compare schedules head-to-head.
          </p>
        </div>
        <Button onClick={openRun} disabled={schedules.length === 0}>
          Run simulation
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Saved runs" value={simulations.length} />
        <Stat label="Schedules" value={schedules.length} />
        <Stat
          label="Best projected recovery"
          value={best ? dollars(best.projected_recovered_cents) : '—'}
          tone="emerald"
          hint={best ? best.name : undefined}
        />
        <Stat label="Total projected" value={dollars(totalProjected)} />
      </div>

      {loading ? (
        <PageSpinner label="Loading simulator..." />
      ) : error ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-red-400">{error}</p>
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : simulations.length === 0 ? (
        <EmptyState
          title="No simulations yet"
          description={
            schedules.length === 0
              ? 'Create a retry schedule first, then run a simulation here.'
              : 'Run your first simulation to project recovered revenue from a retry schedule.'
          }
          action={
            schedules.length > 0 ? <Button onClick={openRun}>Run simulation</Button> : undefined
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white">
                    {selected ? selected.name : 'Recovery curve'}
                  </h3>
                  {selected && (
                    <Badge tone="sky">{scheduleName(selected.schedule_id)}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardBody>
                {selected ? (
                  <>
                    <div className="mb-4 grid grid-cols-2 gap-4">
                      <Stat
                        label="Projected recovered"
                        value={dollars(selected.projected_recovered_cents)}
                        tone="emerald"
                      />
                      <Stat
                        label="Projected rate"
                        value={pct(selected.projected_recovery_rate)}
                      />
                    </div>
                    <RecoveryCurve curve={normalizeCurve(selected.curve)} />
                  </>
                ) : (
                  <p className="py-6 text-center text-sm text-zinc-500">
                    Select a simulation to view its curve.
                  </p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white">Compare schedules</h3>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={runCompare}
                    disabled={comparing || compareIds.length < 2}
                  >
                    {comparing ? 'Comparing...' : `Compare (${compareIds.length})`}
                  </Button>
                </div>
              </CardHeader>
              <CardBody>
                <p className="mb-3 text-xs text-zinc-500">
                  Tick simulations in the table, then compare their underlying schedules.
                </p>
                {compareError && (
                  <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                    {compareError}
                  </div>
                )}
                {comparing ? (
                  <Spinner label="Running comparison..." className="py-6" />
                ) : compareResults && compareResults.length > 0 ? (
                  <div className="space-y-3">
                    {compareResults
                      .slice()
                      .sort(
                        (a, b) =>
                          (b.projected_recovered_cents ?? 0) - (a.projected_recovered_cents ?? 0),
                      )
                      .map((r) => (
                        <div key={r.schedule_id}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="text-zinc-300">{scheduleName(r.schedule_id)}</span>
                            <span className="text-zinc-400">
                              {dollars(r.projected_recovered_cents)} · {pct(r.projected_recovery_rate)}
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-amber-400"
                              style={{
                                width: `${((r.projected_recovered_cents ?? 0) / maxCompare) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="py-2 text-sm text-zinc-500">No comparison run yet.</p>
                )}
              </CardBody>
            </Card>
          </div>

          <Card className="lg:col-span-1">
            <CardHeader>
              <h3 className="text-base font-semibold text-white">Saved runs</h3>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-8"></TH>
                    <TH>Run</TH>
                    <TH>Recovered</TH>
                    <TH></TH>
                  </TR>
                </THead>
                <TBody>
                  {simulations.map((s) => (
                    <TR
                      key={s.id}
                      className={`cursor-pointer ${selectedId === s.id ? 'bg-zinc-800/40' : ''}`}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <TD>
                        <input
                          type="checkbox"
                          checked={compareIds.includes(s.id)}
                          onChange={() => toggleCompare(s.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 accent-amber-500"
                        />
                      </TD>
                      <TD>
                        <div className="font-medium text-zinc-200">{s.name}</div>
                        <div className="text-[11px] text-zinc-500">
                          {scheduleName(s.schedule_id)}
                        </div>
                      </TD>
                      <TD>
                        <div className="font-medium text-amber-400">
                          {dollars(s.projected_recovered_cents)}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {pct(s.projected_recovery_rate)}
                        </div>
                      </TD>
                      <TD>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            removeSim(s)
                          }}
                          className="text-zinc-500 hover:text-red-400"
                          aria-label={`Delete ${s.name}`}
                        >
                          ✕
                        </button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </div>
      )}

      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title="Run simulation"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunOpen(false)} disabled={running}>
              Cancel
            </Button>
            <Button onClick={runSim} disabled={running}>
              {running ? 'Running...' : 'Run'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {runError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {runError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Schedule</label>
            <select
              value={runScheduleId}
              onChange={(e) => setRunScheduleId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
            >
              {schedules.length === 0 && <option value="">No schedules available</option>}
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Run name</label>
            <input
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="Q3 baseline"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Simulates the selected schedule against current open failed charges.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
