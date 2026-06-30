import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  failed_charges,
  routing_decisions,
  recovery_ledger_entries,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── workspace resolution ──────────────────────────────────────────────────────
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

// ── GET / — inbox list with filters ───────────────────────────────────────────
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await resolveWorkspace(userId)

  const declineCode = c.req.query('decline_code')
  const status = c.req.query('status')
  const plan = c.req.query('plan')
  const minAmount = c.req.query('min_amount')
  const retryCount = c.req.query('retry_count')

  const conds = [eq(failed_charges.workspace_id, ws.id)]
  if (declineCode) conds.push(eq(failed_charges.decline_code, declineCode))
  if (status) conds.push(eq(failed_charges.status, status))
  if (plan) conds.push(eq(failed_charges.plan_name, plan))
  if (minAmount && !Number.isNaN(parseInt(minAmount, 10))) {
    conds.push(sql`${failed_charges.amount_cents} >= ${parseInt(minAmount, 10)}`)
  }
  if (retryCount && !Number.isNaN(parseInt(retryCount, 10))) {
    conds.push(eq(failed_charges.retry_count, parseInt(retryCount, 10)))
  }

  const rows = await db
    .select()
    .from(failed_charges)
    .where(and(...conds))
    .orderBy(desc(failed_charges.failed_at))
  return c.json(rows)
})

// ── GET /:id — detail w/ routing decision + ledger timeline ───────────────────
router.get('/:id', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')

  const [charge] = await db
    .select()
    .from(failed_charges)
    .where(and(eq(failed_charges.id, id), eq(failed_charges.workspace_id, ws.id)))
  if (!charge) return c.json({ error: 'Not found' }, 404)

  const [decision] = await db
    .select()
    .from(routing_decisions)
    .where(
      and(
        eq(routing_decisions.failed_charge_id, id),
        eq(routing_decisions.workspace_id, ws.id),
      ),
    )
    .orderBy(desc(routing_decisions.created_at))
    .limit(1)

  const ledger = await db
    .select()
    .from(recovery_ledger_entries)
    .where(
      and(
        eq(recovery_ledger_entries.failed_charge_id, id),
        eq(recovery_ledger_entries.workspace_id, ws.id),
      ),
    )
    .orderBy(recovery_ledger_entries.created_at)

  return c.json({ charge, decision: decision ?? null, ledger })
})

// ── POST / — create charge ────────────────────────────────────────────────────
const createSchema = z.object({
  subscription_account_id: z.string().optional().nullable(),
  external_id: z.string().optional().nullable(),
  amount_cents: z.number().int(),
  currency: z.string().optional().default('USD'),
  raw_decline_code: z.string().optional().nullable(),
  decline_code: z.string().min(1),
  card_brand: z.string().optional().nullable(),
  plan_name: z.string().optional().nullable(),
  geography: z.string().optional().default('US'),
  retry_count: z.number().int().optional().default(0),
  status: z.string().optional().default('failed'),
  assigned_tactic: z.string().optional().nullable(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const body = c.req.valid('json')

  const [charge] = await db
    .insert(failed_charges)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      subscription_account_id: body.subscription_account_id ?? null,
      external_id: body.external_id ?? null,
      amount_cents: body.amount_cents,
      currency: body.currency ?? 'USD',
      raw_decline_code: body.raw_decline_code ?? null,
      decline_code: body.decline_code,
      card_brand: body.card_brand ?? null,
      plan_name: body.plan_name ?? null,
      geography: body.geography ?? 'US',
      retry_count: body.retry_count ?? 0,
      status: body.status ?? 'failed',
      assigned_tactic: body.assigned_tactic ?? null,
    })
    .returning()

  // Opening ledger entry: the attempted amount.
  await db.insert(recovery_ledger_entries).values({
    workspace_id: ws.id,
    user_id: userId,
    failed_charge_id: charge.id,
    entry_type: 'attempted',
    amount_cents: charge.amount_cents,
    tactic: charge.assigned_tactic ?? null,
    retry_attempt: charge.retry_count,
  })

  await logActivity(ws.id, userId, 'failed_charge', charge.id, 'created', {
    amount_cents: charge.amount_cents,
    decline_code: charge.decline_code,
  })
  return c.json(charge, 201)
})

// ── PUT /:id/tactic — manual tactic override ──────────────────────────────────
const tacticSchema = z.object({ assigned_tactic: z.string().min(1) })

router.put('/:id/tactic', authMiddleware, zValidator('json', tacticSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const { assigned_tactic } = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(failed_charges)
    .where(and(eq(failed_charges.id, id), eq(failed_charges.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(failed_charges)
    .set({ assigned_tactic })
    .where(eq(failed_charges.id, id))
    .returning()

  // Record the manual override as a routing decision (no rule).
  await db.insert(routing_decisions).values({
    workspace_id: ws.id,
    user_id: userId,
    failed_charge_id: id,
    rule_id: null,
    chosen_tactic: assigned_tactic,
    reason: 'Manual tactic override',
  })

  await logActivity(ws.id, userId, 'failed_charge', id, 'tactic_override', {
    from: existing.assigned_tactic,
    to: assigned_tactic,
  })
  return c.json(updated)
})

// ── PUT /:id/status — status transition writing a ledger entry ────────────────
const statusSchema = z.object({
  status: z.enum(['failed', 'retrying', 'recovered', 'lost', 'written_off']),
})

const STATUS_TO_ENTRY: Record<string, string | null> = {
  recovered: 'recovered',
  lost: 'lost',
  written_off: 'written_off',
  retrying: null,
  failed: null,
}

router.put('/:id/status', authMiddleware, zValidator('json', statusSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const { status } = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(failed_charges)
    .where(and(eq(failed_charges.id, id), eq(failed_charges.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const resolved = status === 'recovered' || status === 'lost' || status === 'written_off'
  const [updated] = await db
    .update(failed_charges)
    .set({ status, resolved_at: resolved ? new Date() : null })
    .where(eq(failed_charges.id, id))
    .returning()

  // Write a ledger entry for terminal transitions.
  const entryType = STATUS_TO_ENTRY[status]
  if (entryType) {
    await db.insert(recovery_ledger_entries).values({
      workspace_id: ws.id,
      user_id: userId,
      failed_charge_id: id,
      entry_type: entryType,
      amount_cents: existing.amount_cents,
      tactic: existing.assigned_tactic ?? null,
      retry_attempt: existing.retry_count,
    })
  }

  await logActivity(ws.id, userId, 'failed_charge', id, 'status_change', {
    from: existing.status,
    to: status,
  })
  return c.json(updated)
})

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(failed_charges)
    .where(and(eq(failed_charges.id, id), eq(failed_charges.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Clean up dependent rows first (FK references).
  await db.delete(recovery_ledger_entries).where(eq(recovery_ledger_entries.failed_charge_id, id))
  await db.delete(routing_decisions).where(eq(routing_decisions.failed_charge_id, id))
  await db.delete(failed_charges).where(eq(failed_charges.id, id))

  await logActivity(ws.id, userId, 'failed_charge', id, 'deleted', {})
  return c.json({ success: true })
})

export default router
