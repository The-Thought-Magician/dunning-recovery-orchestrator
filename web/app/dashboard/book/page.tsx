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

interface Account {
  id: string
  external_id?: string | null
  customer_name: string
  customer_email?: string | null
  plan_name?: string | null
  mrr_cents: number
  card_brand?: string | null
  card_last4?: string | null
  card_exp_month?: number | null
  card_exp_year?: number | null
  geography?: string | null
  status: string
  updater_coverage?: string | null
  created_at?: string
}

interface BookHealth {
  active: number
  at_risk: number
  in_dunning: number
  churned_involuntary: number
  recovered: number
}

const STATUSES = ['active', 'at_risk', 'in_dunning', 'churned_involuntary', 'recovered']

const statusTone: Record<string, 'emerald' | 'amber' | 'red' | 'sky' | 'slate' | 'violet'> = {
  active: 'emerald',
  at_risk: 'amber',
  in_dunning: 'violet',
  churned_involuntary: 'red',
  recovered: 'sky',
}

function money(cents: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100)
}

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ')
}

const emptyForm = {
  customer_name: '',
  customer_email: '',
  external_id: '',
  plan_name: '',
  mrr: '',
  card_brand: '',
  card_last4: '',
  card_exp_month: '',
  card_exp_year: '',
  geography: '',
  status: 'active',
}

type Form = typeof emptyForm

