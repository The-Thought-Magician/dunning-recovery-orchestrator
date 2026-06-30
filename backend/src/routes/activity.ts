import { Hono } from 'hono'
import { db } from '../db/index.js'
import { activity_log, workspaces } from '../db/schema.js'
import { and, desc, eq } from 'drizzle-orm'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

/**
 * Resolve (and auto-create) the caller's workspace from the X-User-Id header.
 * Returns null when no user id is present (so reads return an empty set rather
 * than leaking another workspace's audit trail).
 */
async function resolveWorkspace(c: any) {
  const userId = getUserId(c)
  if (!userId) return null
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.user_id, userId))
  if (existing.length > 0) return existing[0]
  const [created] = await db
    .insert(workspaces)
    .values({ user_id: userId })
    .onConflictDoNothing()
    .returning()
  if (created) return created
  // Concurrent insert raced us; re-read.
  const [row] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.user_id, userId))
  return row ?? null
}

// GET / — append-only activity/audit log for the workspace.
// Optional filters: entity_type, entity_id. Newest first.
router.get('/', async (c) => {
  const ws = await resolveWorkspace(c)
  if (!ws) return c.json([])

  const entityType = c.req.query('entity_type')
  const entityId = c.req.query('entity_id')

  const conditions = [eq(activity_log.workspace_id, ws.id)]
  if (entityType) conditions.push(eq(activity_log.entity_type, entityType))
  if (entityId) conditions.push(eq(activity_log.entity_id, entityId))

  const rows = await db
    .select()
    .from(activity_log)
    .where(and(...conditions))
    .orderBy(desc(activity_log.created_at))
    .limit(500)

  return c.json(rows)
})

export default router
