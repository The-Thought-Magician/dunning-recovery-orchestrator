import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  workspaces,
  failed_charges,
  decline_codes,
  recovery_ledger_entries,
} from '../db/schema.js'
import { eq } from 'drizzle-orm'

const router = new Hono()

// Resolve (or lazily create) the caller's workspace from the X-User-Id header.
// Public reads still need a workspace scope; if the header is absent we return
// null and handlers respond with empty result sets.
async function resolveWorkspace(c: any): Promise<{ id: string; user_id: string } | null> {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
  if (!userId) return null
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.user_id, userId))
  if (existing) return { id: existing.id, user_id: existing.user_id }
  const [created] = await db.insert(workspaces).values({ user_id: userId }).returning()
  return { id: created.id, user_id: created.user_id }
}

function periodLabel(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// GET /decline-reasons — top decline reasons by count + at-risk MRR.
// Joins failed charges to the canonical taxonomy for human labels, then
// aggregates count and summed amount per canonical decline code.
router.get('/decline-reasons', async (c) => {
  const ws = await resolveWorkspace(c)
  if (!ws) return c.json([])

  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, ws.id))

  const codes = await db.select().from(decline_codes)
  const labelByCode = new Map(codes.map((cd) => [cd.code, cd.label]))

  const agg = new Map<string, { code: string; label: string; count: number; mrr_cents: number }>()
  for (const ch of charges) {
    const code = ch.decline_code || 'unknown'
    let row = agg.get(code)
    if (!row) {
      row = { code, label: labelByCode.get(code) ?? code, count: 0, mrr_cents: 0 }
      agg.set(code, row)
    }
    row.count += 1
    row.mrr_cents += ch.amount_cents ?? 0
  }

  const out = [...agg.values()].sort((a, b) => b.count - a.count || b.mrr_cents - a.mrr_cents)
  return c.json(out)
})

// GET /reason-trend — reason counts over time (monthly buckets by failed_at).
// Returns { periods, series } where series is one entry per decline code with a
// per-period count vector aligned to the periods array.
router.get('/reason-trend', async (c) => {
  const ws = await resolveWorkspace(c)
  if (!ws) return c.json({ periods: [], series: [] })

  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, ws.id))

  const codes = await db.select().from(decline_codes)
  const labelByCode = new Map(codes.map((cd) => [cd.code, cd.label]))

  // Collect period labels and per-code/per-period counts.
  const periodSet = new Set<string>()
  const counts = new Map<string, Map<string, number>>() // code -> (period -> count)
  for (const ch of charges) {
    const when = ch.failed_at ? new Date(ch.failed_at) : new Date(ch.created_at)
    const p = periodLabel(when)
    periodSet.add(p)
    const code = ch.decline_code || 'unknown'
    let m = counts.get(code)
    if (!m) {
      m = new Map()
      counts.set(code, m)
    }
    m.set(p, (m.get(p) ?? 0) + 1)
  }

  const periods = [...periodSet].sort()
  const series = [...counts.entries()].map(([code, m]) => ({
    code,
    label: labelByCode.get(code) ?? code,
    counts: periods.map((p) => m.get(p) ?? 0),
    total: periods.reduce((s, p) => s + (m.get(p) ?? 0), 0),
  }))
  series.sort((a, b) => b.total - a.total)

  return c.json({ periods, series })
})

// GET /effectiveness — reason-to-tactic recovery matrix.
// For each (decline_code, tactic) pair, computes attempted vs recovered using
// the assigned_tactic on the charge plus the failed_charge status, cross-checked
// against recovered ledger entries. The matrix powers the effectiveness heatmap.
router.get('/effectiveness', async (c) => {
  const ws = await resolveWorkspace(c)
  if (!ws) return c.json({ matrix: [], tactics: [], reasons: [] })

  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, ws.id))

  const ledger = await db
    .select()
    .from(recovery_ledger_entries)
    .where(eq(recovery_ledger_entries.workspace_id, ws.id))

  // Which charges actually recovered (from ledger recovered entries or status).
  const recoveredChargeIds = new Set<string>()
  for (const e of ledger) {
    if (e.entry_type === 'recovered' && e.failed_charge_id) recoveredChargeIds.add(e.failed_charge_id)
  }

  type Cell = {
    reason: string
    tactic: string
    attempted: number
    recovered: number
    attempted_cents: number
    recovered_cents: number
    rate: number
  }
  const cells = new Map<string, Cell>()
  const tacticSet = new Set<string>()
  const reasonSet = new Set<string>()

  for (const ch of charges) {
    const reason = ch.decline_code || 'unknown'
    const tactic = ch.assigned_tactic || 'unassigned'
    reasonSet.add(reason)
    tacticSet.add(tactic)
    const key = `${reason}::${tactic}`
    let cell = cells.get(key)
    if (!cell) {
      cell = {
        reason,
        tactic,
        attempted: 0,
        recovered: 0,
        attempted_cents: 0,
        recovered_cents: 0,
        rate: 0,
      }
      cells.set(key, cell)
    }
    cell.attempted += 1
    cell.attempted_cents += ch.amount_cents ?? 0
    const didRecover = ch.status === 'recovered' || recoveredChargeIds.has(ch.id)
    if (didRecover) {
      cell.recovered += 1
      cell.recovered_cents += ch.amount_cents ?? 0
    }
  }

  const matrix = [...cells.values()].map((cell) => ({
    ...cell,
    rate: cell.attempted > 0 ? cell.recovered / cell.attempted : 0,
  }))
  matrix.sort((a, b) => b.recovered_cents - a.recovered_cents)

  return c.json({
    matrix,
    tactics: [...tacticSet].sort(),
    reasons: [...reasonSet].sort(),
  })
})

export default router
