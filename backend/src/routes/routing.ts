import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  routing_rules,
  routing_decisions,
  failed_charges,
  activity_log,
} from '../db/schema.js'
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

// ── rule-matching engine ──────────────────────────────────────────────────────
type Condition = { field: string; op: string; value: unknown }
type ChargeLike = {
  decline_code: string
  card_brand: string | null
  plan_name: string | null
  geography: string
  amount_cents: number
  retry_count: number
}

function fieldValue(charge: ChargeLike, field: string): unknown {
  switch (field) {
    case 'decline_code':
      return charge.decline_code
    case 'card_brand':
      return charge.card_brand
    case 'plan_name':
      return charge.plan_name
    case 'geography':
      return charge.geography
    case 'amount_cents':
      return charge.amount_cents
    case 'retry_count':
      return charge.retry_count
    default:
      return undefined
  }
}

function evalCondition(charge: ChargeLike, cond: Condition): boolean {
  const actual = fieldValue(charge, cond.field)
  const expected = cond.value
  switch (cond.op) {
    case 'eq':
      return actual === expected
    case 'ne':
      return actual !== expected
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    case 'in':
      return Array.isArray(expected) && expected.includes(actual)
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
    default:
      return false
  }
}

function ruleMatches(charge: ChargeLike, conditions: Condition[]): boolean {
  // All conditions must hold (AND semantics). Empty conditions = catch-all.
  if (!conditions || conditions.length === 0) return true
  return conditions.every((cond) => evalCondition(charge, cond))
}

type RuleLike = {
  id: string | null
  priority: number
  conditions: Condition[]
  target_tactic: string
  is_active?: boolean
  name?: string
}

function pickRule(
  charge: ChargeLike,
  rules: RuleLike[],
): { tactic: string; rule_id: string | null; reason: string } {
  // Rules are evaluated in priority order (lower priority number = higher precedence).
  const ordered = [...rules]
    .filter((r) => r.is_active !== false)
    .sort((a, b) => a.priority - b.priority)
  for (const rule of ordered) {
    if (ruleMatches(charge, rule.conditions ?? [])) {
      return {
        tactic: rule.target_tactic,
        rule_id: rule.id,
        reason: `Matched rule "${rule.name ?? rule.id ?? 'candidate'}" (priority ${rule.priority})`,
      }
    }
  }
  return { tactic: 'delayed_retry', rule_id: null, reason: 'No rule matched; default tactic' }
}

// ── GET /rules — list ordered by priority ─────────────────────────────────────
router.get('/rules', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await resolveWorkspace(userId)
  const rows = await db
    .select()
    .from(routing_rules)
    .where(eq(routing_rules.workspace_id, ws.id))
    .orderBy(routing_rules.priority)
  return c.json(rows)
})

// ── GET /decisions — recent decisions ─────────────────────────────────────────
router.get('/decisions', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await resolveWorkspace(userId)
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500)
  const rows = await db
    .select()
    .from(routing_decisions)
    .where(eq(routing_decisions.workspace_id, ws.id))
    .orderBy(desc(routing_decisions.created_at))
    .limit(limit)
  return c.json(rows)
})

// ── POST /rules — create ──────────────────────────────────────────────────────
const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.string().min(1),
  value: z.unknown(),
})

const ruleSchema = z.object({
  name: z.string().min(1),
  priority: z.number().int(),
  conditions: z.array(conditionSchema).optional().default([]),
  target_tactic: z.string().min(1),
  is_active: z.boolean().optional().default(true),
})

router.post('/rules', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const body = c.req.valid('json')
  const [rule] = await db
    .insert(routing_rules)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      name: body.name,
      priority: body.priority,
      conditions: body.conditions as Condition[],
      target_tactic: body.target_tactic,
      is_active: body.is_active ?? true,
    })
    .returning()
  await logActivity(ws.id, userId, 'routing_rule', rule.id, 'created', { name: rule.name })
  return c.json(rule, 201)
})

