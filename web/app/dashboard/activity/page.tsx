'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

interface ActivityEntry {
  id: string
  workspace_id?: string
  user_id?: string
  entity_type: string
  entity_id?: string | null
  action: string
  metadata?: Record<string, unknown> | null
  created_at?: string
}

function timeAgo(iso?: string): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function fmtFull(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

type Tone = 'emerald' | 'amber' | 'red' | 'sky' | 'slate' | 'violet' | 'default'

function actionTone(action: string): Tone {
  const a = action.toLowerCase()
  if (a.includes('create') || a.includes('add') || a.includes('recover') || a.includes('apply')) return 'emerald'
  if (a.includes('delete') || a.includes('remove') || a.includes('reset') || a.includes('lost') || a.includes('write')) return 'red'
  if (a.includes('update') || a.includes('edit') || a.includes('set') || a.includes('close') || a.includes('ack')) return 'amber'
  if (a.includes('run') || a.includes('evaluate') || a.includes('simulate') || a.includes('forecast') || a.includes('model')) return 'violet'
  return 'sky'
}

function prettify(s: string): string {
  return s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const PAGE_SIZE = 25

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [entityType, setEntityType] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState(PAGE_SIZE)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, unknown> = {}
      if (entityType) params.entity_type = entityType
      const data = await api.getActivity(Object.keys(params).length ? params : undefined)
      setEntries(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }, [entityType])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [search, entityType, actionFilter])

  const entityTypes = useMemo(() => {
    return Array.from(new Set(entries.map((e) => e.entity_type).filter(Boolean))).sort()
  }, [entries])

  const actions = useMemo(() => {
    return Array.from(new Set(entries.map((e) => e.action).filter(Boolean))).sort()
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (entityType && e.entity_type !== entityType) return false
      if (actionFilter && e.action !== actionFilter) return false
      if (q) {
        const hay = `${e.entity_type} ${e.action} ${e.entity_id ?? ''} ${JSON.stringify(e.metadata ?? {})}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, search, entityType, actionFilter])

  const shown = filtered.slice(0, visible)

  const todayCount = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return entries.filter((e) => e.created_at && new Date(e.created_at).getTime() >= start.getTime()).length
  }, [entries])

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function clearFilters() {
    setSearch('')
    setEntityType('')
    setActionFilter('')
  }

  if (loading) return <PageSpinner label="Loading activity..." />

  const hasFilters = Boolean(search || entityType || actionFilter)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Activity Log</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every mutation across your recovery workspace, in one auditable timeline.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total events" value={entries.length} hint="recorded activity" />
        <Stat label="Today" value={todayCount} tone="emerald" hint="since midnight" />
        <Stat label="Entity types" value={entityTypes.length} hint="distinct surfaces touched" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events..."
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">All entities</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {prettify(t)}
                </option>
              ))}
            </select>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {prettify(a)}
                </option>
              ))}
            </select>
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </div>
          <span className="text-xs text-slate-500">
            {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
          </span>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={entries.length === 0 ? 'No activity yet' : 'No events match your filters'}
                description={
                  entries.length === 0
                    ? 'As you create accounts, route charges, and close periods, every action will be logged here.'
                    : 'Try clearing the search or filters above.'
                }
                action={
                  hasFilters && entries.length > 0 ? (
                    <Button size="sm" variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-32">When</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Reference</TH>
                  <TH className="text-right">Details</TH>
                </TR>
              </THead>
              <TBody>
                {shown.map((e) => {
                  const hasMeta = e.metadata && Object.keys(e.metadata).length > 0
                  const isOpen = expanded.has(e.id)
                  return (
                    <Fragment key={e.id}>
                      <TR>
                        <TD className="whitespace-nowrap text-slate-400" title={fmtFull(e.created_at)}>
                          {timeAgo(e.created_at)}
                        </TD>
                        <TD>
                          <Badge tone={actionTone(e.action)}>{prettify(e.action)}</Badge>
                        </TD>
                        <TD className="text-slate-200">{prettify(e.entity_type)}</TD>
                        <TD>
                          {e.entity_id ? (
                            <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                              {e.entity_id.length > 14 ? `${e.entity_id.slice(0, 8)}…${e.entity_id.slice(-4)}` : e.entity_id}
                            </code>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </TD>
                        <TD className="text-right">
                          {hasMeta ? (
                            <Button size="sm" variant="ghost" onClick={() => toggleExpand(e.id)}>
                              {isOpen ? 'Hide' : 'View'}
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-600">—</span>
                          )}
                        </TD>
                      </TR>
                      {hasMeta && isOpen && (
                        <TR className="hover:bg-transparent">
                          <TD colSpan={5} className="bg-slate-950/50">
                            <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-400">
                              {JSON.stringify(e.metadata, null, 2)}
                            </pre>
                          </TD>
                        </TR>
                      )}
                    </Fragment>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {visible < filtered.length && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Load more ({filtered.length - visible} remaining)
          </Button>
        </div>
      )}
    </div>
  )
}
