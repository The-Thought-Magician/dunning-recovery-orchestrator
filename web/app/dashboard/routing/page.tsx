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

interface Condition {
  field: string
  op: string
  value: string
}

interface RoutingRule {
  id: string
  name: string
  priority: number
  conditions: Condition[] | Record<string, unknown> | null
  target_tactic: string
  is_active: boolean
  created_at?: string
}

interface RoutingDecision {
  id: string
  failed_charge_id: string
  rule_id: string | null
  chosen_tactic: string
  reason: string
  created_at?: string
}

interface SimAssignment {
  charge_id: string
  tactic: string
  rule_id: string | null
}

interface SimResult {
  assignments: SimAssignment[]
  counts: Record<string, number>
}

const FIELDS = ['decline_code', 'decline_class', 'card_brand', 'plan_name', 'geography', 'amount_cents', 'retry_count']
const OPS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'contains']

function asConditions(c: RoutingRule['conditions']): Condition[] {
  if (Array.isArray(c)) return c as Condition[]
  if (c && typeof c === 'object') {
    // tolerate object map form {field: value}
    return Object.entries(c).map(([field, value]) => ({ field, op: 'eq', value: String(value) }))
  }
  return []
}

function emptyForm() {
  return {
    name: '',
    priority: 100,
    target_tactic: '',
    is_active: true,
    conditions: [{ field: 'decline_code', op: 'eq', value: '' }] as Condition[],
  }
}

