# REST API

Base path `/api`. JSON in and out. Authenticated endpoints need `Authorization: Bearer <Firebase ID token>`.
Mutations that create money-relevant records accept `Idempotency-Key: <8–100 chars [A-Za-z0-9_:-]>` — the web app sends a fresh key per user action and reuses it on retries.

**Success** `{ "success": true, "data": {...}, "requestId": "…" }`
**Error** `{ "success": false, "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient available token balance.", "details": {...} }, "requestId": "…" }`

Amounts: `…Units` = integer TOKEN units (1 TOKEN = 100), `…Poisha` = integer poisha (৳1 = 100). Timestamps are epoch ms.

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| VALIDATION_ERROR / BAD_REQUEST | 400 | invalid input (`details.issues[]`) |
| UNAUTHENTICATED / INVALID_TOKEN | 401 | missing / invalid / expired Firebase token |
| FORBIDDEN, EMAIL_NOT_VERIFIED | 403 | permission missing; admin needs verified email (prod) |
| ACCOUNT_RESTRICTED / SUSPENDED / BANNED | 403 | account status blocks the action |
| FEATURE_DISABLED | 403 | feature flag off (buy/sell/games/payment method) |
| PROFILE_REQUIRED, NOT_FOUND | 404 | no player profile yet / not found (or not yours) |
| CONFLICT, ALREADY_PROCESSED, INVALID_STATE_TRANSITION, IDEMPOTENCY_CONFLICT, DUPLICATE_PAYMENT_REFERENCE, USERNAME_TAKEN, MATCH_FULL, ALREADY_IN_MATCH, TOO_MANY_ACTIVE_MATCHES, ROUND_CLOSED, CASHOUT_TOO_LATE | 409 | state conflicts |
| INSUFFICIENT_BALANCE, TREASURY_INSUFFICIENT, BANKROLL_LIMIT, AMOUNT_OUT_OF_RANGE, STAKE_OUT_OF_RANGE, UNSAFE_CONFIGURATION, GAME_UNAVAILABLE, GAME_MODULE_MISSING | 422 | business rule refused |
| RATE_LIMITED | 429 | with `Retry-After` header |
| MAINTENANCE_MODE | 503 | platform maintenance |
| INTERNAL_ERROR | 500 | no stack traces in production |

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | |
| GET | `/api/config` | public settings: rates, fee, limits, flags, payment methods |
| GET | `/api/games` · `/api/games/:idOrSlug` | game registry |
| GET | `/api/leaderboard?page&pageSize` | public: player number, username, stats |

