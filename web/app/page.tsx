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
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-base font-black text-zinc-950">D</span>
          <span className="text-lg font-black tracking-tight text-white">DunningRecovery<span className="text-amber-400">Orchestrator</span></span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/pricing" className="hidden text-zinc-300 hover:text-white sm:block">Pricing</Link>
          <Link href="/auth/sign-in" className="text-zinc-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(217,119,6,0.12),transparent)]" />
        <div className="relative mx-auto max-w-5xl px-6 py-24 text-center">
          <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
            Recovery orchestration for subscription revenue teams
          </span>
          <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight text-white sm:text-6xl">
            A disciplined system for recovering
            <span className="bg-gradient-to-r from-amber-400 to-amber-200 bg-clip-text text-transparent"> failed-payment revenue</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            DunningRecoveryOrchestrator gives finance and revenue operations teams a structured framework for classifying decline
            reasons, sequencing retries, and reconciling recovered dollars against an auditable ledger. It does not process
            payments or hold card data; it governs the decisions that determine how much of your at-risk MRR is recovered and how
            quickly.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/auth/sign-up" className="rounded-lg bg-amber-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-amber-400">
              Request a workspace
            </Link>
            <Link href="/pricing" className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-200 hover:bg-zinc-800">
              Review pricing
            </Link>
          </div>
        </div>
      </section>

      {/* Positioning band */}
      <section className="border-y border-zinc-800 bg-zinc-900/40">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 py-12 text-center sm:grid-cols-3">
          <div>
            <div className="text-lg font-semibold text-white">Decline-reason discipline</div>
            <div className="mt-1 text-sm text-zinc-400">A consistent taxonomy replaces ad hoc, one-off retry logic</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-white">Modeled retry timing</div>
            <div className="mt-1 text-sm text-zinc-400">Simulate a retry schedule against history before committing to it</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-white">Auditable reconciliation</div>
            <div className="mt-1 text-sm text-zinc-400">A ledger finance can close, export, and stand behind</div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">Involuntary churn is an operational gap, not a fact of life</h2>
        <p className="mt-4 text-center text-zinc-400">
          When a renewal charge fails, most organizations apply a single fixed retry or send a generic payment-failed notice, with
          no formal decline-reason taxonomy, no modeled retry timing, no visibility into card-updater coverage gaps, and no
          recovered-revenue figure that finance can report with confidence. DunningRecoveryOrchestrator provides the decision
          framework and reporting layer that addresses each of these gaps in a single system of record.
        </p>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="mb-2 text-center text-2xl font-bold text-white sm:text-3xl">A structured capability set for recovery operations</h2>
        <p className="mb-12 text-center text-zinc-400">Positioned alongside your existing billing processor, not in place of it.</p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 transition-colors hover:border-amber-500/40">
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 text-center">
          <Link href="/auth/sign-up" className="rounded-lg bg-amber-500 px-6 py-3 font-semibold text-zinc-950 hover:bg-amber-400">
            Set up your workspace
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-600">
        <p>DunningRecoveryOrchestrator — recovery orchestration for subscription revenue teams.</p>
      </footer>
    </main>
  )
}
