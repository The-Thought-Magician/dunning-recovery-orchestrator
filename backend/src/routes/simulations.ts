import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  retry_schedules,
  retry_simulations,
  failed_charges,
  decline_codes,
  decline_code_overrides,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── Workspace resolution ──────────────────────────────────────────────────────
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

// ── Recovery model ────────────────────────────────────────────────────────────
// Per-attempt marginal recovery probability for a recoverable charge. Each
// successive retry recovers a diminishing share of the still-open balance.
const ATTEMPT_MARGINAL_RATE = [0.42, 0.28, 0.18, 0.12, 0.08, 0.05]

// Multipliers that reward schedules that align retries to real-world windows.
function scheduleQualityMultiplier(schedule: {
  payday_aligned: boolean
  issuer_pattern: boolean
}): number {
  let m = 1
  if (schedule.payday_aligned) m += 0.12
  if (schedule.issuer_pattern) m += 0.08
  return m
}

interface SimResult {
  schedule_id: string
  projected_recovered_cents: number
  projected_recovery_rate: number
  curve: Array<{ attempt: number; rate: number }>
  attempted_cents: number
  attempted_count: number
  recovered_count: number
}

async function recoverabilityMap(workspaceId: string): Promise<Record<string, boolean>> {
  const canonical = await db.select().from(decline_codes)
  const overrides = await db
    .select()
    .from(decline_code_overrides)
    .where(eq(decline_code_overrides.workspace_id, workspaceId))
  const map: Record<string, boolean> = {}
  for (const code of canonical) map[code.code] = code.recoverable
  for (const ov of overrides) {
    if (ov.recoverable !== null && ov.recoverable !== undefined) map[ov.code] = ov.recoverable
  }
  return map
}

async function runScheduleSimulation(
  workspaceId: string,
  schedule: typeof retry_schedules.$inferSelect,
): Promise<SimResult> {
  // Open charges that are candidates for retry.
  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, workspaceId))
  const open = charges.filter((ch) => ch.status === 'failed' || ch.status === 'retrying')

  const recoverable = await recoverabilityMap(workspaceId)
  const qualityMult = scheduleQualityMultiplier(schedule)

  // Number of attempts the schedule will make = number of offsets (>=1).
  const baseAttempts = Math.max(1, (schedule.offsets ?? []).length)

  let attemptedCents = 0
  let recoveredCents = 0
  let recoveredCount = 0

  // Accumulate recovered amount per attempt index for the curve.
  const perAttemptRecovered = new Array<number>(baseAttempts).fill(0)
  const perAttemptAttempted = new Array<number>(baseAttempts).fill(0)

  for (const ch of open) {
    attemptedCents += ch.amount_cents
    const isRecoverable = recoverable[ch.decline_code] ?? true
    if (!isRecoverable) continue

    // Per-code override can extend/limit the attempt count for this code.
    const override = (schedule.per_code_overrides ?? {})[ch.decline_code]
    const attempts =
      Array.isArray(override) && override.length > 0
        ? Math.max(1, override.length)
        : baseAttempts

    let remaining = ch.amount_cents
    let chargeRecovered = false
    for (let i = 0; i < attempts; i++) {
      perAttemptAttempted[Math.min(i, baseAttempts - 1)] += remaining
      const marginal = ATTEMPT_MARGINAL_RATE[Math.min(i, ATTEMPT_MARGINAL_RATE.length - 1)]
      const rate = Math.min(0.95, marginal * qualityMult)
      const captured = Math.round(remaining * rate)
      if (captured <= 0) continue
      perAttemptRecovered[Math.min(i, baseAttempts - 1)] += captured
      recoveredCents += captured
      remaining -= captured
      chargeRecovered = true
      if (remaining <= 0) break
    }
    if (chargeRecovered) recoveredCount += 1
  }

  const curve = perAttemptRecovered.map((rec, i) => {
    const att = perAttemptAttempted[i]
    return { attempt: i + 1, rate: att > 0 ? Number((rec / att).toFixed(4)) : 0 }
  })

  const projectedRate = attemptedCents > 0 ? Number((recoveredCents / attemptedCents).toFixed(4)) : 0

  return {
    schedule_id: schedule.id,
    projected_recovered_cents: recoveredCents,
    projected_recovery_rate: projectedRate,
    curve,
    attempted_cents: attemptedCents,
    attempted_count: open.length,
    recovered_count: recoveredCount,
  }
}

