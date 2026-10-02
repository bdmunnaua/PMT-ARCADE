-- Public wallets: the on-chain PMT wallets the project publishes (supply, allocation shares,
-- payout, liquidity). Shown with live balances on the public transparency page.
CREATE TABLE public_wallets (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  address         TEXT NOT NULL UNIQUE,
  purpose         TEXT NOT NULL DEFAULT '',
  planned_tokens  INTEGER CHECK (planned_tokens IS NULL OR planned_tokens >= 0),
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  created_by      TEXT REFERENCES users (id)
);

INSERT INTO public_wallets (id, label, address, purpose, planned_tokens, sort, created_at, created_by)
VALUES ('pw_supply', 'Supply wallet', '0xe328a50732109d129bcf9b302cfe362949f77fb4', 'Created the PMT contract. Holds all PMT not yet moved to a share wallet.', NULL, 0, 0, NULL);
