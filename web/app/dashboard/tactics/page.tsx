'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Tactic {
  id: string
  key: string
  name: string
  description: string | null
  config: Record<string, unknown> | null
  measured_recovery_rate: number | null
  created_at?: string
}

function pct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function rateTone(n: number | null | undefined): 'emerald' | 'amber' | 'red' | 'slate' {
  if (n == null) return 'slate'
  if (n >= 0.5) return 'emerald'
  if (n >= 0.25) return 'amber'
  return 'red'
}

function emptyForm() {
  return { key: '', name: '', description: '', config: '{}' }
}

export default function TacticsPage() {
  const [tactics, setTactics] = useState<Tactic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'rate' | 'name'>('rate')

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Tactic | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ tone: 'emerald' | 'red'; text: string } | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getTactics()
      setTactics(Array.isArray(data) ? data : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load tactics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = tactics.filter((t) => {
      if (!q) return true
      return `${t.key} ${t.name} ${t.description ?? ''}`.toLowerCase().includes(q)
    })
    list = [...list].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      return (b.measured_recovery_rate ?? -1) - (a.measured_recovery_rate ?? -1)
    })
    return list
  }, [tactics, query, sort])

  const stats = useMemo(() => {
    const measured = tactics.filter((t) => t.measured_recovery_rate != null)
    const best = measured.reduce<Tactic | null>(
      (acc, t) => (acc == null || (t.measured_recovery_rate ?? 0) > (acc.measured_recovery_rate ?? 0) ? t : acc),
      null
    )
    const avg = measured.length
      ? measured.reduce((s, t) => s + (t.measured_recovery_rate ?? 0), 0) / measured.length
      : 0
    return { total: tactics.length, measured: measured.length, best, avg }
  }, [tactics])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormErr(null)
    setShowForm(true)
  }

  function openEdit(t: Tactic) {
    setEditing(t)
    setForm({
      key: t.key,
      name: t.name,
      description: t.description ?? '',
      config: JSON.stringify(t.config ?? {}, null, 2),
    })
    setFormErr(null)
    setShowForm(true)
  }

  async function save() {
    if (!form.key.trim()) return setFormErr('Key is required')
    if (!form.name.trim()) return setFormErr('Name is required')
    let config: unknown
    try {
      config = form.config.trim() ? JSON.parse(form.config) : {}
    } catch {
      return setFormErr('Config must be valid JSON')
    }
    setSaving(true)
    setFormErr(null)
    try {
      const body = {
        key: form.key.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        config,
      }
      if (editing) await api.updateTactic(editing.id, body)
      else await api.createTactic(body)
      setShowForm(false)
      await load()
      setBanner({ tone: 'emerald', text: editing ? 'Tactic updated' : 'Tactic created' })
    } catch (e: any) {
      setFormErr(e?.message ?? 'Failed to save tactic')
    } finally {
      setSaving(false)
    }
  }

  async function remove(t: Tactic) {
    if (!confirm(`Delete tactic "${t.name}"?`)) return
    setBanner(null)
    try {
      await api.deleteTactic(t.id)
      await load()
    } catch (e: any) {
      setBanner({ tone: 'red', text: e?.message ?? 'Failed to delete tactic' })
    }
  }

  if (loading) return <PageSpinner label="Loading recovery tactics..." />

  const maxRate = Math.max(0.01, ...tactics.map((t) => t.measured_recovery_rate ?? 0))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Recovery Tactics</h1>
          <p className="mt-1 text-sm text-slate-400">
            Your library of recovery plays with measured recovery rates from real attempts.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          New tactic
        </Button>
      </div>

      {banner && (
        <Card className={banner.tone === 'emerald' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}>
          <CardBody className={banner.tone === 'emerald' ? 'text-sm text-emerald-300' : 'text-sm text-red-300'}>
            {banner.text}
          </CardBody>
        </Card>
      )}

      {error && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardBody className="flex items-center justify-between gap-4">
            <span className="text-sm text-red-300">{error}</span>
            <Button variant="secondary" size="sm" onClick={load}>
              Retry
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Tactics" value={stats.total} />
        <Stat label="With measured data" value={stats.measured} tone="emerald" />
        <Stat label="Best performer" value={stats.best ? pct(stats.best.measured_recovery_rate) : '—'} tone="emerald" hint={stats.best?.name} />
        <Stat label="Average rate" value={pct(stats.avg)} />
      </div>

      {/* Performance bar chart (simple divs) */}
      {tactics.some((t) => t.measured_recovery_rate != null) && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Measured recovery by tactic</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            {[...tactics]
              .filter((t) => t.measured_recovery_rate != null)
              .sort((a, b) => (b.measured_recovery_rate ?? 0) - (a.measured_recovery_rate ?? 0))
              .map((t) => {
                const rate = t.measured_recovery_rate ?? 0
                const w = (rate / maxRate) * 100
                return (
                  <div key={t.id} className="flex items-center gap-3">
                    <div className="w-40 truncate text-xs text-slate-400" title={t.name}>
                      {t.name}
                    </div>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${w}%` }} />
                    </div>
                    <div className="w-14 text-right text-xs tabular-nums text-slate-300">{pct(rate)}</div>
                  </div>
                )
              })}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tactics..."
            className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as 'rate' | 'name')}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="rate">Sort by rate</option>
            <option value="name">Sort by name</option>
          </select>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={tactics.length === 0 ? 'No tactics yet' : 'No tactics match'}
              description={
                tactics.length === 0
                  ? 'Create your first recovery tactic to start routing declines to it.'
                  : 'Adjust your search.'
              }
              action={
                tactics.length === 0 ? (
                  <Button size="sm" onClick={openCreate}>
                    New tactic
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((t) => (
                <div key={t.id} className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{t.name}</div>
                      <div className="mt-0.5 font-mono text-xs text-slate-500">{t.key}</div>
                    </div>
                    <Badge tone={rateTone(t.measured_recovery_rate)}>{pct(t.measured_recovery_rate)}</Badge>
                  </div>
                  <p className="mt-2 flex-1 text-xs text-slate-400">{t.description || 'No description.'}</p>
                  {t.config && Object.keys(t.config).length > 0 && (
                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-2">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-600">Config</div>
                      <pre className="overflow-x-auto text-[11px] leading-tight text-slate-400">
                        {JSON.stringify(t.config, null, 2)}
                      </pre>
                    </div>
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openEdit(t)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => remove(t)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? 'Edit tactic' : 'New tactic'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create tactic'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Key</label>
              <input
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                disabled={Boolean(editing)}
                placeholder="smart_retry"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Smart Retry"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="What this tactic does"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Config (JSON)
            </label>
            <textarea
              value={form.config}
              onChange={(e) => setForm({ ...form, config: e.target.value })}
              rows={5}
              spellCheck={false}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          {formErr && <p className="text-sm text-red-400">{formErr}</p>}
        </div>
      </Modal>
    </div>
  )
}
