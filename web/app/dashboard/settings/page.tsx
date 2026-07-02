'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

interface NotificationPrefs {
  recovery_wins?: boolean
  risk_alerts?: boolean
  period_close?: boolean
  weekly_digest?: boolean
  [k: string]: unknown
}

interface Workspace {
  id: string
  user_id?: string
  name: string
  currency: string
  fiscal_period_start?: string | null
  default_geography?: string | null
  notification_prefs?: NotificationPrefs | null
  created_at?: string
  updated_at?: string
}

interface Plan {
  id: string
  name: string
  price_cents: number
}

interface Subscription {
  id?: string
  plan_id?: string
  status?: string
  current_period_end?: string | null
}

interface BillingPlan {
  subscription?: Subscription | null
  plan?: Plan | null
  stripeEnabled?: boolean
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'BRL']
const GEOGRAPHIES = ['US', 'EU', 'UK', 'CA', 'AU', 'LATAM', 'APAC', 'Global']

const PREF_FIELDS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'recovery_wins', label: 'Recovery wins', hint: 'Notify when a failed charge is recovered' },
  { key: 'risk_alerts', label: 'Risk alerts', hint: 'At-risk MRR and decline-rate alerts' },
  { key: 'period_close', label: 'Period close', hint: 'Ledger period close confirmations' },
  { key: 'weekly_digest', label: 'Weekly digest', hint: 'Summary of recovery performance' },
]

function money(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100)
}

function statusTone(status?: string): 'emerald' | 'amber' | 'red' | 'slate' {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
    case 'trialing':
      return 'emerald'
    case 'past_due':
    case 'incomplete':
      return 'amber'
    case 'canceled':
    case 'unpaid':
      return 'red'
    default:
      return 'slate'
  }
}

