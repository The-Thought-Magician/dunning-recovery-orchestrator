import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  playbooks,
  tactics,
  routing_rules,
  retry_schedules,
  dunning_sequences,
  grace_policies,
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
    entity_type: 'playbook',
    entity_id: entityId,
    action,
    metadata,
  })
}

// A playbook config bundles ready-to-apply recovery building blocks.
const configSchema = z
  .object({
    tactics: z
      .array(
        z.object({
          key: z.string().min(1),
          name: z.string().min(1),
          description: z.string().optional().default(''),
          config: z.record(z.string(), z.unknown()).optional().default({}),
        }),
      )
      .optional(),
    routing_rules: z
      .array(
        z.object({
          name: z.string().min(1),
          priority: z.number().int().optional().default(0),
          conditions: z
            .array(
              z.object({ field: z.string(), op: z.string(), value: z.unknown() }).transform((cond) => ({
                field: cond.field,
                op: cond.op,
                value: cond.value ?? null,
              })),
            )
            .optional()
            .default([]),
          target_tactic: z.string().min(1),
          is_active: z.boolean().optional().default(true),
        }),
      )
      .optional(),
    retry_schedules: z
      .array(
        z.object({
          name: z.string().min(1),
          offsets: z
            .array(z.object({ day: z.number(), window: z.string() }))
            .optional()
            .default([]),
          payday_aligned: z.boolean().optional().default(false),
          issuer_pattern: z.boolean().optional().default(false),
          per_code_overrides: z.record(z.string(), z.array(z.number())).optional().default({}),
          is_default: z.boolean().optional().default(false),
        }),
      )
      .optional(),
    dunning_sequences: z
      .array(
        z.object({
          name: z.string().min(1),
          channel: z.string().optional().default('email'),
          assigned_codes: z.array(z.string()).optional().default([]),
          is_active: z.boolean().optional().default(true),
        }),
      )
      .optional(),
    grace_policies: z
      .array(
        z.object({
          name: z.string().min(1),
          plan_name: z.string().optional(),
          grace_days: z.number().int().optional().default(7),
          soft_suspend_after_days: z.number().int().optional().default(14),
        }),
      )
      .optional(),
  })
  .passthrough()

const createSchema = z.object({
  name: z.string().min(1),
  vertical: z.enum(['saas', 'dtc']).default('saas'),
  config: configSchema.default({}),
  is_template: z.boolean().optional().default(false),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  vertical: z.enum(['saas', 'dtc']).optional(),
  config: configSchema.optional(),
  is_template: z.boolean().optional(),
})

// ── Routes ─────────────────────────────────────────────────────────────────

// Public: list playbooks (workspace-owned + global templates)
router.get('/', async (c) => {
  const ws = await resolveWorkspace(getUserId(c))
  if (!ws) {
    const templates = await db
      .select()
      .from(playbooks)
      .where(eq(playbooks.is_template, true))
      .orderBy(desc(playbooks.created_at))
    return c.json(templates)
  }
  const owned = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.workspace_id, ws.id))
    .orderBy(desc(playbooks.created_at))
  const templates = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.is_template, true))
  // Merge owned + templates, de-duplicated by id (an owned playbook may itself be a template).
  const seen = new Set(owned.map((p) => p.id))
  const merged = [...owned, ...templates.filter((t) => !seen.has(t.id))]
  return c.json(merged)
})

// Public: playbook detail (own workspace or a global template)
router.get('/:id', async (c) => {
  const ws = await resolveWorkspace(getUserId(c))
  const id = c.req.param('id')
  const [pb] = await db.select().from(playbooks).where(eq(playbooks.id, id))
  if (!pb) return c.json({ error: 'Not found' }, 404)
  if (!pb.is_template && (!ws || pb.workspace_id !== ws.id)) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.json(pb)
})

