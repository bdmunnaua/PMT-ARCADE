-- PMT on BNB Chain: players withdraw PMT to their own wallet and deposit PMT back.
--
-- ONCHAIN_BRIDGE is the system wallet for PMT crossing the chain boundary: a withdrawal moves the
-- player's PMT into it (and the network fee out of it to PLATFORM_FEES once paid); a deposit pays
-- out of it. It may go negative (more deposited than withdrawn), like ISSUANCE.

INSERT INTO wallet_accounts (id, owner_type, user_id, bucket, balance, allow_negative, created_at, updated_at) VALUES ('sys_onchain_bridge', 'SYSTEM', NULL, 'ONCHAIN_BRIDGE', 0, 1, 0, 0);

-- one BNB Chain address per player (and per address one player, so deposits are unambiguous)
CREATE TABLE player_crypto_wallets (
  user_id     TEXT PRIMARY KEY REFERENCES users (id),
  address     TEXT NOT NULL UNIQUE,     -- lower-case 0x + 40 hex
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE onchain_withdrawals (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users (id),
  address               TEXT NOT NULL,
  amount_units          INTEGER NOT NULL CHECK (amount_units > 0),
  fee_units             INTEGER NOT NULL CHECK (fee_units >= 0 AND fee_units < amount_units),
  from_bonus_units      INTEGER NOT NULL CHECK (from_bonus_units >= 0),
  from_available_units  INTEGER NOT NULL CHECK (from_available_units >= 0),
  status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'PAID', 'REJECTED', 'FAILED')),
  tx_hash               TEXT UNIQUE,
  note                  TEXT,
  client_key            TEXT NOT NULL,
  lock_tx_id            TEXT NOT NULL REFERENCES ledger_transactions (id),
  resolution_tx_id      TEXT REFERENCES ledger_transactions (id),
  processed_by          TEXT REFERENCES users (id),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  CHECK (from_bonus_units + from_available_units = amount_units),
  UNIQUE (user_id, client_key)
);
CREATE INDEX idx_onchain_withdrawals_status ON onchain_withdrawals (status, created_at);
CREATE INDEX idx_onchain_withdrawals_user ON onchain_withdrawals (user_id, created_at);

CREATE TABLE onchain_deposits (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id),
  tx_hash         TEXT NOT NULL,
  log_index       INTEGER NOT NULL,
  from_address    TEXT NOT NULL,
  amount_units    INTEGER NOT NULL CHECK (amount_units > 0),
  ledger_tx_id    TEXT NOT NULL REFERENCES ledger_transactions (id),
  created_at      INTEGER NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE INDEX idx_onchain_deposits_user ON onchain_deposits (user_id, created_at);
CREATE TRIGGER onchain_deposits_no_update BEFORE UPDATE ON onchain_deposits BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER onchain_deposits_no_delete BEFORE DELETE ON onchain_deposits BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('onchain_withdrawals_enabled', 'false', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('onchain_deposits_enabled', 'false', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('onchain_min_withdraw_tokens', '100000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('onchain_withdraw_fee_tokens', '5000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('onchain_min_deposit_tokens', '1000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('onchain_confirmations', '15', 0, NULL);
