# Token Arena — multiplayer internal-token gaming platform (foundation)

A complete, production-structured platform around future games: players, permanent player numbers,
internal token wallets backed by an immutable double-entry ledger, match escrow with a 1% platform
fee, manual bKash buy/sell requests with admin verification and private realtime chat, disputes,
risk flags, RBAC admin panel, audit logs — and 10 configurable game slots ready for your games.

> **Games:** Ludo · Call Bridge · Twenty-Nine (29) · Aviator · Carrom · Chess.

> **No login or registration screens.** Built to be merged into a host project that signs users in; profiles are created on first sign-in. See [docs/INTEGRATION.md](docs/INTEGRATION.md).

> **Tokens are internal database records only.** No cryptocurrency, Web3, wallets, blockchain or smart contracts.

| Layer | Technology |
|---|---|
| Web app | React 19 · TypeScript · Vite · Tailwind CSS v4 · React Router |
| API | Cloudflare Workers · Hono · TypeScript · Zod |
| Database | Cloudflare D1 (SQLite) — migrations in `migrations/` |
| Realtime | Durable Objects + WebSockets (hibernation API) |
| Auth | Firebase Authentication (email/password; Google optional) — **verified server-side on every request** |

```
platform/
├─ apps/
│  ├─ api/          Cloudflare Worker: REST API, Durable Objects, cron
│  └─ web/          React player app + admin panel
├─ packages/shared/ types, Zod schemas, token math, fees, enums, API contracts, GameModule interface
├─ packages/games/  server-side game rules, one folder per game (ludo, call-bridge, twenty-nine, carrom, chess, aviator)
├─ migrations/      D1 schema + reference data (roles, system wallets, 10 game slots, settings)
├─ scripts/         dev seed, Super Admin bootstrap
├─ tests/           unit + integration tests (Vitest)
└─ docs/            architecture, database, ledger, security, deployment, adding games …
```

---

## 1. Prerequisites

