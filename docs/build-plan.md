# DunningRecoveryOrchestrator — Build Contract (Authoritative)

This is the single source of truth. Filenames, mount paths, api method names, and page files declared here are binding. Stack: Hono 4.12.27 backend (`/api/v1` child router), drizzle-orm + Neon, Next.js 16 + `@neondatabase/auth@0.4.2-beta`, `proxy.ts` only, backend trusts `X-User-Id` via `getUserId(c)`. Public reads / auth-gated writes with zod + ownership checks. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`.

All handlers resolve/auto-create the caller's `workspace` row from `getUserId(c)` and scope every query by `workspace_id` + `user_id`. Mutations write `activity_log`.

---

## (a) Tables (columns)

- **workspaces** — id, user_id(uniq), name, currency, fiscal_period_start, default_geography, notification_prefs(jsonb), created_at, updated_at
- **subscription_accounts** — id, workspace_id(fk), user_id, external_id, customer_name, customer_email, plan_name, mrr_cents, card_brand, card_last4, card_exp_month, card_exp_year, geography, status, updater_coverage, created_at
- **decline_codes** — id, code(uniq), network_codes(jsonb), label, decline_class, category, recoverable, default_tactic, description, created_at
- **decline_code_overrides** — id, workspace_id(fk), user_id, code, decline_class, recoverable, default_tactic, notes, created_at, UNIQUE(workspace_id,code)
- **tactics** — id, workspace_id(fk), user_id, key, name, description, config(jsonb), measured_recovery_rate(real), created_at, UNIQUE(workspace_id,key)
- **failed_charges** — id, workspace_id(fk), user_id, subscription_account_id(fk), external_id, amount_cents, currency, raw_decline_code, decline_code, card_brand, plan_name, geography, retry_count, status, assigned_tactic, failed_at, resolved_at, created_at
- **routing_rules** — id, workspace_id(fk), user_id, name, priority, conditions(jsonb), target_tactic, is_active, created_at
- **routing_decisions** — id, workspace_id(fk), user_id, failed_charge_id(fk), rule_id(fk), chosen_tactic, reason, created_at
- **retry_schedules** — id, workspace_id(fk), user_id, name, offsets(jsonb), payday_aligned, issuer_pattern, per_code_overrides(jsonb), is_default, created_at
- **retry_simulations** — id, workspace_id(fk), user_id, schedule_id(fk), name, projected_recovered_cents, projected_recovery_rate(real), curve(jsonb), results(jsonb), created_at
- **recovery_ledger_entries** — id, workspace_id(fk), user_id, failed_charge_id(fk), entry_type, amount_cents, tactic, retry_attempt, period_id, reconciled, created_at
- **ledger_periods** — id, workspace_id(fk), user_id, label, attempted_cents, recovered_cents, lost_cents, written_off_cents, closed, closed_at, created_at, UNIQUE(workspace_id,label)
- **card_updater_status** — id, workspace_id(fk), user_id, subscription_account_id(fk), coverage, expires_at, at_risk_mrr_cents, created_at, UNIQUE(workspace_id,subscription_account_id)
- **dunning_sequences** — id, workspace_id(fk), user_id, name, channel, assigned_codes(jsonb), is_active, metrics(jsonb), created_at
- **dunning_steps** — id, workspace_id(fk), user_id, sequence_id(fk), step_order, delay_hours, channel, subject, body, created_at
- **portal_configs** — id, workspace_id(fk), user_id, brand_name, primary_color, headline, body_copy, fields(jsonb), is_active, created_at
- **portal_sessions** — id, workspace_id(fk), user_id, subscription_account_id(fk), token(uniq), status, visited_at, completed_at, created_at
- **cohorts** — id, workspace_id(fk), user_id, name, dimension, filters(jsonb), created_at
- **grace_policies** — id, workspace_id(fk), user_id, name, plan_name, grace_days, soft_suspend_after_days, version, projected_impact_cents, created_at
- **playbooks** — id, workspace_id(fk), user_id, name, vertical, config(jsonb), is_template, created_at
- **alert_rules** — id, workspace_id(fk), user_id, name, metric, threshold(real), is_active, created_at
- **alerts** — id, workspace_id(fk), user_id, rule_id(fk), message, severity, acknowledged, created_at
- **watchlist_items** — id, workspace_id(fk), user_id, subscription_account_id(fk), note, created_at, UNIQUE(workspace_id,subscription_account_id)
- **forecasts** — id, workspace_id(fk), user_id, period_label, projected_recovered_cents, low_cents, high_cents, actual_recovered_cents, created_at
- **import_jobs** — id, workspace_id(fk), user_id, source, entity, status, rows_total, rows_valid, rows_invalid, errors(jsonb), created_at
- **activity_log** — id, workspace_id(fk), user_id, entity_type, entity_id, action, metadata(jsonb), created_at
- **notifications** — id, user_id, workspace_id(fk), title, body, kind, read, created_at
- **plans** — id('free'/'pro'), name, price_cents, created_at
- **subscriptions** (billing) — id, user_id(uniq), plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mount under /api/v1)

All mounted in `index.ts` via `api.route('/<mount>', router)`. Each file `export default router`. "auth?" = Y means `authMiddleware`. Reads are public unless noted. Ownership checks on every write/by-id mutation.

### workspaces.ts — mount `/workspaces`
- `GET /` — auth Y — get-or-create current workspace — `Workspace`
- `PUT /` — auth Y — update settings (zod: name, currency, fiscal_period_start, default_geography, notification_prefs) — `Workspace`

### subscriptions-book.ts — mount `/subscriptions-book`
- `GET /` — public(workspace-scoped via header) — list accounts (filter q/status/plan) — `SubscriptionAccount[]`
- `GET /:id` — public — account detail — `SubscriptionAccount`
- `GET /:id/charges` — public — failed charges for account — `FailedCharge[]`
- `GET /health-summary` — public — counts by status — `{ active, at_risk, in_dunning, churned_involuntary, recovered }`
- `POST /` — auth Y — create account (zod) — `SubscriptionAccount`
- `PUT /:id` — auth Y — update account — `SubscriptionAccount`
- `DELETE /:id` — auth Y — delete — `{ success }`

### decline-codes.ts — mount `/decline-codes`
- `GET /` — public — taxonomy (canonical + workspace overrides merged) — `DeclineCode[]`
- `GET /:code` — public — single code w/ recovery rate computed from failed_charges — `DeclineCode & { recovery_rate }`
- `GET /:code/rate` — public — historical recovery rate for code — `{ code, attempted, recovered, rate }`
- `POST /overrides` — auth Y — upsert override (zod: code, decline_class?, recoverable?, default_tactic?, notes?) — `DeclineCodeOverride`
- `DELETE /overrides/:id` — auth Y — remove override — `{ success }`

### failed-charges.ts — mount `/failed-charges`
- `GET /` — public — inbox list (filter decline_code/status/plan/min_amount/retry_count) — `FailedCharge[]`
- `GET /:id` — public — charge detail w/ routing decision + ledger timeline — `{ charge, decision, ledger }`
- `POST /` — auth Y — create charge (zod) — `FailedCharge`
- `PUT /:id/tactic` — auth Y — manual tactic override (zod: assigned_tactic) — `FailedCharge`
- `PUT /:id/status` — auth Y — set status recovered/lost/written_off (writes ledger entry) — `FailedCharge`
- `DELETE /:id` — auth Y — delete — `{ success }`

### routing.ts — mount `/routing`
- `GET /rules` — public — list rules ordered by priority — `RoutingRule[]`
- `GET /decisions` — public — recent routing decisions — `RoutingDecision[]`
- `POST /rules` — auth Y — create rule (zod: name, priority, conditions, target_tactic) — `RoutingRule`
- `PUT /rules/:id` — auth Y — update rule — `RoutingRule`
- `DELETE /rules/:id` — auth Y — delete rule — `{ success }`
- `POST /simulate` — auth Y — preview routing of current failed_charges against a candidate rule set (zod: rules[]) — `{ assignments: Array<{charge_id, tactic, rule_id}>, counts }`
- `POST /apply` — auth Y — re-route all open failed_charges, write routing_decisions — `{ routed }`

### tactics.ts — mount `/tactics`
- `GET /` — public — tactics catalog w/ measured rates — `Tactic[]`
- `POST /` — auth Y — create/upsert tactic (zod: key, name, description, config) — `Tactic`
- `PUT /:id` — auth Y — update — `Tactic`
- `DELETE /:id` — auth Y — delete — `{ success }`

### retry-schedules.ts — mount `/retry-schedules`
- `GET /` — public — list schedules — `RetrySchedule[]`
- `GET /:id` — public — schedule detail — `RetrySchedule`
- `POST /` — auth Y — create (zod: name, offsets, payday_aligned, issuer_pattern, per_code_overrides) — `RetrySchedule`
- `PUT /:id` — auth Y — update — `RetrySchedule`
- `DELETE /:id` — auth Y — delete — `{ success }`

### simulations.ts — mount `/simulations`
- `GET /` — public — list saved simulations — `RetrySimulation[]`
- `GET /:id` — public — simulation detail w/ curve — `RetrySimulation`
- `POST /run` — auth Y — run a simulation against failed_charges for a schedule (zod: schedule_id, name) — `RetrySimulation`
- `POST /compare` — auth Y — compare multiple schedules (zod: schedule_ids[]) — `{ results: Array<{schedule_id, projected_recovered_cents, projected_recovery_rate}> }`
- `DELETE /:id` — auth Y — delete — `{ success }`

### ledger.ts — mount `/ledger`
- `GET /entries` — public — ledger entries (filter entry_type/period_id) — `LedgerEntry[]`
- `GET /summary` — public — attempted/recovered/lost/written_off totals + recovery rate — `{ attempted_cents, recovered_cents, lost_cents, written_off_cents, recovery_rate }`
- `GET /periods` — public — list periods — `LedgerPeriod[]`
- `POST /periods/close` — auth Y — close a period, snapshot totals (zod: label) — `LedgerPeriod`
- `GET /export` — public — CSV export of entries — text/csv
- `POST /reconcile/:id` — auth Y — mark entry reconciled — `LedgerEntry`

### card-updater.ts — mount `/card-updater`
- `GET /coverage` — public — per-account coverage status — `CardUpdaterStatus[]`
- `GET /gap-report` — public — at-risk MRR not covered, grouped by month/brand/issuer — `{ total_at_risk_cents, by_month, by_brand, rows }`
- `POST /recompute` — auth Y — recompute coverage + at_risk_mrr from subscription_accounts expiry — `{ updated }`
- `PUT /:id` — auth Y — set coverage for an account (zod: subscription_account_id, coverage) — `CardUpdaterStatus`

### dunning.ts — mount `/dunning`
- `GET /sequences` — public — list sequences — `DunningSequence[]`
- `GET /sequences/:id` — public — sequence + steps — `{ sequence, steps }`
- `GET /sequences/:id/preview` — public — rendered preview of each step w/ sample vars — `{ steps: Array<{subject, body}> }`
- `POST /sequences` — auth Y — create sequence (zod: name, channel, assigned_codes) — `DunningSequence`
- `PUT /sequences/:id` — auth Y — update — `DunningSequence`
- `DELETE /sequences/:id` — auth Y — delete — `{ success }`
- `POST /sequences/:id/steps` — auth Y — add step (zod: step_order, delay_hours, channel, subject, body) — `DunningStep`
- `PUT /steps/:id` — auth Y — update step — `DunningStep`
- `DELETE /steps/:id` — auth Y — delete step — `{ success }`

### portal.ts — mount `/portal`
- `GET /config` — public — get-or-create portal config — `PortalConfig`
- `PUT /config` — auth Y — update config (zod: brand_name, primary_color, headline, body_copy, fields) — `PortalConfig`
- `GET /sessions` — public — list portal sessions w/ conversion stats — `{ sessions, conversion_rate }`
- `POST /sessions` — auth Y — mint tokenized update link for an account (zod: subscription_account_id) — `PortalSession`
- `PUT /sessions/:id/status` — auth Y — mark visited/completed (zod: status) — `PortalSession`

### cohorts.ts — mount `/cohorts`
- `GET /` — public — list cohorts — `Cohort[]`
- `GET /:id/rate` — public — recovery rate over time for cohort — `{ cohort, points: Array<{period, rate, recovered_cents}> }`
- `POST /` — auth Y — create cohort (zod: name, dimension, filters) — `Cohort`
- `PUT /:id` — auth Y — update — `Cohort`
- `DELETE /:id` — auth Y — delete — `{ success }`
- `POST /compare` — auth Y — compare cohorts (zod: cohort_ids[]) — `{ results: Array<{cohort_id, rate}> }`

### grace-policies.ts — mount `/grace-policies`
- `GET /` — public — list policies — `GracePolicy[]`
- `GET /:id` — public — policy detail — `GracePolicy`
- `POST /` — auth Y — create policy (zod: name, plan_name?, grace_days, soft_suspend_after_days) — `GracePolicy`
- `PUT /:id` — auth Y — update (bumps version) — `GracePolicy`
- `DELETE /:id` — auth Y — delete — `{ success }`
- `POST /:id/model` — auth Y — model revenue impact of policy — `{ projected_impact_cents, detail }`

### playbooks.ts — mount `/playbooks`
- `GET /` — public — list playbooks (+ templates) — `Playbook[]`
- `GET /:id` — public — playbook detail — `Playbook`
- `POST /` — auth Y — create (zod: name, vertical, config) — `Playbook`
- `PUT /:id` — auth Y — update — `Playbook`
- `DELETE /:id` — auth Y — delete — `{ success }`
- `POST /:id/apply` — auth Y — apply playbook config to workspace — `{ applied }`

### alerts.ts — mount `/alerts`
- `GET /rules` — public — list alert rules — `AlertRule[]`
- `GET /` — public — triggered alerts — `Alert[]`
- `POST /rules` — auth Y — create rule (zod: name, metric, threshold) — `AlertRule`
- `PUT /rules/:id` — auth Y — update rule — `AlertRule`
- `DELETE /rules/:id` — auth Y — delete rule — `{ success }`
- `POST /evaluate` — auth Y — evaluate rules now, create alerts — `{ triggered }`
- `PUT /:id/ack` — auth Y — acknowledge alert — `Alert`

### watchlist.ts — mount `/watchlist`
- `GET /` — public — watchlist items joined to accounts — `Array<WatchlistItem & {account}>`
- `POST /` — auth Y — add item (zod: subscription_account_id, note?) — `WatchlistItem`
- `PUT /:id` — auth Y — update note — `WatchlistItem`
- `DELETE /:id` — auth Y — remove — `{ success }`

### forecast.ts — mount `/forecast`
- `GET /` — public — list forecasts (projected vs actual) — `Forecast[]`
- `POST /run` — auth Y — run forecast for next period from current config + curves (zod: period_label) — `Forecast`
- `PUT /:id/actual` — auth Y — record actual recovered (zod: actual_recovered_cents) — `Forecast`

### insights.ts — mount `/insights`
- `GET /decline-reasons` — public — top decline reasons by count + MRR — `Array<{ code, label, count, mrr_cents }>`
- `GET /reason-trend` — public — reason counts over time — `{ periods, series }`
- `GET /effectiveness` — public — reason-to-tactic recovery matrix — `{ matrix }`

### imports.ts — mount `/imports`
- `GET /jobs` — public — import job history — `ImportJob[]`
- `POST /upload` — auth Y — ingest CSV rows w/ column mapping (zod: entity, rows[], mapping) — `ImportJob`
- `GET /jobs/:id` — public — job detail w/ row errors — `ImportJob`

### seeder.ts — mount `/seeder`
- `POST /generate` — auth Y — generate sample subscription book + failed-charge stream (zod: size?, decline_distribution?) — `{ accounts, charges }`
- `POST /reset` — auth Y — delete all workspace domain data — `{ reset: true }`

### reports.ts — mount `/reports`
- `GET /board` — public — board-ready recovered-revenue summary — `{ kpis, ledger_summary, top_reasons, at_risk_mrr }`
- `GET /export` — public — JSON/CSV export bundle (query: format) — file
- `GET /definitions` — public — saved report definitions — `ReportDefinition[]` (stored in activity_log/notifications-free; uses playbooks-like config stored client-side none) — returns scheduled defs from a lightweight store
- `POST /definitions` — auth Y — save a scheduled report definition — `{ id }`

### activity.ts — mount `/activity`
- `GET /` — public — activity/audit log (filter entity_type/entity_id) — `ActivityLog[]`

### notifications.ts — mount `/notifications`
- `GET /` — auth Y — current user notifications — `Notification[]`
- `PUT /:id/read` — auth Y — mark read — `Notification`
- `PUT /read-all` — auth Y — mark all read — `{ updated }`

### billing.ts — mount `/billing`
- `GET /plan` — public(header) — current subscription + plan + stripeEnabled — `{ subscription, plan, stripeEnabled }`
- `POST /checkout` — public(header) — Stripe checkout or 503 — `{ url } | 503`
- `POST /portal` — public(header) — Stripe billing portal or 503 — `{ url } | 503`
- `POST /webhook` — none — Stripe webhook or 503 — `{ received } | 503`

---

## (c) lib/api.ts methods (method — relative path — verb)

```
// workspace
getWorkspace            GET    /api/proxy/workspaces
updateWorkspace         PUT    /api/proxy/workspaces

