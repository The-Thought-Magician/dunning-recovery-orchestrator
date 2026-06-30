import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, activity_log } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Resolve or auto-create the caller's workspace row.
async function getOrCreateWorkspace(userId: string) {
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  if (existing) return existing
  const [created] = await db.insert(workspaces).values({ user_id: userId }).returning()
  return created
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  currency: z.string().min(1).max(8).optional(),
  fiscal_period_start: z.number().int().min(1).max(28).optional(),
  default_geography: z.string().min(1).max(8).optional(),
  notification_prefs: z.record(z.boolean()).optional(),
})

// GET / — get-or-create the current user's workspace.
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  return c.json(ws)
})

// PUT / — update settings on the current user's workspace.
router.put('/', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(workspaces)
    .set({ ...body, updated_at: new Date() })
    .where(eq(workspaces.id, ws.id))
    .returning()
  await db.insert(activity_log).values({
    workspace_id: ws.id,
    user_id: userId,
    entity_type: 'workspace',
    entity_id: ws.id,
    action: 'update',
    metadata: body as Record<string, unknown>,
  })
  return c.json(updated)
})

export default router
