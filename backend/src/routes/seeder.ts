import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  subscription_accounts,
  failed_charges,
  recovery_ledger_entries,
  routing_decisions,
  routing_rules,
  retry_simulations,
  retry_schedules,
  card_updater_status,
  dunning_steps,
  dunning_sequences,
  portal_sessions,
  portal_configs,
  cohorts,
  grace_policies,
  playbooks,
  alerts,
  alert_rules,
  watchlist_items,
  forecasts,
  import_jobs,
  ledger_periods,
  decline_code_overrides,
  tactics,
  activity_log,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function getOrCreateWorkspace(userId: string) {
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  if (existing) return existing
  const [created] = await db.insert(workspaces).values({ user_id: userId }).returning()
  return created
}

// Deterministic-ish PRNG so a given seed produces a repeatable book.
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

const PLANS: Array<{ name: string; mrr: number }> = [
  { name: 'Starter', mrr: 2900 },
  { name: 'Growth', mrr: 9900 },
  { name: 'Scale', mrr: 29900 },
  { name: 'Enterprise', mrr: 99900 },
]
const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover']
const GEOS = ['US', 'GB', 'DE', 'FR', 'CA', 'AU', 'BR', 'IN']
const FIRST = ['Ava', 'Liam', 'Mia', 'Noah', 'Zoe', 'Eli', 'Ivy', 'Leo', 'Nora', 'Max', 'Ada', 'Kai']
const LAST = ['Chen', 'Patel', 'Garcia', 'Khan', 'Müller', 'Silva', 'Nguyen', 'Brown', 'Rossi', 'Kim']

// Default decline-code distribution (weights). Mirrors canonical taxonomy codes.
const DEFAULT_DISTRIBUTION: Record<string, number> = {
  insufficient_funds: 30,
  card_expired: 18,
  do_not_honor: 16,
  card_declined: 12,
  processing_error: 8,
  fraud_suspected: 6,
  lost_or_stolen: 4,
  invalid_account: 4,
  authentication_required: 2,
}

const TACTIC_FOR_CODE: Record<string, string> = {
  insufficient_funds: 'delayed_retry',
  card_expired: 'card_updater',
  do_not_honor: 'delayed_retry',
  card_declined: 'immediate_retry',
  processing_error: 'immediate_retry',
  fraud_suspected: 'manual',
  lost_or_stolen: 'dunning',
  invalid_account: 'dunning',
  authentication_required: 'dunning',
}

function weightedPick(dist: Record<string, number>, r: number): string {
  const total = Object.values(dist).reduce((s, w) => s + w, 0) || 1
  let target = r * total
  for (const [code, w] of Object.entries(dist)) {
    target -= w
    if (target <= 0) return code
  }
  return Object.keys(dist)[0] ?? 'card_declined'
}

const generateSchema = z.object({
  size: z.number().int().min(1).max(2000).optional().default(120),
  decline_distribution: z.record(z.string(), z.number()).optional(),
})

