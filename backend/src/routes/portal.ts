import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  portal_configs,
  portal_sessions,
  subscription_accounts,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

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

async function readWorkspaceId(c: any): Promise<string | null> {
  const userId = getUserId(c)
  if (!userId) return null
  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.user_id, userId) })
  return ws ? ws.id : null
}

const DEFAULT_FIELDS = ['card_number', 'expiry', 'cvc', 'postal_code']

// ── GET /config — get-or-create portal config ────────────────────────────────
router.get('/config', async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const existing = await db.query.portal_configs.findFirst({
    where: eq(portal_configs.workspace_id, workspaceId),
  })
  if (existing) return c.json(existing)
  const [created] = await db
    .insert(portal_configs)
    .values({
      workspace_id: workspaceId,
      user_id: userId,
      brand_name: 'Your Company',
      headline: 'Update your payment method',
      body_copy: 'Your recent payment did not go through. Update your card to keep your subscription active.',
      fields: DEFAULT_FIELDS,
    })
    .returning()
  return c.json(created)
})

// ── PUT /config — update config ───────────────────────────────────────────────
const configSchema = z.object({
  brand_name: z.string().optional(),
  primary_color: z.string().optional(),
  headline: z.string().optional(),
  body_copy: z.string().optional(),
  fields: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
})

router.put('/config', authMiddleware, zValidator('json', configSchema), async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const body = c.req.valid('json')
  let existing = await db.query.portal_configs.findFirst({
    where: eq(portal_configs.workspace_id, workspaceId),
  })
  if (!existing) {
    ;[existing] = await db
      .insert(portal_configs)
      .values({ workspace_id: workspaceId, user_id: userId, fields: DEFAULT_FIELDS })
      .returning()
  }
  const [updated] = await db
    .update(portal_configs)
    .set(body)
    .where(eq(portal_configs.id, existing.id))
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'portal_config',
    entity_id: updated.id,
    action: 'update',
    metadata: { ...body },
  })
  return c.json(updated)
})

// ── GET /sessions — list portal sessions w/ conversion stats ──────────────────
router.get('/sessions', async (c) => {
  const wsId = await readWorkspaceId(c)
  if (!wsId) return c.json({ sessions: [], conversion_rate: 0, counts: { created: 0, visited: 0, completed: 0 } })

  const sessions = await db
    .select()
    .from(portal_sessions)
    .where(eq(portal_sessions.workspace_id, wsId))
    .orderBy(desc(portal_sessions.created_at))

  const accounts = await db
    .select()
    .from(subscription_accounts)
    .where(eq(subscription_accounts.workspace_id, wsId))
  const byId = new Map(accounts.map((a) => [a.id, a]))

  const counts = { created: 0, visited: 0, completed: 0 }
  for (const s of sessions) {
    if (s.status === 'completed') counts.completed++
    else if (s.status === 'visited') counts.visited++
    else counts.created++
  }
  const total = sessions.length
  // Conversion = fraction of all minted sessions that reached completed.
  const conversion_rate = total > 0 ? counts.completed / total : 0
  // Of sessions that were actually visited (or completed), how many converted.
  const visitedOrMore = counts.visited + counts.completed
  const visit_to_complete_rate = visitedOrMore > 0 ? counts.completed / visitedOrMore : 0

  const enriched = sessions.map((s) => {
    const acct = s.subscription_account_id ? byId.get(s.subscription_account_id) : undefined
    return {
      ...s,
      account: acct
        ? { id: acct.id, customer_name: acct.customer_name, plan_name: acct.plan_name, mrr_cents: acct.mrr_cents }
        : null,
    }
  })

  return c.json({ sessions: enriched, conversion_rate, visit_to_complete_rate, counts })
})

// ── POST /sessions — mint tokenized update link for an account ────────────────
const mintSchema = z.object({
  subscription_account_id: z.string().min(1),
})

router.post('/sessions', authMiddleware, zValidator('json', mintSchema), async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const body = c.req.valid('json')

  const account = await db.query.subscription_accounts.findFirst({
    where: eq(subscription_accounts.id, body.subscription_account_id),
  })
  if (!account || account.workspace_id !== workspaceId)
    return c.json({ error: 'Account not found' }, 404)

  const token = `pst_${crypto.randomUUID().replace(/-/g, '')}`
  const [created] = await db
    .insert(portal_sessions)
    .values({
      workspace_id: workspaceId,
      user_id: userId,
      subscription_account_id: body.subscription_account_id,
      token,
      status: 'created',
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'portal_session',
    entity_id: created.id,
    action: 'mint',
    metadata: { subscription_account_id: body.subscription_account_id, token },
  })
  return c.json(created, 201)
})

// ── PUT /sessions/:id/status — mark visited/completed ─────────────────────────
const statusSchema = z.object({
  status: z.enum(['created', 'visited', 'completed']),
})

router.put('/sessions/:id/status', authMiddleware, zValidator('json', statusSchema), async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const existing = await db.query.portal_sessions.findFirst({
    where: eq(portal_sessions.id, id),
  })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== workspaceId) return c.json({ error: 'Forbidden' }, 403)

  const patch: {
    status: string
    visited_at?: Date
    completed_at?: Date
  } = { status: body.status }
  const now = new Date()
  if (body.status === 'visited' && !existing.visited_at) patch.visited_at = now
  if (body.status === 'completed') {
    if (!existing.visited_at) patch.visited_at = now
    patch.completed_at = now
  }

  const [updated] = await db
    .update(portal_sessions)
    .set(patch)
    .where(eq(portal_sessions.id, id))
    .returning()

  // On completion, mark the account's card-updater coverage as covered.
  if (body.status === 'completed' && existing.subscription_account_id) {
    await db
      .update(subscription_accounts)
      .set({ updater_coverage: 'covered' })
      .where(
        and(
          eq(subscription_accounts.id, existing.subscription_account_id),
          eq(subscription_accounts.workspace_id, workspaceId),
        ),
      )
  }

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'portal_session',
    entity_id: id,
    action: 'set_status',
    metadata: { status: body.status },
  })
  return c.json(updated)
})

export default router
