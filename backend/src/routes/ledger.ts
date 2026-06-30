import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  recovery_ledger_entries,
  ledger_periods,
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

interface Totals {
  attempted_cents: number
  recovered_cents: number
  lost_cents: number
  written_off_cents: number
}

function summarize(entries: Array<{ entry_type: string; amount_cents: number }>): Totals {
  const t: Totals = {
    attempted_cents: 0,
    recovered_cents: 0,
    lost_cents: 0,
    written_off_cents: 0,
  }
  for (const e of entries) {
    if (e.entry_type === 'attempted') t.attempted_cents += e.amount_cents
    else if (e.entry_type === 'recovered') t.recovered_cents += e.amount_cents
    else if (e.entry_type === 'lost') t.lost_cents += e.amount_cents
    else if (e.entry_type === 'written_off') t.written_off_cents += e.amount_cents
  }
  return t
}

// ── GET /entries — ledger entries (filter entry_type/period_id) ───────────────
router.get('/entries', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const ws = await resolveWorkspace(userId)
  const entryType = c.req.query('entry_type')
  const periodId = c.req.query('period_id')

  const conditions = [eq(recovery_ledger_entries.workspace_id, ws.id)]
  if (entryType) conditions.push(eq(recovery_ledger_entries.entry_type, entryType))
  if (periodId) conditions.push(eq(recovery_ledger_entries.period_id, periodId))

  const rows = await db
    .select()
    .from(recovery_ledger_entries)
    .where(and(...conditions))
    .orderBy(desc(recovery_ledger_entries.created_at))
  return c.json(rows)
})

// ── GET /summary — totals + recovery rate ─────────────────────────────────────
router.get('/summary', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const ws = await resolveWorkspace(userId)
  const entries = await db
    .select()
    .from(recovery_ledger_entries)
    .where(eq(recovery_ledger_entries.workspace_id, ws.id))
  const t = summarize(entries)
  const recovery_rate =
    t.attempted_cents > 0 ? Number((t.recovered_cents / t.attempted_cents).toFixed(4)) : 0
  return c.json({ ...t, recovery_rate })
})

// ── GET /periods — list periods ───────────────────────────────────────────────
router.get('/periods', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const ws = await resolveWorkspace(userId)
  const rows = await db
    .select()
    .from(ledger_periods)
    .where(eq(ledger_periods.workspace_id, ws.id))
    .orderBy(desc(ledger_periods.label))
  return c.json(rows)
})

// ── POST /periods/close — close a period, snapshot totals ─────────────────────
router.post(
  '/periods/close',
  authMiddleware,
  zValidator('json', z.object({ label: z.string().min(1) })),
  async (c) => {
    const userId = getUserId(c)
    const ws = await resolveWorkspace(userId)
    const { label } = c.req.valid('json')

    // Snapshot totals from entries belonging to this period (period_id == label),
    // falling back to all unassigned entries when none are tagged yet.
    const tagged = await db
      .select()
      .from(recovery_ledger_entries)
      .where(
        and(
          eq(recovery_ledger_entries.workspace_id, ws.id),
          eq(recovery_ledger_entries.period_id, label),
        ),
      )
    const t = summarize(tagged)

    const [existing] = await db
      .select()
      .from(ledger_periods)
      .where(and(eq(ledger_periods.workspace_id, ws.id), eq(ledger_periods.label, label)))

    let period: typeof ledger_periods.$inferSelect
    if (existing) {
      const [updated] = await db
        .update(ledger_periods)
        .set({
          attempted_cents: t.attempted_cents,
          recovered_cents: t.recovered_cents,
          lost_cents: t.lost_cents,
          written_off_cents: t.written_off_cents,
          closed: true,
          closed_at: new Date(),
        })
        .where(and(eq(ledger_periods.workspace_id, ws.id), eq(ledger_periods.label, label)))
        .returning()
      period = updated
    } else {
      const [created] = await db
        .insert(ledger_periods)
        .values({
          workspace_id: ws.id,
          user_id: userId,
          label,
          attempted_cents: t.attempted_cents,
          recovered_cents: t.recovered_cents,
          lost_cents: t.lost_cents,
          written_off_cents: t.written_off_cents,
          closed: true,
          closed_at: new Date(),
        })
        .returning()
      period = created
    }

    await logActivity(ws.id, userId, 'ledger_period', period.id, 'close', { label, ...t })
    return c.json(period, existing ? 200 : 201)
  },
)

// ── GET /export — CSV export of entries ───────────────────────────────────────
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

router.get('/export', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const ws = await resolveWorkspace(userId)
  const rows = await db
    .select()
    .from(recovery_ledger_entries)
    .where(eq(recovery_ledger_entries.workspace_id, ws.id))
    .orderBy(desc(recovery_ledger_entries.created_at))

  const header = [
    'id',
    'failed_charge_id',
    'entry_type',
    'amount_cents',
    'tactic',
    'retry_attempt',
    'period_id',
    'reconciled',
    'created_at',
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.id),
        csvCell(r.failed_charge_id),
        csvCell(r.entry_type),
        csvCell(r.amount_cents),
        csvCell(r.tactic),
        csvCell(r.retry_attempt),
        csvCell(r.period_id),
        csvCell(r.reconciled),
        csvCell(r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at),
      ].join(','),
    )
  }
  const body = lines.join('\n')
  return c.body(body, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="recovery-ledger.csv"',
  })
})

// ── POST /reconcile/:id — mark entry reconciled ───────────────────────────────
router.post('/reconcile/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await resolveWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(recovery_ledger_entries)
    .where(
      and(eq(recovery_ledger_entries.id, id), eq(recovery_ledger_entries.workspace_id, ws.id)),
    )
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(recovery_ledger_entries)
    .set({ reconciled: true })
    .where(and(eq(recovery_ledger_entries.id, id), eq(recovery_ledger_entries.workspace_id, ws.id)))
    .returning()
  await logActivity(ws.id, userId, 'recovery_ledger_entry', id, 'reconcile', {
    entry_type: updated.entry_type,
  })
  return c.json(updated)
})

export default router
