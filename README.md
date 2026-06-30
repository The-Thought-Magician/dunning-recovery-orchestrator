# DunningRecoveryOrchestrator

Turn failed recurring-payment retries into recovered cash by modeling decline reasons, retry timing, and card-updater gaps.

DunningRecoveryOrchestrator is a recovered-revenue intelligence platform for subscription businesses. It ingests (or generates) the stream of failed recurring charges, classifies each failure by its decline code, routes it to the recovery tactic that statistically works for that code, simulates smart retry schedules against historical recovery curves, builds the dunning email/SMS sequences that win customers back, and reconciles every attempted-vs-recovered-vs-lost dollar in an auditable recovered-revenue ledger.

The platform never touches a card and never processes a payment. It is a deterministic decision and analytics layer that sits beside a billing processor (Stripe, Recurly, Chargebee, Braintree, Adyen) and tells RevOps and subscription-finance leaders exactly how much involuntary churn is recoverable, which tactic to apply to each failure, and how much MRR was actually saved.

Everything works on uploaded CSVs, connected-processor-style data, or a built-in sample-data seeder, so the product is demoable from the first sign-in.

See [`docs/idea.md`](docs/idea.md) for the full feature spec, data model, API surface, and page list.

## Features

- Decline-Code Taxonomy Engine — canonical decline-code taxonomy with hard/soft classification, recommended tactic, and per-code recovery rates.
- Failed-Charge Routing — rules engine that routes each failed charge to the tactic that works for its decline code.
- Smart Retry-Schedule Simulator — model retry offsets, payday and issuer windows, and project recovered MRR against history.
- Recovered-Revenue Ledger — double-sided ledger reconciling attempted vs recovered vs lost MRR with monthly period close and CSV export.
- Card-Updater Coverage Gap Report — surface at-risk MRR behind expiring cards.
- Dunning Sequence Builder — multi-step email/SMS sequences with per-decline-code copy variants.
- Self-Serve Card-Update Portal — hosted update-card config with tokenized per-customer links (no card data stored).
- Cohort Recovery-Rate Dashboards, Grace-Period Modeler, Subscriptions Book, Failed-Charge Inbox, Recovery Tactics Library.
- Data Import & Connectors, Sample-Data Seeder, Recovery Playbooks, Alerts & Watchlists, Recovery Forecast, Decline-Reason Insights.
- Reports & Exports, Workspaces & Settings, Activity & Audit Log, Notifications Center.

## Stack

- Backend: Hono on Node (`@hono/node-server`), Drizzle ORM over Neon Postgres (`@neondatabase/serverless`), zod validation. Run with `node --import tsx/esm src/index.ts` (no runtime compile step). Located at `backend/`.
- Frontend: Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4. Located at `web/`.
- Auth: Neon Auth (`@neondatabase/auth`). The Next.js proxy route resolves the session server-side and forwards an `X-User-Id` header to the backend, which trusts it.
- Package manager: pnpm.

## Local Development

Prerequisites: Node 22+, pnpm, and a Postgres database (Neon recommended). Provision the schema out-of-band (the app seeds sample rows but does not create its own tables).

Backend:

```
cd backend
pnpm install
cp .env.example .env   # fill in DATABASE_URL, FRONTEND_URL
pnpm dev               # starts on http://localhost:3001
```

Frontend:

```
cd web
pnpm install
cp .env.example .env.local   # fill in NEON_AUTH_* and NEXT_PUBLIC_API_URL
pnpm dev                     # starts on http://localhost:3000
```

Or bring both up together with Docker:

```
docker-compose up --build
```

## Environment Variables

Backend (`backend/.env`):

- `PORT` — server port (default 3001; Render injects 10000).
- `DATABASE_URL` — Postgres connection string (e.g. `postgres://user:password@host/db?sslmode=require`).
- `FRONTEND_URL` — allowed CORS origin (default `http://localhost:3000`).
- `ADMIN_USER_IDS` — optional comma-separated admin user IDs.
- `STRIPE_SECRET_KEY`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` — optional; billing endpoints return 503 when unset.

Frontend (`web/.env.local`):

- `NEON_AUTH_BASE_URL` — Neon Auth endpoint (server-only).
- `NEON_AUTH_COOKIE_SECRET` — random 32-byte hex cookie secret (server-only).
- `NEXT_PUBLIC_API_URL` — backend base URL, baked into the bundle at build time and read by the proxy route.

## Pricing

All features are free for signed-in users. Stripe billing is optional and degrades to a 503 when unconfigured.

## Deployment

- Backend deploys to Render via `render.yaml` (Node web service, `cd backend && pnpm install` build, `cd backend && node --import tsx/esm src/index.ts` start). Set `DATABASE_URL` and `FRONTEND_URL` as Render env vars.
- Frontend deploys to Vercel with `rootDirectory: web`, framework `nextjs`, Node `22.x`.
