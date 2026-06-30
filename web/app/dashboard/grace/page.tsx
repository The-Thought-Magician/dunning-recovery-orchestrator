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

interface GracePolicy {
  id: string
  name: string
  plan_name?: string | null
  grace_days: number
  soft_suspend_after_days: number
  version: number
  projected_impact_cents?: number | null
  created_at?: string
}

interface ModelResult {
  projected_impact_cents: number
  detail?: Record<string, unknown> | null
}

function money(cents: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100)
}

const emptyForm = { name: '', plan_name: '', grace_days: 7, soft_suspend_after_days: 14 }

// Visual timeline of the customer lifecycle for a policy.
function PolicyTimeline({ grace, suspend }: { grace: number; suspend: number }) {
  const total = Math.max(grace, suspend, 1)
  const gracePct = Math.min(100, (grace / total) * 100)
  const suspendPct = Math.min(100, (suspend / total) * 100)
  return (
    <div className="space-y-2">
      <div className="relative h-8 w-full overflow-hidden rounded-lg bg-slate-800">
        <div
          className="absolute inset-y-0 left-0 bg-emerald-500/40"
          style={{ width: `${gracePct}%` }}
          title={`Grace: ${grace}d`}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-amber-400"
          style={{ left: `${gracePct}%` }}
          title={`Grace ends day ${grace}`}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-red-400"
          style={{ left: `${suspendPct}%` }}
          title={`Soft suspend day ${suspend}`}
        />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>Day 0 — failure</span>
        <span className="text-amber-400">Grace {grace}d</span>
        <span className="text-red-400">Suspend {suspend}d</span>
      </div>
    </div>
  )
}

