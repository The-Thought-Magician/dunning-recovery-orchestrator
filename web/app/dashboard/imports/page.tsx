'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface ImportJob {
  id: string
  source?: string
  entity?: string
  status?: string
  rows_total?: number
  rows_valid?: number
  rows_invalid?: number
  errors?: Array<{ row?: number; message?: string } | string> | null
  created_at?: string
}

const ENTITIES = [
  { value: 'subscription_accounts', label: 'Subscription accounts', fields: ['external_id', 'customer_name', 'customer_email', 'plan_name', 'mrr_cents', 'card_brand', 'card_last4', 'card_exp_month', 'card_exp_year', 'geography', 'status'] },
  { value: 'failed_charges', label: 'Failed charges', fields: ['external_id', 'amount_cents', 'currency', 'raw_decline_code', 'card_brand', 'plan_name', 'geography', 'failed_at'] },
]

function statusTone(status?: string): 'emerald' | 'amber' | 'red' | 'sky' | 'slate' {
  switch ((status || '').toLowerCase()) {
    case 'completed':
    case 'success':
      return 'emerald'
    case 'partial':
    case 'processing':
    case 'pending':
      return 'amber'
    case 'failed':
    case 'error':
      return 'red'
    default:
      return 'slate'
  }
}

function fmtTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

// Minimal CSV parser: handles quoted fields, commas, escaped quotes, CRLF.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