// subscriptions book
getAccounts             GET    /api/proxy/subscriptions-book
getAccount              GET    /api/proxy/subscriptions-book/:id
getAccountCharges       GET    /api/proxy/subscriptions-book/:id/charges
getBookHealth           GET    /api/proxy/subscriptions-book/health-summary
createAccount           POST   /api/proxy/subscriptions-book
updateAccount           PUT    /api/proxy/subscriptions-book/:id
deleteAccount           DELETE /api/proxy/subscriptions-book/:id

// decline codes
getDeclineCodes         GET    /api/proxy/decline-codes
getDeclineCode          GET    /api/proxy/decline-codes/:code
getDeclineCodeRate      GET    /api/proxy/decline-codes/:code/rate
upsertDeclineOverride   POST   /api/proxy/decline-codes/overrides
deleteDeclineOverride   DELETE /api/proxy/decline-codes/overrides/:id

// failed charges
getFailedCharges        GET    /api/proxy/failed-charges
getFailedCharge         GET    /api/proxy/failed-charges/:id
createFailedCharge      POST   /api/proxy/failed-charges
setChargeTactic         PUT    /api/proxy/failed-charges/:id/tactic
setChargeStatus         PUT    /api/proxy/failed-charges/:id/status
deleteFailedCharge      DELETE /api/proxy/failed-charges/:id

