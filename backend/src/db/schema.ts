import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ── Workspaces ───────────────────────────────────────────────────────────────
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  name: text('name').notNull().default('My Workspace'),
  currency: text('currency').notNull().default('USD'),
  fiscal_period_start: integer('fiscal_period_start').notNull().default(1), // day of month
  default_geography: text('default_geography').notNull().default('US'),
  notification_prefs: jsonb('notification_prefs').$type<Record<string, boolean>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ── Subscription book ────────────────────────────────────────────────────────
export const subscription_accounts = pgTable('subscription_accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  external_id: text('external_id'),
  customer_name: text('customer_name').notNull(),
  customer_email: text('customer_email'),
  plan_name: text('plan_name').notNull(),
  mrr_cents: integer('mrr_cents').notNull().default(0),
  card_brand: text('card_brand'),
  card_last4: text('card_last4'),
  card_exp_month: integer('card_exp_month'),
  card_exp_year: integer('card_exp_year'),
  geography: text('geography').notNull().default('US'),
  status: text('status').notNull().default('active'), // active|at_risk|in_dunning|churned_involuntary|recovered
  updater_coverage: text('updater_coverage').notNull().default('unknown'), // covered|not_covered|unknown
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Decline-code taxonomy ────────────────────────────────────────────────────
export const decline_codes = pgTable('decline_codes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text('code').notNull().unique(), // canonical normalized code
  network_codes: jsonb('network_codes').$type<string[]>().default([]),
  label: text('label').notNull(),
  decline_class: text('decline_class').notNull(), // hard|soft
  category: text('category').notNull(), // issuer|network|fraud|funds|technical
  recoverable: boolean('recoverable').notNull().default(true),
  default_tactic: text('default_tactic').notNull().default('delayed_retry'),
  description: text('description').notNull().default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const decline_code_overrides = pgTable('decline_code_overrides', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  code: text('code').notNull(),
  decline_class: text('decline_class'),
  recoverable: boolean('recoverable'),
  default_tactic: text('default_tactic'),
  notes: text('notes').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.code)])

// ── Tactics ──────────────────────────────────────────────────────────────────
export const tactics = pgTable('tactics', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  key: text('key').notNull(), // immediate_retry|delayed_retry|card_updater|dunning|manual|write_off
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  measured_recovery_rate: real('measured_recovery_rate').default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.key)])

