import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  decline_codes,
  decline_code_overrides,
  failed_charges,
  activity_log,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Resolve or auto-create the caller's workspace row.
async function getOrCreateWorkspace(userId: string) {
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  if (existing) return existing
  const [created] = await db.insert(workspaces).values({ user_id: userId }).returning()
  return created
}

// Historical recovery rate for a code, scoped to a workspace.
// attempted = charges with this canonical code; recovered = those whose status is 'recovered'.
async function recoveryRateFor(workspaceId: string, code: string) {
  const rows = await db
    .select()
    .from(failed_charges)
    .where(
      and(eq(failed_charges.workspace_id, workspaceId), eq(failed_charges.decline_code, code)),
    )
  const attempted = rows.length
  const recovered = rows.filter((r) => r.status === 'recovered').length
  const rate = attempted > 0 ? recovered / attempted : 0
  return { attempted, recovered, rate }
}

const overrideSchema = z.object({
  code: z.string().min(1),
  decline_class: z.enum(['hard', 'soft']).optional(),
  recoverable: z.boolean().optional(),
  default_tactic: z.string().min(1).optional(),
  notes: z.string().optional(),
})

// GET / — canonical taxonomy merged with this workspace's overrides.
router.get('/', async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const canonical = await db.select().from(decline_codes)
  const overrides = await db
    .select()
    .from(decline_code_overrides)
    .where(eq(decline_code_overrides.workspace_id, ws.id))
  const overrideByCode = new Map(overrides.map((o) => [o.code, o]))

  const merged = canonical.map((dc) => {
    const ov = overrideByCode.get(dc.code)
    return {
      ...dc,
      decline_class: ov?.decline_class ?? dc.decline_class,
      recoverable: ov?.recoverable ?? dc.recoverable,
      default_tactic: ov?.default_tactic ?? dc.default_tactic,
      override: ov ?? null,
    }
  })
  return c.json(merged)
})

// GET /:code — single code with merged override + computed recovery rate.
router.get('/:code', async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const code = c.req.param('code')
  const [dc] = await db.select().from(decline_codes).where(eq(decline_codes.code, code))
  if (!dc) return c.json({ error: 'Not found' }, 404)
  const [ov] = await db
    .select()
    .from(decline_code_overrides)
    .where(
      and(
        eq(decline_code_overrides.workspace_id, ws.id),
        eq(decline_code_overrides.code, code),
      ),
    )
  const { rate } = await recoveryRateFor(ws.id, code)
  return c.json({
    ...dc,
    decline_class: ov?.decline_class ?? dc.decline_class,
    recoverable: ov?.recoverable ?? dc.recoverable,
    default_tactic: ov?.default_tactic ?? dc.default_tactic,
    override: ov ?? null,
    recovery_rate: rate,
  })
})

// GET /:code/rate — historical recovery rate breakdown for a code.
router.get('/:code/rate', async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const code = c.req.param('code')
  const { attempted, recovered, rate } = await recoveryRateFor(ws.id, code)
  return c.json({ code, attempted, recovered, rate })
})

// POST /overrides — upsert an override for a code (unique per workspace+code).
router.post('/overrides', authMiddleware, zValidator('json', overrideSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const body = c.req.valid('json')
  const [override] = await db
    .insert(decline_code_overrides)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      code: body.code,
      decline_class: body.decline_class,
      recoverable: body.recoverable,
      default_tactic: body.default_tactic,
      notes: body.notes ?? '',
    })
    .onConflictDoUpdate({
      target: [decline_code_overrides.workspace_id, decline_code_overrides.code],
      set: {
        decline_class: body.decline_class,
        recoverable: body.recoverable,
        default_tactic: body.default_tactic,
        notes: body.notes ?? '',
      },
    })
    .returning()
  await db.insert(activity_log).values({
    workspace_id: ws.id,
    user_id: userId,
    entity_type: 'decline_code_override',
    entity_id: override.id,
    action: 'upsert',
    metadata: { code: body.code },
  })
  return c.json(override)
})

// DELETE /overrides/:id — remove an override.
router.delete('/overrides/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(decline_code_overrides)
    .where(
      and(
        eq(decline_code_overrides.id, id),
        eq(decline_code_overrides.workspace_id, ws.id),
      ),
    )
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(decline_code_overrides).where(eq(decline_code_overrides.id, id))
  await db.insert(activity_log).values({
    workspace_id: ws.id,
    user_id: userId,
    entity_type: 'decline_code_override',
    entity_id: id,
    action: 'delete',
    metadata: { code: existing.code },
  })
  return c.json({ success: true })
})

export default router
