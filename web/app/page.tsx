import Link from 'next/link'

const features = [
  {
    title: 'Decline-Code Taxonomy Engine',
    body: 'A canonical map of Stripe, Visa, Mastercard and Amex decline codes, each classified hard vs soft and recoverable vs terminal, with the recovery tactic that statistically wins for that code.',
  },
  {
    title: 'Failed-Charge Routing',
    body: 'A priority rules engine routes every failed charge to the right tactic by amount, plan, card brand and retry count, with a per-charge decision log and bulk re-route.',
  },
  {
    title: 'Smart Retry-Schedule Simulator',
    body: 'Model retry schedules as ordered offsets with payday-aligned and issuer-pattern windows, then simulate them against your history to project recovered MRR before you commit.',
  },
  {
    title: 'Recovered-Revenue Ledger',
    body: 'A double-sided ledger that reconciles attempted vs recovered vs lost MRR, attributes recovery to tactic and retry, closes monthly periods, and exports clean CSV for finance.',
  },
  {
    title: 'Card-Updater Coverage Gap Report',
    body: 'Surface the MRR sitting behind cards about to expire, see coverage status per subscription, and break the gap down by brand, issuer and expiring-card month.',
  },
  {
    title: 'Dunning Sequence Builder',
    body: 'Build multi-step email and SMS sequences with per-step delays, per-decline-code copy variants, template variables and live preview, assigned by decline code or segment.',
  },
  {
    title: 'Cohort Recovery-Rate Dashboards',
    body: 'Track recovery rate by plan, geography, card brand, decline reason and retry attempt, build cohorts from filters, and compare them over time.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-base font-black text-slate-950">D</span>
          <span className="text-lg font-black tracking-tight text-white">DunningRecovery<span className="text-emerald-400">Orchestrator</span></span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/pricing" className="hidden text-slate-300 hover:text-white sm:block">Pricing</Link>
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(16,185,129,0.15),transparent)]" />
        <div className="relative mx-auto max-w-5xl px-6 py-24 text-center">
          <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
            Recovered-revenue intelligence for subscription businesses
          </span>
          <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight text-white sm:text-6xl">
            Turn failed payment retries into
            <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent"> recovered cash</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
            DunningRecoveryOrchestrator classifies every failed recurring charge by its decline code, routes it to the tactic that
            works, simulates smart retry timing, and reconciles every recovered dollar in an auditable ledger. It never touches a
            card and never processes a payment.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/auth/sign-up" className="rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-slate-950 hover:bg-emerald-400">
              Start recovering revenue
            </Link>
            <Link href="/pricing" className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-800">
              View pricing
            </Link>
          </div>
        </div>
      </section>

      {/* ROI stat band */}
      <section className="border-y border-slate-800 bg-slate-900/40">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 py-12 text-center sm:grid-cols-3">
          <div>
            <div className="text-3xl font-black text-emerald-400">5-12%</div>
            <div className="mt-1 text-sm text-slate-400">of recurring revenue lost to involuntary churn each year</div>
          </div>
          <div>
            <div className="text-3xl font-black text-emerald-400">$300K+</div>
            <div className="mt-1 text-sm text-slate-400">recovered annually from a 30% lift on a $20M book</div>
          </div>
          <div>
            <div className="text-3xl font-black text-emerald-400">$0</div>
            <div className="mt-1 text-sm text-slate-400">every feature free for signed-in users</div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">Involuntary churn is silently destroying your MRR</h2>
        <p className="mt-4 text-center text-slate-400">
          When a renewal charge fails, most teams give up after a naive fixed retry or blast a generic payment-failed email. They
          have no decline-reason taxonomy, no retry-timing model, no card-updater coverage view, and no recovered-revenue number
          they can take to the CFO. DunningRecoveryOrchestrator is the decision and analytics layer that fixes all four.
        </p>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-2 text-center text-2xl font-bold text-white sm:text-3xl">Everything you need to recover failed charges</h2>
        <p className="mb-12 text-center text-slate-400">A deterministic engine that sits beside your billing processor.</p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 transition-colors hover:border-emerald-500/40">
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 text-center">
          <Link href="/auth/sign-up" className="rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-slate-950 hover:bg-emerald-400">
            Create your free workspace
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>DunningRecoveryOrchestrator — recovered-revenue intelligence for subscription businesses.</p>
      </footer>
    </main>
  )
}
