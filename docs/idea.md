# DunningRecoveryOrchestrator

> Turn failed recurring-payment retries into recovered cash by modeling decline reasons, retry timing, and card-updater gaps.

---

## Overview

DunningRecoveryOrchestrator is a recovered-revenue intelligence platform for subscription businesses. It ingests (or generates) the stream of failed recurring charges, classifies each failure by its decline code, routes it to the recovery tactic that statistically works for that code, simulates smart retry schedules against historical recovery curves, builds the dunning email/SMS sequences that win the customer back, and reconciles every attempted-vs-recovered-vs-lost dollar in an auditable recovered-revenue ledger.

The platform never touches a card and never processes a payment. It is a deterministic decision and analytics layer that sits beside a billing processor (Stripe, Recurly, Chargebee, Braintree, Adyen) and tells RevOps and subscription-finance leaders exactly how much involuntary churn is recoverable, which tactic to apply to each failure, and how much MRR was actually saved.

Everything works on uploaded CSVs, connected-processor-style data, or a built-in sample-data seeder so the product is demoable from the first sign-in. All features are free for signed-in users; Stripe billing is optional and degrades to a 503 when unconfigured.

---

## Problem

Involuntary churn from failed recurring payments destroys 5-12% of recurring revenue annually. When a renewal charge fails (expired card, insufficient funds, issuer decline, fraud block), most teams either give up after a naive fixed retry or blast a generic "your payment failed" email. They lack:

- A **decline-reason taxonomy** that distinguishes a hard, never-recoverable decline from a soft, retry-in-three-days decline.
- A **retry-timing model** that aligns retries with paydays and issuer authorization patterns instead of firing at random.
- A **card-updater coverage view** that surfaces the MRR sitting behind cards that are about to expire.
- A **recovered-revenue ledger** that proves to the CFO how much involuntary churn was actually recovered.

A 30% recovery lift on a $20M book is $300K+/year. The buyer (Head of RevOps or a subscription-finance leader) owns the involuntary-churn number, carries tooling budget, and reports retained MRR to the CFO. The triggers are recurring and concrete: board churn reviews, missed NRR targets, and payment-processor migrations.

---

## Target Users

- **Heads of RevOps** at B2C/B2B SaaS and DTC subscription companies ($5M-$100M ARR) who own the involuntary-churn metric.
- **Subscriptions / Finance leaders** who report retained MRR to the CFO and need an auditable recovered-revenue number.
- **Billing / Payments engineers** who configure retry schedules and dunning sequences in the processor and need a model to justify the configuration.
- **Growth / Lifecycle marketers** who write the dunning email/SMS copy and run the self-serve card-update portal.

**Buyer:** Head of RevOps or subscription-finance leader who owns the involuntary-churn number, carries tooling budget, and reports retained MRR to the CFO.

---

## Why this is NOT an existing project

Near-neighbors and how DunningRecoveryOrchestrator is distinct:

- **abandoned-cart-recovery** recovers *pre-purchase* carts (a prospect who never paid). DunningRecoveryOrchestrator recovers *post-purchase* subscription dollars already owed by an existing paying customer whose renewal charge failed.
- **billing-platform** *issues* invoices and *charges* cards. DunningRecoveryOrchestrator never issues an invoice and never charges a card; it is a decision/analytics layer over the *failures* a billing platform produces.
- **entitlement-leak-detector** reconciles *plan-vs-usage* (are they using more than they pay for?). DunningRecoveryOrchestrator reconciles *attempted-vs-recovered-vs-lost charges* (did the money we are owed actually arrive?).
- **refund-leakage-controller** (nearest sibling) governs the *outbound* refund stream (money leaving). DunningRecoveryOrchestrator recovers the *inbound* failed subscription charge stream (money that should have arrived but did not).
- **churn-prediction tools** predict *voluntary* churn (customer chose to cancel). DunningRecoveryOrchestrator targets *involuntary* churn (payment mechanics failed; the customer still wants the product).

The unique core: a decline-code taxonomy engine + retry-timing simulator + recovered-revenue ledger that operates strictly on the failed-charge stream of an existing subscription book, touching no card and processing no payment.

---

## Major Features

### 1. Decline-Code Taxonomy Engine
- Canonical taxonomy of decline codes (Stripe/Visa/Mastercard/Amex network codes) mapped to a normalized internal code.
- Per-code classification: hard vs soft, recoverable vs terminal, issuer-side vs network-side vs fraud.
- Per-code recommended recovery tactic (immediate retry, delayed retry, card-updater, dunning sequence, manual outreach, write-off).
- Per-code historical recovery rate computed from the user's own failed-charge data.
- Code aliasing and normalization (map raw processor strings to canonical codes).
- Custom code overrides per workspace.

