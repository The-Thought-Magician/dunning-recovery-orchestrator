'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

interface Playbook {
  id: string
  name: string
  vertical: string
  config: Record<string, unknown> | unknown
  is_template: boolean
  created_at?: string
}

const VERTICALS = ['SaaS', 'Media', 'E-commerce', 'Fintech', 'Education', 'Gaming', 'Other']

function emptyForm() {
  return {
    name: '',
    vertical: 'SaaS',
    config: '{\n  "retry_schedule": "smart",\n  "dunning_channel": "email",\n  "grace_days": 7\n}',
  }
}

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [verticalFilter, setVerticalFilter] = useState('')
  const [showTemplates, setShowTemplates] = useState<'all' | 'templates' | 'custom'>('all')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Playbook | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const [detail, setDetail] = useState<Playbook | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Playbook | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = (await api.getPlaybooks()) as Playbook[]
      setPlaybooks(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load playbooks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return playbooks.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.vertical || '').toLowerCase().includes(q)) return false
      if (verticalFilter && p.vertical !== verticalFilter) return false
      if (showTemplates === 'templates' && !p.is_template) return false
      if (showTemplates === 'custom' && p.is_template) return false
      return true
    })
  }, [playbooks, search, verticalFilter, showTemplates])

  const stats = useMemo(() => {
    const templates = playbooks.filter((p) => p.is_template).length
    const verticals = new Set(playbooks.map((p) => p.vertical).filter(Boolean)).size
    return { total: playbooks.length, templates, custom: playbooks.length - templates, verticals }
  }, [playbooks])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setActionError(null)
    setEditorOpen(true)
  }

  function openEdit(p: Playbook) {
    setEditing(p)
    setForm({
      name: p.name,
      vertical: p.vertical || 'SaaS',
      config: JSON.stringify(p.config ?? {}, null, 2),
    })
    setActionError(null)
    setEditorOpen(true)
  }

  async function openDetail(p: Playbook) {
    setDetailOpen(true)
    setDetail(p)
    try {
      const full = (await api.getPlaybook(p.id)) as Playbook
      if (full && full.id) setDetail(full)
    } catch {
      // keep list version on failure
    }
  }

  async function save() {
    if (!form.name.trim()) {
      setActionError('Name is required')
      return
    }
    let parsedConfig: unknown
    try {
      parsedConfig = form.config.trim() ? JSON.parse(form.config) : {}
    } catch {
      setActionError('Config must be valid JSON')
      return
    }
    setSaving(true)
    setActionError(null)
    try {
      const body = { name: form.name.trim(), vertical: form.vertical, config: parsedConfig }
      if (editing) {
        await api.updatePlaybook(editing.id, body)
        setNotice(`Updated "${form.name.trim()}"`)
      } else {
        await api.createPlaybook(body)
        setNotice(`Created "${form.name.trim()}"`)
      }
      setEditorOpen(false)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save playbook')
    } finally {
      setSaving(false)
    }
  }

  async function apply(p: Playbook) {
    setApplyingId(p.id)
    setActionError(null)
    setNotice(null)
    try {
      const res = (await api.applyPlaybook(p.id)) as { applied?: unknown }
      setNotice(`Applied "${p.name}" to your workspace.`)
      void res
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to apply playbook')
    } finally {
      setApplyingId(null)
    }
  }

  async function doDelete(p: Playbook) {
    setDeletingId(p.id)
    setActionError(null)
    try {
      await api.deletePlaybook(p.id)
      setConfirmDelete(null)
      setNotice(`Deleted "${p.name}"`)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete playbook')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading playbooks..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Recovery Playbooks</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Pre-built and custom configurations of schedules, tactics, and dunning. Apply one to set up your workspace fast.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}>
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            New Playbook
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-amber-400 hover:text-amber-200">
            ✕
          </button>
        </div>
      )}
      {actionError && !editorOpen && !confirmDelete && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Playbooks" value={stats.total} />
        <Stat label="Templates" value={stats.templates} tone="emerald" />
        <Stat label="Custom" value={stats.custom} />
        <Stat label="Verticals" value={stats.verticals} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Library</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-44 rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
            />
            <select
              value={verticalFilter}
              onChange={(e) => setVerticalFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
            >
              <option value="">All verticals</option>
              {VERTICALS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={showTemplates}
              onChange={(e) => setShowTemplates(e.target.value as 'all' | 'templates' | 'custom')}
              className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-1.5 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
            >
              <option value="all">All</option>
              <option value="templates">Templates only</option>
              <option value="custom">Custom only</option>
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={playbooks.length === 0 ? 'No playbooks yet' : 'No playbooks match your filters'}
              description={
                playbooks.length === 0
                  ? 'Create a custom playbook or seed sample data to get started.'
                  : 'Try clearing the search or filters.'
              }
              action={
                playbooks.length === 0 ? (
                  <Button size="sm" onClick={openCreate}>
                    New Playbook
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => {
                const keys =
                  p.config && typeof p.config === 'object' ? Object.keys(p.config as Record<string, unknown>) : []
                return (
                  <div
                    key={p.id}
                    className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 transition-colors hover:border-zinc-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => openDetail(p)} className="text-left">
                        <h3 className="font-semibold text-zinc-100 hover:text-amber-300">{p.name}</h3>
                      </button>
                      {p.is_template ? <Badge tone="violet">Template</Badge> : <Badge tone="slate">Custom</Badge>}
                    </div>
                    <div className="mt-2">
                      <Badge tone="sky">{p.vertical || 'General'}</Badge>
                    </div>
                    <div className="mt-3 flex-1">
                      {keys.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {keys.slice(0, 5).map((k) => (
                            <span
                              key={k}
                              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-400"
                            >
                              {k}
                            </span>
                          ))}
                          {keys.length > 5 && (
                            <span className="text-[11px] text-zinc-600">+{keys.length - 5} more</span>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-600">No config keys</p>
                      )}
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => apply(p)}
                        disabled={applyingId === p.id}
                        className="flex-1"
                      >
                        {applyingId === p.id ? 'Applying...' : 'Apply'}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => openEdit(p)}>
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => {
                          setActionError(null)
                          setConfirmDelete(p)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Editor modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit Playbook' : 'New Playbook'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Create Playbook'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="High-velocity SaaS recovery"
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Vertical</span>
              <select
                value={form.vertical}
                onChange={(e) => setForm({ ...form, vertical: e.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/60 focus:outline-none"
              >
                {VERTICALS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Config (JSON)</span>
            <textarea
              value={form.config}
              onChange={(e) => setForm({ ...form, config: e.target.value })}
              rows={10}
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-zinc-600">
              Settings applied to your workspace (retry schedule, dunning channel, grace days, tactics, etc.).
            </span>
          </label>
          {actionError && <p className="text-sm text-red-400">{actionError}</p>}
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail ? detail.name : 'Playbook'}
        className="max-w-2xl"
        footer={
          detail ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setDetailOpen(false)}>
                Close
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const p = detail
                  setDetailOpen(false)
                  apply(p)
                }}
                disabled={applyingId === detail.id}
              >
                {applyingId === detail.id ? 'Applying...' : 'Apply Playbook'}
              </Button>
            </>
          ) : undefined
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="sky">{detail.vertical || 'General'}</Badge>
              {detail.is_template ? <Badge tone="violet">Template</Badge> : <Badge tone="slate">Custom</Badge>}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Configuration</div>
              <pre className="max-h-80 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 font-mono text-xs text-zinc-300">
                {JSON.stringify(detail.config ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete Playbook"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => confirmDelete && doDelete(confirmDelete)}
              disabled={!!deletingId}
            >
              {deletingId ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          Delete <span className="font-semibold text-white">{confirmDelete?.name}</span>? This cannot be undone.
        </p>
        {actionError && <p className="mt-3 text-sm text-red-400">{actionError}</p>}
      </Modal>
    </div>
  )
}
