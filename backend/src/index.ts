import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import { plans, decline_codes } from './db/schema.js'

import workspacesRoutes from './routes/workspaces.js'
import subscriptionsBookRoutes from './routes/subscriptions-book.js'
import declineCodesRoutes from './routes/decline-codes.js'
import failedChargesRoutes from './routes/failed-charges.js'
import routingRoutes from './routes/routing.js'
import tacticsRoutes from './routes/tactics.js'
import retrySchedulesRoutes from './routes/retry-schedules.js'
import simulationsRoutes from './routes/simulations.js'
import ledgerRoutes from './routes/ledger.js'
import cardUpdaterRoutes from './routes/card-updater.js'
import dunningRoutes from './routes/dunning.js'
import portalRoutes from './routes/portal.js'
import cohortsRoutes from './routes/cohorts.js'
import gracePoliciesRoutes from './routes/grace-policies.js'
import playbooksRoutes from './routes/playbooks.js'
import alertsRoutes from './routes/alerts.js'
import watchlistRoutes from './routes/watchlist.js'
import forecastRoutes from './routes/forecast.js'
import insightsRoutes from './routes/insights.js'
import importsRoutes from './routes/imports.js'
import seederRoutes from './routes/seeder.js'
import reportsRoutes from './routes/reports.js'
import activityRoutes from './routes/activity.js'
import notificationsRoutes from './routes/notifications.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://dunning-recovery-orchestrator.vercel.app',
]

app.use('*', cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
  credentials: true,
}))

// ── Canonical decline-code taxonomy (workspace-independent) ───────────────────
const seedDeclineCodes = [
  { code: 'insufficient_funds', network_codes: ['51'], label: 'Insufficient Funds', decline_class: 'soft', category: 'funds', recoverable: true, default_tactic: 'delayed_retry', description: 'The card has insufficient funds to complete the purchase.' },
  { code: 'do_not_honor', network_codes: ['05'], label: 'Do Not Honor', decline_class: 'soft', category: 'issuer', recoverable: true, default_tactic: 'delayed_retry', description: 'Generic issuer decline with no specific reason given.' },
  { code: 'expired_card', network_codes: ['54'], label: 'Expired Card', decline_class: 'soft', category: 'issuer', recoverable: true, default_tactic: 'card_updater', description: 'The card has expired.' },
  { code: 'lost_card', network_codes: ['41'], label: 'Lost Card', decline_class: 'hard', category: 'fraud', recoverable: false, default_tactic: 'dunning', description: 'The card was reported lost.' },
  { code: 'stolen_card', network_codes: ['43'], label: 'Stolen Card', decline_class: 'hard', category: 'fraud', recoverable: false, default_tactic: 'dunning', description: 'The card was reported stolen.' },
  { code: 'pickup_card', network_codes: ['04'], label: 'Pick Up Card', decline_class: 'hard', category: 'fraud', recoverable: false, default_tactic: 'dunning', description: 'The issuer requested the card be retained.' },
  { code: 'card_velocity_exceeded', network_codes: ['65'], label: 'Card Velocity Exceeded', decline_class: 'soft', category: 'issuer', recoverable: true, default_tactic: 'delayed_retry', description: 'The card has exceeded its allowed transaction frequency.' },
  { code: 'transaction_not_allowed', network_codes: ['57'], label: 'Transaction Not Allowed', decline_class: 'soft', category: 'issuer', recoverable: true, default_tactic: 'dunning', description: 'The issuer does not allow this type of transaction on the card.' },
  { code: 'processing_error', network_codes: ['96'], label: 'Processing Error', decline_class: 'soft', category: 'technical', recoverable: true, default_tactic: 'immediate_retry', description: 'A processing error occurred at the network or issuer.' },
  { code: 'try_again_later', network_codes: ['91'], label: 'Try Again Later', decline_class: 'soft', category: 'technical', recoverable: true, default_tactic: 'delayed_retry', description: 'The issuer is temporarily unavailable.' },
  { code: 'fraudulent', network_codes: ['59'], label: 'Suspected Fraud', decline_class: 'hard', category: 'fraud', recoverable: false, default_tactic: 'manual', description: 'The transaction was flagged as fraudulent.' },
  { code: 'incorrect_cvc', network_codes: ['82'], label: 'Incorrect CVC', decline_class: 'soft', category: 'network', recoverable: true, default_tactic: 'dunning', description: 'The CVC number provided is incorrect.' },
]

const seedPlans = [
  { id: 'free', name: 'Free', price_cents: 0 },
  { id: 'pro', name: 'Pro', price_cents: 4900 },
]

async function seedIfEmpty() {
  try {
    const existingPlans = await db.select().from(plans).limit(1)
    if (existingPlans.length === 0) {
      for (const p of seedPlans) {
        await db.insert(plans).values(p as any).onConflictDoNothing()
      }
      console.log('Seeded plans')
    }
    const existingCodes = await db.select().from(decline_codes).limit(1)
    if (existingCodes.length === 0) {
      for (const dc of seedDeclineCodes) {
        await db.insert(decline_codes).values(dc as any).onConflictDoNothing()
      }
      console.log('Seeded decline codes')
    }
  } catch (e) {
    console.error('Seed error:', e)
  }
}

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/subscriptions-book', subscriptionsBookRoutes)
api.route('/decline-codes', declineCodesRoutes)
api.route('/failed-charges', failedChargesRoutes)
api.route('/routing', routingRoutes)
api.route('/tactics', tacticsRoutes)
api.route('/retry-schedules', retrySchedulesRoutes)
api.route('/simulations', simulationsRoutes)
api.route('/ledger', ledgerRoutes)
api.route('/card-updater', cardUpdaterRoutes)
api.route('/dunning', dunningRoutes)
api.route('/portal', portalRoutes)
api.route('/cohorts', cohortsRoutes)
api.route('/grace-policies', gracePoliciesRoutes)
api.route('/playbooks', playbooksRoutes)
api.route('/alerts', alertsRoutes)
api.route('/watchlist', watchlistRoutes)
api.route('/forecast', forecastRoutes)
api.route('/insights', insightsRoutes)
api.route('/imports', importsRoutes)
api.route('/seeder', seederRoutes)
api.route('/reports', reportsRoutes)
api.route('/activity', activityRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check detects a
// live service immediately, THEN run migrate() and seedIfEmpty() (both idempotent).
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migrate error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
