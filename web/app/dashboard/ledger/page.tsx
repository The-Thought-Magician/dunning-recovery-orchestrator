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
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface LedgerSummary {
  attempted_cents: number
  recovered_cents: number
  lost_cents: number
  written_off_cents: number
  recovery_rate: number
}

interface LedgerEntry {
  id: string
  failed_charge_id?: string
  entry_type: string
  amount_cents: number
  tactic?: string | null
  retry_attempt?: number | null
  period_id?: string | null
  reconciled: boolean
  created_at?: string
}

interface LedgerPeriod {
  id: string
  label: string
  attempted_cents: number
  recovered_cents: number
  lost_cents: number
  written_off_cents: number
  closed: boolean
  closed_at?: string | null
  created_at?: string
}

const ENTRY_TYPES = ['recovered', 'lost', 'written_off', 'attempted']

function dollars(cents: number | undefined | null): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function pct(rate: number | undefined | null): string {
  const r = rate ?? 0
  const v = r <= 1 ? r * 100 : r
  return `${v.toFixed(1)}%`
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
}

function entryTone(t: string): 'emerald' | 'red' | 'amber' | 'slate' {
  if (t === 'recovered') return 'emerald'
  if (t === 'lost') return 'red'
  if (t === 'written_off') return 'amber'
  return 'slate'
}

