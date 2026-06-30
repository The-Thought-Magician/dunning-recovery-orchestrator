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

interface AlertRule {
  id: string
  name: string
  metric: string
  threshold: number
  is_active?: boolean
  created_at?: string
}

interface Alert {
  id: string
  rule_id?: string | null
  message: string
  severity?: string
  acknowledged?: boolean
  created_at?: string
}

interface WatchlistAccount {
  id?: string
  customer_name?: string
  customer_email?: string
  plan_name?: string
  mrr_cents?: number
  status?: string
}

interface WatchlistItem {
  id: string
  subscription_account_id?: string | null
  note?: string | null
  created_at?: string
  account?: WatchlistAccount | null
}

const METRICS = [
  { value: 'recovery_rate', label: 'Recovery rate (%)' },
  { value: 'at_risk_mrr_cents', label: 'At-risk MRR (cents)' },
  { value: 'failed_charge_count', label: 'Failed charge count' },
  { value: 'involuntary_churn', label: 'Involuntary churn count' },
  { value: 'decline_rate', label: 'Decline rate (%)' },
]

function metricLabel(metric: string): string {
  return METRICS.find((m) => m.value === metric)?.label ?? metric
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100)
}

function severityTone(sev?: string): 'red' | 'amber' | 'sky' | 'slate' {
  switch ((sev || '').toLowerCase()) {
    case 'critical':
    case 'high':
      return 'red'
    case 'warning':
    case 'medium':
      return 'amber'
    case 'info':
    case 'low':
      return 'sky'
    default:
      return 'slate'
  }
}

