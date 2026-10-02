-- Weekly free-game tournaments: one featured free game per week (Monday 00:00 → Monday 00:00,
-- Bangladesh time). Every finished game of that week counts automatically; the best score per
-- player ranks. Prizes are BONUS PMT from the REWARDS_POOL, paid once after the week ends
-- (one ledger transaction, idempotency key arcade:tournament:<week_start>).

CREATE TABLE arcade_tournaments (
  week_start   TEXT PRIMARY KEY,            -- YYYY-MM-DD (Monday, Bangladesh time)
  game         TEXT NOT NULL,
  starts_at    INTEGER NOT NULL,
  ends_at      INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('PAID', 'NO_ENTRIES', 'OFF')),
  prize_units  INTEGER NOT NULL DEFAULT 0 CHECK (prize_units >= 0),
  ledger_tx_id TEXT,
  settled_at   INTEGER NOT NULL
);

CREATE TABLE arcade_tournament_winners (
  week_start   TEXT NOT NULL REFERENCES arcade_tournaments (week_start),
  rank         INTEGER NOT NULL CHECK (rank >= 1),
  user_id      TEXT NOT NULL REFERENCES users (id),
  score        INTEGER NOT NULL,
  prize_units  INTEGER NOT NULL CHECK (prize_units >= 0),
  PRIMARY KEY (week_start, rank),
  UNIQUE (week_start, user_id)
);
CREATE INDEX idx_arcade_tournament_winners_user ON arcade_tournament_winners (user_id);

INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('tournament_enabled', 'true', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('tournament_prizes_tokens', '[20000,10000,5000,3000,2000,1000,1000,1000,1000,1000]', 0, NULL);
