import { db } from './index.js'
import { sql } from 'drizzle-orm'

// Idempotent self-provisioning DDL. Column names/types match schema.ts exactly.
// timestamps -> timestamptz, jsonb -> jsonb, real -> real, integer -> integer.
const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    name text NOT NULL DEFAULT 'My Workspace',
    currency text NOT NULL DEFAULT 'USD',
    fiscal_period_start integer NOT NULL DEFAULT 1,
    default_geography text NOT NULL DEFAULT 'US',
    notification_prefs jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS subscription_accounts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    external_id text,
    customer_name text NOT NULL,
    customer_email text,
    plan_name text NOT NULL,
    mrr_cents integer NOT NULL DEFAULT 0,
    card_brand text,
    card_last4 text,
    card_exp_month integer,
    card_exp_year integer,
    geography text NOT NULL DEFAULT 'US',
    status text NOT NULL DEFAULT 'active',
    updater_coverage text NOT NULL DEFAULT 'unknown',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS decline_codes (
    id text PRIMARY KEY,
    code text NOT NULL UNIQUE,
    network_codes jsonb DEFAULT '[]'::jsonb,
    label text NOT NULL,
    decline_class text NOT NULL,
    category text NOT NULL,
    recoverable boolean NOT NULL DEFAULT true,
    default_tactic text NOT NULL DEFAULT 'delayed_retry',
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS decline_code_overrides (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    code text NOT NULL,
    decline_class text,
    recoverable boolean,
    default_tactic text,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, code)
  )`,

  `CREATE TABLE IF NOT EXISTS tactics (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    config jsonb DEFAULT '{}'::jsonb,
    measured_recovery_rate real DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, key)
  )`,

  `CREATE TABLE IF NOT EXISTS failed_charges (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    subscription_account_id text REFERENCES subscription_accounts(id),
    external_id text,
    amount_cents integer NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    raw_decline_code text,
    decline_code text NOT NULL,
    card_brand text,
    plan_name text,
    geography text NOT NULL DEFAULT 'US',
    retry_count integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'failed',
    assigned_tactic text,
    failed_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS routing_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    priority integer NOT NULL DEFAULT 0,
    conditions jsonb DEFAULT '[]'::jsonb,
    target_tactic text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS routing_decisions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    failed_charge_id text NOT NULL REFERENCES failed_charges(id),
    rule_id text REFERENCES routing_rules(id),
    chosen_tactic text NOT NULL,
    reason text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS retry_schedules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    offsets jsonb DEFAULT '[]'::jsonb,
    payday_aligned boolean NOT NULL DEFAULT false,
    issuer_pattern boolean NOT NULL DEFAULT false,
    per_code_overrides jsonb DEFAULT '{}'::jsonb,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS retry_simulations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    schedule_id text REFERENCES retry_schedules(id),
    name text NOT NULL,
    projected_recovered_cents integer NOT NULL DEFAULT 0,
    projected_recovery_rate real DEFAULT 0,
    curve jsonb DEFAULT '[]'::jsonb,
    results jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS recovery_ledger_entries (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    failed_charge_id text REFERENCES failed_charges(id),
    entry_type text NOT NULL,
    amount_cents integer NOT NULL,
    tactic text,
    retry_attempt integer DEFAULT 0,
    period_id text,
    reconciled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS ledger_periods (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    label text NOT NULL,
    attempted_cents integer NOT NULL DEFAULT 0,
    recovered_cents integer NOT NULL DEFAULT 0,
    lost_cents integer NOT NULL DEFAULT 0,
    written_off_cents integer NOT NULL DEFAULT 0,
    closed boolean NOT NULL DEFAULT false,
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, label)
  )`,

  `CREATE TABLE IF NOT EXISTS card_updater_status (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    subscription_account_id text NOT NULL REFERENCES subscription_accounts(id),
    coverage text NOT NULL DEFAULT 'unknown',
    expires_at timestamptz,
    at_risk_mrr_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, subscription_account_id)
  )`,

  `CREATE TABLE IF NOT EXISTS dunning_sequences (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    channel text NOT NULL DEFAULT 'email',
    assigned_codes jsonb DEFAULT '[]'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    metrics jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS dunning_steps (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    sequence_id text NOT NULL REFERENCES dunning_sequences(id),
    step_order integer NOT NULL DEFAULT 0,
    delay_hours integer NOT NULL DEFAULT 24,
    channel text NOT NULL DEFAULT 'email',
    subject text DEFAULT '',
    body text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS portal_configs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    brand_name text NOT NULL DEFAULT '',
    primary_color text NOT NULL DEFAULT '#2563eb',
    headline text NOT NULL DEFAULT '',
    body_copy text NOT NULL DEFAULT '',
    fields jsonb DEFAULT '[]'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS portal_sessions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    subscription_account_id text REFERENCES subscription_accounts(id),
    token text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'created',
    visited_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS cohorts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    dimension text NOT NULL DEFAULT 'plan',
    filters jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS grace_policies (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    plan_name text,
    grace_days integer NOT NULL DEFAULT 7,
    soft_suspend_after_days integer NOT NULL DEFAULT 14,
    version integer NOT NULL DEFAULT 1,
    projected_impact_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS playbooks (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    vertical text NOT NULL DEFAULT 'saas',
    config jsonb DEFAULT '{}'::jsonb,
    is_template boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS alert_rules (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    metric text NOT NULL,
    threshold real NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS alerts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    rule_id text REFERENCES alert_rules(id),
    message text NOT NULL,
    severity text NOT NULL DEFAULT 'info',
    acknowledged boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS watchlist_items (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    subscription_account_id text NOT NULL REFERENCES subscription_accounts(id),
    note text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, subscription_account_id)
  )`,

  `CREATE TABLE IF NOT EXISTS forecasts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    period_label text NOT NULL,
    projected_recovered_cents integer NOT NULL DEFAULT 0,
    low_cents integer NOT NULL DEFAULT 0,
    high_cents integer NOT NULL DEFAULT 0,
    actual_recovered_cents integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS import_jobs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    source text NOT NULL DEFAULT 'csv',
    entity text NOT NULL,
    status text NOT NULL DEFAULT 'completed',
    rows_total integer NOT NULL DEFAULT 0,
    rows_valid integer NOT NULL DEFAULT 0,
    rows_invalid integer NOT NULL DEFAULT 0,
    errors jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    action text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    workspace_id text REFERENCES workspaces(id),
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    kind text NOT NULL DEFAULT 'info',
    read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free',
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Indexes on FKs / workspace_id / common filters
  `CREATE INDEX IF NOT EXISTS idx_sub_accounts_workspace ON subscription_accounts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sub_accounts_user ON subscription_accounts(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_decline_overrides_workspace ON decline_code_overrides(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tactics_workspace ON tactics(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_failed_charges_workspace ON failed_charges(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_failed_charges_status ON failed_charges(status)`,
  `CREATE INDEX IF NOT EXISTS idx_failed_charges_sub ON failed_charges(subscription_account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_routing_rules_workspace ON routing_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_routing_decisions_workspace ON routing_decisions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_routing_decisions_charge ON routing_decisions(failed_charge_id)`,
  `CREATE INDEX IF NOT EXISTS idx_retry_schedules_workspace ON retry_schedules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_retry_sims_workspace ON retry_simulations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_entries_workspace ON recovery_ledger_entries(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_entries_charge ON recovery_ledger_entries(failed_charge_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_periods_workspace ON ledger_periods(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_card_updater_workspace ON card_updater_status(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dunning_seq_workspace ON dunning_sequences(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dunning_steps_seq ON dunning_steps(sequence_id)`,
  `CREATE INDEX IF NOT EXISTS idx_portal_configs_workspace ON portal_configs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_portal_sessions_workspace ON portal_sessions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cohorts_workspace ON cohorts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_grace_policies_workspace ON grace_policies(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_playbooks_workspace ON playbooks(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_rules_workspace ON alert_rules(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_workspace ON alerts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_watchlist_workspace ON watchlist_items(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_forecasts_workspace ON forecasts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_import_jobs_workspace ON import_jobs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_workspace ON activity_log(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log(`Migrated ${statements.length} statements`)
}
