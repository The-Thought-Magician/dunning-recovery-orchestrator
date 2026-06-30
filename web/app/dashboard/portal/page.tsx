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

interface PortalConfig {
  id?: string
  brand_name: string
  primary_color: string
  headline: string
  body_copy: string
  fields: string[]
  is_active: boolean
}

interface PortalSession {
  id: string
  subscription_account_id: string
  token: string
  status: string
  visited_at: string | null
  completed_at: string | null
  created_at: string
  customer_name?: string
}

interface SessionsResponse {
  sessions: PortalSession[]
  conversion_rate: number
}

const FIELD_OPTIONS = ['card_number', 'expiry', 'cvc', 'name', 'email', 'billing_zip', 'address']
const STATUS_OPTIONS = ['pending', 'visited', 'completed', 'expired']

function statusTone(s: string): 'emerald' | 'sky' | 'amber' | 'slate' | 'red' {
  switch ((s || '').toLowerCase()) {
    case 'completed':
      return 'emerald'
    case 'visited':
      return 'sky'
    case 'pending':
      return 'amber'
    case 'expired':
      return 'red'
    default:
      return 'slate'
  }
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function PortalPage() {
  const [config, setConfig] = useState<PortalConfig | null>(null)
  const [sessions, setSessions] = useState<PortalSession[]>([])
  const [conversion, setConversion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // config form state
  const [brandName, setBrandName] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#10b981')
  const [headline, setHeadline] = useState('')
  const [bodyCopy, setBodyCopy] = useState('')
  const [fields, setFields] = useState<string[]>([])
  const [isActive, setIsActive] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)

  // status filter
  const [statusFilter, setStatusFilter] = useState('all')

  // mint session modal
  const [mintOpen, setMintOpen] = useState(false)
  const [mintAccountId, setMintAccountId] = useState('')
  const [minting, setMinting] = useState(false)

  function applyConfig(c: PortalConfig) {
    setConfig(c)
    setBrandName(c.brand_name || '')
    setPrimaryColor(c.primary_color || '#10b981')
    setHeadline(c.headline || '')
    setBodyCopy(c.body_copy || '')
    setFields(Array.isArray(c.fields) ? c.fields : [])
    setIsActive(!!c.is_active)
  }

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [cfg, sess] = await Promise.all([
        api.getPortalConfig() as Promise<PortalConfig>,
        api.getPortalSessions() as Promise<SessionsResponse>,
      ])
      if (cfg) applyConfig(cfg)
      setSessions(Array.isArray(sess?.sessions) ? sess.sessions : [])
      setConversion(typeof sess?.conversion_rate === 'number' ? sess.conversion_rate : 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portal data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleField(f: string) {
    setFields((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))
  }

  async function saveConfig() {
    setSavingConfig(true)
    setError(null)
    setNotice(null)
    try {
      const updated = (await api.updatePortalConfig({
        brand_name: brandName,
        primary_color: primaryColor,
        headline,
        body_copy: bodyCopy,
        fields,
        is_active: isActive,
      })) as PortalConfig
      if (updated) applyConfig(updated)
      setNotice('Portal configuration saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save config')
    } finally {
      setSavingConfig(false)
    }
  }

  async function mintSession() {
    if (!mintAccountId.trim()) return
    setMinting(true)
    setError(null)
    try {
      await api.createPortalSession({ subscription_account_id: mintAccountId.trim() })
      setMintOpen(false)
      setMintAccountId('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mint session')
    } finally {
      setMinting(false)
    }
  }

  async function setSessionStatus(s: PortalSession, status: string) {
    setError(null)
    try {
      await api.setPortalSessionStatus(s.id, { status })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update session status')
    }
  }

  const filteredSessions = useMemo(() => {
    if (statusFilter === 'all') return sessions
    return sessions.filter((s) => (s.status || '').toLowerCase() === statusFilter)
  }, [sessions, statusFilter])

  const sessionStats = useMemo(() => {
    const total = sessions.length
    const completed = sessions.filter((s) => (s.status || '').toLowerCase() === 'completed').length
    const visited = sessions.filter((s) => ['visited', 'completed'].includes((s.status || '').toLowerCase())).length
    return { total, completed, visited }
  }, [sessions])

  const convPct = Math.round((conversion || 0) * (conversion <= 1 ? 100 : 1))

  if (loading) return <PageSpinner label="Loading self-serve portal..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Self-Serve Update Portal</h1>
          <p className="mt-1 text-sm text-slate-400">
            Configure the customer-facing card-update page and track session conversion.
          </p>
        </div>
        <Button onClick={() => setMintOpen(true)}>Mint update link</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total sessions" value={sessionStats.total} />
        <Stat label="Visited" value={sessionStats.visited} tone="default" />
        <Stat label="Completed" value={sessionStats.completed} tone="emerald" />
        <Stat label="Conversion rate" value={`${convPct}%`} tone="emerald" hint="Completed / total" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(280px,360px)]">
        {/* Config editor */}
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Portal configuration</h2>
            <Badge tone={isActive ? 'emerald' : 'slate'}>{isActive ? 'active' : 'inactive'}</Badge>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Brand name
                </label>
                <input
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Acme Inc."
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Primary color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-slate-700 bg-slate-900"
                  />
                  <input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Headline</label>
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Update your payment method"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Body copy</label>
              <textarea
                value={bodyCopy}
                onChange={(e) => setBodyCopy(e.target.value)}
                rows={3}
                placeholder="Your last payment didn't go through. Update your card to keep your subscription active."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Collected fields
              </label>
              <div className="flex flex-wrap gap-2">
                {FIELD_OPTIONS.map((f) => {
                  const on = fields.includes(f)
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => toggleField(f)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        on
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                          : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      {f.replace('_', ' ')}
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
              />
              Portal active
            </label>

            <div className="flex justify-end">
              <Button onClick={saveConfig} disabled={savingConfig}>
                {savingConfig ? <Spinner /> : 'Save configuration'}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Live preview */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Preview</h2>
          </CardHeader>
          <CardBody>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
              <div className="text-sm font-semibold" style={{ color: primaryColor }}>
                {brandName || 'Your brand'}
              </div>
              <h3 className="mt-3 text-lg font-semibold text-white">{headline || 'Update your payment method'}</h3>
              <p className="mt-1 text-sm text-slate-400">
                {bodyCopy || 'Update your card details to keep your subscription active.'}
              </p>
              <div className="mt-4 space-y-2">
                {(fields.length ? fields : ['card_number', 'expiry', 'cvc']).map((f) => (
                  <div
                    key={f}
                    className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs capitalize text-slate-500"
                  >
                    {f.replace('_', ' ')}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="mt-4 w-full rounded-lg px-3 py-2 text-sm font-semibold text-slate-950"
                style={{ backgroundColor: primaryColor }}
                disabled
              >
                Update payment method
              </button>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Sessions */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Portal sessions</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardBody className="p-0">
          {filteredSessions.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={sessions.length === 0 ? 'No sessions yet' : 'No sessions match filter'}
                description={
                  sessions.length === 0
                    ? 'Mint a tokenized update link for an at-risk account to start tracking conversion.'
                    : 'Change the status filter to see other sessions.'
                }
                action={
                  sessions.length === 0 ? (
                    <Button onClick={() => setMintOpen(true)}>Mint update link</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>Token</TH>
                  <TH>Status</TH>
                  <TH>Visited</TH>
                  <TH>Completed</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filteredSessions.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-slate-100">
                      {s.customer_name || s.subscription_account_id}
                    </TD>
                    <TD className="font-mono text-xs text-slate-500">{(s.token || '').slice(0, 12)}…</TD>
                    <TD>
                      <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    </TD>
                    <TD className="text-xs">{fmtDate(s.visited_at)}</TD>
                    <TD className="text-xs">{fmtDate(s.completed_at)}</TD>
                    <TD className="text-xs">{fmtDate(s.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {(s.status || '').toLowerCase() !== 'visited' &&
                          (s.status || '').toLowerCase() !== 'completed' && (
                            <Button size="sm" variant="ghost" onClick={() => setSessionStatus(s, 'visited')}>
                              Mark visited
                            </Button>
                          )}
                        {(s.status || '').toLowerCase() !== 'completed' && (
                          <Button size="sm" variant="secondary" onClick={() => setSessionStatus(s, 'completed')}>
                            Mark completed
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Mint session modal */}
      <Modal
        open={mintOpen}
        onClose={() => setMintOpen(false)}
        title="Mint update link"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMintOpen(false)}>
              Cancel
            </Button>
            <Button onClick={mintSession} disabled={minting || !mintAccountId.trim()}>
              {minting ? <Spinner /> : 'Mint link'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Generate a tokenized self-serve update link for a subscription account.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Subscription account ID
            </label>
            <input
              value={mintAccountId}
              onChange={(e) => setMintAccountId(e.target.value)}
              placeholder="acct_..."
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
