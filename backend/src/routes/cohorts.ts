import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, cohorts, failed_charges, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── Workspace resolution ───────────────────────────────────────────────────
async function resolveWorkspace(userId: string) {
  if (!userId) return null
  const existing = await db.query.workspaces.findFirst({
    where: eq(workspaces.user_id, userId),
  })
  if (existing) return existing
  const [created] = await db
    .insert(workspaces)
    .values({ user_id: userId })
    .returning()
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
    entity_type: 'cohort',
    entity_id: entityId,
    action,
    metadata,
  })
}

const DIMENSIONS = ['plan', 'geography', 'card_brand', 'decline_reason', 'retry_attempt'] as const

const cohortSchema = z.object({
  name: z.string().min(1),
  dimension: z.enum(DIMENSIONS).default('plan'),
  filters: z.record(z.string(), z.unknown()).default({}),
})

// ── Cohort filter matching ─────────────────────────────────────────────────
// Returns true if a failed charge belongs to a cohort given its dimension+filters.
function chargeMatchesCohort(
  charge: typeof failed_charges.$inferSelect,
  dimension: string,
  filters: Record<string, unknown>,
): boolean {
  // Dimension-driven value the cohort keys on.
  const dimValue = (() => {
    switch (dimension) {
      case 'plan':
        return charge.plan_name ?? ''
      case 'geography':
        return charge.geography ?? ''
      case 'card_brand':
        return charge.card_brand ?? ''
      case 'decline_reason':
        return charge.decline_code ?? ''
      case 'retry_attempt':
        return String(charge.retry_count ?? 0)
      default:
        return ''
    }
  })()

  // If filters declare a `value` (or `values[]`) for the dimension, require a match.
  const wanted = filters.value
  if (typeof wanted === 'string' && wanted.length > 0) {
    if (dimValue !== wanted) return false
  }
  const wantedList = filters.values
  if (Array.isArray(wantedList) && wantedList.length > 0) {
    if (!wantedList.map(String).includes(dimValue)) return false
  }

  // Generic field filters (exact match against charge columns).
  for (const [key, val] of Object.entries(filters)) {
    if (key === 'value' || key === 'values') continue
    if (val === undefined || val === null || val === '') continue
    const charged = (charge as unknown as Record<string, unknown>)[key]
    if (charged === undefined) continue
    if (String(charged) !== String(val)) return false
  }
  return true
}

function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// Compute recovery-rate-over-time points for a cohort.
async function cohortRatePoints(workspaceId: string, cohort: typeof cohorts.$inferSelect) {
  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, workspaceId))

  const matched = charges.filter((ch) =>
    chargeMatchesCohort(ch, cohort.dimension, (cohort.filters ?? {}) as Record<string, unknown>),
  )

  // Group by failed_at period.
  const byPeriod = new Map<string, { attempted: number; recovered: number; recovered_cents: number }>()
  for (const ch of matched) {
    const period = periodOf(ch.failed_at instanceof Date ? ch.failed_at : new Date(ch.failed_at))
    let agg = byPeriod.get(period)
    if (!agg) {
      agg = { attempted: 0, recovered: 0, recovered_cents: 0 }
      byPeriod.set(period, agg)
    }
    agg.attempted += 1
    if (ch.status === 'recovered') {
      agg.recovered += 1
      agg.recovered_cents += ch.amount_cents
    }
  }

  return [...byPeriod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, agg]) => ({
      period,
      rate: agg.attempted > 0 ? agg.recovered / agg.attempted : 0,
      recovered_cents: agg.recovered_cents,
    }))
}

// ── Routes ─────────────────────────────────────────────────────────────────

// Public: list cohorts (workspace-scoped via X-User-Id header)
router.get('/', async (c) => {
  const ws = await resolveWorkspace(getUserId(c))
  if (!ws) return c.json([])
  const rows = await db
    .select()
    .from(cohorts)
    .where(eq(cohorts.workspace_id, ws.id))
    .orderBy(desc(cohorts.created_at))
  return c.json(rows)
})

// Public: recovery rate over time for a cohort
router.get('/:id/rate', async (c) => {
  const ws = await resolveWorkspace(getUserId(c))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const id = c.req.param('id')
  const [cohort] = await db
    .select()
    .from(cohorts)
    .where(and(eq(cohorts.id, id), eq(cohorts.workspace_id, ws.id)))
  if (!cohort) return c.json({ error: 'Not found' }, 404)
  const points = await cohortRatePoints(ws.id, cohort)
  return c.json({ cohort, points })
})

// Auth: create cohort
router.post('/', authMiddleware, zValidator('json', cohortSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(cohorts)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      name: body.name,
      dimension: body.dimension,
      filters: body.filters,
    })
    .returning()
  await logActivity(ws.id, userId, created.id, 'create', { name: created.name })
  return c.json(created, 201)
})

// Auth: update cohort
router.put('/:id', authMiddleware, zValidator('json', cohortSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(cohorts)
    .where(and(eq(cohorts.id, id), eq(cohorts.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(cohorts)
    .set(body)
    .where(eq(cohorts.id, id))
    .returning()
  await logActivity(ws.id, userId, id, 'update', body as Record<string, unknown>)
  return c.json(updated)
})

// Auth: delete cohort
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(cohorts)
    .where(and(eq(cohorts.id, id), eq(cohorts.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(cohorts).where(eq(cohorts.id, id))
  await logActivity(ws.id, userId, id, 'delete', { name: existing.name })
  return c.json({ success: true })
})

// Auth: compare multiple cohorts (overall recovery rate per cohort)
const compareSchema = z.object({
  cohort_ids: z.array(z.string().min(1)).min(1),
})

router.post('/compare', authMiddleware, zValidator('json', compareSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const { cohort_ids } = c.req.valid('json')

  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, ws.id))

  const results: Array<{
    cohort_id: string
    name: string | null
    rate: number
    attempted: number
    recovered: number
    recovered_cents: number
  }> = []

  for (const cid of cohort_ids) {
    const [cohort] = await db
      .select()
      .from(cohorts)
      .where(and(eq(cohorts.id, cid), eq(cohorts.workspace_id, ws.id)))
    if (!cohort) {
      results.push({ cohort_id: cid, name: null, rate: 0, attempted: 0, recovered: 0, recovered_cents: 0 })
      continue
    }
    const matched = charges.filter((ch) =>
      chargeMatchesCohort(ch, cohort.dimension, (cohort.filters ?? {}) as Record<string, unknown>),
    )
    const attempted = matched.length
    const recoveredCharges = matched.filter((ch) => ch.status === 'recovered')
    const recovered = recoveredCharges.length
    const recovered_cents = recoveredCharges.reduce((s, ch) => s + ch.amount_cents, 0)
    results.push({
      cohort_id: cid,
      name: cohort.name,
      rate: attempted > 0 ? recovered / attempted : 0,
      attempted,
      recovered,
      recovered_cents,
    })
  }

  return c.json({ results })
})

export default router