// routing
getRoutingRules         GET    /api/proxy/routing/rules
getRoutingDecisions     GET    /api/proxy/routing/decisions
createRoutingRule       POST   /api/proxy/routing/rules
updateRoutingRule       PUT    /api/proxy/routing/rules/:id
deleteRoutingRule       DELETE /api/proxy/routing/rules/:id
simulateRouting         POST   /api/proxy/routing/simulate
applyRouting            POST   /api/proxy/routing/apply

// tactics
getTactics              GET    /api/proxy/tactics
createTactic            POST   /api/proxy/tactics
updateTactic            PUT    /api/proxy/tactics/:id
deleteTactic            DELETE /api/proxy/tactics/:id

// retry schedules
getSchedules            GET    /api/proxy/retry-schedules
getSchedule             GET    /api/proxy/retry-schedules/:id
createSchedule          POST   /api/proxy/retry-schedules
updateSchedule          PUT    /api/proxy/retry-schedules/:id
deleteSchedule          DELETE /api/proxy/retry-schedules/:id

// simulations
getSimulations          GET    /api/proxy/simulations
getSimulation           GET    /api/proxy/simulations/:id
runSimulation           POST   /api/proxy/simulations/run
compareSimulations      POST   /api/proxy/simulations/compare
deleteSimulation        DELETE /api/proxy/simulations/:id

