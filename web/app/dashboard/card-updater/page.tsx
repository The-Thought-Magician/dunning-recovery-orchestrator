'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface CoverageRow {
  id: string
  subscription_account_id: string
  coverage: string
  expires_at: string | null
  at_risk_mrr_cents: number
  customer_name?: string
  card_brand?: string
  card_last4?: string
  plan_name?: string
}

interface GapReport {
  total_at_risk_cents: number
  by_month: Array<{ month: string; at_risk_cents: number; count: number }>
  by_brand: Array<{ brand: string; at_risk_cents: number; count: number }>
  rows: Array<{
    subscription_account_id: string
    customer_name?: string
    card_brand?: string
    card_last4?: string
    expires_at?: string | null
    at_risk_mrr_cents: number
    coverage?: string
  }>
}

const COVERAGE_OPTIONS = ['covered', 'pending', 'not_covered', 'unknown']

function money(cents?: number | null): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function coverageTone(c?: string): 'emerald' | 'amber' | 'red' | 'slate' {
  switch ((c ?? '').toLowerCase()) {
    case 'covered':
      return 'emerald'
    case 'pending':
      return 'amber'
    case 'not_covered':
      return 'red'
    default:
      return 'slate'
  }
}

function monthLabel(iso?: string | null): string {
  if (!iso) return 'No expiry'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function CardUpdaterPage() {
  const [coverage, setCoverage] = useState<CoverageRow[]>([])
  const [gap, setGap] = useState<GapReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')

  const [editing, setEditing] = useState<CoverageRow | null>(null)
  const [editCoverage, setEditCoverage] = useState('covered')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [cov, gp] = await Promise.all([
        api.getCardCoverage() as Promise<CoverageRow[]>,
        api.getCardGapReport() as Promise<GapReport>,
      ])
      setCoverage(Array.isArray(cov) ? cov : [])
      setGap(gp ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load card-updater data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleRecompute() {
    setRecomputing(true)
    setNotice(null)
    setError(null)
    try {
      const res = (await api.recomputeCardCoverage()) as { updated?: number }
      setNotice(`Coverage recomputed — ${res?.updated ?? 0} account(s) updated.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setRecomputing(false)
    }
  }

  function openEdit(row: CoverageRow) {
    setEditing(row)
    setEditCoverage(row.coverage || 'covered')
  }

  async function saveEdit() {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      await api.setCardCoverage(editing.id, {
        subscription_account_id: editing.subscription_account_id,
        coverage: editCoverage,
      })
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set coverage')
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return coverage.filter((r) => {
      if (filter !== 'all' && (r.coverage || '').toLowerCase() !== filter) return false
      if (!q) return true
      return (
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.card_brand || '').toLowerCase().includes(q) ||
        (r.card_last4 || '').includes(q) ||
        (r.plan_name || '').toLowerCase().includes(q)
      )
    })
  }, [coverage, search, filter])

  // Build expiring-card calendar: next 12 months buckets from gap rows + coverage rows.
  const calendar = useMemo(() => {
    const buckets = new Map<string, { label: string; count: number; atRisk: number; sort: number }>()
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      buckets.set(key, {
        label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count: 0,
        atRisk: 0,
        sort: d.getFullYear() * 12 + d.getMonth(),
      })
    }
    const source = coverage.length ? coverage : []
    for (const r of source) {
      if (!r.expires_at) continue
      const d = new Date(r.expires_at)
      if (Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const b = buckets.get(key)
      if (b) {
        b.count += 1
        if ((r.coverage || '').toLowerCase() !== 'covered') b.atRisk += r.at_risk_mrr_cents || 0
      }
    }
    return Array.from(buckets.values()).sort((a, b) => a.sort - b.sort)
  }, [coverage])

  const maxCalAtRisk = Math.max(1, ...calendar.map((c) => c.atRisk))

  const totals = useMemo(() => {
    const total = coverage.length
    const covered = coverage.filter((r) => (r.coverage || '').toLowerCase() === 'covered').length
    const atRisk = coverage.reduce(
      (s, r) => s + ((r.coverage || '').toLowerCase() !== 'covered' ? r.at_risk_mrr_cents || 0 : 0),
      0,
    )
    const coveragePct = total ? Math.round((covered / total) * 100) : 0
    return { total, covered, atRisk, coveragePct }
  }, [coverage])

  if (loading) return <PageSpinner label="Loading card-updater coverage..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Card Updater</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Coverage gap report, expiring-card calendar, and at-risk MRR from card expiry.
          </p>
        </div>
        <Button onClick={handleRecompute} disabled={recomputing}>
          {recomputing ? <Spinner /> : 'Recompute coverage'}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Accounts tracked" value={totals.total} />
        <Stat label="Coverage rate" value={`${totals.coveragePct}%`} tone="emerald" hint={`${totals.covered} covered`} />
        <Stat
          label="At-risk MRR"
          value={money(gap?.total_at_risk_cents ?? totals.atRisk)}
          tone="red"
          hint="Uncovered expiring cards"
        />
        <Stat
          label="Uncovered accounts"
          value={coverage.filter((r) => (r.coverage || '').toLowerCase() !== 'covered').length}
          tone="amber"
        />
      </div>

      {/* Expiring-card calendar */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Expiring-card calendar (next 12 months)</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Bar height = uncovered at-risk MRR expiring that month.</p>
        </CardHeader>
        <CardBody>
          <div className="flex items-end gap-2 overflow-x-auto pb-2" style={{ minHeight: 160 }}>
            {calendar.map((c) => {
              const h = Math.round((c.atRisk / maxCalAtRisk) * 120)
              return (
                <div key={c.label} className="flex min-w-[48px] flex-1 flex-col items-center gap-1">
                  <div className="text-[10px] text-zinc-500">{c.atRisk > 0 ? money(c.atRisk) : ''}</div>
                  <div
                    className={`w-full rounded-t ${c.atRisk > 0 ? 'bg-red-500/70' : 'bg-zinc-700/50'}`}
                    style={{ height: `${Math.max(h, c.count > 0 ? 6 : 2)}px` }}
                    title={`${c.label}: ${c.count} card(s), ${money(c.atRisk)} at risk`}
                  />
                  <div className="text-[10px] text-zinc-400">{c.label}</div>
                  <div className="text-[10px] text-zinc-600">{c.count}</div>
                </div>
              )
            })}
          </div>
        </CardBody>
      </Card>

      {/* Gap report breakdowns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">At-risk MRR by month</h2>
          </CardHeader>
          <CardBody>
            {gap?.by_month?.length ? (
              <div className="space-y-2">
                {gap.by_month.map((m) => {
                  const max = Math.max(1, ...gap.by_month.map((x) => x.at_risk_cents))
                  const pct = Math.round((m.at_risk_cents / max) * 100)
                  return (
                    <div key={m.month} className="flex items-center gap-3">
                      <div className="w-20 shrink-0 text-xs text-zinc-400">{m.month}</div>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-red-500/70" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="w-24 shrink-0 text-right text-xs text-zinc-300">{money(m.at_risk_cents)}</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No month breakdown available.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">At-risk MRR by card brand</h2>
          </CardHeader>
          <CardBody>
            {gap?.by_brand?.length ? (
              <div className="space-y-2">
                {gap.by_brand.map((b) => {
                  const max = Math.max(1, ...gap.by_brand.map((x) => x.at_risk_cents))
                  const pct = Math.round((b.at_risk_cents / max) * 100)
                  return (
                    <div key={b.brand} className="flex items-center gap-3">
                      <div className="w-20 shrink-0 text-xs capitalize text-zinc-400">{b.brand || 'unknown'}</div>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="w-24 shrink-0 text-right text-xs text-zinc-300">{money(b.at_risk_cents)}</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No brand breakdown available.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Coverage table */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Per-account coverage</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, brand, plan..."
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
            >
              <option value="all">All coverage</option>
              {COVERAGE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={coverage.length === 0 ? 'No coverage data yet' : 'No accounts match filters'}
                description={
                  coverage.length === 0
                    ? 'Run "Recompute coverage" to derive coverage and at-risk MRR from your subscription book.'
                    : 'Adjust the search or coverage filter to see accounts.'
                }
                action={
                  coverage.length === 0 ? (
                    <Button onClick={handleRecompute} disabled={recomputing}>
                      Recompute coverage
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH>Card</TH>
                  <TH>Plan</TH>
                  <TH>Expires</TH>
                  <TH>Coverage</TH>
                  <TH className="text-right">At-risk MRR</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => {
                  const covered = (r.coverage || '').toLowerCase() === 'covered'
                  return (
                    <TR key={r.id}>
                      <TD className="font-medium text-zinc-100">{r.customer_name || r.subscription_account_id}</TD>
                      <TD className="capitalize">
                        {r.card_brand || '—'} {r.card_last4 ? `•••• ${r.card_last4}` : ''}
                      </TD>
                      <TD>{r.plan_name || '—'}</TD>
                      <TD>{monthLabel(r.expires_at)}</TD>
                      <TD>
                        <Badge tone={coverageTone(r.coverage)}>{(r.coverage || 'unknown').replace('_', ' ')}</Badge>
                      </TD>
                      <TD className="text-right">
                        <span className={!covered && r.at_risk_mrr_cents > 0 ? 'text-red-400' : 'text-zinc-400'}>
                          {money(r.at_risk_mrr_cents)}
                        </span>
                      </TD>
                      <TD className="text-right">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>
                          Set
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

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Set coverage"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? <Spinner /> : 'Save'}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="text-sm text-zinc-400">
              {editing.customer_name || editing.subscription_account_id}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Coverage status
              </label>
              <select
                value={editCoverage}
                onChange={(e) => setEditCoverage(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
              >
                {COVERAGE_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
