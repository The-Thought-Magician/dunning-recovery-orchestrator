import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  alert_rules,
  alerts,
  failed_charges,
  recovery_ledger_entries,
  subscription_accounts,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── workspace resolution ─────────────────────────────────────────────────────
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

const ruleSchema = z.object({
  name: z.string().min(1),
  metric: z.enum(['recovery_rate_drop', 'at_risk_mrr_spike', 'decline_code_surge']),
  threshold: z.number(),
})

// ── GET /rules — list alert rules (public, workspace-scoped via header) ───────
router.get('/rules', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await resolveWorkspace(userId)
  const rows = await db
    .select()
    .from(alert_rules)
    .where(eq(alert_rules.workspace_id, ws.id))
    .orderBy(desc(alert_rules.created_at))
  return c.json(rows)
})

// ── GET / — triggered alerts (public) ────────────────────────────────────────
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await resolveWorkspace(userId)
  const rows = await db
    .select()
    .from(alerts)
    .where(eq(alerts.workspace_id, ws.id))
    .orderBy(desc(alerts.created_at))
  return c.json(rows)
})

// ── POST /rules — create rule ────────────────────────────────────────────────
router.post('/rules', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(alert_rules)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      name: body.name,
      metric: body.metric,
      threshold: body.threshold,
    })
    .returning()
  await logActivity(ws.id, userId, 'alert_rule', created.id, 'create', { name: body.name })
  return c.json(created, 201)
})

// ── PUT /rules/:id — update rule ─────────────────────────────────────────────
router.put('/rules/:id', authMiddleware, zValidator('json', ruleSchema.partial().extend({ is_active: z.boolean().optional() })), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(alert_rules)
    .where(and(eq(alert_rules.id, id), eq(alert_rules.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(alert_rules)
    .set(body)
    .where(eq(alert_rules.id, id))
    .returning()
  await logActivity(ws.id, userId, 'alert_rule', id, 'update', body)
  return c.json(updated)
})

// ── DELETE /rules/:id — delete rule ──────────────────────────────────────────
router.delete('/rules/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(alert_rules)
    .where(and(eq(alert_rules.id, id), eq(alert_rules.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(alert_rules).where(eq(alert_rules.id, id))
  await logActivity(ws.id, userId, 'alert_rule', id, 'delete', {})
  return c.json({ success: true })
})

// ── POST /evaluate — evaluate active rules now, create alerts ────────────────
router.post('/evaluate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)

  const rules = await db
    .select()
    .from(alert_rules)
    .where(and(eq(alert_rules.workspace_id, ws.id), eq(alert_rules.is_active, true)))

  // Gather metrics for the workspace.
  const ledger = await db
    .select()
    .from(recovery_ledger_entries)
    .where(eq(recovery_ledger_entries.workspace_id, ws.id))
  let attempted = 0
  let recovered = 0
  for (const e of ledger) {
    if (e.entry_type === 'attempted') attempted += e.amount_cents
    if (e.entry_type === 'recovered') recovered += e.amount_cents
  }
  const recoveryRate = attempted > 0 ? recovered / attempted : 0

  const accounts = await db
    .select()
    .from(subscription_accounts)
    .where(eq(subscription_accounts.workspace_id, ws.id))
  let atRiskMrr = 0
  for (const a of accounts) {
    if (a.status === 'at_risk' || a.status === 'in_dunning') atRiskMrr += a.mrr_cents
  }

  // Decline-code surge: largest single-code share of open failed charges.
  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, ws.id))
  const openCharges = charges.filter((ch) => ch.status === 'failed' || ch.status === 'retrying')
  const byCode = new Map<string, number>()
  for (const ch of openCharges) {
    byCode.set(ch.decline_code, (byCode.get(ch.decline_code) ?? 0) + 1)
  }
  let topCodeCount = 0
  let topCode = ''
  for (const [code, count] of byCode) {
    if (count > topCodeCount) {
      topCodeCount = count
      topCode = code
    }
  }
  const surgeShare = openCharges.length > 0 ? topCodeCount / openCharges.length : 0

  const triggered: typeof alerts.$inferSelect[] = []
  for (const rule of rules) {
    let fire = false
    let message = ''
    let severity: 'info' | 'warning' | 'critical' = 'info'

    if (rule.metric === 'recovery_rate_drop') {
      // threshold is the minimum acceptable recovery rate (0..1).
      if (attempted > 0 && recoveryRate < rule.threshold) {
        fire = true
        message = `Recovery rate ${(recoveryRate * 100).toFixed(1)}% is below threshold ${(rule.threshold * 100).toFixed(1)}%`
        severity = recoveryRate < rule.threshold / 2 ? 'critical' : 'warning'
      }
    } else if (rule.metric === 'at_risk_mrr_spike') {
      // threshold is at-risk MRR in cents.
      if (atRiskMrr > rule.threshold) {
        fire = true
        message = `At-risk MRR $${(atRiskMrr / 100).toFixed(2)} exceeds threshold $${(rule.threshold / 100).toFixed(2)}`
        severity = atRiskMrr > rule.threshold * 2 ? 'critical' : 'warning'
      }
    } else if (rule.metric === 'decline_code_surge') {
      // threshold is the share (0..1) one decline code may occupy.
      if (openCharges.length > 0 && surgeShare > rule.threshold) {
        fire = true
        message = `Decline code "${topCode}" is ${(surgeShare * 100).toFixed(1)}% of open failures (${topCodeCount}/${openCharges.length}), above ${(rule.threshold * 100).toFixed(1)}%`
        severity = 'warning'
      }
    }

    if (fire) {
      const [alert] = await db
        .insert(alerts)
        .values({
          workspace_id: ws.id,
          user_id: userId,
          rule_id: rule.id,
          message,
          severity,
        })
        .returning()
      triggered.push(alert)
      await logActivity(ws.id, userId, 'alert', alert.id, 'trigger', { rule_id: rule.id, metric: rule.metric })
    }
  }

  return c.json({ triggered: triggered.length, alerts: triggered })
})

// ── PUT /:id/ack — acknowledge alert ─────────────────────────────────────────
router.put('/:id/ack', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, id), eq(alerts.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(alerts)
    .set({ acknowledged: true })
    .where(eq(alerts.id, id))
    .returning()
  await logActivity(ws.id, userId, 'alert', id, 'acknowledge', {})
  return c.json(updated)
})

export default router