export default function LedgerPage() {
  const [summary, setSummary] = useState<LedgerSummary | null>(null)
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [periods, setPeriods] = useState<LedgerPeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')
  const [reconciledFilter, setReconciledFilter] = useState<'all' | 'reconciled' | 'open'>('all')
  const [search, setSearch] = useState('')

  const [closeOpen, setCloseOpen] = useState(false)
  const [closeLabel, setCloseLabel] = useState('')
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState<string | null>(null)

  const [exporting, setExporting] = useState(false)
  const [reconcilingId, setReconcilingId] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    const params: Record<string, unknown> = {}
    if (typeFilter) params.entry_type = typeFilter
    if (periodFilter) params.period_id = periodFilter
    const data = await api.getLedgerEntries(params)
    setEntries(Array.isArray(data) ? data : [])
  }, [typeFilter, periodFilter])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sum, per] = await Promise.all([api.getLedgerSummary(), api.getLedgerPeriods()])
      setSummary(sum ?? null)
      setPeriods(Array.isArray(per) ? per : [])
      await loadEntries()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ledger')
    } finally {
      setLoading(false)
    }
  }, [loadEntries])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload entries when server-side filters change (after initial load).
  useEffect(() => {
    if (loading) return
    loadEntries().catch((e) =>
      setError(e instanceof Error ? e.message : 'Failed to load entries'),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, periodFilter])

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (reconciledFilter === 'reconciled' && !e.reconciled) return false
      if (reconciledFilter === 'open' && e.reconciled) return false
      if (search) {
        const q = search.toLowerCase()
        const hay = `${e.entry_type} ${e.tactic ?? ''} ${e.failed_charge_id ?? ''} ${e.id}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, reconciledFilter, search])

  const visibleTotal = useMemo(
    () => filteredEntries.reduce((acc, e) => acc + (e.amount_cents ?? 0), 0),
    [filteredEntries],
  )
  const unreconciledCount = useMemo(
    () => entries.filter((e) => !e.reconciled).length,
    [entries],
  )

  const periodLabel = useCallback(
    (id?: string | null) => (id ? periods.find((p) => p.id === id)?.label ?? '—' : '—'),
    [periods],
  )

  const doExport = async () => {
    setExporting(true)
    try {
      const csv = await api.exportLedger()
      const text = typeof csv === 'string' ? csv : JSON.stringify(csv, null, 2)
      const blob = new Blob([text], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recovery-ledger-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to export ledger')
    } finally {
      setExporting(false)
    }
  }

  const reconcile = async (entry: LedgerEntry) => {
    setReconcilingId(entry.id)
    try {
      await api.reconcileLedgerEntry(entry.id)
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, reconciled: true } : e)),
      )
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to reconcile entry')
    } finally {
      setReconcilingId(null)
    }
  }

  const openClose = () => {
    setCloseLabel('')
    setCloseError(null)
    setCloseOpen(true)
  }

  const closePeriod = async () => {
    setCloseError(null)
    const label = closeLabel.trim()
    if (!label) {
      setCloseError('Period label is required (e.g. 2026-Q2)')
      return
    }
    setClosing(true)
    try {
      await api.closeLedgerPeriod({ label })
      setCloseOpen(false)
      await load()
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : 'Failed to close period')
    } finally {
      setClosing(false)
    }
  }

  const recovered = summary?.recovered_cents ?? 0
  const lost = summary?.lost_cents ?? 0
  const writtenOff = summary?.written_off_cents ?? 0
  const outcomeTotal = recovered + lost + writtenOff || 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Recovery Ledger</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Track recovered revenue, reconcile entries, close accounting periods, and export for
            finance.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={doExport} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </Button>
          <Button onClick={openClose}>Close period</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Attempted" value={dollars(summary?.attempted_cents)} />
        <Stat label="Recovered" value={dollars(recovered)} tone="emerald" />
        <Stat label="Lost" value={dollars(lost)} tone="red" />
        <Stat label="Written off" value={dollars(writtenOff)} tone="amber" />
        <Stat
          label="Recovery rate"
          value={pct(summary?.recovery_rate)}
          tone="emerald"
          hint={`${unreconciledCount} unreconciled`}
        />
      </div>

      {loading ? (
        <PageSpinner label="Loading ledger..." />
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
      ) : (
        <>
          {summary && outcomeTotal > 1 && (
            <Card>
              <CardHeader>
                <h3 className="text-base font-semibold text-white">Outcome breakdown</h3>
              </CardHeader>
              <CardBody>
                <div className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-amber-400"
                    style={{ width: `${(recovered / outcomeTotal) * 100}%` }}
                    title={`Recovered ${dollars(recovered)}`}
                  />
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${(lost / outcomeTotal) * 100}%` }}
                    title={`Lost ${dollars(lost)}`}
                  />
                  <div
                    className="h-full bg-amber-400"
                    style={{ width: `${(writtenOff / outcomeTotal) * 100}%` }}
                    title={`Written off ${dollars(writtenOff)}`}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Recovered
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Lost
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Written off
                  </span>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <h3 className="text-base font-semibold text-white">Accounting periods</h3>
            </CardHeader>
            <CardBody className="p-0">
              {periods.length === 0 ? (
                <div className="px-5 py-6">
                  <p className="text-sm text-zinc-500">
                    No periods closed yet. Closing a period snapshots current totals.
                  </p>
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Period</TH>
                      <TH>Status</TH>
                      <TH>Attempted</TH>
                      <TH>Recovered</TH>
                      <TH>Lost</TH>
                      <TH>Written off</TH>
                      <TH>Closed</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {periods.map((p) => (
                      <TR
                        key={p.id}
                        className="cursor-pointer"
                        onClick={() => setPeriodFilter((cur) => (cur === p.id ? '' : p.id))}
                      >
                        <TD>
                          <span className="font-medium text-zinc-200">{p.label}</span>
                          {periodFilter === p.id && (
                            <Badge tone="sky" className="ml-2">
                              filtering
                            </Badge>
                          )}
                        </TD>
                        <TD>
                          <Badge tone={p.closed ? 'slate' : 'emerald'}>
                            {p.closed ? 'Closed' : 'Open'}
                          </Badge>
                        </TD>
                        <TD>{dollars(p.attempted_cents)}</TD>
                        <TD className="text-amber-400">{dollars(p.recovered_cents)}</TD>
                        <TD className="text-red-400">{dollars(p.lost_cents)}</TD>
                        <TD className="text-amber-400">{dollars(p.written_off_cents)}</TD>
                        <TD className="text-zinc-500">{fmtDate(p.closed_at ?? undefined)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-white">Ledger entries</h3>
                <div className="text-xs text-zinc-500">
                  {filteredEntries.length} shown · net {dollars(visibleTotal)}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tactic, charge, id..."
                  className="w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white outline-none focus:border-amber-500"
                />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white outline-none focus:border-amber-500"
                >
                  <option value="">All types</option>
                  {ENTRY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace('_', ' ')}
                    </option>
                  ))}
                </select>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value)}
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white outline-none focus:border-amber-500"
                >
                  <option value="">All periods</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <select
                  value={reconciledFilter}
                  onChange={(e) =>
                    setReconciledFilter(e.target.value as 'all' | 'reconciled' | 'open')
                  }
                  className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white outline-none focus:border-amber-500"
                >
                  <option value="all">All entries</option>
                  <option value="open">Unreconciled</option>
                  <option value="reconciled">Reconciled</option>
                </select>
                {(typeFilter || periodFilter || reconciledFilter !== 'all' || search) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTypeFilter('')
                      setPeriodFilter('')
                      setReconciledFilter('all')
                      setSearch('')
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {filteredEntries.length === 0 ? (
                <div className="px-5 py-10">
                  <EmptyState
                    title="No matching ledger entries"
                    description="Entries are written when a failed charge is marked recovered, lost, or written off."
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Type</TH>
                      <TH>Amount</TH>
                      <TH>Tactic</TH>
                      <TH>Attempt</TH>
                      <TH>Period</TH>
                      <TH>Date</TH>
                      <TH>Reconciled</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filteredEntries.map((e) => (
                      <TR key={e.id}>
                        <TD>
                          <Badge tone={entryTone(e.entry_type)}>
                            {e.entry_type.replace('_', ' ')}
                          </Badge>
                        </TD>
                        <TD className="font-medium text-zinc-200">{dollars(e.amount_cents)}</TD>
                        <TD>{e.tactic || '—'}</TD>
                        <TD>{e.retry_attempt ?? '—'}</TD>
                        <TD className="text-zinc-400">{periodLabel(e.period_id)}</TD>
                        <TD className="text-zinc-500">{fmtDate(e.created_at)}</TD>
                        <TD>
                          {e.reconciled ? (
                            <Badge tone="emerald">Reconciled</Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => reconcile(e)}
                              disabled={reconcilingId === e.id}
                            >
                              {reconcilingId === e.id ? '...' : 'Reconcile'}
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
        </>
      )}

      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="Close accounting period"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)} disabled={closing}>
              Cancel
            </Button>
            <Button onClick={closePeriod} disabled={closing}>
              {closing ? 'Closing...' : 'Close period'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {closeError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {closeError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Period label</label>
            <input
              value={closeLabel}
              onChange={(e) => setCloseLabel(e.target.value)}
              placeholder="2026-Q2"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Snapshots current attempted, recovered, lost, and written-off totals into a closed
              period.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
