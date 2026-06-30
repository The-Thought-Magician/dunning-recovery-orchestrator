import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  grace_policies,
  subscription_accounts,
  failed_charges,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function resolveWorkspace(userId: string) {
  if (!userId) return null
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
  entityId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'grace_policy',
    entity_id: entityId,
    action,
    metadata,
  })
}

const createSchema = z.object({
  name: z.string().min(1),
  plan_name: z.string().min(1).optional(),
  grace_days: z.number().int().min(0).default(7),
  soft_suspend_after_days: z.number().int().min(0).default(14),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  plan_name: z.string().min(1).nullable().optional(),
  grace_days: z.number().int().min(0).optional(),
  soft_suspend_after_days: z.number().int().min(0).optional(),
})

// Revenue-impact model for a grace policy.
// Grace periods retain otherwise-churning revenue long enough for recovery tactics to land;
// they also defer a fraction of lost revenue. We model the net retained MRR from the at-risk
// book (failed/retrying charges) on the matching plan, weighted by how much additional recovery
// runway the grace window buys, minus the carrying cost of softly-suspended-but-unrecovered MRR.
async function modelImpact(workspaceId: string, policy: typeof grace_policies.$inferSelect) {
  // Accounts in scope: matching plan (or all if policy is plan-agnostic).
  const accounts = await db
    .select()
    .from(subscription_accounts)
    .where(eq(subscription_accounts.workspace_id, workspaceId))
  const inScope = policy.plan_name
    ? accounts.filter((a) => a.plan_name === policy.plan_name)
    : accounts

  // At-risk accounts are those currently failing recovery (open failed charges).
  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, workspaceId))
  const openByAccount = new Set(
    charges
      .filter((ch) => ch.status === 'failed' || ch.status === 'retrying')
      .map((ch) => ch.subscription_account_id)
      .filter((x): x is string => !!x),
  )

  const atRisk = inScope.filter(
    (a) => openByAccount.has(a.id) || a.status === 'at_risk' || a.status === 'in_dunning',
  )
  const at_risk_mrr_cents = atRisk.reduce((s, a) => s + a.mrr_cents, 0)

  // Recovery runway: each extra grace day buys diminishing recovery probability.
  // Use a saturating curve so additional days help less. Cap the marginal lift at ~45%.
  const totalWindow = policy.grace_days + policy.soft_suspend_after_days
  const recoveryLift = Math.min(0.45, 1 - Math.exp(-totalWindow / 21))

  // Carrying cost: MRR that stays softly-suspended (served but unbilled) during the suspend tail.
  // Approximate as a small fraction of at-risk MRR proportional to the suspend window length.
  const carryFraction = Math.min(0.2, policy.soft_suspend_after_days / 60)

  const retained_cents = Math.round(at_risk_mrr_cents * recoveryLift)
  const carrying_cost_cents = Math.round(at_risk_mrr_cents * carryFraction)
  const projected_impact_cents = retained_cents - carrying_cost_cents

  return {
    projected_impact_cents,
    detail: {
      accounts_in_scope: inScope.length,
      at_risk_accounts: atRisk.length,
      at_risk_mrr_cents,
      grace_days: policy.grace_days,
      soft_suspend_after_days: policy.soft_suspend_after_days,
      recovery_lift: recoveryLift,
      retained_cents,
      carry_fraction: carryFraction,
      carrying_cost_cents,
    },
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

// Public: list policies
router.get('/', async (c) => {
  const ws = await resolveWorkspace(getUserId(c))
  if (!ws) return c.json([])
  const rows = await db
    .select()
    .from(grace_policies)
    .where(eq(grace_policies.workspace_id, ws.id))
    .orderBy(desc(grace_policies.created_at))
  return c.json(rows)
})

// Public: policy detail
router.get('/:id', async (c) => {
  const ws = await resolveWorkspace(getUserId(c))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const id = c.req.param('id')
  const [policy] = await db
    .select()
    .from(grace_policies)
    .where(and(eq(grace_policies.id, id), eq(grace_policies.workspace_id, ws.id)))
  if (!policy) return c.json({ error: 'Not found' }, 404)
  return c.json(policy)
})

// Auth: create policy
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(grace_policies)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      name: body.name,
      plan_name: body.plan_name ?? null,
      grace_days: body.grace_days,
      soft_suspend_after_days: body.soft_suspend_after_days,
      version: 1,
    })
    .returning()
  await logActivity(ws.id, userId, created.id, 'create', { name: created.name })
  return c.json(created, 201)
})

// Auth: update policy (bumps version)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(grace_policies)
    .where(and(eq(grace_policies.id, id), eq(grace_policies.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(grace_policies)
    .set({ ...body, version: existing.version + 1 })
    .where(eq(grace_policies.id, id))
    .returning()
  await logActivity(ws.id, userId, id, 'update', { ...body, version: updated.version })
  return c.json(updated)
})

// Auth: delete policy
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(grace_policies)
    .where(and(eq(grace_policies.id, id), eq(grace_policies.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(grace_policies).where(eq(grace_policies.id, id))
  await logActivity(ws.id, userId, id, 'delete', { name: existing.name })
  return c.json({ success: true })
})

// Auth: model revenue impact (persists projected_impact_cents)
router.post('/:id/model', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const [policy] = await db
    .select()
    .from(grace_policies)
    .where(and(eq(grace_policies.id, id), eq(grace_policies.workspace_id, ws.id)))
  if (!policy) return c.json({ error: 'Not found' }, 404)
  if (policy.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const { projected_impact_cents, detail } = await modelImpact(ws.id, policy)
  await db
    .update(grace_policies)
    .set({ projected_impact_cents })
    .where(eq(grace_policies.id, id))
  await logActivity(ws.id, userId, id, 'model', { projected_impact_cents })
  return c.json({ projected_impact_cents, detail })
})

export default router
