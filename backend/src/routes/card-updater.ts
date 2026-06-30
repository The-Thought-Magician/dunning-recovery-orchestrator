import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  subscription_accounts,
  card_updater_status,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── workspace resolution ──────────────────────────────────────────────────────
async function resolveWorkspace(userId: string) {
  const existing = await db.query.workspaces.findFirst({
    where: eq(workspaces.user_id, userId),
  })
  if (existing) return existing
  const [created] = await db.insert(workspaces).values({ user_id: userId }).returning()
  return created
}

async function workspaceIdFor(c: any): Promise<{ userId: string; workspaceId: string }> {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  return { userId, workspaceId: ws.id }
}

function brandFor(brand: string | null | undefined): string {
  return brand && brand.length > 0 ? brand : 'unknown'
}

// Crude issuer bucket derived from card brand + last4 parity so the gap report
// has a stable "issuer" dimension without storing a real BIN table.
function issuerFor(account: { card_brand: string | null; card_last4: string | null }): string {
  const brand = brandFor(account.card_brand)
  if (!account.card_last4) return `${brand} / unknown-issuer`
  const last = parseInt(account.card_last4.slice(-1), 10)
  const bucket = Number.isFinite(last) ? (last % 3 === 0 ? 'A' : last % 3 === 1 ? 'B' : 'C') : 'X'
  return `${brand} / issuer-${bucket}`
}

