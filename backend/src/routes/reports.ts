import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  recovery_ledger_entries,
  failed_charges,
  subscription_accounts,
  card_updater_status,
  decline_codes,
  activity_log,
} from '../db/schema.js'
import { and, desc, eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const REPORT_DEF_ENTITY = 'report_definition'

/** Resolve (and auto-create) the caller's workspace from the X-User-Id header. */
async function resolveWorkspace(c: any) {
  const userId = getUserId(c)
  if (!userId) return null
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.user_id, userId))
  if (existing.length > 0) return existing[0]
  const [created] = await db
    .insert(workspaces)
    .values({ user_id: userId })
    .onConflictDoNothing()
    .returning()
  if (created) return created
  const [row] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.user_id, userId))
  return row ?? null
}

interface LedgerSummary {
  attempted_cents: number
  recovered_cents: number
  lost_cents: number
  written_off_cents: number
  recovery_rate: number
}

/** Aggregate the recovery ledger for a workspace into attempted/recovered/lost/written_off + rate. */
async function computeLedgerSummary(workspaceId: string): Promise<LedgerSummary> {
  const entries = await db
    .select()
    .from(recovery_ledger_entries)
    .where(eq(recovery_ledger_entries.workspace_id, workspaceId))

  let attempted = 0
  let recovered = 0
  let lost = 0
  let writtenOff = 0
  for (const e of entries) {
    const amt = e.amount_cents ?? 0
    switch (e.entry_type) {
      case 'attempted':
        attempted += amt
        break
      case 'recovered':
        recovered += amt
        break
      case 'lost':
        lost += amt
        break
      case 'written_off':
        writtenOff += amt
        break
    }
  }
  const rate = attempted > 0 ? recovered / attempted : 0
  return {
    attempted_cents: attempted,
    recovered_cents: recovered,
    lost_cents: lost,
    written_off_cents: writtenOff,
    recovery_rate: Math.round(rate * 10000) / 10000,
  }
}

/** Top decline reasons by count + MRR exposure for a workspace. */
async function computeTopReasons(workspaceId: string) {
  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, workspaceId))

  const codes = await db.select().from(decline_codes)
  const labelByCode = new Map(codes.map((dc) => [dc.code, dc.label]))

  const agg = new Map<string, { code: string; label: string; count: number; mrr_cents: number }>()
  for (const ch of charges) {
    const code = ch.decline_code
    let row = agg.get(code)
    if (!row) {
      row = { code, label: labelByCode.get(code) ?? code, count: 0, mrr_cents: 0 }
      agg.set(code, row)
    }
    row.count += 1
    row.mrr_cents += ch.amount_cents ?? 0
  }
  return [...agg.values()].sort((a, b) => b.count - a.count).slice(0, 10)
}

/** Sum at-risk MRR from card-updater coverage gaps for a workspace. */
async function computeAtRiskMrr(workspaceId: string): Promise<number> {
  const rows = await db
    .select()
    .from(card_updater_status)
    .where(eq(card_updater_status.workspace_id, workspaceId))
  let total = 0
  for (const r of rows) {
    if (r.coverage !== 'covered') total += r.at_risk_mrr_cents ?? 0
  }
  return total
}

/** Headline KPIs for the board view. */
async function computeKpis(workspaceId: string, ledger: LedgerSummary) {
  const charges = await db
    .select()
    .from(failed_charges)
    .where(eq(failed_charges.workspace_id, workspaceId))
  const accounts = await db
    .select()
    .from(subscription_accounts)
    .where(eq(subscription_accounts.workspace_id, workspaceId))

  const totalCharges = charges.length
  const recoveredCharges = charges.filter((ch) => ch.status === 'recovered').length
  const openCharges = charges.filter(
    (ch) => ch.status === 'failed' || ch.status === 'retrying',
  ).length
  const totalMrrCents = accounts.reduce((sum, a) => sum + (a.mrr_cents ?? 0), 0)

  return {
    total_failed_charges: totalCharges,
    recovered_charges: recoveredCharges,
    open_charges: openCharges,
    total_accounts: accounts.length,
    total_mrr_cents: totalMrrCents,
    recovered_revenue_cents: ledger.recovered_cents,
    recovery_rate: ledger.recovery_rate,
  }
}