export default function BookPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [health, setHealth] = useState<BookHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadAccounts = useCallback(async () => {
    const params: Record<string, unknown> = {}
    if (search.trim()) params.q = search.trim()
    if (statusFilter) params.status = statusFilter
    if (planFilter) params.plan = planFilter
    const data = await api.getAccounts(params)
    setAccounts(Array.isArray(data) ? data : [])
  }, [search, statusFilter, planFilter])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [, h] = await Promise.all([loadAccounts(), api.getBookHealth()])
      setHealth(h as BookHealth)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subscription book')
    } finally {
      setLoading(false)
    }
  }, [loadAccounts])

  // Initial load.
  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-query the list (server-side filters) when filters change, after first load.
  useEffect(() => {
    if (loading) return
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const data = await api.getAccounts({
          ...(search.trim() ? { q: search.trim() } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(planFilter ? { plan: planFilter } : {}),
        })
        if (!cancelled) setAccounts(Array.isArray(data) ? data : [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Filter failed')
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, planFilter])

  const plans = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.plan_name).filter((p): p is string => !!p))).sort(),
    [accounts],
  )

  const totalMrr = useMemo(() => accounts.reduce((a, x) => a + (x.mrr_cents || 0), 0), [accounts])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(a: Account) {
    setEditing(a)
    setForm({
      customer_name: a.customer_name ?? '',
      customer_email: a.customer_email ?? '',
      external_id: a.external_id ?? '',
      plan_name: a.plan_name ?? '',
      mrr: a.mrr_cents != null ? String(a.mrr_cents / 100) : '',
      card_brand: a.card_brand ?? '',
      card_last4: a.card_last4 ?? '',
      card_exp_month: a.card_exp_month != null ? String(a.card_exp_month) : '',
      card_exp_year: a.card_exp_year != null ? String(a.card_exp_year) : '',
      geography: a.geography ?? '',
      status: a.status ?? 'active',
    })
    setFormError(null)
    setModalOpen(true)
  }

  function buildBody() {
    return {
      customer_name: form.customer_name.trim(),
      customer_email: form.customer_email.trim() || null,
      external_id: form.external_id.trim() || null,
      plan_name: form.plan_name.trim() || null,
      mrr_cents: form.mrr ? Math.round(Number(form.mrr) * 100) : 0,
      card_brand: form.card_brand.trim() || null,
      card_last4: form.card_last4.trim() || null,
      card_exp_month: form.card_exp_month ? Number(form.card_exp_month) : null,
      card_exp_year: form.card_exp_year ? Number(form.card_exp_year) : null,
      geography: form.geography.trim() || null,
      status: form.status,
    }
  }

  async function submitForm() {
    setFormError(null)
    if (!form.customer_name.trim()) {
      setFormError('Customer name is required')
      return
    }
    if (form.mrr && Number.isNaN(Number(form.mrr))) {
      setFormError('MRR must be a number')
      return
    }
    setSaving(true)
    try {
      if (editing) await api.updateAccount(editing.id, buildBody())
      else await api.createAccount(buildBody())
      setModalOpen(false)
      await loadAll()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(a: Account) {
    if (!confirm(`Delete account "${a.customer_name}"?`)) return
    setBusyRow(a.id)
    try {
      await api.deleteAccount(a.id)
      await loadAll()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyRow(null)
    }
  }

  async function watch(a: Account) {
    setBusyRow(a.id)
    setNotice(null)
    try {
      await api.addWatchlistItem({ subscription_account_id: a.id })
      setNotice(`Added ${a.customer_name} to the watchlist.`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not add to watchlist')
    } finally {
      setBusyRow(null)
    }
  }

  if (loading) return <PageSpinner label="Loading subscription book..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Subscription Book</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every recurring account, its payment health, and the MRR at risk of involuntary churn.
          </p>
        </div>
        <Button onClick={openCreate}>Add account</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Book MRR" value={money(totalMrr)} hint={`${accounts.length} accounts`} />
        <Stat label="Active" value={health?.active ?? 0} tone="emerald" />
        <Stat label="At risk" value={health?.at_risk ?? 0} tone="amber" />
        <Stat label="In dunning" value={health?.in_dunning ?? 0} />
        <Stat label="Churned" value={health?.churned_involuntary ?? 0} tone="red" />
        <Stat label="Recovered" value={health?.recovered ?? 0} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-400">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-300 hover:text-white">
            ✕
          </button>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, external id..."
            className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All plans</option>
            {plans.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {(search || statusFilter || planFilter) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch('')
                setStatusFilter('')
                setPlanFilter('')
              }}
            >
              Clear
            </Button>
          )}
        </CardHeader>
        <CardBody className="px-0 py-0">
          {accounts.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No accounts found"
                description="Add an account manually, or import your subscription book from the Imports page."
                action={
                  <Button size="sm" onClick={openCreate}>
                    Add account
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH>Plan</TH>
                  <TH className="text-right">MRR</TH>
                  <TH>Card</TH>
                  <TH>Geo</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {accounts.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <div className="font-medium text-slate-100">{a.customer_name}</div>
                      {a.customer_email && <div className="text-xs text-slate-500">{a.customer_email}</div>}
                    </TD>
                    <TD>{a.plan_name ? <Badge tone="sky">{a.plan_name}</Badge> : <span className="text-slate-600">—</span>}</TD>
                    <TD className="text-right tabular-nums text-slate-200">{money(a.mrr_cents)}</TD>
                    <TD className="text-slate-400">
                      {a.card_brand || a.card_last4 ? (
                        <span className="text-xs">
                          {a.card_brand ?? 'card'} ····{a.card_last4 ?? '••••'}
                          {a.card_exp_month && a.card_exp_year ? (
                            <span className="ml-1 text-slate-600">
                              {String(a.card_exp_month).padStart(2, '0')}/{String(a.card_exp_year).slice(-2)}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TD>
                    <TD className="text-slate-400">{a.geography || '—'}</TD>
                    <TD>
                      <Badge tone={statusTone[a.status] ?? 'slate'}>{statusLabel(a.status)}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" disabled={busyRow === a.id} onClick={() => watch(a)}>
                          Watch
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(a)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busyRow === a.id} onClick={() => remove(a)}>
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

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit account' : 'Add account'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? <Spinner /> : editing ? 'Save changes' : 'Add account'}
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
          <div className="grid grid-cols-2 gap-4">
            <Field label="Customer name">
              <input
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                className={inputCls}
                placeholder="Acme Inc."
              />
            </Field>
            <Field label="Email">
              <input
                value={form.customer_email}
                onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
                className={inputCls}
                placeholder="billing@acme.com"
              />
            </Field>
            <Field label="External id">
              <input
                value={form.external_id}
                onChange={(e) => setForm({ ...form, external_id: e.target.value })}
                className={inputCls}
                placeholder="cus_123"
              />
            </Field>
            <Field label="Plan">
              <input
                value={form.plan_name}
                onChange={(e) => setForm({ ...form, plan_name: e.target.value })}
                className={inputCls}
                placeholder="Pro"
              />
            </Field>
            <Field label="MRR (USD)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.mrr}
                onChange={(e) => setForm({ ...form, mrr: e.target.value })}
                className={inputCls}
                placeholder="99.00"
              />
            </Field>
            <Field label="Geography">
              <input
                value={form.geography}
                onChange={(e) => setForm({ ...form, geography: e.target.value })}
                className={inputCls}
                placeholder="US"
              />
            </Field>
            <Field label="Card brand">
              <input
                value={form.card_brand}
                onChange={(e) => setForm({ ...form, card_brand: e.target.value })}
                className={inputCls}
                placeholder="visa"
              />
            </Field>
            <Field label="Card last 4">
              <input
                value={form.card_last4}
                onChange={(e) => setForm({ ...form, card_last4: e.target.value })}
                className={inputCls}
                placeholder="4242"
                maxLength={4}
              />
            </Field>
            <Field label="Exp month">
              <input
                type="number"
                min={1}
                max={12}
                value={form.card_exp_month}
                onChange={(e) => setForm({ ...form, card_exp_month: e.target.value })}
                className={inputCls}
                placeholder="12"
              />
            </Field>
            <Field label="Exp year">
              <input
                type="number"
                min={2000}
                value={form.card_exp_year}
                onChange={(e) => setForm({ ...form, card_exp_year: e.target.value })}
                className={inputCls}
                placeholder="2027"
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</label>
      {children}
    </div>
  )
}