// ledger
getLedgerEntries        GET    /api/proxy/ledger/entries
getLedgerSummary        GET    /api/proxy/ledger/summary
getLedgerPeriods        GET    /api/proxy/ledger/periods
closeLedgerPeriod       POST   /api/proxy/ledger/periods/close
exportLedger            GET    /api/proxy/ledger/export
reconcileLedgerEntry    POST   /api/proxy/ledger/reconcile/:id

// card updater
getCardCoverage         GET    /api/proxy/card-updater/coverage
getCardGapReport        GET    /api/proxy/card-updater/gap-report
recomputeCardCoverage   POST   /api/proxy/card-updater/recompute
setCardCoverage         PUT    /api/proxy/card-updater/:id

// dunning
getDunningSequences     GET    /api/proxy/dunning/sequences
getDunningSequence      GET    /api/proxy/dunning/sequences/:id
previewDunningSequence  GET    /api/proxy/dunning/sequences/:id/preview
createDunningSequence   POST   /api/proxy/dunning/sequences
updateDunningSequence   PUT    /api/proxy/dunning/sequences/:id
deleteDunningSequence   DELETE /api/proxy/dunning/sequences/:id
addDunningStep          POST   /api/proxy/dunning/sequences/:id/steps
updateDunningStep       PUT    /api/proxy/dunning/steps/:id
deleteDunningStep       DELETE /api/proxy/dunning/steps/:id

