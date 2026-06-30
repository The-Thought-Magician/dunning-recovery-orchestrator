import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, asc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces, dunning_sequences, dunning_steps, activity_log } from '../db/schema.js'
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

// Sample variables used to render previews of dunning copy.
const SAMPLE_VARS: Record<string, string> = {
  customer_name: 'Jordan Avery',
  customer_email: 'jordan.avery@example.com',
  plan_name: 'Pro Annual',
  amount: '$49.00',
  amount_cents: '4900',
  card_brand: 'Visa',
  card_last4: '4242',
  decline_reason: 'Insufficient funds',
  retry_date: 'Jul 3, 2026',
  update_link: 'https://pay.example.com/update/abc123',
  company: 'Acme Inc.',
}

function renderTemplate(tpl: string): string {
  if (!tpl) return ''
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) =>
    Object.prototype.hasOwnProperty.call(SAMPLE_VARS, key) ? SAMPLE_VARS[key] : `{{${key}}}`,
  )
}

// ── GET /sequences — list sequences ───────────────────────────────────────────
router.get('/sequences', async (c) => {
  const wsId = await readWorkspaceId(c)
  if (!wsId) return c.json([])
  const rows = await db
    .select()
    .from(dunning_sequences)
    .where(eq(dunning_sequences.workspace_id, wsId))
    .orderBy(asc(dunning_sequences.created_at))
  return c.json(rows)
})

// ── GET /sequences/:id — sequence + steps ─────────────────────────────────────
router.get('/sequences/:id', async (c) => {
  const wsId = await readWorkspaceId(c)
  if (!wsId) return c.json({ error: 'Not found' }, 404)
  const id = c.req.param('id')
  const sequence = await db.query.dunning_sequences.findFirst({
    where: eq(dunning_sequences.id, id),
  })
  if (!sequence || sequence.workspace_id !== wsId) return c.json({ error: 'Not found' }, 404)
  const steps = await db
    .select()
    .from(dunning_steps)
    .where(eq(dunning_steps.sequence_id, id))
    .orderBy(asc(dunning_steps.step_order))
  return c.json({ sequence, steps })
})

// ── GET /sequences/:id/preview — rendered preview w/ sample vars ──────────────
router.get('/sequences/:id/preview', async (c) => {
  const wsId = await readWorkspaceId(c)
  if (!wsId) return c.json({ error: 'Not found' }, 404)
  const id = c.req.param('id')
  const sequence = await db.query.dunning_sequences.findFirst({
    where: eq(dunning_sequences.id, id),
  })
  if (!sequence || sequence.workspace_id !== wsId) return c.json({ error: 'Not found' }, 404)
  const steps = await db
    .select()
    .from(dunning_steps)
    .where(eq(dunning_steps.sequence_id, id))
    .orderBy(asc(dunning_steps.step_order))

  const rendered = steps.map((s) => ({
    id: s.id,
    step_order: s.step_order,
    delay_hours: s.delay_hours,
    channel: s.channel,
    subject: renderTemplate(s.subject ?? ''),
    body: renderTemplate(s.body),
  }))
  return c.json({ sample_variables: SAMPLE_VARS, steps: rendered })
})

// ── POST /sequences — create sequence ─────────────────────────────────────────
const sequenceSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(['email', 'sms', 'mixed']).optional().default('email'),
  assigned_codes: z.array(z.string()).optional().default([]),
  is_active: z.boolean().optional().default(true),
})

router.post('/sequences', authMiddleware, zValidator('json', sequenceSchema), async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(dunning_sequences)
    .values({
      workspace_id: workspaceId,
      user_id: userId,
      name: body.name,
      channel: body.channel,
      assigned_codes: body.assigned_codes,
      is_active: body.is_active,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'dunning_sequence',
    entity_id: created.id,
    action: 'create',
    metadata: { name: created.name, assigned_codes: created.assigned_codes },
  })
  return c.json(created, 201)
})

