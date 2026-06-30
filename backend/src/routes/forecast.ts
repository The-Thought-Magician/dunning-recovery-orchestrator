import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  forecasts,
  failed_charges,
  recovery_ledger_entries,
  retry_simulations,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function resolveWorkspace(userId: string) {
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  if (existing) return existing
  const [created] = await db.insert(workspaces).values({ user_id: userId }).returning()
  return created
}

async function logActivity(
  workspaceId: string,
  userId: string,
  entityType: string,
  entityId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    metadata,
  })
}

const runSchema = z.object({
  period_label: z.string().min(1),
})

const actualSchema = z.object({
  actual_recovered_cents: z.number().int().min(0),
})

// ── GET / — list forecasts (projected vs actual) ─────────────────────────────
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await resolveWorkspace(userId)
  const rows = await db
    .select()
    .from(forecasts)
    .where(eq(forecasts.workspace_id, ws.id))
    .orderBy(desc(forecasts.created_at))
  return c.json(rows)
})

// ── POST /run — run forecast for next period from current config + curves ────
router.post('/run', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const { period_label } = c.req.valid('json')

  // Exposure = open failed-charge value still recoverable this period.
  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, ws.id))
  const openCharges = charges.filter((ch) => ch.status === 'failed' || ch.status === 'retrying')
  const exposureCents = openCharges.reduce((sum, ch) => sum + ch.amount_cents, 0)

  // Historical recovery rate from the ledger (recovered / attempted).
  const ledger = await db
    .select()
    .from(recovery_ledger_entries)
    .where(eq(recovery_ledger_entries.workspace_id, ws.id))
  let attempted = 0
  let recovered = 0
  for (const e of ledger) {
    if (e.entry_type === 'attempted') attempted += e.amount_cents
    if (e.entry_type === 'recovered') recovered += e.amount_cents
  }
  const historicalRate = attempted > 0 ? recovered / attempted : 0

  // Best projected recovery rate from saved simulations (the configured curves).
  const sims = await db
    .select()
    .from(retry_simulations)
    .where(eq(retry_simulations.workspace_id, ws.id))
  let simRate = 0
  for (const s of sims) {
    if ((s.projected_recovery_rate ?? 0) > simRate) simRate = s.projected_recovery_rate ?? 0
  }

  // Blend historical actuals with the modeled curve; fall back to a baseline.
  let baseRate: number
  if (attempted > 0 && simRate > 0) baseRate = historicalRate * 0.6 + simRate * 0.4
  else if (simRate > 0) baseRate = simRate
  else if (attempted > 0) baseRate = historicalRate
  else baseRate = 0.35 // industry baseline when no data yet

  baseRate = Math.max(0, Math.min(1, baseRate))

  const projected = Math.round(exposureCents * baseRate)
  // Confidence band: ±25% of the point estimate, clamped to [0, exposure].
  const low = Math.max(0, Math.round(projected * 0.75))
  const high = Math.min(exposureCents, Math.round(projected * 1.25))

  // Upsert-by-label semantics: replace any existing forecast for this period.
  const [existing] = await db
    .select()
    .from(forecasts)
    .where(and(eq(forecasts.workspace_id, ws.id), eq(forecasts.period_label, period_label)))

  let result
  if (existing) {
    ;[result] = await db
      .update(forecasts)
      .set({
        projected_recovered_cents: projected,
        low_cents: low,
        high_cents: high,
      })
      .where(eq(forecasts.id, existing.id))
      .returning()
    await logActivity(ws.id, userId, 'forecast', result.id, 'run', { period_label, projected, base_rate: baseRate })
  } else {
    ;[result] = await db
      .insert(forecasts)
      .values({
        workspace_id: ws.id,
        user_id: userId,
        period_label,
        projected_recovered_cents: projected,
        low_cents: low,
        high_cents: high,
      })
      .returning()
    await logActivity(ws.id, userId, 'forecast', result.id, 'run', { period_label, projected, base_rate: baseRate })
  }

  return c.json(result, existing ? 200 : 201)
})

// ── PUT /:id/actual — record actual recovered ────────────────────────────────
router.put('/:id/actual', authMiddleware, zValidator('json', actualSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(forecasts)
    .where(and(eq(forecasts.id, id), eq(forecasts.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const { actual_recovered_cents } = c.req.valid('json')
  const [updated] = await db
    .update(forecasts)
    .set({ actual_recovered_cents })
    .where(eq(forecasts.id, id))
    .returning()
  await logActivity(ws.id, userId, 'forecast', id, 'record_actual', { actual_recovered_cents })
  return c.json(updated)
})

export default router