// portal
getPortalConfig         GET    /api/proxy/portal/config
updatePortalConfig      PUT    /api/proxy/portal/config
getPortalSessions       GET    /api/proxy/portal/sessions
createPortalSession     POST   /api/proxy/portal/sessions
setPortalSessionStatus  PUT    /api/proxy/portal/sessions/:id/status

// cohorts
getCohorts              GET    /api/proxy/cohorts
getCohortRate           GET    /api/proxy/cohorts/:id/rate
createCohort            POST   /api/proxy/cohorts
updateCohort            PUT    /api/proxy/cohorts/:id
deleteCohort            DELETE /api/proxy/cohorts/:id
compareCohorts          POST   /api/proxy/cohorts/compare

// grace policies
getGracePolicies        GET    /api/proxy/grace-policies
getGracePolicy          GET    /api/proxy/grace-policies/:id
createGracePolicy       POST   /api/proxy/grace-policies
updateGracePolicy       PUT    /api/proxy/grace-policies/:id
deleteGracePolicy       DELETE /api/proxy/grace-policies/:id
modelGracePolicy        POST   /api/proxy/grace-policies/:id/model

// playbooks
getPlaybooks            GET    /api/proxy/playbooks
getPlaybook             GET    /api/proxy/playbooks/:id
createPlaybook          POST   /api/proxy/playbooks
updatePlaybook          PUT    /api/proxy/playbooks/:id
deletePlaybook          DELETE /api/proxy/playbooks/:id
applyPlaybook           POST   /api/proxy/playbooks/:id/apply

