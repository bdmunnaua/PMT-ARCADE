# Admin panel

URL: `/admin` (same app, separate layout). Every action is authorised **server-side** from the database on each request; hidden buttons are convenience only.

## Roles

| Role | Can |
|---|---|
| **SUPER_ADMIN** | everything, incl. treasury issuance, adjustments, settings, administrators, dev simulator |
| **FINANCE_ADMIN** | buy/sell queues, approve/reject, confirm payments, finance chat, token distribution, ledger, integrity check, risk view |
| **GAME_ADMIN** | game registry, matches (void), disputes, dev simulator |
| **SUPPORT_ADMIN** | view players, requests (numbers masked), matches, disputes; write support notes — **cannot move tokens** |
| **RISK_ADMIN** | restrict/suspend/ban, fraud flags, login activity, audit logs, ledger view |

The matrix is in `packages/shared/src/permissions.ts` and seeded into `admin_roles`/`admin_permissions` (a test keeps them identical). In production, admins must have a **verified email**. Denied admin attempts are logged to Login activity.

## Navigation

* **Dashboard** — queues needing action, treasury/fee balances, 24 h volumes, live matches, open flags.
* **Players** — all / active / restricted / suspended / flagged; search by `#number`, username, email. Detail: account, wallet, stats, flags, append-only notes, recent transactions, buy/sell requests, matches; actions restrict / suspend / unsuspend / ban (reason required, audited, player notified).
* **Games** — registry (edit name/description/thumbnail/module/limits/enabled/maintenance; reason required), live matches, history, match detail (escrow, settlement entries, authoritative events, void & refund), disputes.
* **Finance** — overview, buy requests, sell requests, ledger, ledger integrity, admin treasury (issue), platform fee wallet, token distribution.
* **Security** — fraud flags (dismiss / reviewed / confirm, never auto-ban), login activity, audit logs (before/after, IP, user agent, request id).
* **Notifications**, **Administrators** (grant/change/deactivate; cannot edit yourself; last Super Admin protected), **Settings**, **Dev simulator** (non-production only).

## High-risk confirmations (modal dialogs, never `window.confirm`)

| Action | Dialog text (example) |
|---|---|
| Approve purchase | “Credit 11,000 TOKEN to Player #100284? Only continue if you confirmed ৳100 arrived with reference …” |
| Approve sale | “Approve redemption of 12,000 TOKEN for ৳100?” |
| Confirm payment | “Confirm that ৳100 was sent to the player’s registered payment destination 01……?” |
| Reject / suspend / ban / void / settings / role changes | require a typed reason stored in the audit log |

Request and transaction ids are shown with copy buttons on every detail page.

## Settings (`platform_settings`)

`platform_name`, `maintenance_mode`, `MATCH_FEE_BPS` (100 = 1%), `BUY_TOKENS_PER_BDT` (110), `SELL_TOKENS_PER_BDT` (120),
`minimum/maximum_buy_bdt`, `minimum/maximum_sell_tokens`, `minimum/maximum_match_stake`, `buy_requests_enabled`,
`sell_requests_enabled`, `games_enabled`, `enabled_payment_methods`, `bkash_receiving_number`, `payment_provider_notice`,
`large_transaction_tokens`. Every change is validated (Zod + cross-field rules), audited (with dedicated
`settings.exchange_rate_change` / `settings.match_fee_change` entries) and never affects existing requests or matches (snapshots).