| Need | Why | Check |
|---|---|---|
| **Node.js 22.13 or newer** (LTS 22 or 24) | build tools, tests (uses Node's built-in SQLite) | `node -v` |
| **npm 10+** (comes with Node) | workspaces | `npm -v` |
| **Git** | version control | `git --version` |
| A **Firebase** account (free) | sign-in — **EXTERNAL SETUP REQUIRED** | console.firebase.google.com |
| A **Cloudflare** account (free) | only for deploying — local development runs without it | dash.cloudflare.com |

Install Node from <https://nodejs.org> (choose "LTS"). Restart your terminal afterwards.

All commands below are run from the `token-arena` folder unless stated otherwise.

## 2. Install dependencies

```bash
cd token-arena
```
```bash
npm install
```

## 3. Create the Firebase project (EXTERNAL SETUP REQUIRED)

1. Open <https://console.firebase.google.com> → **Add project** → name it (e.g. `token-arena`) → you can disable Google Analytics → **Create**.
2. Left menu → **Build → Authentication → Get started**.
3. **Sign-in method** tab → enable the providers your **host project** uses to sign people in.
   This platform has no login or registration screens of its own — see [docs/INTEGRATION.md](docs/INTEGRATION.md).
   If the host app already has a Firebase project, use that one and skip steps 1–3.
4. **Settings** (gear icon) → **Project settings** → **General** → *Your apps* → click the **`</>` (Web)** icon → nickname `web` → **Register app**.
5. Copy the values `apiKey`, `authDomain`, `projectId` from the shown `firebaseConfig`.
6. Authentication → **Settings → Authorized domains**: `localhost` is already there. Add your production domain later.

Create your local environment file and paste the three values:

```bash
cp .env.example .env
```
(Windows Command Prompt: `copy .env.example .env`)

```ini
FIREBASE_API_KEY=AIza...
FIREBASE_AUTH_DOMAIN=token-arena.firebaseapp.com
FIREBASE_PROJECT_ID=token-arena
```

Then put the **same project id** into `apps/api/wrangler.jsonc` → `vars.FIREBASE_PROJECT_ID` (and `FIREBASE_AUTH_DOMAIN`).
The Worker uses it to verify every Firebase ID token (issuer, audience, signature against Google's public keys).

> Firestore and Cloud Functions are **not** used. Firebase only signs people in (in the host project).
>
> **No Firebase yet?** For local development set `VITE_DEV_AUTH=true` in `.env` and `DEV_AUTH=true` in `apps/api/.dev.vars`: the app then lets each browser tab act as a test player (development only, never in production).

## 4. Local secrets for the Worker

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```
Generate two random values and paste them into `apps/api/.dev.vars`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 5. Create the local database and run migrations

Local development uses a local D1 database on your computer — no Cloudflare login needed.

```bash
npm run db:migrate:local
```

Optional sample data (1 sample Super Admin, 5 players, sample ledger, buy/sell requests, a settled match):

```bash
npm run db:seed:local
```

## 6. Run locally

```bash
npm run dev
```

* Web app: <http://localhost:5173> (Vite, proxies `/api` to the Worker)
* API: <http://localhost:8787/api/health>

Sign in through the host project (or, locally, type a test player name in the development identity box). The first visit creates your player profile automatically with the next permanent player number (first account: **#100001** on an empty database).

## 7. Make yourself Super Admin

Sign in once (step 6), then:

```bash
npm run admin:create -- --email you@example.com
```

Reload the app — an **Admin panel** link appears. (Seed accounts can't sign in; they exist only as sample data.)

Then, in **Admin → Finance → Admin treasury**, issue some treasury tokens, and use **Token distribution** to give test players tokens.
To test matches before games exist: **Admin → Game registry → Edit game-01 → Enabled** (allowed without a module outside production), then use **Admin → Dev simulator** to create a match between two player numbers and settle it as win / forfeit / draw / void / cancel.

## 8. Tests, lint, type checks, build

```bash
npm test
```
```bash
npm run lint
```
```bash
npm run typecheck
```
```bash
npm run build
```
Or everything at once:
```bash
npm run check
```

## 9. Cloudflare setup & deployment (EXTERNAL SETUP REQUIRED)

```bash
cd apps/api
```
```bash
npx wrangler login
```
Create the production database and copy the printed `database_id` into `wrangler.jsonc` → `env.production.d1_databases[0].database_id`:
```bash
npx wrangler d1 create token-arena-prod
```
(Optional, for a shared remote dev database: `npx wrangler d1 create token-arena-dev` → top-level `d1_databases[0].database_id`.)

Edit `env.production.vars` in `wrangler.jsonc`: `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_DOMAIN`, `ALLOWED_ORIGINS` (your site, e.g. `https://play.example.com`).

Set production secrets (you will be prompted to paste a random value each time):
```bash
npx wrangler secret put REALTIME_TICKET_SECRET --env production
```
```bash
npx wrangler secret put INTERNAL_API_SECRET --env production
```

Apply migrations to production and deploy (from the `platform` folder):
```bash
cd ../..
```
```bash
npm run db:migrate:remote
```
```bash
npm run deploy
```

`npm run deploy` builds the web app and deploys **one Worker** that serves both the API (`/api/*`) and the web app (static assets) — so the frontend is deployed together with the Worker. Durable Objects (SQLite-backed, Free-plan compatible) and the 10-minute cron are created automatically.

Finally: add a custom domain to the Worker (Cloudflare dashboard → Workers → token-arena → Settings → Domains & Routes), add that domain to Firebase **Authorized domains**, sign in, and run
```bash
npm run admin:create -- --email you@example.com --remote
```
(In production the admin panel also requires a **verified email** — use “Resend verification email” on the Profile page.)

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for separate frontend hosting, production checklist and rollbacks.

## 10. Games

Installed and enabled: **Ludo, Call Bridge, Twenty-Nine (29), Aviator, Carrom, Chess** — rules in [docs/GAMES.md](docs/GAMES.md).
Slots 7–10 are free for new games.

* Server rules: `packages/games/src/<game>/` (rules.ts + module.ts) · browser UI: `apps/web/src/games/<game>/`
* **Aviator needs a funded house bankroll**: Admin → Finance → Admin treasury → issue tokens, then Admin → Finance → House bankroll → *Treasury → bankroll*. Until then every Aviator bet is refused.
* Add a game: [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md) · contracts: [docs/GAME_INTEGRATION.md](docs/GAME_INTEGRATION.md). Wallet, escrow and settlement code never changes.

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| Web app shows **“External setup required”** | `.env` missing or incomplete in `platform/`. Restart `npm run dev` after editing. |
| Sign-in works but every API call says **“Your session is invalid”** | `FIREBASE_PROJECT_ID` in `apps/api/wrangler.jsonc` differs from the web app's project. |
| `PROFILE_REQUIRED` / stuck on “Choose your player name” | Expected for new accounts — pick a username. |
| `no such table` errors | Run `npm run db:migrate:local` (or `:remote` for production). |
| Seed says it failed | It already ran. Reset local data: delete `apps/api/.wrangler/state`, then migrate and seed again. |
| `TREASURY_INSUFFICIENT` when approving a purchase | Issue tokens: Admin → Finance → Admin treasury → Issue. |
| `UNSAFE_CONFIGURATION` when saving settings | In production the sell rate must be greater than the buy rate. |
| Admin panel says **verify your email** | Production requires a verified email for admins (Profile → resend verification). |
| Realtime updates don't arrive | Check `REALTIME_TICKET_SECRET` is set (production) and the page is served over https (wss). Pages still work with manual refresh. |
| Port 5173 or 8787 in use | Stop the other process, or run `npm run dev:api` / `npm run dev:web` separately with a different port. |
| `wrangler` asks to log in during local dev | Not needed for `--local`; only for `--remote` and `deploy`. Run `npx wrangler login` in `apps/api`. |

## Documentation

[Merging / sign-in](docs/INTEGRATION.md) · [Games](docs/GAMES.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Database](docs/DATABASE.md) · [Wallet & ledger](docs/WALLET_LEDGER.md) ·
[Game integration](docs/GAME_INTEGRATION.md) · [Adding a game](docs/ADDING_A_GAME.md) · [Admin panel](docs/ADMIN_PANEL.md) ·
[Payment request flow](docs/PAYMENT_REQUEST_FLOW.md) · [Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md) ·
[Testing](docs/TESTING.md) · [Recovery](docs/RECOVERY.md)
