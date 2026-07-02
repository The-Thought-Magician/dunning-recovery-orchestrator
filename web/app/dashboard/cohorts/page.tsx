'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface Cohort {
  id: string
  name: string
  dimension: string
  filters?: Record<string, unknown> | null
  created_at?: string
}

interface RatePoint {
  period: string
  rate: number
  recovered_cents: number
}

interface CohortRate {
  cohort: Cohort
  points: RatePoint[]
}

interface CompareResult {
  cohort_id: string
  rate: number
}

const DIMENSIONS = ['plan', 'geography', 'card_brand', 'decline_class', 'tenure', 'mrr_band']

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100)
}

function toneForRate(rate: number): 'emerald' | 'amber' | 'red' {
  if (rate >= 0.6) return 'emerald'
  if (rate >= 0.3) return 'amber'
  return 'red'
}

function RateSparkline({ points }: { points: RatePoint[] }) {
  if (!points.length) return <span className="text-xs text-zinc-600">no data</span>
  const w = 240
  const h = 56
  const max = Math.max(...points.map((p) => p.rate), 0.01)
  const step = points.length > 1 ? w / (points.length - 1) : w
  const coords = points.map((p, i) => {
    const x = points.length > 1 ? i * step : w / 2
    const y = h - (p.rate / max) * (h - 6) - 3
    return [x, y] as const
  })
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${h} L${coords[0][0].toFixed(1)},${h} Z`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="max-w-full">
      <path d={area} fill="rgb(16 185 129 / 0.12)" />
      <path d={line} fill="none" stroke="rgb(52 211 153)" strokeWidth={2} />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.5} fill="rgb(52 211 153)" />
      ))}
    </svg>
  )
}

const emptyForm = { name: '', dimension: 'plan', filters: '{}' }

export default function CohortsPage() {
  const [cohorts, setCohorts] = useState<Cohort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [dimFilter, setDimFilter] = useState('')

  const [rates, setRates] = useState<Record<string, CohortRate>>({})
  const [ratesLoading, setRatesLoading] = useState<Record<string, boolean>>({})

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Cohort | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [compareResults, setCompareResults] = useState<CompareResult[] | null>(null)
  const [comparing, setComparing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getCohorts()
      setCohorts(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cohorts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const loadRate = useCallback(async (id: string) => {
    setRatesLoading((m) => ({ ...m, [id]: true }))
    try {
      const data = await api.getCohortRate(id)
      setRates((m) => ({ ...m, [id]: data as CohortRate }))
    } catch {
      /* leave empty; row shows no data */
    } finally {
      setRatesLoading((m) => ({ ...m, [id]: false }))
    }
  }, [])

  // Lazily fetch rate data for every visible cohort.
  useEffect(() => {
    for (const c of cohorts) {
      if (rates[c.id] === undefined && !ratesLoading[c.id]) loadRate(c.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohorts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cohorts.filter((c) => {
      if (dimFilter && c.dimension !== dimFilter) return false
      if (q && !c.name.toLowerCase().includes(q) && !c.dimension.toLowerCase().includes(q)) return false
      return true
    })
  }, [cohorts, search, dimFilter])

  function latestRate(id: string): number | null {
    const r = rates[id]
    if (!r || !r.points?.length) return null
    return r.points[r.points.length - 1].rate
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(c: Cohort) {
    setEditing(c)
    setForm({
      name: c.name,
      dimension: c.dimension,
      filters: JSON.stringify(c.filters ?? {}, null, 2),
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submitForm() {
    setFormError(null)
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    let filters: unknown
    try {
      filters = form.filters.trim() ? JSON.parse(form.filters) : {}
    } catch {
      setFormError('Filters must be valid JSON')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await api.updateCohort(editing.id, { name: form.name.trim(), dimension: form.dimension, filters })
      } else {
        await api.createCohort({ name: form.name.trim(), dimension: form.dimension, filters })
      }
      setModalOpen(false)
      await load()
      if (editing) loadRate(editing.id)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(c: Cohort) {
    if (!confirm(`Delete cohort "${c.name}"?`)) return
    try {
      await api.deleteCohort(c.id)
      setSelected((s) => {
        const n = new Set(s)
        n.delete(c.id)
        return n
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
    setCompareResults(null)
  }

  async function runCompare() {
    if (selected.size < 2) return
    setComparing(true)
    setError(null)
    try {
      const res = await api.compareCohorts({ cohort_ids: Array.from(selected) })
      setCompareResults((res?.results as CompareResult[]) ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compare failed')
    } finally {
      setComparing(false)
    }
  }

  const cohortName = (id: string) => cohorts.find((c) => c.id === id)?.name ?? id
  const maxCompareRate = useMemo(
    () => Math.max(0.01, ...(compareResults ?? []).map((r) => r.rate)),
    [compareResults],
  )

  if (loading) return <PageSpinner label="Loading cohorts..." />

  const avgLatest = (() => {
    const vals = cohorts.map((c) => latestRate(c.id)).filter((v): v is number => v !== null)
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  })()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Cohort Recovery</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Slice involuntary churn recovery by dimension and benchmark cohorts head to head.
          </p>
        </div>
        <Button onClick={openCreate}>New cohort</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Cohorts" value={cohorts.length} hint="defined segments" />
        <Stat
          label="Avg latest recovery"
          value={avgLatest === null ? '—' : pct(avgLatest)}
          tone={avgLatest === null ? 'default' : toneForRate(avgLatest)}
          hint="across all cohorts"
        />
        <Stat label="Selected to compare" value={selected.size} hint="pick 2+ to benchmark" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cohorts..."
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
            />
            <select
              value={dimFilter}
              onChange={(e) => setDimFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
            >
              <option value="">All dimensions</option>
              {DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" variant="secondary" disabled={selected.size < 2 || comparing} onClick={runCompare}>
            {comparing ? 'Comparing...' : `Compare selected (${selected.size})`}
          </Button>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={cohorts.length === 0 ? 'No cohorts yet' : 'No cohorts match your filters'}
                description={
                  cohorts.length === 0
                    ? 'Create a cohort to track recovery rates for a slice of your subscription book.'
                    : 'Try clearing the search or dimension filter.'
                }
                action={
                  cohorts.length === 0 ? (
                    <Button size="sm" onClick={openCreate}>
                      New cohort
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10"></TH>
                  <TH>Cohort</TH>
                  <TH>Dimension</TH>
                  <TH>Latest rate</TH>
                  <TH>Trend</TH>
                  <TH className="text-right">Recovered</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => {
                  const r = rates[c.id]
                  const lr = latestRate(c.id)
                  const recovered = r?.points?.reduce((a, p) => a + (p.recovered_cents || 0), 0) ?? 0
                  return (
                    <TR key={c.id}>
                      <TD>
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleSelect(c.id)}
                          className="h-4 w-4 accent-amber-500"
                        />
                      </TD>
                      <TD className="font-medium text-zinc-100">{c.name}</TD>
                      <TD>
                        <Badge tone="slate">{c.dimension}</Badge>
                      </TD>
                      <TD>
                        {ratesLoading[c.id] ? (
                          <span className="text-xs text-zinc-600">…</span>
                        ) : lr === null ? (
                          <span className="text-xs text-zinc-600">—</span>
                        ) : (
                          <Badge tone={toneForRate(lr)}>{pct(lr)}</Badge>
                        )}
                      </TD>
                      <TD>{r ? <RateSparkline points={r.points} /> : <span className="text-xs text-zinc-600">…</span>}</TD>
                      <TD className="text-right tabular-nums text-zinc-200">{money(recovered)}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                            Delete
                          </Button>
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

      {compareResults && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Comparison</h2>
          </CardHeader>
          <CardBody>
            {compareResults.length === 0 ? (
              <p className="text-sm text-zinc-500">No comparison data returned.</p>
            ) : (
              <div className="space-y-3">
                {compareResults
                  .slice()
                  .sort((a, b) => b.rate - a.rate)
                  .map((r) => (
                    <div key={r.cohort_id} className="flex items-center gap-3">
                      <div className="w-40 shrink-0 truncate text-sm text-zinc-300">{cohortName(r.cohort_id)}</div>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-zinc-800">
                        <div
                          className="flex h-full items-center justify-end rounded bg-amber-500/70 px-2 text-xs font-medium text-zinc-950"
                          style={{ width: `${Math.max(6, (r.rate / maxCompareRate) * 100)}%` }}
                        >
                          {pct(r.rate)}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit cohort' : 'New cohort'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? <Spinner /> : editing ? 'Save changes' : 'Create cohort'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Enterprise plan — EU"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Dimension</label>
            <select
              value={form.dimension}
              onChange={(e) => setForm({ ...form, dimension: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
            >
              {DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Filters (JSON)
            </label>
            <textarea
              value={form.filters}
              onChange={(e) => setForm({ ...form, filters: e.target.value })}
              rows={5}
              spellCheck={false}
              placeholder='{ "plan_name": "Enterprise", "geography": "EU" }'
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-zinc-600">Key/value constraints applied to the subscription book.</p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
