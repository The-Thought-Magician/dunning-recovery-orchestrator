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
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface DeclineCode {
  id: string
  code: string
  network_codes?: string[] | null
  label: string
  decline_class: string
  category: string
  recoverable: boolean
  default_tactic: string | null
  description?: string | null
  // override fields merged in by backend
  override_id?: string | null
  is_overridden?: boolean
  override?: {
    id: string
    decline_class?: string | null
    recoverable?: boolean | null
    default_tactic?: string | null
    notes?: string | null
  } | null
}

interface RateInfo {
  code: string
  attempted: number
  recovered: number
  rate: number
}

const CLASS_TONES: Record<string, 'emerald' | 'amber' | 'red' | 'slate' | 'sky' | 'violet'> = {
  soft: 'amber',
  hard: 'red',
  technical: 'sky',
  fraud: 'violet',
}

function classTone(cls: string): 'emerald' | 'amber' | 'red' | 'slate' | 'sky' | 'violet' {
  return CLASS_TONES[cls?.toLowerCase()] ?? 'slate'
}

function pct(n: number): string {
  if (!isFinite(n)) return '0%'
  return `${(n * 100).toFixed(1)}%`
}

function RateBar({ rate }: { rate: number }) {
  const w = Math.max(0, Math.min(100, rate * 100))
  const tone = w >= 50 ? 'bg-amber-500' : w >= 25 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full ${tone}`} style={{ width: `${w}%` }} />
      </div>
      <span className="tabular-nums text-xs text-zinc-400">{pct(rate)}</span>
    </div>
  )
}

export default function TaxonomyPage() {
  const [codes, setCodes] = useState<DeclineCode[]>([])
  const [rates, setRates] = useState<Record<string, RateInfo>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [classFilter, setClassFilter] = useState('all')
  const [recoverableFilter, setRecoverableFilter] = useState('all')
  const [onlyOverridden, setOnlyOverridden] = useState(false)

  const [editing, setEditing] = useState<DeclineCode | null>(null)
  const [form, setForm] = useState({ decline_class: '', recoverable: 'inherit', default_tactic: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getDeclineCodes()
      const list: DeclineCode[] = Array.isArray(data) ? data : []
      setCodes(list)
      // fetch recovery rates per code in parallel; tolerate individual failures
      const results = await Promise.allSettled(
        list.map(async (c) => {
          const r = await api.getDeclineCodeRate(c.code)
          return [c.code, r] as const
        })
      )
      const map: Record<string, RateInfo> = {}
      for (const res of results) {
        if (res.status === 'fulfilled') {
          const [code, r] = res.value
          if (r && typeof r === 'object') map[code] = r as RateInfo
        }
      }
      setRates(map)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load decline-code taxonomy')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const classes = useMemo(() => {
    const s = new Set<string>()
    codes.forEach((c) => c.decline_class && s.add(c.decline_class))
    return Array.from(s).sort()
  }, [codes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return codes.filter((c) => {
      if (q) {
        const hay = `${c.code} ${c.label} ${c.category} ${c.default_tactic ?? ''} ${(c.network_codes ?? []).join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (classFilter !== 'all' && c.decline_class !== classFilter) return false
      if (recoverableFilter === 'yes' && !c.recoverable) return false
      if (recoverableFilter === 'no' && c.recoverable) return false
      if (onlyOverridden && !(c.is_overridden || c.override || c.override_id)) return false
      return true
    })
  }, [codes, query, classFilter, recoverableFilter, onlyOverridden])

  const stats = useMemo(() => {
    const total = codes.length
    const recoverable = codes.filter((c) => c.recoverable).length
    const overridden = codes.filter((c) => c.is_overridden || c.override || c.override_id).length
    let attempted = 0
    let recovered = 0
    for (const r of Object.values(rates)) {
      attempted += r.attempted ?? 0
      recovered += r.recovered ?? 0
    }
    const blended = attempted > 0 ? recovered / attempted : 0
    return { total, recoverable, overridden, blended, attempted }
  }, [codes, rates])

  function openEdit(c: DeclineCode) {
    setActionMsg(null)
    setEditing(c)
    const ov = c.override
    setForm({
      decline_class: ov?.decline_class ?? c.decline_class ?? '',
      recoverable: ov?.recoverable == null ? 'inherit' : ov.recoverable ? 'yes' : 'no',
      default_tactic: ov?.default_tactic ?? '',
      notes: ov?.notes ?? '',
    })
  }

  async function saveOverride() {
    if (!editing) return
    setSaving(true)
    setActionMsg(null)
    try {
      const body: Record<string, unknown> = { code: editing.code }
      if (form.decline_class.trim()) body.decline_class = form.decline_class.trim()
      if (form.recoverable !== 'inherit') body.recoverable = form.recoverable === 'yes'
      if (form.default_tactic.trim()) body.default_tactic = form.default_tactic.trim()
      if (form.notes.trim()) body.notes = form.notes.trim()
      await api.upsertDeclineOverride(body)
      setEditing(null)
      await load()
    } catch (e: any) {
      setActionMsg(e?.message ?? 'Failed to save override')
    } finally {
      setSaving(false)
    }
  }

  async function removeOverride(c: DeclineCode) {
    const id = c.override?.id ?? c.override_id
    if (!id) return
    if (!confirm(`Remove override for ${c.code}? It will revert to the canonical taxonomy.`)) return
    setActionMsg(null)
    try {
      await api.deleteDeclineOverride(id)
      await load()
    } catch (e: any) {
      setActionMsg(e?.message ?? 'Failed to remove override')
    }
  }

  if (loading) return <PageSpinner label="Loading decline-code taxonomy..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Decline-Code Taxonomy</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Canonical processor decline codes merged with your workspace overrides, with measured recovery rates.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>

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
        <Stat label="Codes in taxonomy" value={stats.total} />
        <Stat label="Recoverable" value={stats.recoverable} tone="emerald" />
        <Stat label="Overrides active" value={stats.overridden} tone={stats.overridden > 0 ? 'amber' : 'default'} />
        <Stat
          label="Blended recovery"
          value={pct(stats.blended)}
          tone="emerald"
          hint={`${stats.attempted.toLocaleString()} attempts`}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, label, tactic..."
            className="min-w-[200px] flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
          />
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="all">All classes</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={recoverableFilter}
            onChange={(e) => setRecoverableFilter(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="all">Recoverable: any</option>
            <option value="yes">Recoverable</option>
            <option value="no">Not recoverable</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={onlyOverridden}
              onChange={(e) => setOnlyOverridden(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-amber-500"
            />
            Overridden only
          </label>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No decline codes match"
              description="Adjust your filters or seed sample data to populate the taxonomy."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Label</TH>
                  <TH>Class</TH>
                  <TH>Recoverable</TH>
                  <TH>Default tactic</TH>
                  <TH>Recovery rate</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((c) => {
                  const r = rates[c.code]
                  const overridden = Boolean(c.is_overridden || c.override || c.override_id)
                  return (
                    <TR key={c.id}>
                      <TD>
                        <div className="flex items-center gap-2 font-mono text-xs text-zinc-200">
                          {c.code}
                          {overridden && <Badge tone="amber">override</Badge>}
                        </div>
                        {c.network_codes && c.network_codes.length > 0 && (
                          <div className="mt-0.5 font-mono text-[10px] text-zinc-600">
                            {c.network_codes.join(', ')}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <div className="text-zinc-200">{c.label}</div>
                        <div className="text-xs text-zinc-500">{c.category}</div>
                      </TD>
                      <TD>
                        <Badge tone={classTone(c.decline_class)}>{c.decline_class}</Badge>
                      </TD>
                      <TD>
                        {c.recoverable ? (
                          <Badge tone="emerald">yes</Badge>
                        ) : (
                          <Badge tone="slate">no</Badge>
                        )}
                      </TD>
                      <TD>
                        {c.default_tactic ? (
                          <span className="font-mono text-xs text-zinc-300">{c.default_tactic}</span>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </TD>
                      <TD>{r ? <RateBar rate={r.rate ?? 0} /> : <span className="text-xs text-zinc-600">no data</span>}</TD>
                      <TD>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => openEdit(c)}>
                            {overridden ? 'Edit override' : 'Override'}
                          </Button>
                          {overridden && (
                            <Button size="sm" variant="danger" onClick={() => removeOverride(c)}>
                              Reset
                            </Button>
                          )}
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

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Override ${editing.code}` : 'Override'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveOverride} disabled={saving}>
              {saving ? 'Saving...' : 'Save override'}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Canonical: <span className="text-zinc-200">{editing.label}</span> ·{' '}
              <span className="font-mono">{editing.decline_class}</span> ·{' '}
              {editing.recoverable ? 'recoverable' : 'not recoverable'}
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Decline class
              </label>
              <input
                value={form.decline_class}
                onChange={(e) => setForm({ ...form, decline_class: e.target.value })}
                placeholder={editing.decline_class}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Recoverable
              </label>
              <select
                value={form.recoverable}
                onChange={(e) => setForm({ ...form, recoverable: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
              >
                <option value="inherit">Inherit canonical ({editing.recoverable ? 'yes' : 'no'})</option>
                <option value="yes">Recoverable</option>
                <option value="no">Not recoverable</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Default tactic
              </label>
              <input
                value={form.default_tactic}
                onChange={(e) => setForm({ ...form, default_tactic: e.target.value })}
                placeholder={editing.default_tactic ?? 'tactic key'}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                placeholder="Why this override exists"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
              />
            </div>
            {actionMsg && <p className="text-sm text-red-400">{actionMsg}</p>}
          </div>
        )}
      </Modal>
    </div>
  )
}