// alerts + watchlist
getAlertRules           GET    /api/proxy/alerts/rules
getAlerts               GET    /api/proxy/alerts
createAlertRule         POST   /api/proxy/alerts/rules
updateAlertRule         PUT    /api/proxy/alerts/rules/:id
deleteAlertRule         DELETE /api/proxy/alerts/rules/:id
evaluateAlerts          POST   /api/proxy/alerts/evaluate
ackAlert                PUT    /api/proxy/alerts/:id/ack
getWatchlist            GET    /api/proxy/watchlist
addWatchlistItem        POST   /api/proxy/watchlist
updateWatchlistItem     PUT    /api/proxy/watchlist/:id
deleteWatchlistItem     DELETE /api/proxy/watchlist/:id

// forecast
getForecasts            GET    /api/proxy/forecast
runForecast             POST   /api/proxy/forecast/run
setForecastActual       PUT    /api/proxy/forecast/:id/actual

// insights
getDeclineReasons       GET    /api/proxy/insights/decline-reasons
getReasonTrend          GET    /api/proxy/insights/reason-trend
getEffectiveness        GET    /api/proxy/insights/effectiveness

// imports + seeder
getImportJobs           GET    /api/proxy/imports/jobs
uploadImport            POST   /api/proxy/imports/upload
getImportJob            GET    /api/proxy/imports/jobs/:id
seedSampleData          POST   /api/proxy/seeder/generate
resetSampleData         POST   /api/proxy/seeder/reset

// reports
getBoardReport          GET    /api/proxy/reports/board
exportReport            GET    /api/proxy/reports/export
getReportDefinitions    GET    /api/proxy/reports/definitions
saveReportDefinition    POST   /api/proxy/reports/definitions

// activity
getActivity             GET    /api/proxy/activity

// notifications
getNotifications        GET    /api/proxy/notifications
markNotificationRead    PUT    /api/proxy/notifications/:id/read
markAllNotificationsRead PUT   /api/proxy/notifications/read-all

