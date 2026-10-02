-- PMT economy (pmtarcade.com merge).
--
-- The taka reserve is the money buyers paid for PMT minus what sellers were paid back. It is
-- computed from buy_requests / sell_requests; this table only records the owner's own movements
-- in and out of it (taking income out, or adding money such as ad income). Append-only.

CREATE TABLE reserve_movements (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('OWNER_WITHDRAWAL', 'OWNER_DEPOSIT')),
  amount_poisha    INTEGER NOT NULL CHECK (amount_poisha > 0),
  reason           TEXT NOT NULL,
  admin_user_id    TEXT NOT NULL REFERENCES users (id),
  idempotency_key  TEXT NOT NULL UNIQUE,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_reserve_movements_created ON reserve_movements (created_at);
CREATE TRIGGER reserve_movements_no_update BEFORE UPDATE ON reserve_movements BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER reserve_movements_no_delete BEFORE DELETE ON reserve_movements BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('reserve_guard_enabled', 'true', 0, NULL);

-- Player-to-player PMT transfers (sender's AVAILABLE → recipient's AVAILABLE, fee to PLATFORM_FEES).
CREATE TABLE player_transfers (
  id              TEXT PRIMARY KEY,
  from_user_id    TEXT NOT NULL REFERENCES users (id),
  to_user_id      TEXT NOT NULL REFERENCES users (id),
  amount_units    INTEGER NOT NULL CHECK (amount_units > 0),
  fee_units       INTEGER NOT NULL CHECK (fee_units >= 0 AND fee_units < amount_units),
  note            TEXT,
  client_key      TEXT NOT NULL,
  ledger_tx_id    TEXT NOT NULL REFERENCES ledger_transactions (id),
  created_at      INTEGER NOT NULL,
  CHECK (from_user_id <> to_user_id),
  UNIQUE (from_user_id, client_key)
);
CREATE INDEX idx_player_transfers_from ON player_transfers (from_user_id, created_at);
CREATE INDEX idx_player_transfers_to ON player_transfers (to_user_id, created_at);
CREATE TRIGGER player_transfers_no_update BEFORE UPDATE ON player_transfers BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER player_transfers_no_delete BEFORE DELETE ON player_transfers BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('transfers_enabled', 'true', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('transfer_fee_bps', '100', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('minimum_transfer_tokens', '1000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('daily_transfer_limit_tokens', '10000000', 0, NULL);