// GET /board — board-ready recovered-revenue summary
router.get('/board', async (c) => {
  const ws = await resolveWorkspace(c)
  if (!ws) {
    return c.json({
      kpis: {
        total_failed_charges: 0,
        recovered_charges: 0,
        open_charges: 0,
        total_accounts: 0,
        total_mrr_cents: 0,
        recovered_revenue_cents: 0,
        recovery_rate: 0,
      },
      ledger_summary: {
        attempted_cents: 0,
        recovered_cents: 0,
        lost_cents: 0,
        written_off_cents: 0,
        recovery_rate: 0,
      },
      top_reasons: [],
      at_risk_mrr: 0,
    })
  }

  const ledger_summary = await computeLedgerSummary(ws.id)
  const [top_reasons, at_risk_mrr, kpis] = await Promise.all([
    computeTopReasons(ws.id),
    computeAtRiskMrr(ws.id),
    computeKpis(ws.id, ledger_summary),
  ])

  return c.json({ kpis, ledger_summary, top_reasons, at_risk_mrr })
})

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

// GET /export — JSON or CSV export bundle (query: format=json|csv)
router.get('/export', async (c) => {
  const format = (c.req.query('format') ?? 'json').toLowerCase()
  const ws = await resolveWorkspace(c)

  if (!ws) {
    if (format === 'csv') {
      return new Response('section,key,value\n', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="recovery-report.csv"',
        },
      })
    }
    return c.json({ kpis: {}, ledger_summary: {}, top_reasons: [], at_risk_mrr: 0 })
  }

  const ledger_summary = await computeLedgerSummary(ws.id)
  const [top_reasons, at_risk_mrr, kpis] = await Promise.all([
    computeTopReasons(ws.id),
    computeAtRiskMrr(ws.id),
    computeKpis(ws.id, ledger_summary),
  ])

  const bundle = { workspace: ws.name, generated_at: new Date().toISOString(), kpis, ledger_summary, top_reasons, at_risk_mrr }

  if (format === 'csv') {
    const lines: string[] = ['section,key,value']
    for (const [k, v] of Object.entries(kpis)) {
      lines.push([csvCell('kpis'), csvCell(k), csvCell(v)].join(','))
    }
    for (const [k, v] of Object.entries(ledger_summary)) {
      lines.push([csvCell('ledger_summary'), csvCell(k), csvCell(v)].join(','))
    }
    lines.push([csvCell('at_risk_mrr'), csvCell('at_risk_mrr_cents'), csvCell(at_risk_mrr)].join(','))
    for (const r of top_reasons) {
      lines.push(
        [csvCell('top_reason'), csvCell(`${r.code} (${r.label})`), csvCell(`count=${r.count};mrr_cents=${r.mrr_cents}`)].join(','),
      )
    }
    return new Response(lines.join('\n') + '\n', {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="recovery-report.csv"',
      },
    })
  }

  return c.json(bundle)
})

interface ReportDefinition {
  id: string
  name: string
  cadence: string
  format: string
  recipients: string[]
  sections: string[]
  created_at: string
}

// GET /definitions — saved scheduled report definitions (stored in activity_log metadata)
router.get('/definitions', async (c) => {
  const ws = await resolveWorkspace(c)
  if (!ws) return c.json([])

  const rows = await db
    .select()
    .from(activity_log)
    .where(and(eq(activity_log.workspace_id, ws.id), eq(activity_log.entity_type, REPORT_DEF_ENTITY)))
    .orderBy(desc(activity_log.created_at))

  const defs: ReportDefinition[] = rows.map((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>
    return {
      id: r.entity_id ?? r.id,
      name: typeof m.name === 'string' ? m.name : 'Untitled report',
      cadence: typeof m.cadence === 'string' ? m.cadence : 'monthly',
      format: typeof m.format === 'string' ? m.format : 'pdf',
      recipients: Array.isArray(m.recipients) ? (m.recipients as string[]) : [],
      sections: Array.isArray(m.sections) ? (m.sections as string[]) : [],
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }
  })

  return c.json(defs)
})

const definitionSchema = z.object({
  name: z.string().min(1),
  cadence: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).default('monthly'),
  format: z.enum(['pdf', 'csv', 'json']).default('pdf'),
  recipients: z.array(z.string()).optional().default([]),
  sections: z.array(z.string()).optional().default([]),
})

// POST /definitions — save a scheduled report definition
router.post('/definitions', authMiddleware, zValidator('json', definitionSchema), async (c) => {
  const ws = await resolveWorkspace(c)
  if (!ws) return c.json({ error: 'Unauthorized' }, 401)
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const definitionId = crypto.randomUUID()

  await db.insert(activity_log).values({
    workspace_id: ws.id,
    user_id: userId,
    entity_type: REPORT_DEF_ENTITY,
    entity_id: definitionId,
    action: 'define',
    metadata: {
      name: body.name,
      cadence: body.cadence,
      format: body.format,
      recipients: body.recipients,
      sections: body.sections,
    },
  })

  return c.json({ id: definitionId }, 201)
})

export default router