function expiryMonthKey(month: number | null, year: number | null): string {
  if (!month || !year) return 'no-expiry'
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`
}

function expiresAtOf(month: number | null, year: number | null): Date | null {
  if (!month || !year) return null
  // Card expires at the end of the expiry month.
  return new Date(Date.UTC(year, month, 0, 23, 59, 59))
}

// ── GET /coverage — per-account coverage status ───────────────────────────────
router.get('/coverage', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.user_id, userId) })
  if (!ws) return c.json([])
  const rows = await db
    .select()
    .from(card_updater_status)
    .where(eq(card_updater_status.workspace_id, ws.id))
  return c.json(rows)
})

// ── GET /gap-report — at-risk MRR not covered, grouped by month/brand/issuer ──
router.get('/gap-report', async (c) => {
  const userId = getUserId(c)
  if (!userId)
    return c.json({ total_at_risk_cents: 0, by_month: [], by_brand: [], by_issuer: [], rows: [] })
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.user_id, userId) })
  if (!ws)
    return c.json({ total_at_risk_cents: 0, by_month: [], by_brand: [], by_issuer: [], rows: [] })

  const accounts = await db
    .select()
    .from(subscription_accounts)
    .where(eq(subscription_accounts.workspace_id, ws.id))

  // An account is "at risk" when its card-updater coverage is not confirmed
  // covered (updater_coverage !== 'covered'). Its at-risk MRR is its MRR.
  const atRisk = accounts.filter((a) => a.updater_coverage !== 'covered')

  let total = 0
  const byMonth = new Map<string, number>()
  const byBrand = new Map<string, number>()
  const byIssuer = new Map<string, number>()
  const rows = atRisk.map((a) => {
    const month = expiryMonthKey(a.card_exp_month, a.card_exp_year)
    const brand = brandFor(a.card_brand)
    const issuer = issuerFor(a)
    total += a.mrr_cents
    byMonth.set(month, (byMonth.get(month) ?? 0) + a.mrr_cents)
    byBrand.set(brand, (byBrand.get(brand) ?? 0) + a.mrr_cents)
    byIssuer.set(issuer, (byIssuer.get(issuer) ?? 0) + a.mrr_cents)
    return {
      subscription_account_id: a.id,
      customer_name: a.customer_name,
      plan_name: a.plan_name,
      mrr_cents: a.mrr_cents,
      card_brand: brand,
      issuer,
      expiry_month: month,
      coverage: a.updater_coverage,
    }
  })

  const sortDesc = (m: Map<string, number>, key: string) =>
    [...m.entries()]
      .map(([k, v]) => ({ [key]: k, at_risk_cents: v }))
      .sort((x, y) => (y.at_risk_cents as number) - (x.at_risk_cents as number))

  return c.json({
    total_at_risk_cents: total,
    by_month: sortDesc(byMonth, 'month'),
    by_brand: sortDesc(byBrand, 'brand'),
    by_issuer: sortDesc(byIssuer, 'issuer'),
    rows: rows.sort((a, b) => b.mrr_cents - a.mrr_cents),
  })
})

// ── POST /recompute — recompute coverage + at_risk_mrr from expiry ────────────
router.post('/recompute', authMiddleware, async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const accounts = await db
    .select()
    .from(subscription_accounts)
    .where(eq(subscription_accounts.workspace_id, workspaceId))

  const now = Date.now()
  let updated = 0
  for (const a of accounts) {
    const expiresAt = expiresAtOf(a.card_exp_month, a.card_exp_year)
    // Coverage logic: a card already expired (or expiring within 60 days) and not
    // marked covered on the account is "not_covered"; a covered account stays covered.
    let coverage: string
    if (a.updater_coverage === 'covered') {
      coverage = 'covered'
    } else if (expiresAt) {
      const soon = expiresAt.getTime() <= now + 60 * 86_400_000
      coverage = soon ? 'not_covered' : 'unknown'
    } else {
      coverage = 'unknown'
    }
    const atRisk = coverage === 'covered' ? 0 : a.mrr_cents

    const existing = await db.query.card_updater_status.findFirst({
      where: and(
        eq(card_updater_status.workspace_id, workspaceId),
        eq(card_updater_status.subscription_account_id, a.id),
      ),
    })
    if (existing) {
      await db
        .update(card_updater_status)
        .set({ coverage, expires_at: expiresAt, at_risk_mrr_cents: atRisk })
        .where(eq(card_updater_status.id, existing.id))
    } else {
      await db.insert(card_updater_status).values({
        workspace_id: workspaceId,
        user_id: userId,
        subscription_account_id: a.id,
        coverage,
        expires_at: expiresAt,
        at_risk_mrr_cents: atRisk,
      })
    }
    updated++
  }

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'card_updater',
    entity_id: null,
    action: 'recompute',
    metadata: { updated },
  })

  return c.json({ updated })
})

// ── PUT /:id — set coverage for an account ────────────────────────────────────
const setCoverageSchema = z.object({
  subscription_account_id: z.string().min(1),
  coverage: z.enum(['covered', 'not_covered', 'unknown']),
})

router.put('/:id', authMiddleware, zValidator('json', setCoverageSchema), async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const existing = await db.query.card_updater_status.findFirst({
    where: eq(card_updater_status.id, id),
  })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== workspaceId) return c.json({ error: 'Forbidden' }, 403)

  const account = await db.query.subscription_accounts.findFirst({
    where: eq(subscription_accounts.id, body.subscription_account_id),
  })
  if (!account || account.workspace_id !== workspaceId)
    return c.json({ error: 'Account not found' }, 404)

  const atRisk = body.coverage === 'covered' ? 0 : account.mrr_cents
  const [updated] = await db
    .update(card_updater_status)
    .set({
      coverage: body.coverage,
      subscription_account_id: body.subscription_account_id,
      at_risk_mrr_cents: atRisk,
    })
    .where(eq(card_updater_status.id, id))
    .returning()

  // Keep the account's denormalized coverage flag in sync.
  await db
    .update(subscription_accounts)
    .set({ updater_coverage: body.coverage })
    .where(eq(subscription_accounts.id, body.subscription_account_id))

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'card_updater',
    entity_id: id,
    action: 'set_coverage',
    metadata: { coverage: body.coverage, subscription_account_id: body.subscription_account_id },
  })

  return c.json(updated)
})

export default router
