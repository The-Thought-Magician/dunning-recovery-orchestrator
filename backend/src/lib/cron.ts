import { CronExpressionParser } from 'cron-parser'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ScheduleJob {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string | null
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export interface DstTrap {
  type: 'double_fire' | 'skip' | 'ambiguous'
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  windowStart: string
  windowEnd: string
  gapMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

function safeTz(tz?: string): string {
  return tz && tz.length > 0 ? tz : 'UTC'
}

/** Parse a "rate" expression of the form "every N minutes|hours|days" (or "N minutes"). */
function parseRate(expr: string): { everyMs: number; unit: string; n: number } | null {
  const m = expr
    .trim()
    .toLowerCase()
    .match(/^(?:every\s+)?(\d+)\s*(minute|minutes|min|hour|hours|hr|day|days|d)$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2]
  if (unit.startsWith('min')) return { everyMs: n * MINUTE_MS, unit: 'minutes', n }
  if (unit.startsWith('h')) return { everyMs: n * HOUR_MS, unit: 'hours', n }
  return { everyMs: n * DAY_MS, unit: 'days', n }
}

/** Get the UTC-offset (minutes) of an instant in a given IANA timezone. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const map: Record<string, number> = {}
    for (const p of parts) if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
    // hour can come back as 24 for midnight in some environments
    const hour = map.hour === 24 ? 0 : map.hour
    const asUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second)
    return Math.round((asUTC - date.getTime()) / MINUTE_MS)
  } catch {
    return 0
  }
}

function isoMinute(d: Date): string {
  // Truncate to minute, ISO UTC
  return new Date(Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS).toISOString()
}

// ─────────────────────────────────────────────────────────────────────────────
// validateExpression
// ─────────────────────────────────────────────────────────────────────────────

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (!expr || expr.trim().length === 0) return { valid: false, error: 'Expression is empty' }
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(expr)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : 'Invalid cron expression' }
    }
  }
  if (kind === 'rate') {
    const r = parseRate(expr)
    return r ? { valid: true } : { valid: false, error: 'Rate must be "every N minutes|hours|days"' }
  }
  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    return Number.isNaN(t)
      ? { valid: false, error: 'One-off must be a valid ISO timestamp' }
      : { valid: true }
  }
  return { valid: false, error: `Unknown kind: ${kind}` }
}

// ─────────────────────────────────────────────────────────────────────────────
// describeExpression
// ─────────────────────────────────────────────────────────────────────────────

export function describeExpression(kind: ScheduleKind, expr: string, timezone?: string): string {
  const tz = safeTz(timezone)
  const v = validateExpression(kind, expr)
  if (!v.valid) return `Invalid expression: ${v.error}`

  if (kind === 'rate') {
    const r = parseRate(expr)!
    return `Every ${r.n} ${r.n === 1 ? r.unit.replace(/s$/, '') : r.unit} (${tz})`
  }
  if (kind === 'oneoff') {
    return `Once at ${new Date(expr).toISOString()} (${tz})`
  }

  // cron
  const fields = expr.trim().split(/\s+/)
  const [min, hour, dom, mon, dow] = fields
  const parts: string[] = []
  if (min === '*' && hour === '*') parts.push('every minute')
  else if (min !== '*' && hour === '*') parts.push(`at minute ${min} of every hour`)
  else if (min === '0' && hour !== '*') parts.push(`at ${hour}:00`)
  else parts.push(`at ${hour}:${min.padStart(2, '0')}`)
  if (dom && dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (mon && mon !== '*') parts.push(`in month ${mon}`)
  if (dow && dow !== '*') parts.push(`on day-of-week ${dow}`)
  return `Runs ${parts.join(', ')} (${tz})`
}

// ─────────────────────────────────────────────────────────────────────────────
// nextFirings
// ─────────────────────────────────────────────────────────────────────────────

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone: string | undefined,
  fromISO: string,
  count: number,
): string[] {
  const tz = safeTz(timezone)
  const n = Math.max(0, Math.min(count ?? 0, 5000))
  if (n === 0) return []
  const from = new Date(fromISO)
  if (Number.isNaN(from.getTime())) return []

  if (kind === 'cron') {
    try {
      const it = CronExpressionParser.parse(expr, { tz, currentDate: from })
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        const next = it.next()
        out.push(new Date(next.getTime()).toISOString())
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return []
    const out: string[] = []
    let t = from.getTime() + r.everyMs
    for (let i = 0; i < n; i++) {
      out.push(new Date(t).toISOString())
      t += r.everyMs
    }
    return out
  }

  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return []
    return t > from.getTime() ? [new Date(t).toISOString()] : []
  }

  return []
}

// ─────────────────────────────────────────────────────────────────────────────
// computeCollisions
// ─────────────────────────────────────────────────────────────────────────────

export function computeCollisions(
  jobs: ScheduleJob[],
  opts: { horizonDays: number; threshold: number },
): CollisionWindow[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const threshold = opts.threshold > 0 ? opts.threshold : 2
  const fromISO = new Date().toISOString()
  const from = new Date(fromISO).getTime()
  const horizonMs = horizonDays * DAY_MS

  // bucket(minute) -> { jobIds:Set, resources:Map<resourceId, Set<jobId>> }
  const buckets = new Map<string, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    // generous count cap proportional to horizon
    const firings = nextFirings(job.kind, job.expr, job.timezone, fromISO, 2000)
    for (const f of firings) {
      const t = Date.parse(f)
      if (t - from > horizonMs) break
      const key = isoMinute(new Date(t))
      let b = buckets.get(key)
      if (!b) {
        b = { jobIds: new Set(), resources: new Map() }
        buckets.set(key, b)
      }
      b.jobIds.add(job.id)
      if (job.resourceId) {
        let rs = b.resources.get(job.resourceId)
        if (!rs) {
          rs = new Set()
          b.resources.set(job.resourceId, rs)
        }
        rs.add(job.id)
      }
    }
  }

  const out: CollisionWindow[] = []
  for (const [key, b] of buckets) {
    const concurrency = b.jobIds.size
    // resource contention: >=2 jobs sharing a resource in this minute
    let contendedResource: string | undefined
    for (const [rid, rs] of b.resources) {
      if (rs.size >= 2) {
        contendedResource = rid
        break
      }
    }
    const flag = concurrency >= threshold || contendedResource !== undefined
    if (!flag) continue
    const start = new Date(key)
    const end = new Date(start.getTime() + MINUTE_MS)
    let severity: CollisionWindow['severity'] = 'low'
    if (concurrency >= threshold * 2 || contendedResource) severity = 'high'
    else if (concurrency >= threshold) severity = 'medium'
    out.push({
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      jobIds: [...b.jobIds],
      severity,
      ...(contendedResource ? { resourceId: contendedResource } : {}),
    })
  }
  out.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// loadHeatmap
// ─────────────────────────────────────────────────────────────────────────────

export function loadHeatmap(jobs: ScheduleJob[], opts: { horizonDays: number }): HeatmapBucket[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const fromISO = new Date().toISOString()
  const from = new Date(fromISO).getTime()
  const horizonMs = horizonDays * DAY_MS

  // Bucket by hour for a readable heatmap.
  const counts = new Map<string, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone, fromISO, 2000)
    for (const f of firings) {
      const t = Date.parse(f)
      if (t - from > horizonMs) break
      const hourBucket = new Date(Math.floor(t / HOUR_MS) * HOUR_MS).toISOString()
      counts.set(hourBucket, (counts.get(hourBucket) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ─────────────────────────────────────────────────────────────────────────────
// dstTraps
// ─────────────────────────────────────────────────────────────────────────────

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone: string | undefined,
  fromISO: string,
  days: number,
): DstTrap[] {
  const tz = safeTz(timezone)
  if (tz === 'UTC') return [] // UTC never observes DST
  const from = new Date(fromISO)
  if (Number.isNaN(from.getTime())) return []
  const horizon = (days > 0 ? days : 7) * DAY_MS

  const traps: DstTrap[] = []
  // Walk hour by hour, detect offset transitions.
  const stepMs = HOUR_MS
  let prevOffset = tzOffsetMinutes(from, tz)
  for (let t = from.getTime() + stepMs; t <= from.getTime() + horizon; t += stepMs) {
    const cur = new Date(t)
    const curOffset = tzOffsetMinutes(cur, tz)
    if (curOffset === prevOffset) {
      prevOffset = curOffset
      continue
    }
    const delta = curOffset - prevOffset
    // Spring forward (offset increases): a local-time window is skipped.
    // Fall back (offset decreases): a local-time window repeats (ambiguous / double).
    const localFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    const atLocal = localFmt.format(cur)
    const atUtc = cur.toISOString()
    if (delta > 0) {
      traps.push({ type: 'skip', atLocal, atUtc })
    } else {
      traps.push({ type: 'ambiguous', atLocal, atUtc })
      traps.push({ type: 'double_fire', atLocal, atUtc })
    }
    prevOffset = curOffset
  }

  // If the schedule never fires near a transition we still report the trap window;
  // callers cross-reference against nextFirings for relevance.
  void kind
  void expr
  return traps
}

// ─────────────────────────────────────────────────────────────────────────────
// coverageGaps
// ─────────────────────────────────────────────────────────────────────────────

export function coverageGaps(
  windows: Array<{ start: string; end: string }>,
  jobs: ScheduleJob[],
  opts: { horizonDays: number },
): CoverageGap[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const fromISO = new Date().toISOString()
  const from = new Date(fromISO).getTime()
  const horizonMs = horizonDays * DAY_MS
  const end = from + horizonMs

  // Collect all firing instants in horizon.
  const firings: number[] = []
  for (const job of jobs) {
    for (const f of nextFirings(job.kind, job.expr, job.timezone, fromISO, 2000)) {
      const t = Date.parse(f)
      if (t - from > horizonMs) break
      firings.push(t)
    }
  }
  firings.sort((a, b) => a - b)

  // Required-coverage windows (intervals that must contain at least one firing).
  const reqs = (windows ?? [])
    .map((w) => ({ s: Date.parse(w.start), e: Date.parse(w.end) }))
    .filter((w) => !Number.isNaN(w.s) && !Number.isNaN(w.e) && w.e > w.s && w.s < end)
    .sort((a, b) => a.s - b.s)

  const gaps: CoverageGap[] = []

  if (reqs.length > 0) {
    // A required window is a gap if no firing lands inside it.
    for (const w of reqs) {
      const covered = firings.some((t) => t >= w.s && t <= w.e)
      if (!covered) {
        gaps.push({
          windowStart: new Date(w.s).toISOString(),
          windowEnd: new Date(w.e).toISOString(),
          gapMinutes: Math.round((w.e - w.s) / MINUTE_MS),
        })
      }
    }
    return gaps
  }

  // No explicit windows: report the largest stretches with no firings across the horizon.
  let cursor = from
  for (const t of firings) {
    if (t - cursor > HOUR_MS) {
      gaps.push({
        windowStart: new Date(cursor).toISOString(),
        windowEnd: new Date(t).toISOString(),
        gapMinutes: Math.round((t - cursor) / MINUTE_MS),
      })
    }
    cursor = Math.max(cursor, t)
  }
  if (end - cursor > HOUR_MS) {
    gaps.push({
      windowStart: new Date(cursor).toISOString(),
      windowEnd: new Date(end).toISOString(),
      gapMinutes: Math.round((end - cursor) / MINUTE_MS),
    })
  }
  return gaps
}

// ─────────────────────────────────────────────────────────────────────────────
// autoSpread
// ─────────────────────────────────────────────────────────────────────────────

export function autoSpread(
  jobs: ScheduleJob[],
  opts: { threshold: number },
): SpreadSuggestion[] {
  const threshold = opts.threshold > 0 ? opts.threshold : 2
  const collisions = computeCollisions(jobs, { horizonDays: 7, threshold })
  if (collisions.length === 0) return []

  // Tally, per job, how many collision windows it participates in.
  const jobCollisionCount = new Map<string, number>()
  for (const w of collisions) {
    for (const id of w.jobIds) {
      jobCollisionCount.set(id, (jobCollisionCount.get(id) ?? 0) + 1)
    }
  }

  const jobsById = new Map(jobs.map((j) => [j.id, j]))
  const suggestions: SpreadSuggestion[] = []
  // Sort by most-colliding; spread them out by staggering the minute field.
  const ranked = [...jobCollisionCount.entries()].sort((a, b) => b[1] - a[1])

  let offset = 0
  for (const [jobId, hits] of ranked) {
    const job = jobsById.get(jobId)
    if (!job) continue
    offset += 7 // stagger by 7-minute increments to break minute-alignment
    let suggestedExpr = job.expr
    let reason = `Participates in ${hits} collision window(s); staggering to reduce concurrency`

    if (job.kind === 'cron') {
      const fields = job.expr.trim().split(/\s+/)
      if (fields.length >= 5) {
        const newMinute = (offset % 60).toString()
        fields[0] = newMinute
        suggestedExpr = fields.join(' ')
        reason = `Shift minute field to ${newMinute} to avoid ${hits} collision window(s)`
      }
    } else if (job.kind === 'rate') {
      const r = parseRate(job.expr)
      if (r) {
        suggestedExpr = `every ${r.n + 1} ${r.unit}`
        reason = `Lengthen interval to "every ${r.n + 1} ${r.unit}" to desynchronize from ${hits} collision(s)`
      }
    }

    suggestions.push({ jobId, suggestedExpr, reason })
  }
  return suggestions
}