function periodLabel(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// POST /generate — build a realistic subscription book + failed-charge stream.
// Roughly 70% of accounts are healthy; the rest produce failed charges drawn
// from the decline distribution. A share of failed charges are marked recovered
// (writing recovered + attempted ledger entries) so downstream analytics have
// signal. Auth-gated, fully workspace+user scoped.
router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const { size, decline_distribution } = c.req.valid('json')
  const dist =
    decline_distribution && Object.keys(decline_distribution).length > 0
      ? decline_distribution
      : DEFAULT_DISTRIBUTION

  const rng = makeRng((Date.now() ^ (size * 2654435761)) >>> 0)
  const now = Date.now()
  const DAY = 86_400_000

  // ── Accounts ────────────────────────────────────────────────────────────────
  const accountRows: Array<typeof subscription_accounts.$inferInsert> = []
  for (let i = 0; i < size; i++) {
    const plan = PLANS[Math.floor(rng() * PLANS.length)]
    const name = `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`
    const brand = CARD_BRANDS[Math.floor(rng() * CARD_BRANDS.length)]
    const geo = GEOS[Math.floor(rng() * GEOS.length)]
    // ~15% of cards expire within the next few months (card-updater at-risk).
    const expiringSoon = rng() < 0.15
    const expMonth = 1 + Math.floor(rng() * 12)
    const expYear = expiringSoon ? 2026 : 2027 + Math.floor(rng() * 2)
    const coverage = rng() < 0.5 ? 'covered' : rng() < 0.5 ? 'not_covered' : 'unknown'
    accountRows.push({
      workspace_id: ws.id,
      user_id: userId,
      external_id: `seed_acct_${i + 1}`,
      customer_name: name,
      customer_email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
      plan_name: plan.name,
      mrr_cents: plan.mrr,
      card_brand: brand,
      card_last4: String(1000 + Math.floor(rng() * 9000)),
      card_exp_month: expMonth,
      card_exp_year: expYear,
      geography: geo,
      status: 'active',
      updater_coverage: coverage,
    })
  }
  const insertedAccounts = accountRows.length
    ? await db.insert(subscription_accounts).values(accountRows).returning()
    : []

  // ── Failed charges + ledger ─────────────────────────────────────────────────
  const chargeRows: Array<typeof failed_charges.$inferInsert> = []
  const chargePlan: string[] = [] // parallel array to recover ledger metadata
  for (const acct of insertedAccounts) {
    // ~35% of accounts experience a payment failure.
    if (rng() >= 0.35) continue
    const code = weightedPick(dist, rng())
    const tactic = TACTIC_FOR_CODE[code] ?? 'delayed_retry'
    const failedAt = new Date(now - Math.floor(rng() * 90) * DAY)
    const retryCount = Math.floor(rng() * 4)
    chargeRows.push({
      workspace_id: ws.id,
      user_id: userId,
      subscription_account_id: acct.id,
      external_id: `seed_chg_${acct.external_id}`,
      amount_cents: acct.mrr_cents,
      currency: 'USD',
      raw_decline_code: code,
      decline_code: code,
      card_brand: acct.card_brand,
      plan_name: acct.plan_name,
      geography: acct.geography,
      retry_count: retryCount,
      status: 'failed',
      assigned_tactic: tactic,
      failed_at: failedAt,
    })
    chargePlan.push(code)
  }

  const insertedCharges = chargeRows.length
    ? await db.insert(failed_charges).values(chargeRows).returning()
    : []

  // Mark a recoverable share as recovered and write ledger entries (attempted for
  // every charge, recovered for the ones that resolved). Recovery odds depend on
  // the decline code so analytics show realistic per-reason effectiveness.
  const recoveryOdds: Record<string, number> = {
    insufficient_funds: 0.55,
    card_expired: 0.65,
    do_not_honor: 0.4,
    card_declined: 0.45,
    processing_error: 0.7,
    fraud_suspected: 0.1,
    lost_or_stolen: 0.15,
    invalid_account: 0.12,
    authentication_required: 0.5,
  }

  const ledgerRows: Array<typeof recovery_ledger_entries.$inferInsert> = []
  const updates: Array<{ id: string; resolvedAt: Date }> = []
  let recoveredCount = 0
  for (let i = 0; i < insertedCharges.length; i++) {
    const ch = insertedCharges[i]
    const code = chargePlan[i]
    const failedAt = ch.failed_at ? new Date(ch.failed_at) : new Date(now)
    const period = periodLabel(failedAt)
    ledgerRows.push({
      workspace_id: ws.id,
      user_id: userId,
      failed_charge_id: ch.id,
      entry_type: 'attempted',
      amount_cents: ch.amount_cents,
      tactic: ch.assigned_tactic ?? null,
      retry_attempt: ch.retry_count,
      period_id: period,
      reconciled: false,
    })
    const recovered = rng() < (recoveryOdds[code] ?? 0.4)
    if (recovered) {
      recoveredCount += 1
      const resolvedAt = new Date(failedAt.getTime() + (1 + Math.floor(rng() * 5)) * DAY)
      updates.push({ id: ch.id, resolvedAt })
      ledgerRows.push({
        workspace_id: ws.id,
        user_id: userId,
        failed_charge_id: ch.id,
        entry_type: 'recovered',
        amount_cents: ch.amount_cents,
        tactic: ch.assigned_tactic ?? null,
        retry_attempt: ch.retry_count,
        period_id: periodLabel(resolvedAt),
        reconciled: false,
      })
    }
  }

  if (ledgerRows.length) await db.insert(recovery_ledger_entries).values(ledgerRows)
  for (const u of updates) {
    await db
      .update(failed_charges)
      .set({ status: 'recovered', resolved_at: u.resolvedAt })
      .where(and(eq(failed_charges.id, u.id), eq(failed_charges.workspace_id, ws.id)))
  }

  // Record the synthetic import as a job for traceability + audit trail.
  await db.insert(import_jobs).values({
    workspace_id: ws.id,
    user_id: userId,
    source: 'seeder',
    entity: 'subscriptions',
    status: 'completed',
    rows_total: insertedAccounts.length,
    rows_valid: insertedAccounts.length,
    rows_invalid: 0,
    errors: [],
  })
  await db.insert(activity_log).values({
    workspace_id: ws.id,
    user_id: userId,
    entity_type: 'seeder',
    entity_id: ws.id,
    action: 'generate',
    metadata: {
      accounts: insertedAccounts.length,
      charges: insertedCharges.length,
      recovered: recoveredCount,
    },
  })

  return c.json(
    { accounts: insertedAccounts.length, charges: insertedCharges.length, recovered: recoveredCount },
    201,
  )
})

