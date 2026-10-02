-- Free arcade games (the original pmtarcade.com games), merged onto the PMT ledger.
-- Rewards are paid as BONUS PMT from the REWARDS_POOL system wallet (1 old coin = 1 PMT).

CREATE TABLE arcade_profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users (id),
  ref_code        TEXT NOT NULL UNIQUE,
  referred_by     TEXT REFERENCES users (id),
  ref_paid        INTEGER NOT NULL DEFAULT 0 CHECK (ref_paid IN (0, 1)),
  ref_count       INTEGER NOT NULL DEFAULT 0,
  streak          INTEGER NOT NULL DEFAULT 0,
  last_checkin    TEXT,                       -- YYYY-MM-DD, Bangladesh time
  lifetime_units  INTEGER NOT NULL DEFAULT 0, -- PMT units ever earned from games
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CHECK (referred_by IS NULL OR referred_by <> user_id)
);
CREATE INDEX idx_arcade_profiles_referrer ON arcade_profiles (referred_by);

CREATE TABLE arcade_runs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users (id),
  game          TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  score         INTEGER,
  reward_units  INTEGER NOT NULL DEFAULT 0 CHECK (reward_units >= 0),
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'FLAGGED', 'ABANDONED')),
  message       TEXT
);
CREATE INDEX idx_arcade_runs_user ON arcade_runs (user_id, started_at);
CREATE INDEX idx_arcade_runs_board ON arcade_runs (game, status, finished_at);
CREATE INDEX idx_arcade_runs_finished ON arcade_runs (finished_at);

-- Balances carried over from the old arcade database, claimed once at the player's first visit.
CREATE TABLE arcade_legacy_accounts (
  firebase_uid  TEXT PRIMARY KEY,
  email         TEXT,
  name          TEXT,
  coins         INTEGER NOT NULL CHECK (coins >= 0),
  lifetime      INTEGER NOT NULL DEFAULT 0,
  ref_code      TEXT,
  streak        INTEGER NOT NULL DEFAULT 0,
  last_checkin  TEXT,
  claimed_by    TEXT REFERENCES users (id),
  claimed_at    INTEGER
);

INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('arcade_enabled', 'true', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('arcade_daily_cap_tokens', '1000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('arcade_welcome_bonus_tokens', '50', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('arcade_referral_bonus_tokens', '300', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('arcade_referral_welcome_tokens', '100', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('arcade_referral_unlock_tokens', '500', 0, NULL);