function timeAgo(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

const emptyRuleForm = { name: '', metric: 'recovery_rate', threshold: '', is_active: true }

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const [tab, setTab] = useState<'alerts' | 'rules' | 'watchlist'>('alerts')
  const [alertFilter, setAlertFilter] = useState<'all' | 'open' | 'acked'>('open')
  const [search, setSearch] = useState('')

  const [evaluating, setEvaluating] = useState(false)
  const [acking, setAcking] = useState<Record<string, boolean>>({})

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AlertRule | null>(null)
  const [form, setForm] = useState(emptyRuleForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [editNote, setEditNote] = useState<WatchlistItem | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, a, w] = await Promise.all([api.getAlertRules(), api.getAlerts(), api.getWatchlist()])
      setRules(Array.isArray(r) ? r : [])
      setAlerts(Array.isArray(a) ? a : [])
      setWatchlist(Array.isArray(w) ? w : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const ruleName = useCallback(
    (id?: string | null) => (id ? rules.find((r) => r.id === id)?.name ?? 'rule' : 'manual'),
    [rules],
  )

  const openAlerts = useMemo(() => alerts.filter((a) => !a.acknowledged), [alerts])

  const visibleAlerts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return alerts.filter((a) => {
      if (alertFilter === 'open' && a.acknowledged) return false
      if (alertFilter === 'acked' && !a.acknowledged) return false
      if (q && !a.message.toLowerCase().includes(q) && !ruleName(a.rule_id).toLowerCase().includes(q)) return false
      return true
    })
  }, [alerts, alertFilter, search, ruleName])

  const atRiskMrr = useMemo(
    () => watchlist.reduce((acc, w) => acc + (w.account?.mrr_cents ?? 0), 0),
    [watchlist],
  )

  async function evaluate() {
    setEvaluating(true)
    setError(null)
    setBanner(null)
    try {
      const res = await api.evaluateAlerts()
      const triggered = (res?.triggered as number) ?? 0
      setBanner(triggered > 0 ? `Evaluation complete — ${triggered} alert(s) triggered.` : 'Evaluation complete — no new alerts.')
      setTab('alerts')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation failed')
    } finally {
      setEvaluating(false)
    }
  }

  async function ack(a: Alert) {
    setAcking((m) => ({ ...m, [a.id]: true }))
    try {
      await api.ackAlert(a.id)
      setAlerts((list) => list.map((x) => (x.id === a.id ? { ...x, acknowledged: true } : x)))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Acknowledge failed')
    } finally {
      setAcking((m) => ({ ...m, [a.id]: false }))
    }
  }

  async function ackAll() {
    const targets = openAlerts.slice()
    if (targets.length === 0) return
    setBanner(null)
    try {
      await Promise.all(targets.map((a) => api.ackAlert(a.id)))
      setAlerts((list) => list.map((x) => (x.acknowledged ? x : { ...x, acknowledged: true })))
      setBanner(`Acknowledged ${targets.length} alert(s).`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk acknowledge failed')
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyRuleForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(r: AlertRule) {
    setEditing(r)
    setForm({
      name: r.name,
      metric: r.metric,
      threshold: String(r.threshold ?? ''),
      is_active: r.is_active !== false,
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submitRule() {
    setFormError(null)
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    const threshold = Number(form.threshold)
    if (form.threshold.trim() === '' || Number.isNaN(threshold)) {
      setFormError('Threshold must be a number')
      return
    }
    setSaving(true)
    try {
      const body = { name: form.name.trim(), metric: form.metric, threshold, is_active: form.is_active }
      if (editing) {
        await api.updateAlertRule(editing.id, body)
      } else {
        await api.createAlertRule(body)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function toggleRule(r: AlertRule) {
    try {
      await api.updateAlertRule(r.id, { name: r.name, metric: r.metric, threshold: r.threshold, is_active: !r.is_active })
      setRules((list) => list.map((x) => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function removeRule(r: AlertRule) {
    if (!confirm(`Delete alert rule "${r.name}"?`)) return
    try {
      await api.deleteAlertRule(r.id)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  function openNote(w: WatchlistItem) {
    setEditNote(w)
    setNoteDraft(w.note ?? '')
  }

  async function saveNote() {
    if (!editNote) return
    setSavingNote(true)
    try {
      await api.updateWatchlistItem(editNote.id, { note: noteDraft })
      setWatchlist((list) => list.map((x) => (x.id === editNote.id ? { ...x, note: noteDraft } : x)))
      setEditNote(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSavingNote(false)
    }
  }

  async function removeWatch(w: WatchlistItem) {
    if (!confirm(`Remove ${w.account?.customer_name ?? 'account'} from the watchlist?`)) return
    try {
      await api.deleteWatchlistItem(w.id)
      setWatchlist((list) => list.filter((x) => x.id !== w.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Remove failed')
    }
  }

  if (loading) return <PageSpinner label="Loading alerts..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Alerts &amp; Watchlist</h1>
          <p className="mt-1 text-sm text-slate-400">
            Monitor recovery health, get notified when metrics cross thresholds, and keep an eye on high-value accounts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={evaluate} disabled={evaluating}>
            {evaluating ? 'Evaluating...' : 'Evaluate now'}
          </Button>
          <Button onClick={openCreate}>New rule</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open alerts" value={openAlerts.length} tone={openAlerts.length ? 'red' : 'emerald'} hint="awaiting acknowledgement" />
        <Stat label="Active rules" value={rules.filter((r) => r.is_active !== false).length} hint={`${rules.length} total`} />
        <Stat label="Watchlist accounts" value={watchlist.length} hint="under active monitoring" />
        <Stat label="Watchlist MRR" value={money(atRiskMrr)} tone="amber" hint="monthly recurring at stake" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}
      {banner && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          {banner}
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-800">
        {([
          ['alerts', `Alerts${openAlerts.length ? ` (${openAlerts.length})` : ''}`],
          ['rules', `Rules (${rules.length})`],
          ['watchlist', `Watchlist (${watchlist.length})`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'alerts' && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search alerts..."
                className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
              />
              <select
                value={alertFilter}
                onChange={(e) => setAlertFilter(e.target.value as typeof alertFilter)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="open">Open</option>
                <option value="acked">Acknowledged</option>
                <option value="all">All</option>
              </select>
            </div>
            <Button size="sm" variant="secondary" disabled={openAlerts.length === 0} onClick={ackAll}>
              Acknowledge all ({openAlerts.length})
            </Button>
          </CardHeader>
          <CardBody className="px-0 py-0">
            {visibleAlerts.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title={alerts.length === 0 ? 'No alerts yet' : 'No alerts match your filter'}
                  description={
                    alerts.length === 0
                      ? 'Define alert rules and run an evaluation to surface recovery-health issues here.'
                      : 'Try switching the filter or clearing your search.'
                  }
                  action={
                    alerts.length === 0 ? (
                      <Button size="sm" variant="secondary" onClick={evaluate} disabled={evaluating}>
                        {evaluating ? 'Evaluating...' : 'Evaluate now'}
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Severity</TH>
                    <TH>Message</TH>
                    <TH>Rule</TH>
                    <TH>Triggered</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {visibleAlerts.map((a) => (
                    <TR key={a.id} className={a.acknowledged ? 'opacity-60' : ''}>
                      <TD>
                        <Badge tone={severityTone(a.severity)}>{a.severity || 'info'}</Badge>
                      </TD>
                      <TD className="font-medium text-slate-100">{a.message}</TD>
                      <TD className="text-slate-400">{ruleName(a.rule_id)}</TD>
                      <TD className="text-slate-500">{timeAgo(a.created_at)}</TD>
                      <TD className="text-right">
                        {a.acknowledged ? (
                          <Badge tone="emerald">Acknowledged</Badge>
                        ) : (
                          <Button size="sm" variant="secondary" disabled={acking[a.id]} onClick={() => ack(a)}>
                            {acking[a.id] ? 'Acking...' : 'Acknowledge'}
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {tab === 'rules' && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Alert rules</h2>
            <Button size="sm" onClick={openCreate}>
              New rule
            </Button>
          </CardHeader>
          <CardBody className="px-0 py-0">
            {rules.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No alert rules"
                  description="Create a rule to be notified when a recovery metric crosses a threshold."
                  action={
                    <Button size="sm" onClick={openCreate}>
                      New rule
                    </Button>
                  }
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Metric</TH>
                    <TH className="text-right">Threshold</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {rules.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium text-slate-100">{r.name}</TD>
                      <TD>
                        <Badge tone="slate">{metricLabel(r.metric)}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums text-slate-200">{r.threshold}</TD>
                      <TD>
                        <button onClick={() => toggleRule(r)} className="cursor-pointer">
                          <Badge tone={r.is_active !== false ? 'emerald' : 'slate'}>
                            {r.is_active !== false ? 'Active' : 'Paused'}
                          </Badge>
                        </button>
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeRule(r)}>
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
      )}

      {tab === 'watchlist' && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Watchlist</h2>
          </CardHeader>
          <CardBody className="px-0 py-0">
            {watchlist.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Watchlist is empty"
                  description="Add high-value or at-risk accounts to the watchlist from the Subscription Book to track them here."
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Account</TH>
                    <TH>Plan</TH>
                    <TH className="text-right">MRR</TH>
                    <TH>Status</TH>
                    <TH>Note</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {watchlist.map((w) => (
                    <TR key={w.id}>
                      <TD>
                        <div className="font-medium text-slate-100">{w.account?.customer_name ?? 'Unknown account'}</div>
                        {w.account?.customer_email && (
                          <div className="text-xs text-slate-500">{w.account.customer_email}</div>
                        )}
                      </TD>
                      <TD className="text-slate-300">{w.account?.plan_name ?? '—'}</TD>
                      <TD className="text-right tabular-nums text-slate-200">{money(w.account?.mrr_cents ?? 0)}</TD>
                      <TD>{w.account?.status ? <Badge tone="slate">{w.account.status}</Badge> : '—'}</TD>
                      <TD className="max-w-xs text-slate-400">{w.note || <span className="text-slate-600">—</span>}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openNote(w)}>
                            Note
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeWatch(w)}>
                            Remove
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
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit alert rule' : 'New alert rule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitRule} disabled={saving}>
              {saving ? <Spinner /> : editing ? 'Save changes' : 'Create rule'}
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
              placeholder="Recovery rate below target"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Metric</label>
            <select
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Threshold</label>
            <input
              type="number"
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: e.target.value })}
              placeholder="e.g. 50"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-600">An alert triggers when the metric crosses this value.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 accent-emerald-500"
            />
            Active
          </label>
        </div>
      </Modal>

      <Modal
        open={editNote !== null}
        onClose={() => setEditNote(null)}
        title="Watchlist note"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditNote(null)}>
              Cancel
            </Button>
            <Button onClick={saveNote} disabled={savingNote}>
              {savingNote ? <Spinner /> : 'Save note'}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <div className="text-sm text-slate-300">{editNote?.account?.customer_name ?? 'Account'}</div>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={4}
            placeholder="Why is this account on the watchlist?"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </Modal>
    </div>
  )
}