// ── PUT /rules/:id — update ───────────────────────────────────────────────────
router.put('/rules/:id', authMiddleware, zValidator('json', ruleSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(routing_rules)
    .where(and(eq(routing_rules.id, id), eq(routing_rules.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.priority !== undefined) patch.priority = body.priority
  if (body.conditions !== undefined) patch.conditions = body.conditions as Condition[]
  if (body.target_tactic !== undefined) patch.target_tactic = body.target_tactic
  if (body.is_active !== undefined) patch.is_active = body.is_active
  const [updated] = await db
    .update(routing_rules)
    .set(patch)
    .where(eq(routing_rules.id, id))
    .returning()
  await logActivity(ws.id, userId, 'routing_rule', id, 'updated', patch)
  return c.json(updated)
})

// ── DELETE /rules/:id ─────────────────────────────────────────────────────────
router.delete('/rules/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(routing_rules)
    .where(and(eq(routing_rules.id, id), eq(routing_rules.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  // Detach decisions that reference this rule, then delete.
  await db
    .update(routing_decisions)
    .set({ rule_id: null })
    .where(eq(routing_decisions.rule_id, id))
  await db.delete(routing_rules).where(eq(routing_rules.id, id))
  await logActivity(ws.id, userId, 'routing_rule', id, 'deleted', {})
  return c.json({ success: true })
})

// ── POST /simulate — preview routing against a candidate rule set ─────────────
const simulateSchema = z.object({
  rules: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      priority: z.number().int(),
      conditions: z.array(conditionSchema).optional().default([]),
      target_tactic: z.string().min(1),
      is_active: z.boolean().optional().default(true),
    }),
  ),
})

router.post('/simulate', authMiddleware, zValidator('json', simulateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const { rules } = c.req.valid('json')

  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, ws.id))

  const candidateRules: RuleLike[] = rules.map((r) => ({
    id: r.id ?? null,
    name: r.name,
    priority: r.priority,
    conditions: (r.conditions ?? []) as Condition[],
    target_tactic: r.target_tactic,
    is_active: r.is_active,
  }))

  const assignments = charges.map((charge) => {
    const result = pickRule(charge as ChargeLike, candidateRules)
    return { charge_id: charge.id, tactic: result.tactic, rule_id: result.rule_id }
  })

  const counts: Record<string, number> = {}
  for (const a of assignments) {
    counts[a.tactic] = (counts[a.tactic] ?? 0) + 1
  }

  return c.json({ assignments, counts })
})

// ── POST /apply — re-route all open charges, write routing_decisions ──────────
router.post('/apply', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)

  const rules = await db
    .select()
    .from(routing_rules)
    .where(eq(routing_rules.workspace_id, ws.id))
    .orderBy(routing_rules.priority)

  // Open charges = not yet terminally resolved.
  const openCharges = await db
    .select()
    .from(failed_charges)
    .where(
      and(
        eq(failed_charges.workspace_id, ws.id),
        inArray(failed_charges.status, ['failed', 'retrying']),
      ),
    )

  const ruleLikes: RuleLike[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    conditions: (r.conditions ?? []) as Condition[],
    target_tactic: r.target_tactic,
    is_active: r.is_active,
  }))

  let routed = 0
  for (const charge of openCharges) {
    const result = pickRule(charge as ChargeLike, ruleLikes)
    await db
      .update(failed_charges)
      .set({ assigned_tactic: result.tactic })
      .where(eq(failed_charges.id, charge.id))
    await db.insert(routing_decisions).values({
      workspace_id: ws.id,
      user_id: userId,
      failed_charge_id: charge.id,
      rule_id: result.rule_id,
      chosen_tactic: result.tactic,
      reason: result.reason,
    })
    routed++
  }

  await logActivity(ws.id, userId, 'routing', ws.id, 'applied', { routed })
  return c.json({ routed })
})

export default router