// billing
getBillingPlan          GET    /api/proxy/billing/plan
startCheckout           POST   /api/proxy/billing/checkout
openBillingPortal       POST   /api/proxy/billing/portal
```

---

## (d) Pages (URL — file under web/ — kind — api methods — renders)

1. `/` — `app/page.tsx` — public — (none) — static landing: hero, 7 flagship feature grid, ROI stat, CTAs to sign-up/pricing.
2. `/auth/sign-in` — `app/auth/sign-in/page.tsx` — public — (authClient) — email/password sign-in.
3. `/auth/sign-up` — `app/auth/sign-up/page.tsx` — public — (authClient) — email/password sign-up.
4. `/pricing` — `app/pricing/page.tsx` — public — getBillingPlan — Free vs Pro tiers, all-free note.
5. `/dashboard` — `app/dashboard/page.tsx` — dashboard — getLedgerSummary, getBookHealth, getCardGapReport, getDeclineReasons, getForecasts — recovered-revenue overview KPIs, at-risk MRR, recovery rate, top reasons.
6. `/dashboard/inbox` — `app/dashboard/inbox/page.tsx` — dashboard — getFailedCharges, getTactics, setChargeTactic, setChargeStatus — failed-charge inbox w/ filters + inline tactic/status.
7. `/dashboard/charges/[id]` — `app/dashboard/charges/[id]/page.tsx` — dashboard — getFailedCharge, getDeclineCode, setChargeTactic, setChargeStatus — charge detail + routing decision + recovery timeline.
8. `/dashboard/taxonomy` — `app/dashboard/taxonomy/page.tsx` — dashboard — getDeclineCodes, getDeclineCodeRate, upsertDeclineOverride, deleteDeclineOverride — decline-code taxonomy table + per-code overrides + recovery rates.
9. `/dashboard/routing` — `app/dashboard/routing/page.tsx` — dashboard — getRoutingRules, getRoutingDecisions, createRoutingRule, updateRoutingRule, deleteRoutingRule, simulateRouting, applyRouting — rules builder, decisions log, simulate/apply.
10. `/dashboard/tactics` — `app/dashboard/tactics/page.tsx` — dashboard — getTactics, createTactic, updateTactic, deleteTactic — tactics library w/ measured rates.
11. `/dashboard/schedules` — `app/dashboard/schedules/page.tsx` — dashboard — getSchedules, createSchedule, updateSchedule, deleteSchedule — retry-schedule builder (offsets, payday/issuer toggles, per-code overrides).
12. `/dashboard/simulator` — `app/dashboard/simulator/page.tsx` — dashboard — getSchedules, getSimulations, runSimulation, compareSimulations, deleteSimulation — run simulations, recovery curve, compare schedules.
13. `/dashboard/ledger` — `app/dashboard/ledger/page.tsx` — dashboard — getLedgerSummary, getLedgerEntries, getLedgerPeriods, closeLedgerPeriod, reconcileLedgerEntry, exportLedger — recovered-revenue ledger + period close + export.
14. `/dashboard/card-updater` — `app/dashboard/card-updater/page.tsx` — dashboard — getCardCoverage, getCardGapReport, recomputeCardCoverage, setCardCoverage — coverage gap report, expiring-card calendar, at-risk MRR.
15. `/dashboard/dunning` — `app/dashboard/dunning/page.tsx` — dashboard — getDunningSequences, getDunningSequence, previewDunningSequence, createDunningSequence, updateDunningSequence, deleteDunningSequence, addDunningStep, updateDunningStep, deleteDunningStep — sequence builder w/ steps + preview.
16. `/dashboard/portal` — `app/dashboard/portal/page.tsx` — dashboard — getPortalConfig, updatePortalConfig, getPortalSessions, createPortalSession, setPortalSessionStatus — portal config + session conversion.
17. `/dashboard/cohorts` — `app/dashboard/cohorts/page.tsx` — dashboard — getCohorts, getCohortRate, createCohort, updateCohort, deleteCohort, compareCohorts — cohort recovery dashboards + compare.
18. `/dashboard/grace` — `app/dashboard/grace/page.tsx` — dashboard — getGracePolicies, getGracePolicy, createGracePolicy, updateGracePolicy, deleteGracePolicy, modelGracePolicy — grace-period policy modeler + impact.
19. `/dashboard/book` — `app/dashboard/book/page.tsx` — dashboard — getAccounts, getBookHealth, createAccount, updateAccount, deleteAccount, addWatchlistItem — subscription book list + health.
20. `/dashboard/insights` — `app/dashboard/insights/page.tsx` — dashboard — getDeclineReasons, getReasonTrend, getEffectiveness — decline-reason insights + effectiveness matrix.
21. `/dashboard/forecast` — `app/dashboard/forecast/page.tsx` — dashboard — getForecasts, runForecast, setForecastActual — recovery forecast vs actual.
22. `/dashboard/playbooks` — `app/dashboard/playbooks/page.tsx` — dashboard — getPlaybooks, getPlaybook, createPlaybook, updatePlaybook, deletePlaybook, applyPlaybook — playbooks list + apply.
23. `/dashboard/alerts` — `app/dashboard/alerts/page.tsx` — dashboard — getAlertRules, getAlerts, createAlertRule, updateAlertRule, deleteAlertRule, evaluateAlerts, ackAlert, getWatchlist, updateWatchlistItem, deleteWatchlistItem — alerts + watchlist.
24. `/dashboard/imports` — `app/dashboard/imports/page.tsx` — dashboard — getImportJobs, uploadImport, getImportJob, seedSampleData, resetSampleData — CSV import + sample-data seeder.
25. `/dashboard/reports` — `app/dashboard/reports/page.tsx` — dashboard — getBoardReport, exportReport, getReportDefinitions, saveReportDefinition — board report + exports + scheduled defs.
26. `/dashboard/activity` — `app/dashboard/activity/page.tsx` — dashboard — getActivity — audit/activity log.
27. `/dashboard/notifications` — `app/dashboard/notifications/page.tsx` — dashboard — getNotifications, markNotificationRead, markAllNotificationsRead — notifications center.
28. `/dashboard/settings` — `app/dashboard/settings/page.tsx` — dashboard — getWorkspace, updateWorkspace, getBillingPlan, startCheckout, openBillingPortal — workspace settings + billing.

Plus route handlers: `app/api/auth/[...path]/route.ts`, `app/api/proxy/[...path]/route.ts`. Layout: `app/dashboard/layout.tsx` → `components/DashboardLayout`.

---

## (e) DashboardLayout sidebar nav sections

- **Overview**: Dashboard (`/dashboard`), Forecast (`/dashboard/forecast`), Reports (`/dashboard/reports`)
- **Recovery**: Inbox (`/dashboard/inbox`), Taxonomy (`/dashboard/taxonomy`), Routing (`/dashboard/routing`), Tactics (`/dashboard/tactics`)
- **Retry Modeling**: Schedules (`/dashboard/schedules`), Simulator (`/dashboard/simulator`), Grace Policies (`/dashboard/grace`)
- **Revenue**: Ledger (`/dashboard/ledger`), Card Updater (`/dashboard/card-updater`), Cohorts (`/dashboard/cohorts`), Insights (`/dashboard/insights`)
- **Engagement**: Dunning (`/dashboard/dunning`), Portal (`/dashboard/portal`)
- **Accounts**: Subscription Book (`/dashboard/book`), Playbooks (`/dashboard/playbooks`), Alerts & Watchlist (`/dashboard/alerts`)
- **Data**: Imports & Seeder (`/dashboard/imports`), Activity (`/dashboard/activity`), Notifications (`/dashboard/notifications`)
- **Account**: Settings (`/dashboard/settings`)

---

## Consistency invariants

- Every api method maps 1:1 to exactly one backend endpoint above; every endpoint is consumed by at least one page.
- `getReportDefinitions`/`saveReportDefinition` are consumed by `/dashboard/reports`; backed by `reports.ts` definitions endpoints (lightweight; persisted in a `report_definitions`-like use of `playbooks` is NOT used — implement a simple in-table store or reuse `activity_log` metadata; if a dedicated table is desired add `report_definitions` mirroring playbooks shape — optional, not required by the binding table list).
- 28 pages (4 public + 24 dashboard), 26 route files.