// Auth: create playbook
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(playbooks)
    .values({
      workspace_id: ws.id,
      user_id: userId,
      name: body.name,
      vertical: body.vertical,
      config: body.config,
      is_template: body.is_template,
    })
    .returning()
  await logActivity(ws.id, userId, created.id, 'create', { name: created.name })
  return c.json(created, 201)
})

// Auth: update playbook
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, id), eq(playbooks.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(playbooks)
    .set(body)
    .where(eq(playbooks.id, id))
    .returning()
  await logActivity(ws.id, userId, id, 'update', { name: updated.name })
  return c.json(updated)
})

// Auth: delete playbook
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, id), eq(playbooks.workspace_id, ws.id)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(playbooks).where(eq(playbooks.id, id))
  await logActivity(ws.id, userId, id, 'delete', { name: existing.name })
  return c.json({ success: true })
})

// Auth: apply playbook config to the caller's workspace.
// A template (cross-workspace) may also be applied; ownership is required only for
// non-template playbooks. Idempotent on unique keys via upsert where the schema allows.
router.post('/:id/apply', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const [pb] = await db.select().from(playbooks).where(eq(playbooks.id, id))
  if (!pb) return c.json({ error: 'Not found' }, 404)
  if (!pb.is_template && pb.workspace_id !== ws.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const cfg = configSchema.safeParse(pb.config ?? {})
  const config = cfg.success ? cfg.data : {}

  const applied = {
    tactics: 0,
    routing_rules: 0,
    retry_schedules: 0,
    dunning_sequences: 0,
    grace_policies: 0,
  }

  if (config.tactics?.length) {
    for (const t of config.tactics) {
      await db
        .insert(tactics)
        .values({
          workspace_id: ws.id,
          user_id: userId,
          key: t.key,
          name: t.name,
          description: t.description ?? '',
          config: t.config ?? {},
        })
        .onConflictDoUpdate({
          target: [tactics.workspace_id, tactics.key],
          set: { name: t.name, description: t.description ?? '', config: t.config ?? {} },
        })
      applied.tactics += 1
    }
  }

  if (config.routing_rules?.length) {
    for (const r of config.routing_rules) {
      await db.insert(routing_rules).values({
        workspace_id: ws.id,
        user_id: userId,
        name: r.name,
        priority: r.priority ?? 0,
        conditions: r.conditions ?? [],
        target_tactic: r.target_tactic,
        is_active: r.is_active ?? true,
      })
      applied.routing_rules += 1
    }
  }

  if (config.retry_schedules?.length) {
    for (const s of config.retry_schedules) {
      await db.insert(retry_schedules).values({
        workspace_id: ws.id,
        user_id: userId,
        name: s.name,
        offsets: s.offsets ?? [],
        payday_aligned: s.payday_aligned ?? false,
        issuer_pattern: s.issuer_pattern ?? false,
        per_code_overrides: s.per_code_overrides ?? {},
        is_default: s.is_default ?? false,
      })
      applied.retry_schedules += 1
    }
  }

  if (config.dunning_sequences?.length) {
    for (const d of config.dunning_sequences) {
      await db.insert(dunning_sequences).values({
        workspace_id: ws.id,
        user_id: userId,
        name: d.name,
        channel: d.channel ?? 'email',
        assigned_codes: d.assigned_codes ?? [],
        is_active: d.is_active ?? true,
      })
      applied.dunning_sequences += 1
    }
  }

  if (config.grace_policies?.length) {
    for (const g of config.grace_policies) {
      await db.insert(grace_policies).values({
        workspace_id: ws.id,
        user_id: userId,
        name: g.name,
        plan_name: g.plan_name ?? null,
        grace_days: g.grace_days ?? 7,
        soft_suspend_after_days: g.soft_suspend_after_days ?? 14,
        version: 1,
      })
      applied.grace_policies += 1
    }
  }

  await logActivity(ws.id, userId, id, 'apply', { ...applied, playbook: pb.name })
  return c.json({ applied })
})

export default router
