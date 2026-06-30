// All calls are same-origin relative fetches to /api/proxy/<path>, which maps
// 1:1 to the backend /api/v1/<path>. The proxy route injects X-User-Id after
// resolving the server-side Neon Auth session.

async function req<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/proxy/${path}`, {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      // non-JSON error body; keep default message
    }
    throw new Error(message)
  }
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

const get = <T = any>(path: string) => req<T>(path)
const post = <T = any>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = <T = any>(path: string, body?: unknown) =>
  req<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
const del = <T = any>(path: string) => req<T>(path, { method: 'DELETE' })

function qs(params?: Record<string, unknown>): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.append(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // workspace
  getWorkspace: () => get('workspaces'),
  updateWorkspace: (body: unknown) => put('workspaces', body),

  // subscriptions book
  getAccounts: (params?: Record<string, unknown>) => get(`subscriptions-book${qs(params)}`),
  getAccount: (id: string) => get(`subscriptions-book/${id}`),
  getAccountCharges: (id: string) => get(`subscriptions-book/${id}/charges`),
  getBookHealth: () => get('subscriptions-book/health-summary'),
  createAccount: (body: unknown) => post('subscriptions-book', body),
  updateAccount: (id: string, body: unknown) => put(`subscriptions-book/${id}`, body),
  deleteAccount: (id: string) => del(`subscriptions-book/${id}`),

  // decline codes
  getDeclineCodes: () => get('decline-codes'),
  getDeclineCode: (code: string) => get(`decline-codes/${code}`),
  getDeclineCodeRate: (code: string) => get(`decline-codes/${code}/rate`),
  upsertDeclineOverride: (body: unknown) => post('decline-codes/overrides', body),
  deleteDeclineOverride: (id: string) => del(`decline-codes/overrides/${id}`),

  // failed charges
  getFailedCharges: (params?: Record<string, unknown>) => get(`failed-charges${qs(params)}`),
  getFailedCharge: (id: string) => get(`failed-charges/${id}`),
  createFailedCharge: (body: unknown) => post('failed-charges', body),
  setChargeTactic: (id: string, body: unknown) => put(`failed-charges/${id}/tactic`, body),
  setChargeStatus: (id: string, body: unknown) => put(`failed-charges/${id}/status`, body),
  deleteFailedCharge: (id: string) => del(`failed-charges/${id}`),

  // routing
  getRoutingRules: () => get('routing/rules'),
  getRoutingDecisions: () => get('routing/decisions'),
  createRoutingRule: (body: unknown) => post('routing/rules', body),
  updateRoutingRule: (id: string, body: unknown) => put(`routing/rules/${id}`, body),
  deleteRoutingRule: (id: string) => del(`routing/rules/${id}`),
  simulateRouting: (body: unknown) => post('routing/simulate', body),
  applyRouting: (body?: unknown) => post('routing/apply', body),

  // tactics
  getTactics: () => get('tactics'),
  createTactic: (body: unknown) => post('tactics', body),
  updateTactic: (id: string, body: unknown) => put(`tactics/${id}`, body),
  deleteTactic: (id: string) => del(`tactics/${id}`),

  // retry schedules
  getSchedules: () => get('retry-schedules'),
  getSchedule: (id: string) => get(`retry-schedules/${id}`),
  createSchedule: (body: unknown) => post('retry-schedules', body),
  updateSchedule: (id: string, body: unknown) => put(`retry-schedules/${id}`, body),
  deleteSchedule: (id: string) => del(`retry-schedules/${id}`),

  // simulations
  getSimulations: () => get('simulations'),
  getSimulation: (id: string) => get(`simulations/${id}`),
  runSimulation: (body: unknown) => post('simulations/run', body),
  compareSimulations: (body: unknown) => post('simulations/compare', body),
  deleteSimulation: (id: string) => del(`simulations/${id}`),

  // ledger
  getLedgerEntries: (params?: Record<string, unknown>) => get(`ledger/entries${qs(params)}`),
  getLedgerSummary: () => get('ledger/summary'),
  getLedgerPeriods: () => get('ledger/periods'),
  closeLedgerPeriod: (body: unknown) => post('ledger/periods/close', body),
  exportLedger: () => get('ledger/export'),
  reconcileLedgerEntry: (id: string) => post(`ledger/reconcile/${id}`),

  // card updater
  getCardCoverage: () => get('card-updater/coverage'),
  getCardGapReport: () => get('card-updater/gap-report'),
  recomputeCardCoverage: (body?: unknown) => post('card-updater/recompute', body),
  setCardCoverage: (id: string, body: unknown) => put(`card-updater/${id}`, body),

  // dunning
  getDunningSequences: () => get('dunning/sequences'),
  getDunningSequence: (id: string) => get(`dunning/sequences/${id}`),
  previewDunningSequence: (id: string) => get(`dunning/sequences/${id}/preview`),
  createDunningSequence: (body: unknown) => post('dunning/sequences', body),
  updateDunningSequence: (id: string, body: unknown) => put(`dunning/sequences/${id}`, body),
  deleteDunningSequence: (id: string) => del(`dunning/sequences/${id}`),
  addDunningStep: (id: string, body: unknown) => post(`dunning/sequences/${id}/steps`, body),
  updateDunningStep: (id: string, body: unknown) => put(`dunning/steps/${id}`, body),
  deleteDunningStep: (id: string) => del(`dunning/steps/${id}`),

  // portal
  getPortalConfig: () => get('portal/config'),
  updatePortalConfig: (body: unknown) => put('portal/config', body),
  getPortalSessions: () => get('portal/sessions'),
  createPortalSession: (body: unknown) => post('portal/sessions', body),
  setPortalSessionStatus: (id: string, body: unknown) => put(`portal/sessions/${id}/status`, body),

  // cohorts
  getCohorts: () => get('cohorts'),
  getCohortRate: (id: string) => get(`cohorts/${id}/rate`),
  createCohort: (body: unknown) => post('cohorts', body),
  updateCohort: (id: string, body: unknown) => put(`cohorts/${id}`, body),
  deleteCohort: (id: string) => del(`cohorts/${id}`),
  compareCohorts: (body: unknown) => post('cohorts/compare', body),

  // grace policies
  getGracePolicies: () => get('grace-policies'),
  getGracePolicy: (id: string) => get(`grace-policies/${id}`),
  createGracePolicy: (body: unknown) => post('grace-policies', body),
  updateGracePolicy: (id: string, body: unknown) => put(`grace-policies/${id}`, body),
  deleteGracePolicy: (id: string) => del(`grace-policies/${id}`),
  modelGracePolicy: (id: string, body?: unknown) => post(`grace-policies/${id}/model`, body),

  // playbooks
  getPlaybooks: () => get('playbooks'),
  getPlaybook: (id: string) => get(`playbooks/${id}`),
  createPlaybook: (body: unknown) => post('playbooks', body),
  updatePlaybook: (id: string, body: unknown) => put(`playbooks/${id}`, body),
  deletePlaybook: (id: string) => del(`playbooks/${id}`),
  applyPlaybook: (id: string, body?: unknown) => post(`playbooks/${id}/apply`, body),

  // alerts + watchlist
  getAlertRules: () => get('alerts/rules'),
  getAlerts: () => get('alerts'),
  createAlertRule: (body: unknown) => post('alerts/rules', body),
  updateAlertRule: (id: string, body: unknown) => put(`alerts/rules/${id}`, body),
  deleteAlertRule: (id: string) => del(`alerts/rules/${id}`),
  evaluateAlerts: (body?: unknown) => post('alerts/evaluate', body),
  ackAlert: (id: string) => put(`alerts/${id}/ack`),
  getWatchlist: () => get('watchlist'),
  addWatchlistItem: (body: unknown) => post('watchlist', body),
  updateWatchlistItem: (id: string, body: unknown) => put(`watchlist/${id}`, body),
  deleteWatchlistItem: (id: string) => del(`watchlist/${id}`),

  // forecast
  getForecasts: () => get('forecast'),
  runForecast: (body: unknown) => post('forecast/run', body),
  setForecastActual: (id: string, body: unknown) => put(`forecast/${id}/actual`, body),

  // insights
  getDeclineReasons: () => get('insights/decline-reasons'),
  getReasonTrend: () => get('insights/reason-trend'),
  getEffectiveness: () => get('insights/effectiveness'),

  // imports + seeder
  getImportJobs: () => get('imports/jobs'),
  uploadImport: (body: unknown) => post('imports/upload', body),
  getImportJob: (id: string) => get(`imports/jobs/${id}`),
  seedSampleData: (body?: unknown) => post('seeder/generate', body),
  resetSampleData: (body?: unknown) => post('seeder/reset', body),

  // reports
  getBoardReport: () => get('reports/board'),
  exportReport: (params?: Record<string, unknown>) => get(`reports/export${qs(params)}`),
  getReportDefinitions: () => get('reports/definitions'),
  saveReportDefinition: (body: unknown) => post('reports/definitions', body),

  // activity
  getActivity: (params?: Record<string, unknown>) => get(`activity${qs(params)}`),

  // notifications
  getNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => put(`notifications/${id}/read`),
  markAllNotificationsRead: () => put('notifications/read-all'),

  // billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: (body?: unknown) => post('billing/checkout', body),
  openBillingPortal: (body?: unknown) => post('billing/portal', body),
}

export default api
