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

interface LedgerSummary {
  attempted_cents?: number
  recovered_cents?: number
  lost_cents?: number
  written_off_cents?: number
  recovery_rate?: number
}

interface TopReason {
  code: string
  label?: string
  count?: number
  mrr_cents?: number
}

interface BoardKpi {
  label: string
  value: number | string
  unit?: string
}

interface BoardReport {
  kpis?: BoardKpi[] | Record<string, number | string>
  ledger_summary?: LedgerSummary
  top_reasons?: TopReason[]
  at_risk_mrr?: number | { total_at_risk_cents?: number }
}

interface ReportDefinition {
  id: string
  name?: string
  cadence?: string
  format?: string
  recipients?: string | string[]
  created_at?: string
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100)
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

const CADENCES = ['daily', 'weekly', 'monthly', 'quarterly']
const emptyDef = { name: '', cadence: 'weekly', format: 'csv', recipients: '' }

function normalizeKpis(kpis: BoardReport['kpis']): BoardKpi[] {
  if (!kpis) return []
  if (Array.isArray(kpis)) return kpis
  return Object.entries(kpis).map(([label, value]) => ({ label, value }))
}

function atRiskCents(at?: BoardReport['at_risk_mrr']): number {
  if (at == null) return 0
  if (typeof at === 'number') return at
  return at.total_at_risk_cents ?? 0
}

