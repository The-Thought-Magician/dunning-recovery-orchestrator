import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces, watchlist_items, subscription_accounts, activity_log } from '../db/schema.js'
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

const addSchema = z.object({
  subscription_account_id: z.string().min(1),
  note: z.string().optional().default(''),
})

const updateSchema = z.object({
  note: z.string().default(''),
})

// ── GET / — watchlist items joined to account data ───────────────────────────
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await resolveWorkspace(userId)
  const rows = await db
    .select({
      id: watchlist_items.id,
      workspace_id: watchlist_items.workspace_id,
      user_id: watchlist_items.user_id,
      subscription_account_id: watchlist_items.subscription_account_id,
      note: watchlist_items.note,
      created_at: watchlist_items.created_at,
      account: {
        id: subscription_accounts.id,
        external_id: subscription_accounts.external_id,
        customer_name: subscription_accounts.customer_name,
        customer_email: subscription_accounts.customer_email,
        plan_name: subscription_accounts.plan_name,
        mrr_cents: subscription_accounts.mrr_cents,
        card_brand: subscription_accounts.card_brand,
        card_last4: subscription_accounts.card_last4,
        card_exp_month: subscription_accounts.card_exp_month,
        card_exp_year: subscription_accounts.card_exp_year,
        geography: subscription_accounts.geography,
        status: subscription_accounts.status,
        updater_coverage: subscription_accounts.updater_coverage,
      },
    })
    .from(watchlist_items)
    .leftJoin(
      subscription_accounts,
      eq(watchlist_items.subscription_account_id, subscription_accounts.id),
    )
    .where(eq(watchlist_items.workspace_id, ws.id))
    .orderBy(desc(watchlist_items.created_at))
  return c.json(rows)
})

// ── POST / — add item (unique per (workspace, account)) ──────────────────────
router.post('/', authMiddleware, zValidator('json', addSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const body = c.req.valid('json')

  // Ownership: the account must belong to this workspace.
  const [account] = await db
    .select()
    .from(subscription_accounts)
    .where(
      and(
        eq(subscription_accounts.id, body.subscription_account_id),
        eq(subscription_accounts.workspace_id, ws.id),
      ),
    )
  if (!account) return c.json({ error: 'Account not found' }, 404)

  const [created] = await db
    .insert(watchlist_items)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      subscription_account_id: body.subscription_account_id,
      note: body.note,
    })
    .onConflictDoUpdate({
      target: [watchlist_items.workspace_id, watchlist_items.subscription_account_id],
      set: { note: body.note },
    })
    .returning()
  await logActivity(ws.id, userId, 'watchlist_item', created.id, 'add', {
    subscription_account_id: body.subscription_account_id,
  })
  return c.json(created, 201)
})

// ── PUT /:id — update note ───────────────────────────────────────────────────
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(watchlist_items)
    .where(and(eq(watchlist_items.id, id), eq(watchlist_items.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(watchlist_items)
    .set({ note: body.note })
    .where(eq(watchlist_items.id, id))
    .returning()
  await logActivity(ws.id, userId, 'watchlist_item', id, 'update', { note: body.note })
  return c.json(updated)
})

// ── DELETE /:id — remove ─────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(watchlist_items)
    .where(and(eq(watchlist_items.id, id), eq(watchlist_items.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(watchlist_items).where(eq(watchlist_items.id, id))
  await logActivity(ws.id, userId, 'watchlist_item', id, 'remove', {})
  return c.json({ success: true })
})

export default router
