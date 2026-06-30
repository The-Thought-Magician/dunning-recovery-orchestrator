import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  import_jobs,
  subscription_accounts,
  failed_charges,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function getOrCreateWorkspace(userId: string) {
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  if (existing) return existing
  const [created] = await db.insert(workspaces).values({ user_id: userId }).returning()
  return created
}

// A raw CSV row is an arbitrary string->string map; the client supplies a
// `mapping` from the destination column name to the source CSV header.
const uploadSchema = z.object({
  entity: z.enum(['subscriptions', 'failed_charges']),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(20000),
  mapping: z.record(z.string(), z.string()).default({}),
  source: z.enum(['csv', 'stripe', 'recurly', 'chargebee']).optional().default('csv'),
})

function pick(row: Record<string, unknown>, mapping: Record<string, string>, dest: string): unknown {
  // Prefer the mapped source header; fall back to the destination key itself.
  const src = mapping[dest]
  if (src && src in row) return row[src]
  if (dest in row) return row[dest]
  return undefined
}

function toStr(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s.length === 0 ? undefined : s
}

function toInt(v: unknown): number | undefined {
  const s = toStr(v)
  if (s === undefined) return undefined
  // Accept "12.34", "$12.34", "1,234" forms and dollar amounts.
  const cleaned = s.replace(/[$,\s]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : undefined
}

// Parse a money-ish field into integer cents. If the value already looks like an
// integer count of cents (no decimal point) we keep it; otherwise we treat it as
// a major-unit amount and multiply by 100.
function toCents(v: unknown): number | undefined {
  const s = toStr(v)
  if (s === undefined) return undefined
  const cleaned = s.replace(/[$,\s]/g, '')
  if (cleaned.length === 0) return undefined
  if (cleaned.includes('.')) {
    const n = Number(cleaned)
    return Number.isFinite(n) ? Math.round(n * 100) : undefined
  }
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n) : undefined
}

// GET /jobs — import job history for the workspace (newest first).
router.get('/jobs', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
  if (!userId) return c.json([])
  const ws = await getOrCreateWorkspace(userId)
  const jobs = await db
    .select()
    .from(import_jobs)
    .where(eq(import_jobs.workspace_id, ws.id))
    .orderBy(desc(import_jobs.created_at))
  return c.json(jobs)
})

// GET /jobs/:id — single job detail including row-level validation errors.
router.get('/jobs/:id', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
  if (!userId) return c.json({ error: 'Not found' }, 404)
  const ws = await getOrCreateWorkspace(userId)
  const [job] = await db
    .select()
    .from(import_jobs)
    .where(and(eq(import_jobs.id, c.req.param('id')), eq(import_jobs.workspace_id, ws.id)))
  if (!job) return c.json({ error: 'Not found' }, 404)
  return c.json(job)
})

// POST /upload — ingest CSV rows with column mapping. Validates each row, inserts
// the valid ones into the target table, and records an import_jobs row with a
// per-row error list. Auth-gated; everything is workspace+user scoped.
router.post('/upload', authMiddleware, zValidator('json', uploadSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await getOrCreateWorkspace(userId)
  const { entity, rows, mapping, source } = c.req.valid('json')

  const errors: Array<{ row: number; message: string }> = []
  let valid = 0

  if (entity === 'subscriptions') {
    const toInsert: Array<typeof subscription_accounts.$inferInsert> = []
    rows.forEach((row, idx) => {
      const customer_name = toStr(pick(row, mapping, 'customer_name'))
      const plan_name = toStr(pick(row, mapping, 'plan_name'))
      if (!customer_name) {
        errors.push({ row: idx + 1, message: 'Missing required field: customer_name' })
        return
      }
      if (!plan_name) {
        errors.push({ row: idx + 1, message: 'Missing required field: plan_name' })
        return
      }
      const mrr = toCents(pick(row, mapping, 'mrr_cents')) ?? 0
      const expMonth = toInt(pick(row, mapping, 'card_exp_month'))
      const expYear = toInt(pick(row, mapping, 'card_exp_year'))
      if (expMonth !== undefined && (expMonth < 1 || expMonth > 12)) {
        errors.push({ row: idx + 1, message: `Invalid card_exp_month: ${expMonth}` })
        return
      }
      toInsert.push({
        workspace_id: ws.id,
        user_id: userId,
        external_id: toStr(pick(row, mapping, 'external_id')) ?? null,
        customer_name,
        customer_email: toStr(pick(row, mapping, 'customer_email')) ?? null,
        plan_name,
        mrr_cents: mrr,
        card_brand: toStr(pick(row, mapping, 'card_brand')) ?? null,
        card_last4: toStr(pick(row, mapping, 'card_last4')) ?? null,
        card_exp_month: expMonth ?? null,
        card_exp_year: expYear ?? null,
        geography: toStr(pick(row, mapping, 'geography')) ?? 'US',
        status: toStr(pick(row, mapping, 'status')) ?? 'active',
      })
    })
    if (toInsert.length > 0) {
      await db.insert(subscription_accounts).values(toInsert)
      valid = toInsert.length
    }
  } else {
    // failed_charges
    const toInsert: Array<typeof failed_charges.$inferInsert> = []
    rows.forEach((row, idx) => {
      const amount_cents = toCents(pick(row, mapping, 'amount_cents'))
      const decline_code = toStr(pick(row, mapping, 'decline_code'))
      if (amount_cents === undefined) {
        errors.push({ row: idx + 1, message: 'Missing or invalid required field: amount_cents' })
        return
      }
      if (!decline_code) {
        errors.push({ row: idx + 1, message: 'Missing required field: decline_code' })
        return
      }
      toInsert.push({
        workspace_id: ws.id,
        user_id: userId,
        subscription_account_id: toStr(pick(row, mapping, 'subscription_account_id')) ?? null,
        external_id: toStr(pick(row, mapping, 'external_id')) ?? null,
        amount_cents,
        currency: toStr(pick(row, mapping, 'currency')) ?? 'USD',
        raw_decline_code: toStr(pick(row, mapping, 'raw_decline_code')) ?? null,
        decline_code,
        card_brand: toStr(pick(row, mapping, 'card_brand')) ?? null,
        plan_name: toStr(pick(row, mapping, 'plan_name')) ?? null,
        geography: toStr(pick(row, mapping, 'geography')) ?? 'US',
        retry_count: toInt(pick(row, mapping, 'retry_count')) ?? 0,
        status: toStr(pick(row, mapping, 'status')) ?? 'failed',
        assigned_tactic: toStr(pick(row, mapping, 'assigned_tactic')) ?? null,
      })
    })
    if (toInsert.length > 0) {
      await db.insert(failed_charges).values(toInsert)
      valid = toInsert.length
    }
  }

  const status = errors.length === rows.length ? 'failed' : 'completed'
  const [job] = await db
    .insert(import_jobs)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      source,
      entity,
      status,
      rows_total: rows.length,
      rows_valid: valid,
      rows_invalid: errors.length,
      errors,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: ws.id,
    user_id: userId,
    entity_type: 'import_job',
    entity_id: job.id,
    action: 'import',
    metadata: { entity, source, rows_total: rows.length, rows_valid: valid, rows_invalid: errors.length },
  })

  return c.json(job, 201)
})

export default router