### 2. Failed-Charge Routing
- Routes each failed charge to the tactic that works for its decline code.
- Routing rules engine with priority ordering and conditions (amount, plan, card brand, retry count).
- Per-charge routing decision log (which tactic chosen and why).
- Bulk re-route on rule change.
- Routing simulation/preview before committing a rule set.

### 3. Smart Retry-Schedule Simulator
- Models retry schedules as ordered offsets (e.g. +1d, +3d, +7d) with windows.
- Payday-aligned windows (1st/15th/end-of-month, configurable per geography).
- Issuer-pattern windows (time-of-day and day-of-week authorization likelihood).
- Recovery-curve modeling: probability of recovery by retry number and offset.
- Simulate a schedule against historical failed charges and project recovered MRR.
- Compare multiple schedules side by side.
- Per-decline-code schedule overrides.

### 4. Recovered-Revenue Ledger
- Double-sided ledger reconciling attempted vs recovered vs lost MRR.
- Per-charge lifecycle: failed -> retried -> recovered/lost/written-off.
- Recovery attribution to tactic and retry attempt.
- Period close (monthly) snapshot of recovered/lost totals.
- Exportable ledger (CSV) for finance.
- Reconciliation status and discrepancy flags.

### 5. Card-Updater Coverage Gap Report
- At-risk MRR behind cards expiring in the next N months.
- Card-updater coverage status per subscription (covered, not-covered, unknown).
- Gap report: MRR not protected by an account-updater service.
- Expiring-card calendar by month.
- Per-brand and per-issuer coverage breakdown.

### 6. Dunning Sequence Builder
- Multi-step email/SMS sequences with per-step delays.
- Per-decline-code copy variants.
- Template variables (customer name, amount, plan, update-card link).
- Sequence assignment by decline code / segment.
- Preview and test-render of each step.
- Sequence performance metrics (open/click/recovery proxy).

### 7. Self-Serve Card-Update Portal
- Hosted update-card landing config (branding, copy, fields).
- Tokenized per-customer update links (no card data stored; link only).
- Portal session tracking (visited, completed-proxy).
- Portal conversion metrics.

### 8. Cohort Recovery-Rate Dashboards
- Recovery rate by plan, geography, card brand, decline reason, retry attempt.
- Cohort builder (define a cohort by filters).
- Trend over time per cohort.
- Cohort comparison.

### 9. Grace-Period & Soft-Suspension Policy Modeler
- Define grace-period length and soft-suspension rules per plan.
- Model revenue impact of grace-period changes.
- Failed-charge seeder to populate scenarios for modeling.
- Policy versioning and what-if comparison.

### 10. Subscriptions Book
- Imported/seeded subscriptions with plan, MRR, card brand, expiry, geography, status.
- Per-subscription failed-charge history.
- Subscription health (at-risk, healthy, in-dunning, churned-involuntary).
- Search and filter the book.

### 11. Failed-Charge Inbox
- Stream of failed charges needing a decision.
- Filter by decline code, amount, plan, retry count, status.
- Per-charge detail with routing decision and recovery timeline.
- Manual tactic override.

### 12. Recovery Tactics Library
- Catalog of tactics (immediate retry, delayed retry, card-updater, dunning, manual, write-off).
- Per-tactic config and default applicability by decline class.
- Per-tactic measured recovery rate.

### 13. Data Import & Connectors
- CSV upload of subscriptions and failed charges with column mapping.
- Connector stubs (Stripe/Recurly/Chargebee-style) that ingest sample payloads deterministically.
- Import job history and row-level validation.

### 14. Sample-Data Seeder
- One-click generation of a realistic subscription book + failed-charge stream.
- Configurable size and decline-code distribution.
- Reset/regenerate.

### 15. Recovery Playbooks
- Saved end-to-end configurations (taxonomy overrides + routing rules + retry schedule + dunning sequence).
- Apply a playbook to the book.
- Playbook templates by vertical (SaaS, DTC).

### 16. Alerts & Watchlists
- Alerts on recovery-rate drop, at-risk-MRR spike, decline-code surge.
- Watchlist of high-value subscriptions.
- Alert rule config and triggered-alert log.

### 17. Recovery Forecast
- Projected recovered MRR for the next period given current config.
- Confidence band from historical curve variance.
- Forecast vs actual tracking.

### 18. Decline-Reason Insights
- Top decline reasons by count and MRR.
- Reason trend over time.
- Reason-to-tactic effectiveness matrix.

### 19. Reports & Exports
- Board-ready recovered-revenue report.
- Scheduled report definitions.
- CSV/JSON exports of ledger, cohorts, gap report.

### 20. Workspaces & Settings
- Per-user workspace with currency, fiscal-period, geography defaults.
- Member/role notes (single-owner model via user_id).
- Notification preferences.

### 21. Activity & Audit Log
- Append-only log of config changes, imports, routing decisions, ledger closes.
- Filter by entity and actor.

### 22. Notifications Center
- In-app notifications for alerts, import completion, period close.
- Mark-read.

---

## Data Model (tables)

