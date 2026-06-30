'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface FailedCharge {
  id: string
  external_id: string | null
  customer_name?: string | null
  customer_email?: string | null
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
  resolved_at: string | null
}
interface RoutingDecision {
  id: string
  chosen_tactic: string | null
  reason: string | null
  rule_id: string | null
  created_at: string
}
interface LedgerEntry {
  id: string
  entry_type: string
  amount_cents: number
  tactic: string | null
  retry_attempt: number | null
  reconciled: boolean
  created_at: string
}
interface ChargeDetail {
  charge: FailedCharge
  decision: RoutingDecision | null
  ledger: LedgerEntry[]
}
interface DeclineCode {
  code: string
  label: string
  decline_class: string | null
  category: string | null
  recoverable: boolean
  default_tactic: string | null
  description: string | null
  recovery_rate?: number | null
}

const SETTABLE_STATUS = ['recovered', 'lost', 'written_off'] as const

function fmtMoney(cents?: number | null, currency = 'USD'): string {
  const n = (cents ?? 0) / 100
  return n.toLocaleString(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 })
}
function fmtDateTime(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}
function fmtPct(rate?: number | null): string {
  if (rate == null) return '—'
  const r = rate > 1 ? rate / 100 : rate
  return `${(r * 100).toFixed(1)}%`
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
function entryTone(t: string): 'emerald' | 'amber' | 'red' | 'slate' | 'sky' {
  switch (t) {
    case 'recovered':
      return 'emerald'
    case 'attempted':
      return 'sky'
    case 'lost':
      return 'red'
    case 'written_off':
      return 'slate'
    default:
      return 'slate'
  }
}

export default function ChargeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChargeDetail | null>(null)
  const [declineCode, setDeclineCode] = useState<DeclineCode | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [savingTactic, setSavingTactic] = useState(false)
  const [savingStatus, setSavingStatus] = useState<string | null>(null)
  const [tacticInput, setTacticInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const d = (await api.getFailedCharge(id)) as ChargeDetail
      setDetail(d)
      setTacticInput(d?.charge?.assigned_tactic ?? '')
      const code = d?.charge?.decline_code
      if (code) {
        try {
          setDeclineCode((await api.getDeclineCode(code)) as DeclineCode)
        } catch {
          setDeclineCode(null)
        }
      } else {
        setDeclineCode(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load charge')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const saveTactic = async () => {
    setActionError(null)
    setSavingTactic(true)
    try {
      const updated = (await api.setChargeTactic(id, { assigned_tactic: tacticInput })) as FailedCharge
      setDetail((d) => (d ? { ...d, charge: { ...d.charge, ...updated } } : d))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update tactic')
    } finally {
      setSavingTactic(false)
    }
  }

  const setStatus = async (status: string) => {
    setActionError(null)
    setSavingStatus(status)
    try {
      const updated = (await api.setChargeStatus(id, { status })) as FailedCharge
      setDetail((d) => (d ? { ...d, charge: { ...d.charge, ...updated } } : d))
      // refresh to pull the newly written ledger entry
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setSavingStatus(null)
    }
  }

  if (loading) return <PageSpinner label="Loading charge..." />

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <EmptyState
          title="Could not load this charge"
          description={error || 'The charge was not found.'}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
              <Link href="/dashboard/inbox">
                <Button variant="ghost">Back to inbox</Button>
              </Link>
            </div>
          }
        />
      </div>
    )
  }

  const { charge, decision, ledger } = detail
  const timeline = [...(ledger ?? [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/inbox" className="text-xs text-slate-500 hover:text-emerald-400">
            ← Back to inbox
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">
            {charge.customer_name || charge.external_id || `Charge ${charge.id.slice(0, 8)}`}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-400">
            {charge.customer_email && <span>{charge.customer_email}</span>}
            <Badge tone={statusTone(charge.status)}>{charge.status.replace('_', ' ')}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {SETTABLE_STATUS.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === 'recovered' ? 'primary' : s === 'lost' ? 'danger' : 'secondary'}
              disabled={savingStatus !== null || charge.status === s}
              onClick={() => setStatus(s)}
            >
              {savingStatus === s ? 'Saving…' : `Mark ${s.replace('_', ' ')}`}
            </Button>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {actionError}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Amount" value={fmtMoney(charge.amount_cents, charge.currency)} />
        <Stat label="Retry count" value={charge.retry_count} />
        <Stat label="Failed at" value={<span className="text-base">{fmtDateTime(charge.failed_at)}</span>} />
        <Stat
          label="Resolved at"
          value={<span className="text-base">{fmtDateTime(charge.resolved_at)}</span>}
          tone={charge.resolved_at ? 'emerald' : 'default'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Charge facts + decline code */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Charge details</h2>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <Row label="External ID" value={charge.external_id || '—'} />
            <Row label="Plan" value={charge.plan_name || '—'} />
            <Row label="Card brand" value={charge.card_brand ? <span className="capitalize">{charge.card_brand}</span> : '—'} />
            <Row label="Geography" value={charge.geography || '—'} />
            <Row
              label="Raw decline code"
              value={charge.raw_decline_code ? <Badge tone="slate">{charge.raw_decline_code}</Badge> : '—'}
            />
            <Row
              label="Normalized code"
              value={charge.decline_code ? <Badge tone="amber">{charge.decline_code}</Badge> : '—'}
            />

            {declineCode && (
              <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium text-slate-200">{declineCode.label}</div>
                  <Badge tone={declineCode.recoverable ? 'emerald' : 'red'}>
                    {declineCode.recoverable ? 'Recoverable' : 'Hard decline'}
                  </Badge>
                </div>
                {declineCode.description && (
                  <p className="mt-1 text-xs text-slate-500">{declineCode.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                  {declineCode.decline_class && <span>Class: {declineCode.decline_class}</span>}
                  {declineCode.category && <span>· Category: {declineCode.category}</span>}
                  {declineCode.default_tactic && <span>· Default tactic: {declineCode.default_tactic}</span>}
                  <span>· Historical recovery: {fmtPct(declineCode.recovery_rate)}</span>
                </div>
                <Link
                  href="/dashboard/taxonomy"
                  className="mt-2 inline-block text-xs text-emerald-400 hover:text-emerald-300"
                >
                  Manage in taxonomy →
                </Link>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Routing decision + tactic override */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Routing decision</h2>
          </CardHeader>
          <CardBody className="space-y-4 text-sm">
            {decision ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-slate-500">Chosen tactic</span>
                  <Badge tone="emerald">{decision.chosen_tactic || 'none'}</Badge>
                </div>
                {decision.reason && <p className="mt-2 text-xs text-slate-400">{decision.reason}</p>}
                <div className="mt-2 text-xs text-slate-600">
                  {decision.rule_id ? `Rule ${decision.rule_id.slice(0, 8)}` : 'No rule matched'} ·{' '}
                  {fmtDateTime(decision.created_at)}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/30 p-3 text-xs text-slate-500">
                No routing decision recorded for this charge yet. Apply routing from the{' '}
                <Link href="/dashboard/routing" className="text-emerald-400 hover:text-emerald-300">
                  routing page
                </Link>
                .
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
                Manual tactic override
              </label>
              <div className="flex gap-2">
                <input
                  value={tacticInput}
                  onChange={(e) => setTacticInput(e.target.value)}
                  placeholder="tactic key (e.g. smart_retry)"
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
                />
                <Button
                  size="sm"
                  onClick={saveTactic}
                  disabled={savingTactic || tacticInput === (charge.assigned_tactic ?? '')}
                >
                  {savingTactic ? 'Saving…' : 'Save'}
                </Button>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Currently assigned: {charge.assigned_tactic ? <Badge tone="slate">{charge.assigned_tactic}</Badge> : 'unassigned'}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Recovery timeline */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Recovery timeline</h2>
          {savingStatus && <Spinner className="!gap-0" />}
        </CardHeader>
        <CardBody>
          {timeline.length === 0 ? (
            <EmptyState
              title="No ledger entries yet"
              description="Ledger entries are written when this charge is retried or resolved."
            />
          ) : (
            <ol className="relative space-y-5 border-l border-slate-800 pl-6">
              {timeline.map((e) => (
                <li key={e.id} className="relative">
                  <span
                    className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-slate-950 ${
                      e.entry_type === 'recovered'
                        ? 'bg-emerald-500'
                        : e.entry_type === 'lost'
                          ? 'bg-red-500'
                          : e.entry_type === 'attempted'
                            ? 'bg-sky-500'
                            : 'bg-slate-500'
                    }`}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={entryTone(e.entry_type)}>{e.entry_type.replace('_', ' ')}</Badge>
                      {e.tactic && <span className="text-xs text-slate-400">via {e.tactic}</span>}
                      {e.retry_attempt != null && (
                        <span className="text-xs text-slate-500">attempt #{e.retry_attempt}</span>
                      )}
                      {e.reconciled && <Badge tone="emerald">reconciled</Badge>}
                    </div>
                    <div className="text-sm font-medium text-white">{fmtMoney(e.amount_cents, charge.currency)}</div>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">{fmtDateTime(e.created_at)}</div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/60 pb-2 last:border-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-200">{value}</span>
    </div>
  )
}
