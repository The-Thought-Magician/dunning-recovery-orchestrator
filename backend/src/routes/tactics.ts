import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces, tactics, failed_charges, activity_log } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── workspace resolution + activity ───────────────────────────────────────────
async function resolveWorkspace(userId: string) {
  const existing = await db.query.workspaces.findFirst({
    where: eq(workspaces.user_id, userId),
  })
  if (existing) return existing
  const [created] = await db.insert(workspaces).values({ user_id: userId }).returning()
  return created
}

async function logActivity(
  workspaceId: string,
  userId: string,
  entityType: string,
  entityId: string,
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

// Compute measured recovery rate per tactic key from the charge population:
// recovered charges / charges that were attempted with that tactic.
async function measuredRates(workspaceId: string): Promise<Record<string, number>> {
  const charges = await db
    .select({
      assigned_tactic: failed_charges.assigned_tactic,
      status: failed_charges.status,
    })
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, workspaceId))

  const totals: Record<string, { attempted: number; recovered: number }> = {}
  for (const ch of charges) {
    const key = ch.assigned_tactic
    if (!key) continue
    if (!totals[key]) totals[key] = { attempted: 0, recovered: 0 }
    totals[key].attempted++
    if (ch.status === 'recovered') totals[key].recovered++
  }

  const rates: Record<string, number> = {}
  for (const [key, t] of Object.entries(totals)) {
    rates[key] = t.attempted > 0 ? t.recovered / t.attempted : 0
  }
  return rates
}

// ── GET / — catalog w/ measured rates ─────────────────────────────────────────
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await resolveWorkspace(userId)

  const rows = await db
    .select()
    .from(tactics)
    .where(eq(tactics.workspace_id, ws.id))
    .orderBy(tactics.created_at)

  const rates = await measuredRates(ws.id)
  const enriched = rows.map((t) => ({
    ...t,
    measured_recovery_rate: rates[t.key] ?? t.measured_recovery_rate ?? 0,
  }))
  return c.json(enriched)
})

// ── POST / — create/upsert tactic ─────────────────────────────────────────────
const tacticSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  config: z.record(z.unknown()).optional().default({}),
})

router.post('/', authMiddleware, zValidator('json', tacticSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const body = c.req.valid('json')

  const rates = await measuredRates(ws.id)
  const [tactic] = await db
    .insert(tactics)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      key: body.key,
      name: body.name,
      description: body.description ?? '',
      config: (body.config ?? {}) as Record<string, unknown>,
      measured_recovery_rate: rates[body.key] ?? 0,
    })
    .onConflictDoUpdate({
      target: [tactics.workspace_id, tactics.key],
      set: {
        name: body.name,
        description: body.description ?? '',
        config: (body.config ?? {}) as Record<string, unknown>,
      },
    })
    .returning()

  await logActivity(ws.id, userId, 'tactic', tactic.id, 'upserted', { key: tactic.key })
  return c.json(tactic, 201)
})

// ── PUT /:id — update ─────────────────────────────────────────────────────────
const updateSchema = z.object({
  key: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  config: z.record(z.unknown()).optional(),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(tactics)
    .where(and(eq(tactics.id, id), eq(tactics.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.key !== undefined) patch.key = body.key
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.config !== undefined) patch.config = body.config as Record<string, unknown>

  const [updated] = await db
    .update(tactics)
    .set(patch)
    .where(eq(tactics.id, id))
    .returning()

  await logActivity(ws.id, userId, 'tactic', id, 'updated', patch)
  return c.json(updated)
})

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(tactics)
    .where(and(eq(tactics.id, id), eq(tactics.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(tactics).where(eq(tactics.id, id))
  await logActivity(ws.id, userId, 'tactic', id, 'deleted', { key: existing.key })
  return c.json({ success: true })
})

export default router
