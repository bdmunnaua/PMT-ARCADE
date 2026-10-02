# Going live on pmtarcade.com (merging the old arcade)

The merged platform replaces the old arcade Worker **`pmt-arcade`** in place (same name, same
routes). The old database `arcade` is not touched and stays as a backup.
Run everything from the `token-arena` folder. Steps marked **(owner)** need you.

## 0. Before
- A fresh backup of the old database, taken just before going live (the earlier one is
  `D:\my games\backups\arcade-live-20261002-0136.sql`):
  ```bash
  cd ../pmtarcade/worker
  npx wrangler d1 export arcade --remote --output ../../backups/arcade-final.sql
  ```
- **(owner)** Firebase console → Authentication → Settings → Authorized domains contains
  `pmtarcade.com` and `www.pmtarcade.com`, and the Google + Email/Password providers are enabled.

## 1. New database and secrets
```bash
cd apps/api
npx wrangler d1 create pmt-platform
```
Paste the printed `database_id` into `wrangler.jsonc` → `env.production.d1_databases[0].database_id`.
```bash
npx wrangler secret put REALTIME_TICKET_SECRET --env production
npx wrangler secret put INTERNAL_API_SECRET --env production
```
(two different random values: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

## 2. Database tables, then the build
```bash
npm run db:migrate:remote
npm run build
```

## 3. Switch pmtarcade.com to the new platform
```bash
npm run deploy
```
Undo at any time: `npx wrangler rollback --env production` (in `apps/api`) brings the old arcade back.

## 4. First admin, PMT supply, rewards pool, old balances
1. **(owner)** Sign in at https://pmtarcade.com with the account that should be the first admin.
2. `npm run admin:create -- --email you@example.com --remote`
3. Admin → Finance → Admin treasury: issue the PMT you plan to use (e.g. the 20% sale + 10% rewards).
4. Admin → Finance → Rewards pool: move the rewards budget in (at least what old players are owed).
5. Carry over old balances (credited as bonus PMT when each player first signs in):
   ```bash
   npm run arcade:import -- --file ../backups/arcade-final.sql --remote
   ```

## 5. Settings to review (Admin → Settings)
| Setting | Launch value |
|---|---|
| Games enabled (stake games) | **off** until the legal check |
| Buy / Sell requests enabled | **off** until the legal check; then set `bkash_receiving_number` |
| Aviator (Game registry) | off — the only game where the house can lose |
| Free-game rewards | on |
| Crypto withdrawals / deposits | off until the payout wallet is ready |
| Reserve guard | **on** |

## 6. Payout wallet (when you open crypto withdrawals)
1. Create a NEW wallet used only for payouts. Never the main supply wallet (0xe328…7FB4).
2. Put in a little BNB for gas and only the PMT you plan to pay out soon.
3. `npx wrangler secret put PAYOUT_PRIVATE_KEY --env production` (in `apps/api`), then turn
   “Crypto withdrawals open” on.

## 7. Afterwards
- Admin → Finance → Ledger integrity: run it — it must say PASS.
- This repository replaced the old PMT-ARCADE code (still in the git history). Deploys are run
  by hand with `npx wrangler deploy --env production`; GitHub only runs the tests.