// ── GET / — list saved simulations ────────────────────────────────────────────
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const ws = await resolveWorkspace(userId)
  const rows = await db
    .select()
    .from(retry_simulations)
    .where(eq(retry_simulations.workspace_id, ws.id))
    .orderBy(desc(retry_simulations.created_at))
  return c.json(rows)
})

// ── GET /:id — simulation detail w/ curve ─────────────────────────────────────
router.get('/:id', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const ws = await resolveWorkspace(userId)
  const [row] = await db
    .select()
    .from(retry_simulations)
    .where(
      and(eq(retry_simulations.id, c.req.param('id')), eq(retry_simulations.workspace_id, ws.id)),
    )
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// ── POST /run — run a simulation against failed_charges for a schedule ────────
router.post(
  '/run',
  authMiddleware,
  zValidator('json', z.object({ schedule_id: z.string().min(1), name: z.string().min(1) })),
  async (c) => {
    const userId = getUserId(c)
    const ws = await resolveWorkspace(userId)
    const { schedule_id, name } = c.req.valid('json')

    const [schedule] = await db
      .select()
      .from(retry_schedules)
      .where(and(eq(retry_schedules.id, schedule_id), eq(retry_schedules.workspace_id, ws.id)))
    if (!schedule) return c.json({ error: 'Schedule not found' }, 404)

    const result = await runScheduleSimulation(ws.id, schedule)

    const [row] = await db
      .insert(retry_simulations)
      .values({
        workspace_id: ws.id,
        user_id: userId,
        schedule_id,
        name,
        projected_recovered_cents: result.projected_recovered_cents,
        projected_recovery_rate: result.projected_recovery_rate,
        curve: result.curve,
        results: {
          attempted_cents: result.attempted_cents,
          attempted_count: result.attempted_count,
          recovered_count: result.recovered_count,
          schedule_name: schedule.name,
        },
      })
      .returning()
    await logActivity(ws.id, userId, 'retry_simulation', row.id, 'run', {
      schedule_id,
      projected_recovered_cents: result.projected_recovered_cents,
    })
    return c.json(row, 201)
  },
)

// ── POST /compare — compare multiple schedules ────────────────────────────────
router.post(
  '/compare',
  authMiddleware,
  zValidator('json', z.object({ schedule_ids: z.array(z.string().min(1)).min(1) })),
  async (c) => {
    const userId = getUserId(c)
    const ws = await resolveWorkspace(userId)
    const { schedule_ids } = c.req.valid('json')

    const results: Array<{
      schedule_id: string
      schedule_name: string
      projected_recovered_cents: number
      projected_recovery_rate: number
    }> = []

    for (const sid of schedule_ids) {
      const [schedule] = await db
        .select()
        .from(retry_schedules)
        .where(and(eq(retry_schedules.id, sid), eq(retry_schedules.workspace_id, ws.id)))
      if (!schedule) continue
      const r = await runScheduleSimulation(ws.id, schedule)
      results.push({
        schedule_id: sid,
        schedule_name: schedule.name,
        projected_recovered_cents: r.projected_recovered_cents,
        projected_recovery_rate: r.projected_recovery_rate,
      })
    }

    results.sort((a, b) => b.projected_recovered_cents - a.projected_recovered_cents)
    return c.json({ results })
  },
)

// ── DELETE /:id — delete simulation ───────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(retry_simulations)
    .where(and(eq(retry_simulations.id, id), eq(retry_simulations.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db
    .delete(retry_simulations)
    .where(and(eq(retry_simulations.id, id), eq(retry_simulations.workspace_id, ws.id)))
  await logActivity(ws.id, userId, 'retry_simulation', id, 'delete', { name: existing.name })
  return c.json({ success: true })
})

export default router