// ── Failed charges ───────────────────────────────────────────────────────────
export const failed_charges = pgTable('failed_charges', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  subscription_account_id: text('subscription_account_id').references(() => subscription_accounts.id),
  external_id: text('external_id'),
  amount_cents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  raw_decline_code: text('raw_decline_code'),
  decline_code: text('decline_code').notNull(), // canonical
  card_brand: text('card_brand'),
  plan_name: text('plan_name'),
  geography: text('geography').notNull().default('US'),
  retry_count: integer('retry_count').notNull().default(0),
  status: text('status').notNull().default('failed'), // failed|retrying|recovered|lost|written_off
  assigned_tactic: text('assigned_tactic'),
  failed_at: timestamp('failed_at').defaultNow().notNull(),
  resolved_at: timestamp('resolved_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Routing ──────────────────────────────────────────────────────────────────
export const routing_rules = pgTable('routing_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  priority: integer('priority').notNull().default(0),
  conditions: jsonb('conditions').$type<Array<{ field: string; op: string; value: unknown }>>().default([]),
  target_tactic: text('target_tactic').notNull(),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const routing_decisions = pgTable('routing_decisions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  failed_charge_id: text('failed_charge_id').notNull().references(() => failed_charges.id),
  rule_id: text('rule_id').references(() => routing_rules.id),
  chosen_tactic: text('chosen_tactic').notNull(),
  reason: text('reason').notNull().default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Retry schedules + simulations ────────────────────────────────────────────
export const retry_schedules = pgTable('retry_schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  offsets: jsonb('offsets').$type<Array<{ day: number; window: string }>>().default([]),
  payday_aligned: boolean('payday_aligned').notNull().default(false),
  issuer_pattern: boolean('issuer_pattern').notNull().default(false),
  per_code_overrides: jsonb('per_code_overrides').$type<Record<string, number[]>>().default({}),
  is_default: boolean('is_default').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const retry_simulations = pgTable('retry_simulations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  schedule_id: text('schedule_id').references(() => retry_schedules.id),
  name: text('name').notNull(),
  projected_recovered_cents: integer('projected_recovered_cents').notNull().default(0),
  projected_recovery_rate: real('projected_recovery_rate').default(0),
  curve: jsonb('curve').$type<Array<{ attempt: number; rate: number }>>().default([]),
  results: jsonb('results').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Recovered-revenue ledger ─────────────────────────────────────────────────
export const recovery_ledger_entries = pgTable('recovery_ledger_entries', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  failed_charge_id: text('failed_charge_id').references(() => failed_charges.id),
  entry_type: text('entry_type').notNull(), // attempted|recovered|lost|written_off
  amount_cents: integer('amount_cents').notNull(),
  tactic: text('tactic'),
  retry_attempt: integer('retry_attempt').default(0),
  period_id: text('period_id'),
  reconciled: boolean('reconciled').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const ledger_periods = pgTable('ledger_periods', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  label: text('label').notNull(), // 2026-06
  attempted_cents: integer('attempted_cents').notNull().default(0),
  recovered_cents: integer('recovered_cents').notNull().default(0),
  lost_cents: integer('lost_cents').notNull().default(0),
  written_off_cents: integer('written_off_cents').notNull().default(0),
  closed: boolean('closed').notNull().default(false),
  closed_at: timestamp('closed_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.label)])

// ── Card-updater coverage ────────────────────────────────────────────────────
export const card_updater_status = pgTable('card_updater_status', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  subscription_account_id: text('subscription_account_id').notNull().references(() => subscription_accounts.id),
  coverage: text('coverage').notNull().default('unknown'), // covered|not_covered|unknown
  expires_at: timestamp('expires_at'),
  at_risk_mrr_cents: integer('at_risk_mrr_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.subscription_account_id)])

// ── Dunning sequences ────────────────────────────────────────────────────────
export const dunning_sequences = pgTable('dunning_sequences', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  channel: text('channel').notNull().default('email'), // email|sms|mixed
  assigned_codes: jsonb('assigned_codes').$type<string[]>().default([]),
  is_active: boolean('is_active').notNull().default(true),
  metrics: jsonb('metrics').$type<Record<string, number>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const dunning_steps = pgTable('dunning_steps', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  sequence_id: text('sequence_id').notNull().references(() => dunning_sequences.id),
  step_order: integer('step_order').notNull().default(0),
  delay_hours: integer('delay_hours').notNull().default(24),
  channel: text('channel').notNull().default('email'),
  subject: text('subject').default(''),
  body: text('body').notNull().default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Self-serve portal ────────────────────────────────────────────────────────
export const portal_configs = pgTable('portal_configs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  brand_name: text('brand_name').notNull().default(''),
  primary_color: text('primary_color').notNull().default('#2563eb'),
  headline: text('headline').notNull().default(''),
  body_copy: text('body_copy').notNull().default(''),
  fields: jsonb('fields').$type<string[]>().default([]),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const portal_sessions = pgTable('portal_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  subscription_account_id: text('subscription_account_id').references(() => subscription_accounts.id),
  token: text('token').notNull().unique(),
  status: text('status').notNull().default('created'), // created|visited|completed
  visited_at: timestamp('visited_at'),
  completed_at: timestamp('completed_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Cohorts ──────────────────────────────────────────────────────────────────
export const cohorts = pgTable('cohorts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  dimension: text('dimension').notNull().default('plan'), // plan|geography|card_brand|decline_reason|retry_attempt
  filters: jsonb('filters').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Grace policies ───────────────────────────────────────────────────────────
export const grace_policies = pgTable('grace_policies', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  plan_name: text('plan_name'),
  grace_days: integer('grace_days').notNull().default(7),
  soft_suspend_after_days: integer('soft_suspend_after_days').notNull().default(14),
  version: integer('version').notNull().default(1),
  projected_impact_cents: integer('projected_impact_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Playbooks ────────────────────────────────────────────────────────────────
export const playbooks = pgTable('playbooks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  vertical: text('vertical').notNull().default('saas'), // saas|dtc
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  is_template: boolean('is_template').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Alerts + watchlist ───────────────────────────────────────────────────────
export const alert_rules = pgTable('alert_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  metric: text('metric').notNull(), // recovery_rate_drop|at_risk_mrr_spike|decline_code_surge
  threshold: real('threshold').notNull().default(0),
  is_active: boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  rule_id: text('rule_id').references(() => alert_rules.id),
  message: text('message').notNull(),
  severity: text('severity').notNull().default('info'), // info|warning|critical
  acknowledged: boolean('acknowledged').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const watchlist_items = pgTable('watchlist_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  subscription_account_id: text('subscription_account_id').notNull().references(() => subscription_accounts.id),
  note: text('note').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.subscription_account_id)])

// ── Forecast ─────────────────────────────────────────────────────────────────
export const forecasts = pgTable('forecasts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  period_label: text('period_label').notNull(),
  projected_recovered_cents: integer('projected_recovered_cents').notNull().default(0),
  low_cents: integer('low_cents').notNull().default(0),
  high_cents: integer('high_cents').notNull().default(0),
  actual_recovered_cents: integer('actual_recovered_cents'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Imports ──────────────────────────────────────────────────────────────────
export const import_jobs = pgTable('import_jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  source: text('source').notNull().default('csv'), // csv|stripe|recurly|chargebee|seeder
  entity: text('entity').notNull(), // subscriptions|failed_charges
  status: text('status').notNull().default('completed'), // pending|completed|failed
  rows_total: integer('rows_total').notNull().default(0),
  rows_valid: integer('rows_valid').notNull().default(0),
  rows_invalid: integer('rows_invalid').notNull().default(0),
  errors: jsonb('errors').$type<Array<{ row: number; message: string }>>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Activity log ─────────────────────────────────────────────────────────────
export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id'),
  action: text('action').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Notifications ────────────────────────────────────────────────────────────
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  kind: text('kind').notNull().default('info'),
  read: boolean('read').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ── Billing (Stripe-optional; matches webhook-inspector billing.ts) ───────────
export const plans = pgTable('plans', {
  id: text('id').primaryKey(), // 'free' | 'pro'
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free'),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
