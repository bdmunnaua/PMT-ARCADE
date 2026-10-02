# Recovery & incident runbook

## Principles

1. **Never edit balances or ledger rows.** Triggers forbid it; corrections are compensating `ADJUSTMENT` transactions (Admin → Finance, Super Admin, reason required).
2. Find facts first: Audit logs (who/what/when/request id), Ledger (transaction + entries), match events, request timeline, Worker logs (`npx wrangler tail --env production` in `apps/api`).
3. Run **Ledger integrity** before and after any intervention.

## Scenarios

| Situation | What to do |
|---|---|
| Purchase credited but payment never arrived | Do not reverse the ledger row. Post a DEBIT adjustment for the player (if tokens still available), document the reason, restrict the account if fraud is suspected. |
| Player paid but request was rejected by mistake | Ask the player to resubmit (rejected references are reusable) or post a CREDIT adjustment referencing the request. |
| Sell payout sent twice by mistake (outside the platform) | The platform records one payout. Recover the money manually; note it in the request's admin notes and player notes. |
| Match stuck in PLAYING (game server crashed) | Admin → Match → **Void & refund** (stakes returned, no fee). The cron alerts after 6 h. |
| GameRoom state lost | Automatic: the room voids the match and refunds on the next connection. |
| Wrong match result | Player opens a dispute (freezes unsettled matches). If already settled: resolve with **Compensate** (treasury grant) — the original settlement stays in the ledger. |
| Integrity check FAIL | Read each issue. `balance_reconciliation` means a cached balance was changed outside the service (should be impossible) — check audit logs and D1 access; restore from Time Travel if the database was tampered with (below). |
| Treasury too low | Super Admin issues tokens (audited). |
| Exchange rates set wrong | Fix in Settings. Existing requests keep their snapshotted rate by design. |
| Compromised admin account | Another Super Admin deactivates them (Administrators), revoke their Firebase session (Firebase console → Users → disable), review their audit trail. |
| Leaked `REALTIME_TICKET_SECRET` / `INTERNAL_API_SECRET` | `npx wrangler secret put … --env production` with a new value (tickets expire in 60 s anyway). |

## Database point-in-time restore (D1 Time Travel)

D1 keeps a 30-day (paid) / 7-day (free) history. EXTERNAL SETUP: requires Cloudflare access.

```bash
cd apps/api
```
```bash
npx wrangler d1 time-travel info token-arena-prod --env production
```
```bash
npx wrangler d1 time-travel restore token-arena-prod --timestamp=2026-10-01T12:00:00Z --env production
```

Restoring rewinds **all** data (including legitimate later transactions). Prefer compensating transactions; restore only for corruption or tampering, after putting the platform into maintenance mode, and reconcile manual payments made after the restore point.

## Backups

```bash
npx wrangler d1 export token-arena-prod --remote --env production --output backup-2026-10-01.sql
```
Store exports encrypted; they contain personal data (emails, phone numbers).

## Maintenance mode

Admin → Settings → Maintenance mode pauses match creation/joining and buy/sell submissions for players while admins keep working.
