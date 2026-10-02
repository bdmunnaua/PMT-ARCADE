# Manual payment request flow (buy & sell)

Payments are **manual**: the platform never calls a payment API and never asks for a PIN, OTP or password.
Providers are pluggable (`packages/shared/src/payment.ts`): `BKASH_MANUAL` and `OTHER_MANUAL`, each switchable via the `enabled_payment_methods` setting; `buy_requests_enabled` / `sell_requests_enabled` turn whole flows off without affecting games.

## Buy tokens

```mermaid
sequenceDiagram
  actor P as Player
  participant API
  actor A as Finance admin
  P->>P: send ৳ via bKash to the published number
  P->>API: POST buy request (BDT, sender number, TrxID) — rate snapshot 110
  API-->>P: SUBMITTED (nothing credited)
  API-->>A: notification (+ risk flags if any)
  A->>API: START REVIEW → UNDER_REVIEW
  A-->>P: chat (optional)
  A->>A: verify the payment in the bKash merchant app
  alt verified
    A->>API: APPROVE & CREDIT
    API->>API: one batch: ADMIN_TREASURY → player AVAILABLE, status COMPLETED, audit
    API-->>P: approved + tokens credited
  else not verified
    A->>API: REJECT (reason required)
    API-->>P: rejected (reason)
  end
```

Statuses: `SUBMITTED → UNDER_REVIEW → (APPROVED → TOKEN_CREDITED →) COMPLETED`, or `REJECTED`, or `CANCELLED` (player, only while SUBMITTED). The intermediate states are recorded in the timeline; the credit itself is a single atomic step that can happen once (`buy:<id>:credit`).

**Duplicate references.** References are normalised (trim, remove spaces, uppercase). A reference used by any SUBMITTED / UNDER_REVIEW / COMPLETED request is blocked by a partial UNIQUE index; the attempt is refused (`DUPLICATE_PAYMENT_REFERENCE`) and flagged HIGH for review. A rejected request's reference can be reused.

**Admin sees:** request number & id, player number/name, account age, BDT, tokens, rate snapshot, method, sender number (full for finance roles, masked otherwise), reference, timestamps, previous buy/sell history, current balances, risk flags (shared sender number across accounts, velocity, large amount, duplicate reference), chat, admin notes.

## Sell tokens

```mermaid
sequenceDiagram
  actor P as Player
  participant API
  actor A as Finance admin
  P->>API: POST sell request (tokens, receiving number) — rate snapshot 120
  API->>API: one batch: AVAILABLE → LOCKED_SELL + hold
  API-->>P: TOKENS_LOCKED
  A->>API: START REVIEW → UNDER_REVIEW
  alt approve
    A->>API: APPROVE → PAYMENT_PROCESSING (not completed)
    A->>A: send ৳ manually
    A->>API: CONFIRM PAYMENT SENT (amount = payout, outgoing TrxID)
    API->>API: one batch: LOCKED_SELL → ADMIN_TREASURY, record reference, COMPLETED, audit
    API-->>P: payment sent + completed
  else reject
    A->>API: REJECT (reason) 
    API->>API: LOCKED_SELL → AVAILABLE → TOKENS_UNLOCKED
  end
```

Example: available 20,000 → sell 12,000 → available 8,000 + locked 12,000 → payout ৳100. Locked tokens cannot be staked, sold again, transferred or spent.
Statuses: `SUBMITTED → TOKENS_LOCKED → UNDER_REVIEW → APPROVED → PAYMENT_PROCESSING → PAYMENT_SENT → COMPLETED`; or `→ REJECTED → TOKENS_UNLOCKED`; or `CANCELLED` (player, before review, tokens returned). Completion, rejection and cancellation share one idempotency key, so exactly one can happen; confirming payment twice is refused; the outgoing reference must be unique and the amount must equal the snapshotted payout.

## Chat

Every request has a private chat (player ↔ authorised finance admins), stored in `finance_messages` (no edit/delete; read receipts), pushed in realtime over the request's channel, with unread counters in lists. Players see admins as “Support team”.

## Economic safety

Buy 110 / sell 120 means buying ৳100 (11,000 TOKEN) and selling it back returns ৳91.66 — never more than paid. Production refuses any configuration where `SELL_TOKENS_PER_BDT ≤ BUY_TOKENS_PER_BDT`.

## Data minimisation

Only the sender/receiving number, reference and amounts are stored. Numbers are masked (`01******89`) for admins without finance/sensitive permissions and never appear in public profiles, rooms or leaderboards.