// ── PUT /sequences/:id — update sequence ──────────────────────────────────────
router.put(
  '/sequences/:id',
  authMiddleware,
  zValidator('json', sequenceSchema.partial()),
  async (c) => {
    const { userId, workspaceId } = await workspaceIdFor(c)
    const id = c.req.param('id')
    const existing = await db.query.dunning_sequences.findFirst({
      where: eq(dunning_sequences.id, id),
    })
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.workspace_id !== workspaceId) return c.json({ error: 'Forbidden' }, 403)
    const body = c.req.valid('json')
    const [updated] = await db
      .update(dunning_sequences)
      .set(body)
      .where(eq(dunning_sequences.id, id))
      .returning()

    await db.insert(activity_log).values({
      workspace_id: workspaceId,
      user_id: userId,
      entity_type: 'dunning_sequence',
      entity_id: id,
      action: 'update',
      metadata: { ...body },
    })
    return c.json(updated)
  },
)

// ── DELETE /sequences/:id — delete sequence (+ its steps) ─────────────────────
router.delete('/sequences/:id', authMiddleware, async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const id = c.req.param('id')
  const existing = await db.query.dunning_sequences.findFirst({
    where: eq(dunning_sequences.id, id),
  })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== workspaceId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(dunning_steps).where(eq(dunning_steps.sequence_id, id))
  await db.delete(dunning_sequences).where(eq(dunning_sequences.id, id))

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'dunning_sequence',
    entity_id: id,
    action: 'delete',
    metadata: {},
  })
  return c.json({ success: true })
})

// ── POST /sequences/:id/steps — add step ──────────────────────────────────────
const stepSchema = z.object({
  step_order: z.number().int().min(0).optional().default(0),
  delay_hours: z.number().int().min(0).optional().default(24),
  channel: z.enum(['email', 'sms']).optional().default('email'),
  subject: z.string().optional().default(''),
  body: z.string().min(1),
})

router.post('/sequences/:id/steps', authMiddleware, zValidator('json', stepSchema), async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const sequenceId = c.req.param('id')
  const sequence = await db.query.dunning_sequences.findFirst({
    where: eq(dunning_sequences.id, sequenceId),
  })
  if (!sequence) return c.json({ error: 'Not found' }, 404)
  if (sequence.workspace_id !== workspaceId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(dunning_steps)
    .values({
      workspace_id: workspaceId,
      user_id: userId,
      sequence_id: sequenceId,
      step_order: body.step_order,
      delay_hours: body.delay_hours,
      channel: body.channel,
      subject: body.subject,
      body: body.body,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'dunning_step',
    entity_id: created.id,
    action: 'create',
    metadata: { sequence_id: sequenceId, step_order: created.step_order },
  })
  return c.json(created, 201)
})

// ── PUT /steps/:id — update step ──────────────────────────────────────────────
router.put('/steps/:id', authMiddleware, zValidator('json', stepSchema.partial()), async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const id = c.req.param('id')
  const existing = await db.query.dunning_steps.findFirst({ where: eq(dunning_steps.id, id) })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== workspaceId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(dunning_steps)
    .set(body)
    .where(eq(dunning_steps.id, id))
    .returning()

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'dunning_step',
    entity_id: id,
    action: 'update',
    metadata: { ...body },
  })
  return c.json(updated)
})

// ── DELETE /steps/:id — delete step ───────────────────────────────────────────
router.delete('/steps/:id', authMiddleware, async (c) => {
  const { userId, workspaceId } = await workspaceIdFor(c)
  const id = c.req.param('id')
  const existing = await db.query.dunning_steps.findFirst({ where: eq(dunning_steps.id, id) })
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== workspaceId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(dunning_steps).where(eq(dunning_steps.id, id))

  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    entity_type: 'dunning_step',
    entity_id: id,
    action: 'delete',
    metadata: { sequence_id: existing.sequence_id },
  })
  return c.json({ success: true })
})

export default router
