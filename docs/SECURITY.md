# Security

## Trust model

The browser is untrusted. The server never accepts from it: player number, user id, wallet balance, stake split, exchange rate, fee, winner, or admin role. All of these are read from D1 after verifying the Firebase ID token.

## Controls

| Area | Implementation |
|---|---|
| Authentication | Firebase ID token on every request; `jose` verifies RS256 signature against Google JWKS, issuer `https://securetoken.google.com/<project>`, audience, expiry, `auth_time`, non-empty `sub` (`apps/api/src/auth/verifier.ts`). `alg:none`/forged tokens rejected (tested). No login/registration UI: sign-in belongs to the host project ([INTEGRATION.md](INTEGRATION.md)); profiles are created on the first verified session. Development `dev.<name>` tokens are accepted only with `ENVIRONMENT=development` and `DEV_AUTH=true` (tested to be refused in production). |
| Authorisation | RBAC from `admin_users`/`admin_permissions` per request; per-route permission middleware; admin needs ACTIVE account and (production) verified email; denials logged. |
| Account status | RESTRICTED/SUSPENDED/BANNED block matches, buys, sells; BANNED blocks everything except reading own profile. |
| Input validation | Zod schemas (`packages/shared/src/schemas.ts`) on every body/query; payment numbers and references normalised by provider. |
| SQL | Prepared statements with bound parameters only. |
| Money correctness | single ledger writer, CHECK constraints, unique idempotency keys, state assertions in the same transaction, immutable ledger/audit/messages via triggers, integrity checker. |
| Idempotency / duplicates | `Idempotency-Key` header + deterministic operation keys; concurrent duplicates tested. |
| Rate limiting | D1 fixed windows for login-sensitive actions, buy/sell creation, chat, match create/join, admin finance actions, tickets; HTTP 429 + `Retry-After`; configurable via `RATE_LIMIT_OVERRIDES`. |
| CSRF | API uses bearer tokens in the `Authorization` header (no cookies) → classic CSRF does not apply. |
| CORS | strict allow-list `ALLOWED_ORIGINS`; no credentials. |
| Headers | API: CSP `default-src 'none'`, HSTS, nosniff, frame-ancestors none, no-referrer, `Cache-Control: no-store`. Web: CSP with script hash, frame/permissions policy (`apps/web/public/_headers`). |
| Errors | consistent envelope with request id; no stack traces/details in production; structured logs. |
| Realtime | channel authorisation at ticket issue; HMAC tickets valid 60 s; DO only trusts headers set by the Worker. |
| Internal API | HMAC-SHA256 over timestamp+method+path+body, 5-min skew; disabled without secret. |
| Dev tools | `/api/dev/*` returns 404 when `ENVIRONMENT=production` (tested) and requires `dev.simulator`. |
| Privacy | emails never exposed to other players; payment numbers masked unless permitted; IPs/fraud data admin-only; leaderboard shows only number/username/stats. |
| Fraud | signals (duplicate reference, shared sender/receiving numbers, velocity, large/new-account sales, same-IP opponents) create flags + admin notifications; never auto-ban. |
| Audit | append-only `audit_logs` with admin, action, entity, before/after, reason, IP, UA, timestamp, request id — written in the same transaction as the action. |
| Secrets | none committed; `.env`, `.dev.vars` git-ignored; production via `wrangler secret put`. |

## Security checklist (before going live)

- [ ] `ENVIRONMENT=production`, `ADMIN_REQUIRE_VERIFIED_EMAIL=true` in `env.production.vars`
- [ ] `ALLOWED_ORIGINS` = only your domain(s)
- [ ] `REALTIME_TICKET_SECRET` and `INTERNAL_API_SECRET` set as secrets (≥ 32 random chars)
- [ ] `DEV_AUTH` is not set in production (it is ignored there anyway)
- [ ] Firebase: only needed sign-in providers enabled; authorized domains = your domains; consider email enumeration protection
- [ ] at least two Super Admins with verified emails and strong passwords; least-privilege roles for staff
- [ ] `SELL_TOKENS_PER_BDT > BUY_TOKENS_PER_BDT`; `bkash_receiving_number` set; payment notice reviewed
- [ ] run Ledger integrity → PASS; review Audit logs regularly
- [ ] Cloudflare account: 2FA on, API tokens scoped, D1 Time Travel known (see RECOVERY.md)
- [ ] legal review of real-money skill gaming and manual payments in your jurisdiction; use the feature flags to disable payments where required

## Repository scan

`tests/unit/invariants.test.ts` fails the build if source code contains `TODO`, `FIXME`, `mockBalance`, `fakeApprove`, or if anything other than the ledger service writes balances, or anything other than the settlement service resolves escrow.