export default function SettingsPage() {
  const [ws, setWs] = useState<Workspace | null>(null)
  const [billing, setBilling] = useState<BillingPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // form state
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [fiscalStart, setFiscalStart] = useState('')
  const [geography, setGeography] = useState('')
  const [prefs, setPrefs] = useState<NotificationPrefs>({})

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMsg, setBillingMsg] = useState<string | null>(null)

  const hydrate = useCallback((w: Workspace) => {
    setName(w.name ?? '')
    setCurrency(w.currency ?? 'USD')
    setFiscalStart(w.fiscal_period_start ? String(w.fiscal_period_start).slice(0, 10) : '')
    setGeography(w.default_geography ?? '')
    setPrefs(w.notification_prefs ?? {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [w, b] = await Promise.all([api.getWorkspace(), api.getBillingPlan().catch(() => null)])
      setWs(w as Workspace)
      hydrate(w as Workspace)
      setBilling((b as BillingPlan) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [hydrate])

  useEffect(() => {
    load()
  }, [load])

  async function saveWorkspace() {
    setFormError(null)
    if (!name.trim()) {
      setFormError('Workspace name is required')
      return
    }
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        currency,
        fiscal_period_start: fiscalStart || null,
        default_geography: geography || null,
        notification_prefs: prefs,
      }
      const updated = (await api.updateWorkspace(body)) as Workspace
      setWs(updated)
      hydrate(updated)
      setSavedAt(Date.now())
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleCheckout() {
    setBillingBusy(true)
    setBillingMsg(null)
    try {
      const res = (await api.startCheckout()) as { url?: string }
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Checkout is not configured. Stripe is disabled on this workspace.')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Could not start checkout')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handlePortal() {
    setBillingBusy(true)
    setBillingMsg(null)
    try {
      const res = (await api.openBillingPortal()) as { url?: string }
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Billing portal is not configured. Stripe is disabled on this workspace.')
      }
    } catch (e) {
      setBillingMsg(e instanceof Error ? e.message : 'Could not open billing portal')
    } finally {
      setBillingBusy(false)
    }
  }

  if (loading) return <PageSpinner label="Loading settings..." />

  const sub = billing?.subscription
  const plan = billing?.plan
  const isPro = (plan?.id ?? sub?.plan_id) === 'pro'
  const stripeEnabled = billing?.stripeEnabled ?? false

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-amber-500 focus:outline-none'
  const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Configure your recovery workspace, defaults, and subscription.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Workspace</h2>
              <p className="mt-0.5 text-xs text-zinc-500">Identity, currency, and reporting defaults.</p>
            </CardHeader>
            <CardBody className="space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {formError}
                </div>
              )}
              <div>
                <label className={labelCls}>Workspace name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Acme Recovery" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Reporting currency</label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputCls}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Default geography</label>
                  <select value={geography} onChange={(e) => setGeography(e.target.value)} className={inputCls}>
                    <option value="">None</option>
                    {GEOGRAPHIES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sm:max-w-[50%]">
                <label className={labelCls}>Fiscal period start</label>
                <input type="date" value={fiscalStart} onChange={(e) => setFiscalStart(e.target.value)} className={inputCls} />
                <p className="mt-1 text-xs text-zinc-600">Anchors ledger period boundaries and forecasts.</p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Notification preferences</h2>
              <p className="mt-0.5 text-xs text-zinc-500">Choose which events reach your notifications center.</p>
            </CardHeader>
            <CardBody className="space-y-1">
              {PREF_FIELDS.map((f) => (
                <label
                  key={String(f.key)}
                  className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-2.5 hover:bg-zinc-800/30"
                >
                  <div>
                    <div className="text-sm font-medium text-zinc-200">{f.label}</div>
                    <div className="text-xs text-zinc-500">{f.hint}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(prefs[f.key])}
                    onChange={(e) => setPrefs((p) => ({ ...p, [f.key]: e.target.checked }))}
                    className="h-4 w-4 accent-amber-500"
                  />
                </label>
              ))}
            </CardBody>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={saveWorkspace} disabled={saving}>
              {saving ? <Spinner /> : 'Save changes'}
            </Button>
            {savedAt && <span className="text-xs text-amber-400">Saved {new Date(savedAt).toLocaleTimeString()}</span>}
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Plan &amp; billing</h2>
              {sub?.status && <Badge tone={statusTone(sub.status)}>{sub.status}</Badge>}
            </CardHeader>
            <CardBody className="space-y-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-semibold text-white">{plan?.name ?? (isPro ? 'Pro' : 'Free')}</span>
                  <Badge tone={isPro ? 'emerald' : 'slate'}>{isPro ? 'Pro' : 'Free'}</Badge>
                </div>
                <div className="mt-1 text-sm text-zinc-400">
                  {plan ? (plan.price_cents > 0 ? `${money(plan.price_cents, currency)} / mo` : 'No charge') : '—'}
                </div>
                {sub?.current_period_end && (
                  <div className="mt-2 text-xs text-zinc-500">
                    Renews {new Date(sub.current_period_end).toLocaleDateString()}
                  </div>
                )}
              </div>

              {!stripeEnabled && (
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
                  Stripe is not configured on this deployment. All features are available on the free plan.
                </div>
              )}

              {billingMsg && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  {billingMsg}
                </div>
              )}

              <div className="space-y-2">
                {isPro ? (
                  <Button className="w-full" variant="secondary" disabled={billingBusy} onClick={handlePortal}>
                    {billingBusy ? 'Opening...' : 'Manage billing'}
                  </Button>
                ) : (
                  <>
                    <Button className="w-full" disabled={billingBusy} onClick={handleCheckout}>
                      {billingBusy ? 'Starting...' : 'Upgrade to Pro'}
                    </Button>
                    {sub && (
                      <Button className="w-full" variant="ghost" disabled={billingBusy} onClick={handlePortal}>
                        Open billing portal
                      </Button>
                    )}
                  </>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Workspace info</h2>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">ID</span>
                <code className="truncate font-mono text-xs text-zinc-400">{ws?.id ?? '—'}</code>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Created</span>
                <span className="text-zinc-300">
                  {ws?.created_at ? new Date(ws.created_at).toLocaleDateString() : '—'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Updated</span>
                <span className="text-zinc-300">
                  {ws?.updated_at ? new Date(ws.updated_at).toLocaleDateString() : '—'}
                </span>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