export default function GracePage() {
  const [policies, setPolicies] = useState<GracePolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<GracePolicy | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [modelOpen, setModelOpen] = useState(false)
  const [modelPolicy, setModelPolicy] = useState<GracePolicy | null>(null)
  const [modelResult, setModelResult] = useState<ModelResult | null>(null)
  const [modeling, setModeling] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getGracePolicies()
      setPolicies(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load grace policies')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return policies
    return policies.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.plan_name ?? '').toLowerCase().includes(q),
    )
  }, [policies, search])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(p: GracePolicy) {
    setEditing(p)
    setForm({
      name: p.name,
      plan_name: p.plan_name ?? '',
      grace_days: p.grace_days,
      soft_suspend_after_days: p.soft_suspend_after_days,
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
    if (form.grace_days < 0 || form.soft_suspend_after_days < 0) {
      setFormError('Day values cannot be negative')
      return
    }
    const body = {
      name: form.name.trim(),
      plan_name: form.plan_name.trim() || null,
      grace_days: Number(form.grace_days),
      soft_suspend_after_days: Number(form.soft_suspend_after_days),
    }
    setSaving(true)
    try {
      if (editing) await api.updateGracePolicy(editing.id, body)
      else await api.createGracePolicy(body)
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(p: GracePolicy) {
    if (!confirm(`Delete policy "${p.name}"?`)) return
    try {
      await api.deleteGracePolicy(p.id)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function openModel(p: GracePolicy) {
    setModelPolicy(p)
    setModelResult(null)
    setModelError(null)
    setModelOpen(true)
    setModeling(true)
    try {
      const res = await api.modelGracePolicy(p.id)
      setModelResult(res as ModelResult)
      // Reflect the freshly modeled impact in the table.
      await load()
    } catch (e) {
      setModelError(e instanceof Error ? e.message : 'Modeling failed')
    } finally {
      setModeling(false)
    }
  }

  if (loading) return <PageSpinner label="Loading grace policies..." />

  const totalImpact = policies.reduce((a, p) => a + (p.projected_impact_cents || 0), 0)
  const avgGrace = policies.length
    ? Math.round(policies.reduce((a, p) => a + p.grace_days, 0) / policies.length)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Grace & Soft Suspension</h1>
          <p className="mt-1 text-sm text-slate-400">
            Model how grace windows and soft-suspension timing affect recovered revenue before you ship a policy.
          </p>
        </div>
        <Button onClick={openCreate}>New policy</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Policies" value={policies.length} hint="defined" />
        <Stat label="Modeled impact" value={money(totalImpact)} tone="emerald" hint="sum of projected impact" />
        <Stat label="Avg grace window" value={`${avgGrace}d`} hint="across policies" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search policies..."
            className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={policies.length === 0 ? 'No grace policies yet' : 'No policies match your search'}
                description={
                  policies.length === 0
                    ? 'Define a grace window and soft-suspension threshold, then model its revenue impact.'
                    : 'Try a different search term.'
                }
                action={
                  policies.length === 0 ? (
                    <Button size="sm" onClick={openCreate}>
                      New policy
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Policy</TH>
                  <TH>Plan</TH>
                  <TH className="text-right">Grace</TH>
                  <TH className="text-right">Suspend after</TH>
                  <TH className="text-right">Version</TH>
                  <TH className="text-right">Projected impact</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-slate-100">{p.name}</TD>
                    <TD>
                      {p.plan_name ? <Badge tone="sky">{p.plan_name}</Badge> : <span className="text-slate-600">All plans</span>}
                    </TD>
                    <TD className="text-right tabular-nums text-slate-200">{p.grace_days}d</TD>
                    <TD className="text-right tabular-nums text-slate-200">{p.soft_suspend_after_days}d</TD>
                    <TD className="text-right">
                      <Badge tone="slate">v{p.version}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">
                      {p.projected_impact_cents == null ? (
                        <span className="text-slate-600">not modeled</span>
                      ) : (
                        <span className="text-emerald-400">{money(p.projected_impact_cents)}</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openModel(p)}>
                          Model
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(p)}>
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit policy${editing ? ` (v${editing.version})` : ''}` : 'New grace policy'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? <Spinner /> : editing ? 'Save & bump version' : 'Create policy'}
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
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Standard 7-day grace"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Plan (optional)
            </label>
            <input
              value={form.plan_name}
              onChange={(e) => setForm({ ...form, plan_name: e.target.value })}
              placeholder="Leave blank to apply to all plans"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Grace days
              </label>
              <input
                type="number"
                min={0}
                value={form.grace_days}
                onChange={(e) => setForm({ ...form, grace_days: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Soft suspend after (days)
              </label>
              <input
                type="number"
                min={0}
                value={form.soft_suspend_after_days}
                onChange={(e) => setForm({ ...form, soft_suspend_after_days: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Lifecycle preview</div>
            <PolicyTimeline grace={Number(form.grace_days)} suspend={Number(form.soft_suspend_after_days)} />
          </div>
        </div>
      </Modal>

      {/* Model impact modal */}
      <Modal
        open={modelOpen}
        onClose={() => setModelOpen(false)}
        title={`Impact model — ${modelPolicy?.name ?? ''}`}
        footer={
          <Button variant="secondary" onClick={() => setModelOpen(false)}>
            Close
          </Button>
        }
      >
        {modeling ? (
          <div className="py-8">
            <Spinner label="Modeling revenue impact..." />
          </div>
        ) : modelError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {modelError}
          </div>
        ) : modelResult ? (
          <div className="space-y-4">
            {modelPolicy && (
              <PolicyTimeline grace={modelPolicy.grace_days} suspend={modelPolicy.soft_suspend_after_days} />
            )}
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-center">
              <div className="text-xs font-medium uppercase tracking-wide text-emerald-400/80">
                Projected revenue impact
              </div>
              <div className="mt-1 text-3xl font-semibold text-emerald-400">
                {money(modelResult.projected_impact_cents)}
              </div>
            </div>
            {modelResult.detail && Object.keys(modelResult.detail).length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Breakdown</div>
                <div className="space-y-1.5">
                  {Object.entries(modelResult.detail).map(([k, v]) => (
                    <div key={k} className="flex justify-between border-b border-slate-800/60 pb-1.5 text-sm">
                      <span className="text-slate-400">{k.replace(/_/g, ' ')}</span>
                      <span className="tabular-nums text-slate-200">
                        {typeof v === 'number' && /cents/i.test(k) ? money(v) : String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No model output.</p>
        )}
      </Modal>
    </div>
  )
}
