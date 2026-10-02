# Wallet & ledger

## Units

* `1 TOKEN = 100 token units`; `৳1 = 100 poisha`. Every stored amount is an integer.
* All math lives in `packages/shared/src/money.ts`, `fees.ts`, `exchange.ts` (BigInt for products, safe-integer guards, string-based parsing/formatting). No floating-point arithmetic touches an amount.

## Accounts

| Owner | Buckets |
|---|---|
| each player | `AVAILABLE`, `LOCKED_GAME`, `LOCKED_SELL`, `BONUS` |
| system | `ADMIN_TREASURY`, `PLATFORM_FEES`, `ISSUANCE`, `HOUSE_BANKROLL` (Aviator) |

`ISSUANCE` is the only account allowed to go negative; its balance is minus the total supply ever issued.
Therefore **the sum of all balances is always 0** (checked by the integrity checker).

`wallet_accounts.balance` is a cache. The immutable ledger is the source of truth; the cache changes only inside the same SQL transaction as the matching entries.

## Operations (ledger transaction types)

| Type | Postings |
|---|---|
| `TREASURY_ISSUANCE` | ISSUANCE → ADMIN_TREASURY (Super Admin, audited) |
| `ADMIN_GRANT` | ADMIN_TREASURY → player AVAILABLE (BONUS for grant type BONUS) |
| `TOKEN_PURCHASE` | ADMIN_TREASURY → player AVAILABLE (buy approval) |
| `TOKEN_SELL_LOCK` | AVAILABLE → LOCKED_SELL (sell submission) |
| `TOKEN_SELL_COMPLETE` | LOCKED_SELL → ADMIN_TREASURY (payment confirmed) |
| `TOKEN_SELL_REFUND` | LOCKED_SELL → AVAILABLE (rejected / cancelled) |
| `GAME_STAKE_LOCK` | BONUS then AVAILABLE → LOCKED_GAME |
| `GAME_WIN_PAYOUT` | losers' LOCKED_GAME → winner AVAILABLE, fee portion → PLATFORM_FEES (posting type `PLATFORM_MATCH_FEE`), winner's own LOCKED_GAME → AVAILABLE |
| `GAME_STAKE_REFUND` | LOCKED_GAME → original buckets (draw, cancel, void, refund, leave) |
| `ADJUSTMENT` | ADMIN_TREASURY ↔ player AVAILABLE — compensating corrections |
| `HOUSE_BANKROLL_TRANSFER` | ADMIN_TREASURY ↔ HOUSE_BANKROLL (audited; withdrawals ≥ open exposure) |
| `HOUSE_BET_WIN` | Aviator cash-out: LOCKED_GAME → AVAILABLE (stake) + HOUSE_BANKROLL → AVAILABLE (profit) |
| `HOUSE_BET_LOSS` | Aviator crash: LOCKED_GAME → HOUSE_BANKROLL |
| `HOUSE_BET_REFUND` | interrupted Aviator round: LOCKED_GAME → original buckets |

Every transaction stores: id, idempotency key, type, reference type/id, game id, created by (type + id), metadata, total, timestamp. Every entry stores account, user, bucket, signed amount, `balance_after`, posting type.

There is **no** "set balance" API. Corrections are compensating `ADJUSTMENT` transactions (Super Admin, reason required, audited).

## Idempotency keys (UNIQUE)

| Operation | Key |
|---|---|
| buy credit | `buy:<requestId>:credit` |
| sell lock | `sell:<requestId>:lock` |
| sell resolution (complete / reject / cancel) | `sell:<requestId>:resolution` — mutually exclusive |
| match stake (create) | `stake:<userId>:<clientIdempotencyKey>` |
| match stake (join) | `match:<matchId>:stake:<userId>` |
| match resolution (win / draw / void / refund / cancel) | `match:<matchId>:resolution` — exactly once |
| leave before full | `match:<matchId>:leave:<userId>` |
| grant / issuance / adjustment | `grant:<adminId>:<key>` · `issue:<adminId>:<key>` · `adjust:<adminId>:<key>` |
| dispute compensation | `dispute:<disputeId>:compensation` |
| Aviator bet lock / resolution | `crash:<betId>:lock` · `crash:<betId>:resolution` (cash-out, crash and refund are mutually exclusive) |
| bankroll transfer | `bankroll:<adminId>:<key>` |

A retried request with the same key returns the original result (`replayed: true`); the same key with a different payload returns `IDEMPOTENCY_CONFLICT`.

## The 1% match fee

```
pot     = Σ stakes                       (e.g. 1,000 + 1,000 = 2,000 TOKEN)
fee     = floor(pot × MATCH_FEE_BPS / 10,000)   (100 bps → 20 TOKEN)
payout  = pot − fee                      (1,980 TOKEN to the winner; loser 0)
```

* `MATCH_FEE_BPS` is **snapshotted** into the match at creation; later changes never affect it.
* Rounding is **down** (player-favourable). At 1%, pots below 100 units (1 TOKEN) pay no fee. The platform minimum stake (10 TOKEN by default) keeps fees meaningful.
* The fee is drawn from the losers' escrow first, then the winner's, and goes **only** to `PLATFORM_FEES`.
* Draw / cancel / void / server failure: every stake returns to the bucket it came from, fee 0.
* Forfeit (decided by the game module): opponent wins, normal fee.
* **Team games** (29): pot − fee is split equally among the winners (indivisible remainder units go to the first winners); 4 × 1,000 → 40 fee, 1,980 to each partner.
* Winnings always land in AVAILABLE (a bonus-funded stake becomes withdrawable only by winning).

## Exchange rates

* Buy: `৳1 = BUY_TOKENS_PER_BDT TOKEN` → `tokenUnits = poisha × rate`.
* Sell: `SELL_TOKENS_PER_BDT TOKEN = ৳1` → `poisha = floor(tokenUnits / rate)`.
* Both are snapshotted into each request. In production `SELL_TOKENS_PER_BDT > BUY_TOKENS_PER_BDT` is enforced (otherwise buy-then-sell would mint money); unsafe settings are refused, and live finance requests are paused if the database is ever edited into an unsafe state.

## Invariants (enforced in code, constraints and tests)

1. A player cannot spend more AVAILABLE tokens than they have (CHECK constraint).
2. Locked tokens cannot be spent (only settlement/sell services debit locked buckets).
3. Every token movement has matching ledger entries summing to zero.
4. One match settles once; one purchase credits once; one sell request resolves once (unique keys + state assertions).
5. Rejected/cancelled sells return all locked tokens; cancelled/drawn/voided matches return exact stakes.
6. Only server-side results settle matches.
7. Platform fees go only to PLATFORM_FEES; purchases/sales/grants use ADMIN_TREASURY.
8. The admin UI has no path that bypasses the ledger.
9. Historical rates/fees never change; the browser never supplies rate, fee, balance, winner, player number or role.

## Integrity checker

Admin → Finance → Ledger integrity (`POST /api/admin/ledger/integrity`, read-only):
balanced transactions · totals · cached balance = Σ entries · no negatives · total supply = 0 · locked = active holds ·
one resolution per resolved match and none for open ones · recorded fee = posted fee · buy credited exactly once ·
sell resolved exactly once · PLATFORM_FEES touched only by match fees. Reports **PASS** or detailed errors; never repairs.
