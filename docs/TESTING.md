# Testing

```bash
npm test            # all unit + integration tests (Vitest)
npm run check       # lint + type checks + tests + production build
```

## How the integration tests work

`tests/helpers/d1.ts` is a D1-compatible adapter over Node's built-in SQLite (`node:sqlite`): the **real migrations**, constraints, triggers, partial indexes and **transactional batches** — the same semantics the code relies on in D1. Each test builds a fresh in-memory database.

`tests/helpers/harness.ts` generates an RS256 key pair and signs Firebase-shaped ID tokens; the **production verifier** (`createFirebaseVerifier`) checks them against that key set, so authentication runs the real code path. Requests go through the real Hono app (`app.request`), including middleware, RBAC, rate limiting and validation.

Concurrency: `Promise.all` of identical requests interleaves exactly where Workers requests interleave (between awaits); D1/SQLite serialises each batch.

## Coverage map

| Requirement | Test |
|---|---|
| registration creates profile, wallets; unique sequential player numbers from 100001; immutable | `integration/auth-registration.test.ts` |
| invalid / expired / wrong-audience / forged tokens rejected | `auth-registration` |
| wallet balance calculation, admin grant, treasury issuance, BONUS bucket | `integration/wallet-ledger.test.ts` |
| insufficient balance rejection, no negative balances, immutable ledger | `wallet-ledger` |
| idempotency (sequential + concurrent), key reuse conflict | `wallet-ledger`, `buy-requests`, `matches-settlement` |
| no API can set a balance | `wallet-ledger` |
| stake lock, two-player escrow, 1% fee, winner 1,980 / loser 0, fees only to PLATFORM_FEES | `integration/matches-settlement.test.ts` |
| draw refund, cancel refund, leave refund, void refund, bonus stake refund | `matches-settlement` |
| settlement exactly once (sequential + concurrent) | `matches-settlement` |
| fee snapshot, no public winner endpoint, signed internal API, disputes freeze + admin resolution, compensation once | `matches-settlement` |
| dev simulator works in dev, 404 in production; cron expiry refund | `matches-settlement` |
| purchase credits once (concurrent), duplicate bKash reference rejected + flagged, rate snapshot, treasury insufficient, finance chat immutability/privacy | `integration/buy-requests.test.ts` |
| sell locks, locked tokens unspendable, rejection unlocks, approval ≠ completion, payment confirmation once → treasury, masking | `integration/sell-requests.test.ts` |
| unsafe exchange rates refused in production; settings validated & audited | `integration/admin-rbac.test.ts`, `unit/rules.test.ts` |
| admin permissions per role, player cannot reach admin API, verified-email rule, suspension flow, last super admin, audit append-only, HTTP 429 | `admin-rbac` |
| ledger integrity PASS / FAIL detection without repair | `integration/integrity.test.ts`, `integration/seed.test.ts` |
| token math, fee rounding, exchange, arbitrage safety | `unit/money.test.ts` |
| state machine, payment normalisation, masking, roles | `unit/rules.test.ts` |
| room engine: start, hidden info, validated results, forfeit, disconnect window, VOID policy, hibernation restore | `unit/room-engine.test.ts` |
| single ledger writer, single settlement authority, no TODO/FIXME/fake code | `unit/invariants.test.ts` |

## Manual end-to-end (development)

1. `npm run db:migrate:local && npm run dev`, create two accounts (two browsers), make yourself Super Admin.
2. Admin → Treasury → issue; Token distribution → give both players tokens.
3. Buy: submit a request as a player → approve as admin → balance increases once (try double-clicking).
4. Sell: submit → available drops, pending sell rises → approve → confirm payment → completed.
5. Matches: enable `game-01` (dev) → Dev simulator → create match → settle WIN → winner +1,980, fee wallet +20.
6. Admin → Ledger integrity → PASS.
