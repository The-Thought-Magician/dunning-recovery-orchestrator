'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const allFeatures = [
  'Decline-code taxonomy engine + per-workspace overrides',
  'Failed-charge routing rules, decisions log, simulate & apply',
  'Smart retry-schedule simulator with recovery curves',
  'Recovered-revenue ledger, period close & CSV export',
  'Card-updater coverage gap report & at-risk MRR',
  'Dunning sequence builder with preview',
  'Self-serve card-update portal config & sessions',
  'Cohort recovery dashboards & comparison',
  'Grace-period policy modeler',
  'Recovery forecast vs actual',
  'Decline-reason insights & effectiveness matrix',
  'Playbooks, alerts, watchlists & board reports',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const plan = await api.getBillingPlan()
        if (!cancelled) setStripeEnabled(Boolean(plan?.stripeEnabled))
      } catch {
        if (!cancelled) setStripeEnabled(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-base font-black text-slate-950">D</span>
          <span className="text-lg font-black tracking-tight text-white">DunningRecovery<span className="text-emerald-400">Orchestrator</span></span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400">
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">Simple pricing. Every feature free.</h1>
        <p className="mx-auto mt-4 max-w-2xl text-slate-400">
          All capabilities of DunningRecoveryOrchestrator are free for every signed-in user. The Pro tier exists only as an
          optional billing hook and is not required to use the platform.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-6 text-left md:grid-cols-2">
          {/* Free */}
          <div className="rounded-2xl border border-emerald-500/40 bg-slate-900/60 p-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Free</h2>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                Everything included
              </span>
            </div>
            <div className="mt-4 text-4xl font-black text-white">
              $0<span className="text-base font-medium text-slate-500">/forever</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">Full access to every feature for any signed-in user.</p>
            <Link
              href="/auth/sign-up"
              className="mt-6 block rounded-lg bg-emerald-500 py-3 text-center font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Create free workspace
            </Link>
            <ul className="mt-6 space-y-2">
              {allFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="mt-0.5 text-emerald-400">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Pro */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Pro</h2>
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-400">
                Optional
              </span>
            </div>
            <div className="mt-4 text-4xl font-black text-white">
              Custom
            </div>
            <p className="mt-2 text-sm text-slate-400">
              An optional billing hook for organizations that want a formal subscription. It unlocks no additional product
              capabilities today.
            </p>
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">
              {stripeEnabled === null
                ? 'Checking billing status...'
                : stripeEnabled
                  ? 'Billing is configured. Manage your plan from workspace settings after signing in.'
                  : 'Billing is not configured on this deployment, so checkout is unavailable. Everything stays free.'}
            </div>
            <Link
              href="/auth/sign-up"
              className="mt-6 block rounded-lg border border-slate-700 py-3 text-center font-semibold text-slate-200 hover:bg-slate-800"
            >
              Get started free
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>DunningRecoveryOrchestrator — recovered-revenue intelligence for subscription businesses.</p>
      </footer>
    </main>
  )
}