export default function ImportsPage() {
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const [entity, setEntity] = useState(ENTITIES[0].value)
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)

  const [seedSize, setSeedSize] = useState('150')
  const [seeding, setSeeding] = useState(false)
  const [resetting, setResetting] = useState(false)

  const [detail, setDetail] = useState<ImportJob | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getImportJobs()
      setJobs(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load import jobs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const entityDef = useMemo(() => ENTITIES.find((e) => e.value === entity) ?? ENTITIES[0], [entity])

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const parsed = parseCsv(text)
      if (parsed.length === 0) {
        setHeaders([])
        setDataRows([])
        return
      }
      const hdr = parsed[0].map((h) => h.trim())
      setHeaders(hdr)
      setDataRows(parsed.slice(1))
      // auto-map columns whose header matches a target field
      const auto: Record<string, string> = {}
      for (const f of entityDef.fields) {
        const match = hdr.find((h) => h.toLowerCase().replace(/[\s-]/g, '_') === f.toLowerCase())
        if (match) auto[f] = match
      }
      setMapping(auto)
    }
    reader.readAsText(file)
  }

  function resetUpload() {
    setHeaders([])
    setDataRows([])
    setMapping({})
    setFileName('')
    if (fileRef.current) fileRef.current.value = ''
  }

  // Re-auto-map when entity changes and headers are present.
  useEffect(() => {
    if (headers.length === 0) return
    const auto: Record<string, string> = {}
    for (const f of entityDef.fields) {
      const match = headers.find((h) => h.toLowerCase().replace(/[\s-]/g, '_') === f.toLowerCase())
      if (match) auto[f] = match
    }
    setMapping(auto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity])

  async function submitUpload() {
    if (dataRows.length === 0) {
      setError('Load a CSV file with at least one data row first.')
      return
    }
    const mappedFields = Object.entries(mapping).filter(([, h]) => h)
    if (mappedFields.length === 0) {
      setError('Map at least one target field to a CSV column.')
      return
    }
    const idx: Record<string, number> = {}
    for (const [field, h] of mappedFields) idx[field] = headers.indexOf(h)
    const rows = dataRows.map((r) => {
      const obj: Record<string, string> = {}
      for (const [field, colIdx] of Object.entries(idx)) obj[field] = (r[colIdx] ?? '').trim()
      return obj
    })
    setUploading(true)
    setError(null)
    setBanner(null)
    try {
      const job = await api.uploadImport({ entity, rows, mapping })
      const j = job as ImportJob
      setBanner(
        `Import finished — ${j.rows_valid ?? 0} valid, ${j.rows_invalid ?? 0} invalid of ${j.rows_total ?? rows.length} rows.`,
      )
      resetUpload()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function seed() {
    const size = Number(seedSize)
    setSeeding(true)
    setError(null)
    setBanner(null)
    try {
      const res = await api.seedSampleData(Number.isNaN(size) || size <= 0 ? undefined : { size })
      const accounts = (res?.accounts as number) ?? 0
      const charges = (res?.charges as number) ?? 0
      setBanner(`Seeded sample data — ${accounts} account(s), ${charges} failed charge(s).`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seeding failed')
    } finally {
      setSeeding(false)
    }
  }

  async function resetData() {
    if (!confirm('This deletes ALL workspace domain data (accounts, charges, ledger, etc.). Continue?')) return
    setResetting(true)
    setError(null)
    setBanner(null)
    try {
      await api.resetSampleData()
      setBanner('All workspace domain data has been reset.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  async function openDetail(j: ImportJob) {
    setDetail(j)
    setDetailLoading(true)
    try {
      const full = await api.getImportJob(j.id)
      setDetail(full as ImportJob)
    } catch {
      /* keep the summary row we already have */
    } finally {
      setDetailLoading(false)
    }
  }

  const previewRows = dataRows.slice(0, 5)

  if (loading) return <PageSpinner label="Loading imports..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Imports &amp; Seeder</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Bring your subscription book and failed-charge history in via CSV, or generate realistic sample data to
            explore the platform.
          </p>
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

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">CSV import</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Entity</label>
                <select
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
                >
                  {ENTITIES.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">CSV file</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFile}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1 file:text-xs file:text-zinc-200 hover:file:bg-zinc-700"
                />
              </div>
            </div>

            {headers.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-zinc-500">
                    {fileName} — {dataRows.length} data row(s), {headers.length} column(s)
                  </p>
                  <Button size="sm" variant="ghost" onClick={resetUpload}>
                    Clear
                  </Button>
                </div>

                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Column mapping</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {entityDef.fields.map((f) => (
                      <div key={f} className="flex items-center gap-2">
                        <span className="w-36 shrink-0 truncate text-xs text-zinc-400">{f}</span>
                        <select
                          value={mapping[f] ?? ''}
                          onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}
                          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-amber-500 focus:outline-none"
                        >
                          <option value="">— skip —</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Preview (first 5)</div>
                  <Table>
                    <THead>
                      <TR>
                        {headers.map((h) => (
                          <TH key={h}>{h}</TH>
                        ))}
                      </TR>
                    </THead>
                    <TBody>
                      {previewRows.map((r, i) => (
                        <TR key={i}>
                          {headers.map((_, ci) => (
                            <TD key={ci} className="whitespace-nowrap text-xs">
                              {r[ci] ?? ''}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>

                <div className="flex justify-end">
                  <Button onClick={submitUpload} disabled={uploading}>
                    {uploading ? 'Importing...' : `Import ${dataRows.length} row(s)`}
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                title="No file loaded"
                description="Choose a CSV file to map its columns to the selected entity and preview the rows before importing."
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Sample data seeder</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-zinc-400">
              Generate a realistic subscription book and failed-charge stream so you can explore recovery workflows
              without uploading data.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Accounts to generate
              </label>
              <input
                type="number"
                value={seedSize}
                onChange={(e) => setSeedSize(e.target.value)}
                min={1}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <Button className="w-full" onClick={seed} disabled={seeding}>
              {seeding ? 'Seeding...' : 'Generate sample data'}
            </Button>
            <div className="border-t border-zinc-800 pt-4">
              <p className="mb-2 text-xs text-zinc-500">
                Reset wipes every account, charge, ledger entry, and related record in this workspace. This cannot be
                undone.
              </p>
              <Button className="w-full" variant="danger" onClick={resetData} disabled={resetting}>
                {resetting ? 'Resetting...' : 'Reset all workspace data'}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Import history</h2>
          <Button size="sm" variant="ghost" onClick={load}>
            Refresh
          </Button>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {jobs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No imports yet"
                description="Upload a CSV or seed sample data and your import jobs will appear here with row counts and errors."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Entity</TH>
                  <TH>Source</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="text-right">Valid</TH>
                  <TH className="text-right">Invalid</TH>
                  <TH>When</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {jobs.map((j) => (
                  <TR key={j.id}>
                    <TD className="font-medium text-zinc-100">{j.entity ?? '—'}</TD>
                    <TD className="text-zinc-400">{j.source ?? 'csv'}</TD>
                    <TD>
                      <Badge tone={statusTone(j.status)}>{j.status ?? 'unknown'}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums text-zinc-200">{j.rows_total ?? 0}</TD>
                    <TD className="text-right tabular-nums text-amber-400">{j.rows_valid ?? 0}</TD>
                    <TD className="text-right tabular-nums text-red-400">{j.rows_invalid ?? 0}</TD>
                    <TD className="text-zinc-500">{fmtTime(j.created_at)}</TD>
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openDetail(j)}>
                        View
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal open={detail !== null} onClose={() => setDetail(null)} title="Import job detail">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Total" value={detail.rows_total ?? 0} />
              <Stat label="Valid" value={detail.rows_valid ?? 0} tone="emerald" />
              <Stat label="Invalid" value={detail.rows_invalid ?? 0} tone={detail.rows_invalid ? 'red' : 'default'} />
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Badge tone={statusTone(detail.status)}>{detail.status ?? 'unknown'}</Badge>
              <span>{detail.entity}</span>
              <span className="text-zinc-600">·</span>
              <span>{fmtTime(detail.created_at)}</span>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Row errors</div>
              {detailLoading ? (
                <Spinner label="Loading errors..." />
              ) : !detail.errors || detail.errors.length === 0 ? (
                <p className="text-sm text-zinc-500">No row errors recorded.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.errors.map((err, i) => {
                    const text = typeof err === 'string' ? err : `Row ${err.row ?? '?'}: ${err.message ?? 'invalid'}`
                    return (
                      <li key={i} className="rounded border border-red-500/20 bg-red-500/5 px-3 py-1.5 text-xs text-red-300">
                        {text}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
