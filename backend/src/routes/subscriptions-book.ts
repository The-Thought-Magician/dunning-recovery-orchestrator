import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, subscription_accounts, failed_charges, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Resolve or auto-create the caller's workspace row.
async function getOrCreateWorkspace(userId: string) {
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  if (existing) return existing
  const [created] = await db.insert(workspaces).values({ user_id: userId }).returning()
  return created
}

const accountSchema = z.object({
  external_id: z.string().optional(),
  customer_name: z.string().min(1),
  customer_email: z.string().email().optional(),
  plan_name: z.string().min(1),
  mrr_cents: z.number().int().min(0).optional().default(0),
  card_brand: z.string().optional(),
  card_last4: z.string().max(4).optional(),
  card_exp_month: z.number().int().min(1).max(12).optional(),
  card_exp_year: z.number().int().min(2000).max(2100).optional(),
  geography: z.string().min(1).max(8).optional().default('US'),
  status: z.enum(['active', 'at_risk', 'in_dunning', 'churned_involuntary', 'recovered']).optional(),
  updater_coverage: z.enum(['covered', 'not_covered', 'unknown']).optional(),
})

// Derive an account's current book-health bucket from its most recent failed
// charge rather than trusting the stored `status` column, which is only set
// once at creation/seed time and is never synced when a charge fails, retries,
// or recovers. Falls back to the stored status for accounts with no charges.
function deriveAccountStatus(
  storedStatus: string,
  latestCharge: { status: string; retry_count: number } | undefined,
): string {
  if (!latestCharge) return storedStatus
  switch (latestCharge.status) {
    case 'recovered':
      return 'recovered'
    case 'lost':
    case 'written_off':
      return 'churned_involuntary'
    case 'failed':
    case 'retrying':
      return latestCharge.retry_count > 0 ? 'in_dunning' : 'at_risk'
    default:
      return storedStatus
  }
}

// GET /health-summary — counts by status (declared before /:id so it is not shadowed).
router.get('/health-summary', async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const accounts = await db
    .select()
    .from(subscription_accounts)
    .where(eq(subscription_accounts.workspace_id, ws.id))
  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, ws.id))

  // Latest charge per account, by failed_at.
  const latestByAccount = new Map<string, { status: string; retry_count: number; failed_at: Date }>()
  for (const ch of charges) {
    if (!ch.subscription_account_id) continue
    const existing = latestByAccount.get(ch.subscription_account_id)
    const failedAt = ch.failed_at ? new Date(ch.failed_at) : new Date(0)
    if (!existing || failedAt > existing.failed_at) {
      latestByAccount.set(ch.subscription_account_id, {
        status: ch.status,
        retry_count: ch.retry_count,
        failed_at: failedAt,
      })
    }
  }

  const summary = {
    active: 0,
    at_risk: 0,
    in_dunning: 0,
    churned_involuntary: 0,
    recovered: 0,
  }
  for (const acct of accounts) {
    const derived = deriveAccountStatus(acct.status, latestByAccount.get(acct.id))
    if (derived in summary) {
      summary[derived as keyof typeof summary] += 1
    }
  }
  return c.json(summary)
})

// GET / — list accounts with optional filters (q / status / plan).
router.get('/', async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const q = c.req.query('q')?.trim().toLowerCase()
  const status = c.req.query('status')
  const plan = c.req.query('plan')

  let rows = await db
    .select()
    .from(subscription_accounts)
    .where(eq(subscription_accounts.workspace_id, ws.id))
    .orderBy(desc(subscription_accounts.created_at))

  if (status) rows = rows.filter((r) => r.status === status)
  if (plan) rows = rows.filter((r) => r.plan_name === plan)
  if (q) {
    rows = rows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(q) ||
        (r.customer_email ?? '').toLowerCase().includes(q) ||
        (r.external_id ?? '').toLowerCase().includes(q),
    )
  }
  return c.json(rows)
})

// GET /:id — single account detail.
router.get('/:id', async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const [account] = await db
    .select()
    .from(subscription_accounts)
    .where(
      and(
        eq(subscription_accounts.id, c.req.param('id')),
        eq(subscription_accounts.workspace_id, ws.id),
      ),
    )
  if (!account) return c.json({ error: 'Not found' }, 404)
  return c.json(account)
})

// GET /:id/charges — failed charges for an account.
router.get('/:id/charges', async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const id = c.req.param('id')
  const [account] = await db
    .select()
    .from(subscription_accounts)
    .where(and(eq(subscription_accounts.id, id), eq(subscription_accounts.workspace_id, ws.id)))
  if (!account) return c.json({ error: 'Not found' }, 404)
  const charges = await db
    .select()
    .from(failed_charges)
    .where(
      and(
        eq(failed_charges.workspace_id, ws.id),
        eq(failed_charges.subscription_account_id, id),
      ),
    )
    .orderBy(desc(failed_charges.failed_at))
  return c.json(charges)
})

// POST / — create account.
router.post('/', authMiddleware, zValidator('json', accountSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const body = c.req.valid('json')
  const [account] = await db
    .insert(subscription_accounts)
    .values({ ...body, workspace_id: ws.id, user_id: userId })
    .returning()
  await db.insert(activity_log).values({
    workspace_id: ws.id,
    user_id: userId,
    entity_type: 'subscription_account',
    entity_id: account.id,
    action: 'create',
    metadata: { customer_name: account.customer_name, plan_name: account.plan_name },
  })
  return c.json(account, 201)
})

// PUT /:id — update account.
router.put('/:id', authMiddleware, zValidator('json', accountSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(subscription_accounts)
    .where(and(eq(subscription_accounts.id, id), eq(subscription_accounts.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(subscription_accounts)
    .set(body)
    .where(eq(subscription_accounts.id, id))
    .returning()
  await db.insert(activity_log).values({
    workspace_id: ws.id,
    user_id: userId,
    entity_type: 'subscription_account',
    entity_id: id,
    action: 'update',
    metadata: body as Record<string, unknown>,
  })
  return c.json(updated)
})

// DELETE /:id — delete account.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(subscription_accounts)
    .where(and(eq(subscription_accounts.id, id), eq(subscription_accounts.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(subscription_accounts).where(eq(subscription_accounts.id, id))
  await db.insert(activity_log).values({
    workspace_id: ws.id,
    user_id: userId,
    entity_type: 'subscription_account',
    entity_id: id,
    action: 'delete',
    metadata: {},
  })
  return c.json({ success: true })
})

export default router