// POST /reset — delete ALL domain data for the workspace. Ordered to respect
// foreign-key dependencies (children before parents). The workspace row and
// billing rows are preserved. Auth-gated + workspace scoped.
router.post('/reset', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)

  // Delete in FK-safe order: tables referencing failed_charges / accounts first.
  await db.delete(routing_decisions).where(eq(routing_decisions.workspace_id, ws.id))
  await db.delete(recovery_ledger_entries).where(eq(recovery_ledger_entries.workspace_id, ws.id))
  await db.delete(retry_simulations).where(eq(retry_simulations.workspace_id, ws.id))
  await db.delete(dunning_steps).where(eq(dunning_steps.workspace_id, ws.id))
  await db.delete(portal_sessions).where(eq(portal_sessions.workspace_id, ws.id))
  await db.delete(card_updater_status).where(eq(card_updater_status.workspace_id, ws.id))
  await db.delete(watchlist_items).where(eq(watchlist_items.workspace_id, ws.id))
  await db.delete(alerts).where(eq(alerts.workspace_id, ws.id))
  await db.delete(failed_charges).where(eq(failed_charges.workspace_id, ws.id))
  await db.delete(subscription_accounts).where(eq(subscription_accounts.workspace_id, ws.id))

  // Independent / parent domain tables.
  await db.delete(routing_rules).where(eq(routing_rules.workspace_id, ws.id))
  await db.delete(retry_schedules).where(eq(retry_schedules.workspace_id, ws.id))
  await db.delete(dunning_sequences).where(eq(dunning_sequences.workspace_id, ws.id))
  await db.delete(portal_configs).where(eq(portal_configs.workspace_id, ws.id))
  await db.delete(cohorts).where(eq(cohorts.workspace_id, ws.id))
  await db.delete(grace_policies).where(eq(grace_policies.workspace_id, ws.id))
  await db.delete(playbooks).where(eq(playbooks.workspace_id, ws.id))
  await db.delete(alert_rules).where(eq(alert_rules.workspace_id, ws.id))
  await db.delete(forecasts).where(eq(forecasts.workspace_id, ws.id))
  await db.delete(import_jobs).where(eq(import_jobs.workspace_id, ws.id))
  await db.delete(ledger_periods).where(eq(ledger_periods.workspace_id, ws.id))
  await db.delete(decline_code_overrides).where(eq(decline_code_overrides.workspace_id, ws.id))
  await db.delete(tactics).where(eq(tactics.workspace_id, ws.id))
  await db.delete(activity_log).where(eq(activity_log.workspace_id, ws.id))

  return c.json({ reset: true })
})

export default router