## Player

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/session` | call after every sign-in in the host project. First call for a uid creates profile, player number and wallets (201); later calls record the login (200). Returns `MeDto`. There is no register endpoint. |
| GET / PATCH | `/api/me` | profile (PATCH: displayName, avatarUrl only) |
| GET | `/api/me/wallet` | AVAILABLE / LOCKED_GAME / LOCKED_SELL / BONUS / total |
| GET | `/api/me/transactions?category&from&to&gameId&txId&page` | ledger history |
| GET | `/api/me/transactions/:id` | detail incl. entries and related match/request |
| GET | `/api/me/matches?status&page` | |
| GET | `/api/notifications?unread=1` · `/api/notifications/unread-count` · POST `/api/notifications/read {ids?, all?}` | |
| POST | `/api/matches` | `{gameId, stakeUnits, visibility, maxPlayers?}` + Idempotency-Key → locks stake |
| POST | `/api/matches/quick` | `{gameId, stakeUnits}` joins an open quick room or creates one |
| POST | `/api/matches/join-by-code` | `{code}` private rooms |
| GET | `/api/matches/open?gameId` | public rooms waiting |
| GET | `/api/matches/:id` | |
| POST | `/api/matches/:id/join` · `/api/matches/:id/leave` | leave = refund (creator leaving cancels for all) |
| POST | `/api/matches/:id/disputes` | `{category, description}` |
| GET | `/api/disputes` · `/api/disputes/:id` | own disputes |
| POST/GET | `/api/wallet/buy-requests` · GET `/:id` · POST `/:id/cancel` | manual purchases |
| POST/GET | `/api/wallet/sell-requests` · GET `/:id` · POST `/:id/cancel` | redemptions (locks tokens) |
| GET/POST | `/api/wallet/{buy,sell}-requests/:id/messages` · POST `…/messages/read` | finance chat |
| POST | `/api/realtime/ticket` | `{channel}` → 60 s ticket |
| GET (WS) | `/api/realtime/connect?ticket=` | WebSocket upgrade |

| GET | `/api/crash/:gameId/state` | Aviator: current round (seed hash only), your bets (`myBets`, one per panel), live bets, recent crash points, limits |
| POST | `/api/crash/:gameId/bets` | `{panel: 1|2, amountUnits, autoCashoutX100?}` + Idempotency-Key — only during betting |
| POST | `/api/crash/:gameId/cashout` | `{panel: 1|2}` — cash out that bet now; the multiplier is decided by the server clock |
| GET | `/api/crash/:gameId/history` | finished rounds with revealed seeds (verifiable) |
| GET | `/api/crash/me/bets` | your Aviator bets |

Realtime channels also include `crash:<gameId>` (Aviator round/bet updates) and `room:<matchId>` (game rooms).

> There is intentionally **no** endpoint for a player to report a result or a winner.

## Admin (`/api/admin`, RBAC per route)

| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard`, `/me` | any admin |
| GET | `/players?status&flagged&q` · `/players/:idOrNumber` · `/players/:id/transactions` | players.view |
| POST | `/players/:id/status {status, reason}` | players.manage |
| POST | `/players/:id/notes {note}` | support.notes or players.manage |
| GET / PATCH | `/games` · `/games/:id {changes, reason}` | games.view / games.manage |
| GET | `/matches?status&gameId&live=1` · `/matches/:id` | matches.view |
| POST | `/matches/:id/void {reason}` | matches.manage |
| GET / POST | `/disputes` · `/disputes/:id` · `/:id/review` · `/:id/resolve` | disputes.view / disputes.manage |
| GET | `/finance/overview` | finance.view |
| GET | `/buy-requests?status&open=1&q` · `/buy-requests/:id` (request + context) | finance.view |
| POST | `/buy-requests/:id/review` · `/approve` · `/reject {reason}` · `/notes` | finance.buy.manage |
| GET | `/sell-requests…` · `/sell-requests/:id` | finance.view |
| POST | `/sell-requests/:id/review` · `/approve` · `/reject {reason}` · `/payment-sent {amountSentPoisha, outgoingReference, note?}` · `/notes` | finance.sell.manage |
| GET/POST | `/{buy,sell}-requests/:id/messages` (+ `/read`) | finance.chat |
| POST | `/tokens/distribute {playerNumber, amountUnits, type, reason}` + Idempotency-Key | finance.distribute |
| POST | `/treasury/issue {amountUnits, reason}` + Idempotency-Key | finance.treasury |
| POST | `/adjustments {playerNumber, direction, amountUnits, reason, relatedTransactionId?}` | finance.treasury |
| GET | `/ledger?type&txId&playerNumber&from&to` · `/ledger/:id` | finance.ledger.view |
| POST | `/ledger/integrity` | finance.integrity |
| GET | `/treasury` · `/platform-fees` · `/house-bankroll` | finance.view |
| POST | `/house-bankroll/transfer {direction: TO_BANKROLL\|FROM_BANKROLL, amountUnits, reason}` + Idempotency-Key | finance.treasury |
| GET / POST | `/fraud-flags?status` · `/fraud-flags/:id/status` | risk.view / risk.manage |
| GET | `/login-activity` | security.login_activity |
| GET | `/audit?action&entityType&entityId&adminUserId` | audit.view |
| GET / POST | `/notifications` · `/notifications/read` | any admin |
| GET / POST / PATCH | `/admins` · `/admins/:userId` | admins.manage |
| GET / PATCH | `/settings` · `/settings {changes, reason}` | settings.view / settings.manage |

## Internal game-server API (`/internal`, HMAC)

Headers: `X-Arena-Timestamp` (ms) and `X-Arena-Signature` = base64url(HMAC-SHA256(`INTERNAL_API_SECRET`, `${ts}.${METHOD}.${path}.${rawBody}`)). ±5 min skew. Disabled when the secret is unset.

| POST | Body |
|---|---|
| `/internal/matches/:id/start` | — |
| `/internal/matches/:id/events` | `{type, payload}` |
| `/internal/matches/:id/result` | `{outcome: {type:'WIN', winnerPlayerNumber, reason?} \| {type:'DRAW'} \| {type:'VOID', reason}, resultProof?}` |

## Development only (`/api/dev`, 404 in production, needs `dev.simulator`)

`POST /api/dev/matches {gameId, stakeUnits, playerNumbers[]}` · `POST /api/dev/matches/:id/start` · `POST /api/dev/matches/:id/simulate {outcome: WIN|FORFEIT|DRAW|VOID|CANCEL, winnerPlayerNumber?, forfeitPlayerNumber?}`