export default function ReportsPage() {
  const [report, setReport] = useState<BoardReport | null>(null)
  const [defs, setDefs] = useState<ReportDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const [exporting, setExporting] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(emptyDef)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, d] = await Promise.all([api.getBoardReport(), api.getReportDefinitions()])
      setReport((r as BoardReport) ?? null)
      setDefs(Array.isArray(d) ? d : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const kpis = useMemo(() => normalizeKpis(report?.kpis), [report])
  const summary = report?.ledger_summary ?? {}
  const topReasons = report?.top_reasons ?? []
  const atRisk = atRiskCents(report?.at_risk_mrr)
  const maxReasonMrr = useMemo(
    () => Math.max(1, ...topReasons.map((r) => r.mrr_cents ?? 0)),
    [topReasons],
  )

  async function doExport(format: 'csv' | 'json') {
    setExporting(format)
    setError(null)
    setBanner(null)
    try {
      const data = await api.exportReport({ format })
      const isObj = typeof data === 'object' && data !== null
      const text = isObj ? JSON.stringify(data, null, 2) : String(data ?? '')
      const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `board-report-${new Date().toISOString().slice(0, 10)}.${format === 'json' || isObj ? 'json' : 'csv'}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setBanner(`Export downloaded as ${format.toUpperCase()}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  function openCreate() {
    setForm(emptyDef)
    setFormError(null)
    setModalOpen(true)
  }

  async function submitDef() {
    setFormError(null)
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    try {
      const recipients = form.recipients
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      await api.saveReportDefinition({
        name: form.name.trim(),
        cadence: form.cadence,
        format: form.format,
        recipients,
      })
      setModalOpen(false)
      setBanner('Scheduled report saved.')
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function recipientText(r?: string | string[]): string {
    if (!r) return '—'
    return Array.isArray(r) ? r.join(', ') || '—' : r
  }

  if (loading) return <PageSpinner label="Loading reports..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Reports</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Board-ready recovered-revenue summary, one-click exports, and scheduled report definitions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => doExport('csv')} disabled={exporting !== null}>
            {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
          </Button>
          <Button variant="secondary" onClick={() => doExport('json')} disabled={exporting !== null}>
            {exporting === 'json' ? 'Exporting...' : 'Export JSON'}
          </Button>
          <Button onClick={openCreate}>Schedule report</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}
      {banner && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          {banner}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Recovered" value={money(summary.recovered_cents ?? 0)} tone="emerald" hint="reclaimed revenue" />
        <Stat label="Recovery rate" value={pct(summary.recovery_rate ?? 0)} tone="emerald" hint="of attempted" />
        <Stat label="Lost + written off" value={money((summary.lost_cents ?? 0) + (summary.written_off_cents ?? 0))} tone="red" hint="unrecoverable" />
        <Stat label="At-risk MRR" value={money(atRisk)} tone="amber" hint="exposure ahead" />
      </div>

      {kpis.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Board KPIs</h2>
          </CardHeader>
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {kpis.map((k, i) => (
                <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{k.label}</div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {k.value}
                    {k.unit ? <span className="ml-1 text-sm text-zinc-500">{k.unit}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Recovery ledger snapshot</h2>
          </CardHeader>
          <CardBody>
            <RecoveryBars summary={summary} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Top decline reasons</h2>
          </CardHeader>
          <CardBody>
            {topReasons.length === 0 ? (
              <p className="text-sm text-zinc-500">No decline reasons recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {topReasons.slice(0, 8).map((r) => (
                  <div key={r.code} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 truncate text-sm text-zinc-300">{r.label || r.code}</div>
                    <div className="h-6 flex-1 overflow-hidden rounded bg-zinc-800">
                      <div
                        className="flex h-full items-center justify-end rounded bg-amber-500/70 px-2 text-xs font-medium text-zinc-950"
                        style={{ width: `${Math.max(6, ((r.mrr_cents ?? 0) / maxReasonMrr) * 100)}%` }}
                      >
                        {money(r.mrr_cents ?? 0)}
                      </div>
                    </div>
                    <div className="w-12 shrink-0 text-right text-xs text-zinc-500">{r.count ?? 0}×</div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Scheduled report definitions</h2>
          <Button size="sm" onClick={openCreate}>
            Schedule report
          </Button>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {defs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No scheduled reports"
                description="Schedule a recurring board report to be generated automatically on your chosen cadence."
                action={
                  <Button size="sm" onClick={openCreate}>
                    Schedule report
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Cadence</TH>
                  <TH>Format</TH>
                  <TH>Recipients</TH>
                </TR>
              </THead>
              <TBody>
                {defs.map((d) => (
                  <TR key={d.id}>
                    <TD className="font-medium text-zinc-100">{d.name ?? 'Untitled'}</TD>
                    <TD>
                      <Badge tone="sky">{d.cadence ?? '—'}</Badge>
                    </TD>
                    <TD>
                      <Badge tone="slate">{(d.format ?? 'csv').toUpperCase()}</Badge>
                    </TD>
                    <TD className="text-zinc-400">{recipientText(d.recipients)}</TD>
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
        title="Schedule report"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitDef} disabled={saving}>
              {saving ? <Spinner /> : 'Save schedule'}
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
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Weekly recovery board report"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Cadence</label>
              <select
                value={form.cadence}
                onChange={(e) => setForm({ ...form, cadence: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
              >
                {CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Format</label>
              <select
                value={form.format}
                onChange={(e) => setForm({ ...form, format: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Recipients (comma-separated)
            </label>
            <input
              value={form.recipients}
              onChange={(e) => setForm({ ...form, recipients: e.target.value })}
              placeholder="cfo@acme.com, ops@acme.com"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

function RecoveryBars({ summary }: { summary: LedgerSummary }) {
  const rows: Array<{ label: string; cents: number; tone: string }> = [
    { label: 'Recovered', cents: summary.recovered_cents ?? 0, tone: 'bg-amber-500/70' },
    { label: 'Lost', cents: summary.lost_cents ?? 0, tone: 'bg-red-500/70' },
    { label: 'Written off', cents: summary.written_off_cents ?? 0, tone: 'bg-amber-500/70' },
  ]
  const attempted = summary.attempted_cents ?? rows.reduce((a, r) => a + r.cents, 0)
  const max = Math.max(1, attempted, ...rows.map((r) => r.cents))
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-zinc-500">Attempted</span>
        <span className="text-sm font-semibold text-white">{money(attempted)}</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <div className="w-24 shrink-0 text-sm text-zinc-300">{r.label}</div>
          <div className="h-6 flex-1 overflow-hidden rounded bg-zinc-800">
            <div
              className={`flex h-full items-center justify-end rounded px-2 text-xs font-medium text-zinc-950 ${r.tone}`}
              style={{ width: `${Math.max(4, (r.cents / max) * 100)}%` }}
            >
              {money(r.cents)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
