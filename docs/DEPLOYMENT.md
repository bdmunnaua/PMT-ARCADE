# Deployment

## Topology (recommended)

One Cloudflare Worker (`token-arena`) serves the web app's static assets, `/api/*`, `/internal/*`, the two Durable Object classes and the cron trigger. Run every command below from the `pmtarcade.com` folder unless noted. (The live Worker is named `pmt-arcade`; the `token-arena-*` names are the database names and stay as they are.)

## First deployment (EXTERNAL SETUP REQUIRED)

1. Firebase project ready (README §3). Add your production domain under Authentication → Settings → Authorized domains.
2. Cloudflare:
   ```bash
   cd apps/api
   ```
   ```bash
   npx wrangler login
   ```
   ```bash
   npx wrangler d1 create token-arena-prod
   ```
   Paste the `database_id` into `wrangler.jsonc → env.production.d1_databases[0].database_id`.
3. Edit `wrangler.jsonc → env.production.vars`: `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_API_KEY` (optional), `ALLOWED_ORIGINS`.
4. Secrets:
   ```bash
   npx wrangler secret put REALTIME_TICKET_SECRET --env production
   ```
   ```bash
   npx wrangler secret put INTERNAL_API_SECRET --env production
   ```
5. Web build variables: `platform/.env` must contain the production Firebase web config (same project) before building.
6. Migrate and deploy:
   ```bash
   cd ../..
   ```
   ```bash
   npm run db:migrate:remote
   ```
   ```bash
   npm run deploy
   ```
7. Custom domain: Cloudflare dashboard → Workers & Pages → `token-arena` → Settings → Domains & Routes → Add custom domain.
8. Sign in on the live site through the host project once (this creates your profile), then:
   ```bash
   npm run admin:create -- --email you@example.com --remote
   ```
9. Admin → Settings: set `bkash_receiving_number`, review limits/rates. Admin → Finance → Admin treasury: issue the initial supply. Admin → Ledger integrity: PASS.

## Updating

```bash
npm run check
```
```bash
npm run db:migrate:remote
```
```bash
npm run deploy
```
Migrations are forward-only; add new files (`0003_…sql`). Durable Object classes are declared in `wrangler.jsonc → migrations`; add a new tag when adding/renaming DO classes.

## Hosting the frontend separately (optional)

Build with the API origin and deploy `apps/web/dist` to any static host (e.g. Cloudflare Pages):
```bash
VITE_API_BASE_URL=https://api.example.com npm run build
```
```bash
npx wrangler pages deploy apps/web/dist --project-name token-arena-web
```
Then add the Pages origin to `ALLOWED_ORIGINS`, and add the API origin to `connect-src` in `apps/web/public/_headers`.

## Production configuration

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `production` (disables dev simulator, enforces safe exchange rates, hides error details) |
| `ADMIN_REQUIRE_VERIFIED_EMAIL` | `true` |
| `ALLOWED_ORIGINS` | your origin(s) only |
| `RATE_LIMIT_OVERRIDES` | optional JSON |
| secrets | `REALTIME_TICKET_SECRET`, `INTERNAL_API_SECRET` |

## Rollback

* Code: Cloudflare dashboard → Worker → Deployments → roll back, or `npx wrangler rollback --env production` (in `apps/api`).
* Data: see [RECOVERY.md](RECOVERY.md) (D1 Time Travel). Never roll back the database to "undo" a single financial action — post a compensating transaction instead.

## Free-tier notes

Workers Free: 100k requests/day; D1 Free: 5 GB, 5M rows read/day, 100k rows written/day; SQLite-backed Durable Objects are available on the Free plan; one cron trigger is used. The design keeps writes to business events (no per-frame writes, hibernating sockets, indexed paginated reads). Check current limits on Cloudflare's pricing pages before launch and upgrade to Workers Paid for real traffic.
