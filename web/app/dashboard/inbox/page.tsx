'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { RightRail } from '@/components/RightRail'

interface FailedCharge {
  id: string
  external_id: string | null
  customer_name?: string | null
  amount_cents: number
  currency: string
  raw_decline_code: string | null
  decline_code: string | null
  card_brand: string | null
  plan_name: string | null
  geography: string | null
  retry_count: number
  status: string
  assigned_tactic: string | null
  failed_at: string | null
}
interface Tactic {
  id: string
  key: string
  name: string
  measured_recovery_rate: number | null
}

const STATUS_OPTIONS = ['open', 'recovered', 'lost', 'written_off'] as const
const SETTABLE_STATUS = ['recovered', 'lost', 'written_off'] as const

function fmtMoney(cents?: number | null, currency = 'USD'): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 })
}
function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
function statusTone(status: string): 'emerald' | 'amber' | 'red' | 'slate' | 'sky' {
  switch (status) {
    case 'recovered':
      return 'emerald'
    case 'lost':
      return 'red'
    case 'written_off':
      return 'slate'
    case 'open':
      return 'amber'
    default:
      return 'sky'
  }
}

export default function InboxPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [charges, setCharges] = useState<FailedCharge[]>([])
  const [tactics, setTactics] = useState<Tactic[]>([])
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({})
  const [actionError, setActionError] = useState<string | null>(null)

  // filters
  const [q, setQ] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fDeclineCode, setFDeclineCode] = useState('')
  const [fPlan, setFPlan] = useState('')
  const [fMinAmount, setFMinAmount] = useState('')
  const [fRetryCount, setFRetryCount] = useState('')

  const loadCharges = useCallback(async () => {
    const params: Record<string, unknown> = {}
    if (fStatus) params.status = fStatus
    if (fDeclineCode) params.decline_code = fDeclineCode
    if (fPlan) params.plan = fPlan
    if (fMinAmount) params.min_amount = Math.round(Number(fMinAmount) * 100)
    if (fRetryCount) params.retry_count = Number(fRetryCount)
    const list = (await api.getFailedCharges(params)) as FailedCharge[]
    setCharges(Array.isArray(list) ? list : [])
  }, [fStatus, fDeclineCode, fPlan, fMinAmount, fRetryCount])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [, t] = await Promise.all([loadCharges(), api.getTactics() as Promise<Tactic[]>])
        if (cancelled) return
        setTactics(Array.isArray(t) ? t : [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load inbox')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyFilters = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await loadCharges()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }, [loadCharges])

  const resetFilters = useCallback(() => {
    setFStatus('')
    setFDeclineCode('')
    setFPlan('')
    setFMinAmount('')
    setFRetryCount('')
    setQ('')
  }, [])

  const setBusy = (id: string, v: boolean) => setRowBusy((p) => ({ ...p, [id]: v }))

  const onTactic = async (id: string, tacticKey: string) => {
    setActionError(null)
    setBusy(id, true)
    // optimistic
    const prev = charges
    setCharges((cs) => cs.map((c) => (c.id === id ? { ...c, assigned_tactic: tacticKey || null } : c)))
    try {
      await api.setChargeTactic(id, { assigned_tactic: tacticKey })
    } catch (e) {
      setCharges(prev)
      setActionError(e instanceof Error ? e.message : 'Failed to set tactic')
    } finally {
      setBusy(id, false)
    }
  }

  const onStatus = async (id: string, status: string) => {
    setActionError(null)
    setBusy(id, true)
    const prev = charges
    setCharges((cs) => cs.map((c) => (c.id === id ? { ...c, status } : c)))
    try {
      const updated = (await api.setChargeStatus(id, { status })) as FailedCharge
      // honor server state if filtering would now exclude it
      setCharges((cs) => cs.map((c) => (c.id === id ? { ...c, ...updated } : c)))
      if (fStatus && updated.status !== fStatus) {
        setCharges((cs) => cs.filter((c) => c.id !== id))
      }
    } catch (e) {
      setCharges(prev)
      setActionError(e instanceof Error ? e.message : 'Failed to set status')
    } finally {
      setBusy(id, false)
    }
  }

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return charges
    return charges.filter((c) =>
      [c.customer_name, c.external_id, c.decline_code, c.raw_decline_code, c.plan_name, c.card_brand]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term))
    )
  }, [charges, q])

  const totalOpen = useMemo(
    () => visible.filter((c) => c.status === 'open' || !SETTABLE_STATUS.includes(c.status as any)).length,
    [visible]
  )
  const totalAtStake = useMemo(() => visible.reduce((s, c) => s + (c.amount_cents || 0), 0), [visible])

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Failed-charge inbox</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Triage failed charges, assign recovery tactics, and resolve outcomes inline.
          </p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Open</div>
            <div className="text-xl font-semibold text-amber-400">{totalOpen}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">At stake</div>
            <div className="text-xl font-semibold text-white">{fmtMoney(totalAtStake)}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Search</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Customer, code, plan…"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Status</label>
              <select
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="">All</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Decline code</label>
              <input
                value={fDeclineCode}
                onChange={(e) => setFDeclineCode(e.target.value)}
                placeholder="e.g. insufficient_funds"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Plan</label>
              <input
                value={fPlan}
                onChange={(e) => setFPlan(e.target.value)}
                placeholder="Plan name"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Min $</label>
                <input
                  type="number"
                  min="0"
                  value={fMinAmount}
                  onChange={(e) => setFMinAmount(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-zinc-500">Retries</label>
                <input
                  type="number"
                  min="0"
                  value={fRetryCount}
                  onChange={(e) => setFRetryCount(e.target.value)}
                  placeholder="≥"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={applyFilters}>
              Apply filters
            </Button>
            <Button size="sm" variant="ghost" onClick={resetFilters}>
              Reset
            </Button>
          </div>
        </CardBody>
      </Card>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {actionError}
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading failed charges..." />
      ) : error ? (
        <EmptyState
          title="Could not load the inbox"
          description={error}
          action={
            <Button variant="secondary" onClick={applyFilters}>
              Retry
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No failed charges"
          description={
            charges.length === 0
              ? 'Your inbox is clear, or no data has been imported yet.'
              : 'No charges match the current search or filters.'
          }
          action={
            charges.length === 0 ? (
              <Link href="/dashboard/imports">
                <Button size="sm" variant="secondary">
                  Import or seed data
                </Button>
              </Link>
            ) : (
              <Button size="sm" variant="ghost" onClick={resetFilters}>
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Customer</TH>
                <TH>Amount</TH>
                <TH>Decline code</TH>
                <TH>Plan / Card</TH>
                <TH>Retries</TH>
                <TH>Tactic</TH>
                <TH>Status</TH>
                <TH>Failed</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((c) => {
                const busy = !!rowBusy[c.id]
                return (
                  <TR key={c.id}>
                    <TD>
                      <Link
                        href={`/dashboard/charges/${c.id}`}
                        className="font-medium text-zinc-100 hover:text-amber-400"
                      >
                        {c.customer_name || c.external_id || c.id.slice(0, 8)}
                      </Link>
                      {c.geography && <div className="text-xs text-zinc-500">{c.geography}</div>}
                    </TD>
                    <TD className="font-medium text-white">{fmtMoney(c.amount_cents, c.currency)}</TD>
                    <TD>
                      {c.decline_code ? (
                        <Badge tone="slate">{c.decline_code}</Badge>
                      ) : (
                        <span className="text-zinc-600">{c.raw_decline_code || '—'}</span>
                      )}
                    </TD>
                    <TD>
                      <div className="text-zinc-300">{c.plan_name || '—'}</div>
                      {c.card_brand && <div className="text-xs capitalize text-zinc-500">{c.card_brand}</div>}
                    </TD>
                    <TD className="text-zinc-400">{c.retry_count}</TD>
                    <TD>
                      <select
                        value={c.assigned_tactic ?? ''}
                        disabled={busy}
                        onChange={(e) => onTactic(c.id, e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none disabled:opacity-50"
                      >
                        <option value="">Unassigned</option>
                        {tactics.map((t) => (
                          <option key={t.id} value={t.key}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(c.status)}>{c.status.replace('_', ' ')}</Badge>
                    </TD>
                    <TD className="text-xs text-zinc-500">{fmtDate(c.failed_at)}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1.5">
                        {busy && <Spinner className="!gap-0" />}
                        <select
                          value=""
                          disabled={busy}
                          onChange={(e) => {
                            if (e.target.value) onStatus(c.id, e.target.value)
                          }}
                          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none disabled:opacity-50"
                        >
                          <option value="">Resolve…</option>
                          {SETTABLE_STATUS.map((s) => (
                            <option key={s} value={s}>
                              Mark {s.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </Card>
      )}
      </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <RightRail />
        </aside>
      </div>
    </div>
  )
}
