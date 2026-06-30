import { Hono } from 'hono'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { and, desc, eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// All notification endpoints are per-user and auth-gated.

// GET / — current user's notifications, newest first
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.user_id, userId))
    .orderBy(desc(notifications.created_at))
  return c.json(rows)
})

// PUT /:id/read — mark a single notification read (ownership enforced)
router.put('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))
    .returning()
  return c.json(updated)
})

// PUT /read-all — mark every notification for the current user read
router.put('/read-all', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const updated = await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.read, false)))
    .returning()
  return c.json({ updated: updated.length })
})

export default router