- `workspaces` — per-user workspace settings (currency, fiscal period, geo defaults).
- `subscriptions` (domain) — the subscription book (plan, MRR cents, card brand, card expiry, geography, status, updater coverage). NOTE: distinct from billing `subscriptions`; this domain table is `subscription_accounts`.
- `subscription_accounts` — the subscription book rows.
- `decline_codes` — canonical decline-code taxonomy (class, recoverable, default tactic).
- `decline_code_overrides` — per-workspace overrides of taxonomy.
- `failed_charges` — failed recurring charges (amount, decline code, retry count, status).
- `routing_rules` — ordered routing rules (conditions, target tactic).
- `routing_decisions` — per-charge routing decision log.
- `tactics` — recovery tactics catalog.
- `retry_schedules` — named retry schedules (offsets, windows).
- `retry_simulations` — saved simulation runs and projected results.
- `recovery_ledger_entries` — attempted/recovered/lost ledger entries.
- `ledger_periods` — monthly close snapshots.
- `card_updater_status` — per-subscription updater coverage.
- `dunning_sequences` — sequence definitions.
- `dunning_steps` — steps within a sequence.
- `portal_configs` — self-serve update portal config.
- `portal_sessions` — portal visit/conversion tracking.
- `cohorts` — saved cohort definitions.
- `grace_policies` — grace-period/soft-suspension policy versions.
- `playbooks` — saved end-to-end configurations.
- `alert_rules` — alert rule definitions.
- `alerts` — triggered alerts.
- `watchlist_items` — watched high-value subscriptions.
- `forecasts` — recovery forecast runs.
- `import_jobs` — data import job history.
- `activity_log` — append-only audit log.
- `notifications` — in-app notifications.
- `plans` — billing plans (free/pro).
- `subscriptions` (billing) — billing subscription per user.

---

## API Surface (high level, all under /api/v1)

- `/workspaces` — get/update current workspace.
- `/decline-codes` — taxonomy CRUD + overrides + per-code recovery rate.
- `/failed-charges` — inbox list/detail, override tactic, recover/lose status.
- `/routing` — rules CRUD, decisions log, simulate.
- `/tactics` — catalog CRUD + measured rates.
- `/retry-schedules` — schedules CRUD.
- `/simulations` — run/list retry simulations.
- `/ledger` — entries, summary, period close, export.
- `/card-updater` — coverage status, gap report.
- `/dunning` — sequences + steps CRUD, preview, metrics.
- `/portal` — portal configs, sessions, conversion.
- `/cohorts` — cohort CRUD + recovery rates + comparison.
- `/grace-policies` — policy CRUD + impact model.
- `/subscriptions-book` — subscription accounts list/detail/health.
- `/seeder` — generate/reset sample data.
- `/imports` — upload, jobs, validation.
- `/playbooks` — CRUD + apply.
- `/alerts` — rules CRUD + triggered alerts.
- `/watchlist` — items CRUD.
- `/forecast` — run + forecast-vs-actual.
- `/insights` — decline-reason insights.
- `/reports` — report definitions + render.
- `/activity` — audit log list.
- `/notifications` — list + mark read.
- `/billing` — plan/checkout/portal/webhook (Stripe-optional 503).

---

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing).
2. `/auth/sign-in`
3. `/auth/sign-up`
4. `/pricing`

Dashboard (under `/dashboard/*`, sidebar chrome):
5. `/dashboard` — recovered-revenue overview (KPIs, at-risk MRR, recovery rate).
6. `/dashboard/inbox` — failed-charge inbox.
7. `/dashboard/charges/[id]` — failed-charge detail + recovery timeline.
8. `/dashboard/taxonomy` — decline-code taxonomy + overrides.
9. `/dashboard/routing` — routing rules + decisions + simulate.
10. `/dashboard/tactics` — recovery tactics library.
11. `/dashboard/schedules` — retry-schedule builder.
12. `/dashboard/simulator` — retry simulator + compare.
13. `/dashboard/ledger` — recovered-revenue ledger + period close.
14. `/dashboard/card-updater` — card-updater coverage gap report.
15. `/dashboard/dunning` — dunning sequence builder.
16. `/dashboard/portal` — self-serve update portal config.
17. `/dashboard/cohorts` — cohort recovery dashboards.
18. `/dashboard/grace` — grace-period policy modeler.
19. `/dashboard/book` — subscriptions book.
20. `/dashboard/insights` — decline-reason insights.
21. `/dashboard/forecast` — recovery forecast.
22. `/dashboard/playbooks` — recovery playbooks.
23. `/dashboard/alerts` — alerts & watchlists.
24. `/dashboard/imports` — data import + seeder.
25. `/dashboard/reports` — reports & exports.
26. `/dashboard/activity` — activity/audit log.
27. `/dashboard/notifications` — notifications center.
28. `/dashboard/settings` — workspace settings + billing.
