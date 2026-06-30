import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, retry_schedules, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── Workspace resolution ──────────────────────────────────────────────────────
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

// ── Validation ────────────────────────────────────────────────────────────────
const offsetSchema = z.object({
  day: z.number(),
  window: z.string(),
})

const scheduleSchema = z.object({
  name: z.string().min(1),
  offsets: z.array(offsetSchema).optional().default([]),
  payday_aligned: z.boolean().optional().default(false),
  issuer_pattern: z.boolean().optional().default(false),
  per_code_overrides: z.record(z.string(), z.array(z.number())).optional().default({}),
  is_default: z.boolean().optional().default(false),
})

// ── GET / — list schedules (public, workspace-scoped via header) ──────────────
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const ws = await resolveWorkspace(userId)
  const rows = await db
    .select()
    .from(retry_schedules)
    .where(eq(retry_schedules.workspace_id, ws.id))
    .orderBy(desc(retry_schedules.created_at))
  return c.json(rows)
})

// ── GET /:id — schedule detail ────────────────────────────────────────────────
router.get('/:id', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const ws = await resolveWorkspace(userId)
  const [row] = await db
    .select()
    .from(retry_schedules)
    .where(and(eq(retry_schedules.id, c.req.param('id')), eq(retry_schedules.workspace_id, ws.id)))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// ── POST / — create schedule ──────────────────────────────────────────────────
router.post('/', authMiddleware, zValidator('json', scheduleSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const body = c.req.valid('json')

  // If this schedule is the default, clear any existing default first.
  if (body.is_default) {
    await db
      .update(retry_schedules)
      .set({ is_default: false })
      .where(eq(retry_schedules.workspace_id, ws.id))
  }

  const [row] = await db
    .insert(retry_schedules)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      name: body.name,
      offsets: body.offsets,
      payday_aligned: body.payday_aligned,
      issuer_pattern: body.issuer_pattern,
      per_code_overrides: body.per_code_overrides,
      is_default: body.is_default,
    })
    .returning()
  await logActivity(ws.id, userId, 'retry_schedule', row.id, 'create', { name: row.name })
  return c.json(row, 201)
})

// ── PUT /:id — update schedule ────────────────────────────────────────────────
router.put('/:id', authMiddleware, zValidator('json', scheduleSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(retry_schedules)
    .where(and(eq(retry_schedules.id, id), eq(retry_schedules.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  if (body.is_default) {
    await db
      .update(retry_schedules)
      .set({ is_default: false })
      .where(eq(retry_schedules.workspace_id, ws.id))
  }

  const [updated] = await db
    .update(retry_schedules)
    .set(body)
    .where(and(eq(retry_schedules.id, id), eq(retry_schedules.workspace_id, ws.id)))
    .returning()
  await logActivity(ws.id, userId, 'retry_schedule', id, 'update', { name: updated.name })
  return c.json(updated)
})

// ── DELETE /:id — delete schedule ─────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(retry_schedules)
    .where(and(eq(retry_schedules.id, id), eq(retry_schedules.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db
    .delete(retry_schedules)
    .where(and(eq(retry_schedules.id, id), eq(retry_schedules.workspace_id, ws.id)))
  await logActivity(ws.id, userId, 'retry_schedule', id, 'delete', { name: existing.name })
  return c.json({ success: true })
})

export default router
