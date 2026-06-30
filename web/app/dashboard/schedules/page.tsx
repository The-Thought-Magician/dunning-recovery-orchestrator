'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'

interface PerCodeOverride {
  code: string
  offsets: number[]
}

interface RetrySchedule {
  id: string
  name: string
  offsets: number[]
  payday_aligned: boolean
  issuer_pattern: boolean
  per_code_overrides: PerCodeOverride[] | Record<string, number[]> | null
  is_default: boolean
  created_at?: string
}

interface FormState {
  name: string
  offsetsText: string
  payday_aligned: boolean
  issuer_pattern: boolean
  overrides: PerCodeOverride[]
}

const EMPTY_FORM: FormState = {
  name: '',
  offsetsText: '0, 24, 72, 120',
  payday_aligned: false,
  issuer_pattern: false,
  overrides: [],
}

function parseOffsets(text: string): number[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 0)
}

function normalizeOverrides(raw: RetrySchedule['per_code_overrides']): PerCodeOverride[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  return Object.entries(raw).map(([code, offsets]) => ({
    code,
    offsets: Array.isArray(offsets) ? offsets : [],
  }))
}

function fmtHours(h: number): string {
  if (h === 0) return 'immediate'
  if (h % 24 === 0) return `${h / 24}d`
  return `${h}h`
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<RetrySchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RetrySchedule | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [newOverrideCode, setNewOverrideCode] = useState('')
  const [newOverrideOffsets, setNewOverrideOffsets] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getSchedules()
      setSchedules(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setNewOverrideCode('')
    setNewOverrideOffsets('')
    setFormError(null)
    setModalOpen(true)
  }

  const openEdit = (s: RetrySchedule) => {
    setEditing(s)
    setForm({
      name: s.name,
      offsetsText: (s.offsets ?? []).join(', '),
      payday_aligned: !!s.payday_aligned,
      issuer_pattern: !!s.issuer_pattern,
      overrides: normalizeOverrides(s.per_code_overrides),
    })
    setNewOverrideCode('')
    setNewOverrideOffsets('')
    setFormError(null)
    setModalOpen(true)
  }

  const addOverride = () => {
    const code = newOverrideCode.trim()
    if (!code) return
    const offsets = parseOffsets(newOverrideOffsets)
    if (offsets.length === 0) return
    setForm((f) => ({
      ...f,
      overrides: [...f.overrides.filter((o) => o.code !== code), { code, offsets }],
    }))
    setNewOverrideCode('')
    setNewOverrideOffsets('')
  }

  const removeOverride = (code: string) => {
    setForm((f) => ({ ...f, overrides: f.overrides.filter((o) => o.code !== code) }))
  }

  const submit = async () => {
    setFormError(null)
    const name = form.name.trim()
    if (!name) {
      setFormError('Name is required')
      return
    }
    const offsets = parseOffsets(form.offsetsText)
    if (offsets.length === 0) {
      setFormError('At least one valid retry offset (hours) is required')
      return
    }
    const payload = {
      name,
      offsets,
      payday_aligned: form.payday_aligned,
      issuer_pattern: form.issuer_pattern,
      per_code_overrides: form.overrides,
    }
    setSaving(true)
    try {
      if (editing) {
        await api.updateSchedule(editing.id, payload)
      } else {
        await api.createSchedule(payload)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (s: RetrySchedule) => {
    if (!confirm(`Delete schedule "${s.name}"? This cannot be undone.`)) return
    try {
      await api.deleteSchedule(s.id)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete schedule')
    }
  }

  const stats = useMemo(() => {
    const total = schedules.length
    const withOverrides = schedules.filter(
      (s) => normalizeOverrides(s.per_code_overrides).length > 0,
    ).length
    const paydayCount = schedules.filter((s) => s.payday_aligned).length
    const avgAttempts =
      total === 0
        ? 0
        : Math.round(
            (schedules.reduce((acc, s) => acc + (s.offsets?.length ?? 0), 0) / total) * 10,
          ) / 10
    return { total, withOverrides, paydayCount, avgAttempts }
  }, [schedules])

  const previewOffsets = parseOffsets(form.offsetsText)
  const maxOffset = previewOffsets.length ? Math.max(...previewOffsets) : 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Retry Schedules</h1>
          <p className="mt-1 text-sm text-slate-400">
            Design retry cadences with payday-aware and issuer-pattern timing, plus per-decline-code
            overrides.
          </p>
        </div>
        <Button onClick={openCreate}>New schedule</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Schedules" value={stats.total} />
        <Stat label="Avg attempts" value={stats.avgAttempts} tone="emerald" />
        <Stat label="With code overrides" value={stats.withOverrides} />
        <Stat label="Payday-aligned" value={stats.paydayCount} tone="amber" />
      </div>

      {loading ? (
        <PageSpinner label="Loading schedules..." />
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
      ) : schedules.length === 0 ? (
        <EmptyState
          title="No retry schedules yet"
          description="Create your first retry schedule to define when failed charges are re-attempted."
          action={<Button onClick={openCreate}>New schedule</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {schedules.map((s) => {
            const overrides = normalizeOverrides(s.per_code_overrides)
            const max = s.offsets?.length ? Math.max(...s.offsets, 1) : 1
            return (
              <Card key={s.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-white">{s.name}</h3>
                      {s.is_default && <Badge tone="emerald">Default</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(s)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.payday_aligned && <Badge tone="amber">Payday aligned</Badge>}
                    {s.issuer_pattern && <Badge tone="sky">Issuer pattern</Badge>}
                    <Badge tone="slate">{s.offsets?.length ?? 0} attempts</Badge>
                  </div>
                </CardHeader>
                <CardBody className="space-y-4">
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Retry timeline
                    </div>
                    <div className="relative h-12 rounded-lg border border-slate-800 bg-slate-950/40">
                      <div className="absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-slate-800" />
                      {(s.offsets ?? []).map((h, i) => {
                        const pct = (h / max) * 100
                        return (
                          <div
                            key={i}
                            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                            style={{ left: `calc(${pct}% * 0.92 + 4%)` }}
                            title={`Attempt ${i + 1}: ${fmtHours(h)}`}
                          >
                            <div className="h-3 w-3 rounded-full border-2 border-slate-950 bg-emerald-400" />
                            <div className="mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] text-slate-500">
                              {fmtHours(h)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {overrides.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        Per-code overrides
                      </div>
                      <div className="space-y-1">
                        {overrides.map((o) => (
                          <div
                            key={o.code}
                            className="flex items-center justify-between rounded-md bg-slate-800/40 px-3 py-1.5 text-xs"
                          >
                            <span className="font-mono text-slate-300">{o.code}</span>
                            <span className="text-slate-400">
                              {o.offsets.map(fmtHours).join(' → ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit schedule' : 'New retry schedule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create schedule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Aggressive 4-step"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Retry offsets (hours, comma-separated)
            </label>
            <input
              value={form.offsetsText}
              onChange={(e) => setForm((f) => ({ ...f, offsetsText: e.target.value }))}
              placeholder="0, 24, 72, 120"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-emerald-500"
            />
            {previewOffsets.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {previewOffsets.map((h, i) => (
                  <Badge key={i} tone="emerald">
                    #{i + 1} {fmtHours(h)}
                  </Badge>
                ))}
              </div>
            )}
            {previewOffsets.length > 0 && (
              <div className="relative mt-3 h-8 rounded-md border border-slate-800 bg-slate-950/40">
                <div className="absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-slate-800" />
                {previewOffsets.map((h, i) => (
                  <div
                    key={i}
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-400"
                    style={{ left: `calc(${(h / maxOffset) * 100}% * 0.92 + 4%)` }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <input
                type="checkbox"
                checked={form.payday_aligned}
                onChange={(e) => setForm((f) => ({ ...f, payday_aligned: e.target.checked }))}
                className="h-4 w-4 accent-emerald-500"
              />
              <span className="text-sm text-slate-200">Payday aligned</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <input
                type="checkbox"
                checked={form.issuer_pattern}
                onChange={(e) => setForm((f) => ({ ...f, issuer_pattern: e.target.checked }))}
                className="h-4 w-4 accent-emerald-500"
              />
              <span className="text-sm text-slate-200">Issuer pattern</span>
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Per-decline-code overrides
            </label>
            <div className="space-y-1.5">
              {form.overrides.map((o) => (
                <div
                  key={o.code}
                  className="flex items-center justify-between rounded-md bg-slate-800/50 px-3 py-1.5 text-xs"
                >
                  <span className="font-mono text-slate-200">{o.code}</span>
                  <span className="text-slate-400">{o.offsets.map(fmtHours).join(', ')}</span>
                  <button
                    onClick={() => removeOverride(o.code)}
                    className="text-slate-500 hover:text-red-400"
                    aria-label={`Remove ${o.code} override`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newOverrideCode}
                onChange={(e) => setNewOverrideCode(e.target.value)}
                placeholder="insufficient_funds"
                className="w-1/2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-emerald-500"
              />
              <input
                value={newOverrideOffsets}
                onChange={(e) => setNewOverrideOffsets(e.target.value)}
                placeholder="0, 72, 168"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-emerald-500"
              />
              <Button size="sm" variant="secondary" onClick={addOverride}>
                Add
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