export default function RoutingPage() {
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [decisions, setDecisions] = useState<RoutingDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<{ tone: 'emerald' | 'red'; text: string } | null>(null)

  const [editing, setEditing] = useState<RoutingRule | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const [sim, setSim] = useState<SimResult | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [r, d] = await Promise.all([api.getRoutingRules(), api.getRoutingDecisions()])
      setRules(Array.isArray(r) ? r : [])
      setDecisions(Array.isArray(d) ? d : [])
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load routing data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    [rules]
  )

  const ruleNameById = useMemo(() => {
    const m: Record<string, string> = {}
    rules.forEach((r) => (m[r.id] = r.name))
    return m
  }, [rules])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormErr(null)
    setShowForm(true)
  }

  function openEdit(rule: RoutingRule) {
    setEditing(rule)
    setForm({
      name: rule.name,
      priority: rule.priority ?? 100,
      target_tactic: rule.target_tactic,
      is_active: rule.is_active,
      conditions: asConditions(rule.conditions).length
        ? asConditions(rule.conditions)
        : [{ field: 'decline_code', op: 'eq', value: '' }],
    })
    setFormErr(null)
    setShowForm(true)
  }

  function updateCondition(i: number, patch: Partial<Condition>) {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }))
  }

  function addCondition() {
    setForm((f) => ({ ...f, conditions: [...f.conditions, { field: 'decline_code', op: 'eq', value: '' }] }))
  }

  function removeCondition(i: number) {
    setForm((f) => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }))
  }

  function buildBody() {
    return {
      name: form.name.trim(),
      priority: Number(form.priority) || 0,
      target_tactic: form.target_tactic.trim(),
      is_active: form.is_active,
      conditions: form.conditions.filter((c) => c.field && String(c.value).trim() !== ''),
    }
  }

  async function saveRule() {
    const body = buildBody()
    if (!body.name) return setFormErr('Name is required')
    if (!body.target_tactic) return setFormErr('Target tactic is required')
    if (body.conditions.length === 0) return setFormErr('Add at least one condition')
    setSaving(true)
    setFormErr(null)
    try {
      if (editing) await api.updateRoutingRule(editing.id, body)
      else await api.createRoutingRule(body)
      setShowForm(false)
      await load()
      setBanner({ tone: 'emerald', text: editing ? 'Rule updated' : 'Rule created' })
    } catch (e: any) {
      setFormErr(e?.message ?? 'Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(rule: RoutingRule) {
    setBanner(null)
    try {
      await api.updateRoutingRule(rule.id, { is_active: !rule.is_active })
      await load()
    } catch (e: any) {
      setBanner({ tone: 'red', text: e?.message ?? 'Failed to toggle rule' })
    }
  }

  async function deleteRule(rule: RoutingRule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return
    setBanner(null)
    try {
      await api.deleteRoutingRule(rule.id)
      await load()
    } catch (e: any) {
      setBanner({ tone: 'red', text: e?.message ?? 'Failed to delete rule' })
    }
  }

  async function runSimulate() {
    setBusy(true)
    setBanner(null)
    setSim(null)
    try {
      const body = { rules: sortedRules.map((r) => ({ ...r, conditions: asConditions(r.conditions) })) }
      const res = await api.simulateRouting(body)
      setSim(res as SimResult)
    } catch (e: any) {
      setBanner({ tone: 'red', text: e?.message ?? 'Simulation failed' })
    } finally {
      setBusy(false)
    }
  }

  async function applyNow() {
    if (!confirm('Re-route all open failed charges using the active rule set?')) return
    setBusy(true)
    setBanner(null)
    try {
      const res: any = await api.applyRouting({})
      const routed = res?.routed ?? 0
      setBanner({ tone: 'emerald', text: `Routed ${routed} charge${routed === 1 ? '' : 's'}` })
      await load()
    } catch (e: any) {
      setBanner({ tone: 'red', text: e?.message ?? 'Apply failed' })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <PageSpinner label="Loading routing engine..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Routing Engine</h1>
          <p className="mt-1 text-sm text-slate-400">
            Build prioritized rules that map failed charges to recovery tactics. Simulate before you apply.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={runSimulate} disabled={busy}>
            {busy ? 'Working...' : 'Simulate'}
          </Button>
          <Button variant="secondary" size="sm" onClick={applyNow} disabled={busy}>
            Apply to open charges
          </Button>
          <Button size="sm" onClick={openCreate}>
            New rule
          </Button>
        </div>
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
        <Stat label="Rules" value={rules.length} />
        <Stat label="Active rules" value={rules.filter((r) => r.is_active).length} tone="emerald" />
        <Stat label="Decisions logged" value={decisions.length} />
        <Stat
          label="Last simulation"
          value={sim ? sim.assignments.length : '—'}
          hint={sim ? 'charges routed' : 'not run'}
          tone={sim ? 'emerald' : 'default'}
        />
      </div>

      {/* Rules builder */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Rules (evaluated by priority, low first)</h2>
        </CardHeader>
        <CardBody className="p-0">
          {sortedRules.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No routing rules yet"
              description="Create your first rule to start mapping declines to tactics."
              action={
                <Button size="sm" onClick={openCreate}>
                  New rule
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Priority</TH>
                  <TH>Name</TH>
                  <TH>Conditions</TH>
                  <TH>Target tactic</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {sortedRules.map((rule) => {
                  const conds = asConditions(rule.conditions)
                  return (
                    <TR key={rule.id}>
                      <TD className="font-mono text-xs text-slate-400">{rule.priority}</TD>
                      <TD className="text-slate-200">{rule.name}</TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {conds.length === 0 ? (
                            <span className="text-xs text-slate-600">any</span>
                          ) : (
                            conds.map((c, i) => (
                              <Badge key={i} tone="slate">
                                <span className="font-mono">
                                  {c.field} {c.op} {c.value}
                                </span>
                              </Badge>
                            ))
                          )}
                        </div>
                      </TD>
                      <TD>
                        <span className="font-mono text-xs text-emerald-400">{rule.target_tactic}</span>
                      </TD>
                      <TD>
                        <button onClick={() => toggleActive(rule)} className="cursor-pointer">
                          {rule.is_active ? <Badge tone="emerald">active</Badge> : <Badge tone="slate">paused</Badge>}
                        </button>
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="secondary" onClick={() => openEdit(rule)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => deleteRule(rule)}>
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

      {/* Simulation results */}
      {sim && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Simulation preview</h2>
            <span className="text-xs text-slate-500">{sim.assignments.length} charges</span>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {Object.entries(sim.counts ?? {}).map(([tactic, n]) => (
                <Badge key={tactic} tone="emerald">
                  <span className="font-mono">{tactic}</span>
                  <span className="ml-1.5 text-emerald-200">{n}</span>
                </Badge>
              ))}
              {Object.keys(sim.counts ?? {}).length === 0 && (
                <span className="text-xs text-slate-500">No assignments produced.</span>
              )}
            </div>
            {sim.assignments.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>Charge</TH>
                    <TH>Tactic</TH>
                    <TH>Matched rule</TH>
                  </TR>
                </THead>
                <TBody>
                  {sim.assignments.slice(0, 50).map((a) => (
                    <TR key={a.charge_id}>
                      <TD className="font-mono text-xs text-slate-400">{a.charge_id.slice(0, 8)}</TD>
                      <TD className="font-mono text-xs text-emerald-400">{a.tactic}</TD>
                      <TD className="text-xs text-slate-400">
                        {a.rule_id ? ruleNameById[a.rule_id] ?? a.rule_id.slice(0, 8) : 'default'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {sim.assignments.length > 50 && (
              <p className="text-xs text-slate-600">Showing first 50 of {sim.assignments.length}.</p>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={applyNow} disabled={busy}>
                Apply this routing
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Decisions log */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Recent routing decisions</h2>
        </CardHeader>
        <CardBody className="p-0">
          {decisions.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No decisions logged"
              description="Apply routing to open charges to populate the decision log."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Charge</TH>
                  <TH>Tactic</TH>
                  <TH>Rule</TH>
                  <TH>Reason</TH>
                </TR>
              </THead>
              <TBody>
                {decisions.map((d) => (
                  <TR key={d.id}>
                    <TD className="text-xs text-slate-500">
                      {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                    </TD>
                    <TD className="font-mono text-xs text-slate-400">{d.failed_charge_id.slice(0, 8)}</TD>
                    <TD className="font-mono text-xs text-emerald-400">{d.chosen_tactic}</TD>
                    <TD className="text-xs text-slate-400">
                      {d.rule_id ? ruleNameById[d.rule_id] ?? d.rule_id.slice(0, 8) : 'default'}
                    </TD>
                    <TD className="text-xs text-slate-400">{d.reason}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Rule editor modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? `Edit rule` : 'New routing rule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveRule} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Insufficient funds → smart retry"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Target tactic
              </label>
              <input
                value={form.target_tactic}
                onChange={(e) => setForm({ ...form, target_tactic: e.target.value })}
                placeholder="tactic key"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Conditions (all must match)</label>
              <Button size="sm" variant="ghost" onClick={addCondition}>
                + Add
              </Button>
            </div>
            <div className="space-y-2">
              {form.conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={c.field}
                    onChange={(e) => updateCondition(i, { field: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    {FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.op}
                    onChange={(e) => updateCondition(i, { op: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    {OPS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <input
                    value={c.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    placeholder="value"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    onClick={() => removeCondition(i)}
                    className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-800 hover:text-red-400"
                    aria-label="Remove condition"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-emerald-500"
            />
            Active
          </label>

          {formErr && <p className="text-sm text-red-400">{formErr}</p>}
        </div>
      </Modal>
    </div>
  )
}
