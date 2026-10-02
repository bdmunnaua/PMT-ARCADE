-- Token Arena — core schema (Cloudflare D1 / SQLite)
-- Conventions:
--   * ids are ULID strings; public numbers (player/request/match) come from `counters`
--   * all token amounts are INTEGER token units (1 TOKEN = 100 units); BDT amounts are INTEGER poisha
--   * timestamps are INTEGER epoch milliseconds
--   * financial history tables are append-only, enforced by triggers

-- ---------------------------------------------------------------- helpers

-- Monotonic counters for public numbers. Values are never decremented, so numbers are never reused.
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Batch assertions: `INSERT INTO batch_assert(ok) SELECT <condition>` aborts the whole D1 batch
-- (which is a single SQL transaction) when the condition is false. Nothing is ever stored.
CREATE VIEW batch_assert AS SELECT 1 AS ok;
CREATE TRIGGER batch_assert_insert INSTEAD OF INSERT ON batch_assert
BEGIN
  SELECT RAISE(ABORT, 'BATCH_ASSERTION_FAILED') WHERE NEW.ok IS NOT 1;
END;

-- ---------------------------------------------------------------- identity

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  firebase_uid    TEXT NOT NULL UNIQUE,
  email           TEXT,
  email_verified  INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  account_status  TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'RESTRICTED', 'SUSPENDED', 'BANNED')),
  status_reason   TEXT,
  last_login_at   INTEGER,
  last_login_ip   TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_status_created ON users (account_status, created_at);
CREATE INDEX idx_users_created ON users (created_at);
CREATE INDEX idx_users_last_ip ON users (last_login_ip);

CREATE TABLE player_profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users (id),
  player_number   INTEGER NOT NULL UNIQUE CHECK (player_number >= 100001),
  username        TEXT NOT NULL,
  username_lower  TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TRIGGER player_number_immutable BEFORE UPDATE OF player_number ON player_profiles
WHEN NEW.player_number IS NOT OLD.player_number
BEGIN
  SELECT RAISE(ABORT, 'PLAYER_NUMBER_IMMUTABLE');
END;
CREATE TRIGGER player_profiles_no_delete BEFORE DELETE ON player_profiles
BEGIN
  SELECT RAISE(ABORT, 'PLAYER_PROFILE_DELETE_FORBIDDEN');
END;

CREATE TABLE player_stats (
  user_id             TEXT PRIMARY KEY REFERENCES users (id),
  games_played        INTEGER NOT NULL DEFAULT 0,
  wins                INTEGER NOT NULL DEFAULT 0,
  losses              INTEGER NOT NULL DEFAULT 0,
  draws               INTEGER NOT NULL DEFAULT 0,
  total_staked_units  INTEGER NOT NULL DEFAULT 0,
  total_won_units     INTEGER NOT NULL DEFAULT 0,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_player_stats_leaderboard ON player_stats (wins DESC, games_played ASC);

CREATE TABLE player_notes (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id),
  admin_user_id  TEXT NOT NULL REFERENCES users (id),
  note           TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_player_notes_user ON player_notes (user_id, created_at);
CREATE TRIGGER player_notes_no_update BEFORE UPDATE ON player_notes BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER player_notes_no_delete BEFORE DELETE ON player_notes BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- ---------------------------------------------------------------- admin / RBAC

CREATE TABLE admin_roles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

CREATE TABLE admin_permissions (
  role_id     TEXT NOT NULL REFERENCES admin_roles (id),
  permission  TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE admin_users (
  user_id     TEXT PRIMARY KEY REFERENCES users (id),
  role_id     TEXT NOT NULL REFERENCES admin_roles (id),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by  TEXT REFERENCES users (id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_admin_users_role ON admin_users (role_id, active);

-- ---------------------------------------------------------------- wallet & ledger

-- Cached balances. Changed ONLY by the ledger service, in the same batch that inserts the
-- matching ledger entries. The CHECK makes overdrafts impossible: an update that would make a
-- balance negative aborts the whole batch.
CREATE TABLE wallet_accounts (
  id              TEXT PRIMARY KEY,
  owner_type      TEXT NOT NULL CHECK (owner_type IN ('PLAYER', 'SYSTEM')),
  user_id         TEXT REFERENCES users (id),
  bucket          TEXT NOT NULL CHECK (bucket IN ('AVAILABLE', 'LOCKED_GAME', 'LOCKED_SELL', 'BONUS', 'ADMIN_TREASURY', 'PLATFORM_FEES', 'ISSUANCE', 'HOUSE_BANKROLL', 'REWARDS_POOL', 'ONCHAIN_BRIDGE')),
  balance         INTEGER NOT NULL DEFAULT 0,
  allow_negative  INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative IN (0, 1)),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CONSTRAINT wallet_balance_non_negative CHECK (allow_negative = 1 OR balance >= 0),
  CONSTRAINT wallet_owner_shape CHECK (
    (owner_type = 'PLAYER' AND user_id IS NOT NULL AND bucket IN ('AVAILABLE', 'LOCKED_GAME', 'LOCKED_SELL', 'BONUS'))
    OR (owner_type = 'SYSTEM' AND user_id IS NULL AND bucket IN ('ADMIN_TREASURY', 'PLATFORM_FEES', 'ISSUANCE', 'HOUSE_BANKROLL', 'REWARDS_POOL', 'ONCHAIN_BRIDGE'))
  ),
  UNIQUE (user_id, bucket)
);
CREATE TRIGGER wallet_accounts_shape_immutable BEFORE UPDATE OF id, owner_type, user_id, bucket, allow_negative ON wallet_accounts
BEGIN
  SELECT RAISE(ABORT, 'WALLET_ACCOUNT_SHAPE_IMMUTABLE');
END;
CREATE TRIGGER wallet_accounts_no_delete BEFORE DELETE ON wallet_accounts
BEGIN
  SELECT RAISE(ABORT, 'WALLET_ACCOUNT_DELETE_FORBIDDEN');
END;

CREATE TABLE ledger_transactions (
  id               TEXT PRIMARY KEY,
  idempotency_key  TEXT NOT NULL UNIQUE,
  type             TEXT NOT NULL CHECK (type IN (
                     'TREASURY_ISSUANCE', 'ADMIN_GRANT', 'TOKEN_PURCHASE', 'TOKEN_SELL_LOCK', 'TOKEN_SELL_COMPLETE',
                     'TOKEN_SELL_REFUND', 'GAME_STAKE_LOCK', 'GAME_STAKE_REFUND', 'GAME_WIN_PAYOUT', 'ADJUSTMENT',
                     'HOUSE_BET_WIN', 'HOUSE_BET_LOSS', 'HOUSE_BET_REFUND', 'HOUSE_BANKROLL_TRANSFER',
                     'PLAYER_TRANSFER', 'ARCADE_REWARD', 'REWARDS_POOL_TRANSFER', 'ONCHAIN_WITHDRAW', 'ONCHAIN_WITHDRAW_PAID',
                     'ONCHAIN_WITHDRAW_REFUND', 'ONCHAIN_DEPOSIT')),
  reference_type   TEXT,
  reference_id     TEXT,
  game_id          TEXT,
  created_by_type  TEXT NOT NULL CHECK (created_by_type IN ('PLAYER', 'ADMIN', 'SYSTEM')),
  created_by_id    TEXT,
  metadata         TEXT NOT NULL DEFAULT '{}',
  total_units      INTEGER NOT NULL CHECK (total_units > 0),
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_ledger_tx_reference ON ledger_transactions (reference_type, reference_id);
CREATE INDEX idx_ledger_tx_type_created ON ledger_transactions (type, created_at);
CREATE INDEX idx_ledger_tx_created ON ledger_transactions (created_at);
CREATE INDEX idx_ledger_tx_game ON ledger_transactions (game_id, created_at);

-- One row per side of every movement. amount < 0 = tokens leave the account (debit),
-- amount > 0 = tokens enter the account (credit). Every transaction sums to exactly zero.
CREATE TABLE ledger_entries (
  id              TEXT PRIMARY KEY,
  transaction_id  TEXT NOT NULL REFERENCES ledger_transactions (id),
  posting_index   INTEGER NOT NULL,
  posting_type    TEXT NOT NULL,
  account_id      TEXT NOT NULL REFERENCES wallet_accounts (id),
  user_id         TEXT REFERENCES users (id),
  bucket          TEXT NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount <> 0),
  balance_after   INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE (transaction_id, posting_index, account_id)
);
CREATE INDEX idx_ledger_entries_tx ON ledger_entries (transaction_id);
CREATE INDEX idx_ledger_entries_account ON ledger_entries (account_id, created_at);
CREATE INDEX idx_ledger_entries_user ON ledger_entries (user_id, created_at);

CREATE TRIGGER ledger_transactions_no_update BEFORE UPDATE ON ledger_transactions BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER ledger_transactions_no_delete BEFORE DELETE ON ledger_transactions BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE'); END;

-- Which reference (match / sell request) each locked amount belongs to.
-- Integrity rule: sum(ACTIVE holds) per player+bucket == locked bucket balance.
CREATE TABLE wallet_holds (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users (id),
  bucket          TEXT NOT NULL CHECK (bucket IN ('LOCKED_GAME', 'LOCKED_SELL')),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  reference_type  TEXT NOT NULL CHECK (reference_type IN ('MATCH', 'SELL_REQUEST', 'CRASH_BET')),
  reference_id    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'CAPTURED')),
  lock_tx_id      TEXT NOT NULL REFERENCES ledger_transactions (id),
  release_tx_id   TEXT REFERENCES ledger_transactions (id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (reference_type, reference_id, user_id)
);
CREATE INDEX idx_wallet_holds_user ON wallet_holds (user_id, status);
CREATE INDEX idx_wallet_holds_status ON wallet_holds (status, bucket);
CREATE TRIGGER wallet_holds_final BEFORE UPDATE OF status ON wallet_holds
WHEN OLD.status <> 'ACTIVE'
BEGIN
  SELECT RAISE(ABORT, 'HOLD_ALREADY_FINAL');
END;
CREATE TRIGGER wallet_holds_no_delete BEFORE DELETE ON wallet_holds BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- ---------------------------------------------------------------- games & matches

CREATE TABLE games (
  id                   TEXT PRIMARY KEY,
  slug                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  thumbnail_url        TEXT,
  module_key           TEXT,
  kind                 TEXT NOT NULL DEFAULT 'ROOM' CHECK (kind IN ('ROOM', 'CRASH')),
  enabled              INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  maintenance_mode     INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_mode IN (0, 1)),
  minimum_stake_units  INTEGER NOT NULL CHECK (minimum_stake_units > 0),
  maximum_stake_units  INTEGER NOT NULL,
  minimum_players      INTEGER NOT NULL DEFAULT 2,
  maximum_players      INTEGER NOT NULL DEFAULT 2,
  game_version         TEXT NOT NULL DEFAULT '0.0.0',
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  CHECK (maximum_stake_units >= minimum_stake_units),
  CHECK (maximum_players >= minimum_players AND (kind = 'CRASH' OR minimum_players >= 2))
);
CREATE INDEX idx_games_sort ON games (sort_order);

CREATE TABLE matches (
  id                TEXT PRIMARY KEY,
  match_number      INTEGER NOT NULL UNIQUE,
  game_id           TEXT NOT NULL REFERENCES games (id),
  creator_id        TEXT NOT NULL REFERENCES users (id),
  mode              TEXT NOT NULL CHECK (mode IN ('QUICK', 'ROOM')),
  visibility        TEXT NOT NULL CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  join_code         TEXT,
  stake_units       INTEGER NOT NULL CHECK (stake_units > 0),
  min_players       INTEGER NOT NULL CHECK (min_players >= 2),
  max_players       INTEGER NOT NULL,
  player_count      INTEGER NOT NULL DEFAULT 0 CHECK (player_count >= 0),
  fee_bps           INTEGER NOT NULL CHECK (fee_bps >= 0 AND fee_bps <= 1000),
  game_version      TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN (
                      'CREATED', 'WAITING_FOR_OPPONENT', 'STAKE_LOCKING', 'READY', 'PLAYING', 'RESULT_PENDING', 'SETTLING',
                      'SETTLED', 'DRAW', 'CANCELLED', 'VOID', 'REFUNDED', 'DISPUTED')),
  result_type       TEXT,
  winner_user_id    TEXT REFERENCES users (id),
  pot_units         INTEGER NOT NULL DEFAULT 0,
  fee_units         INTEGER,
  payout_units      INTEGER,
  resolution_tx_id  TEXT REFERENCES ledger_transactions (id),
  result_source     TEXT,
  result_proof      TEXT,
  void_reason       TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  ready_at          INTEGER,
  started_at        INTEGER,
  ended_at          INTEGER,
  settled_at        INTEGER,
  CHECK (max_players >= min_players),
  CHECK (player_count <= max_players)
);
CREATE INDEX idx_matches_open ON matches (status, game_id, visibility, stake_units, created_at);
CREATE INDEX idx_matches_status_updated ON matches (status, updated_at);
CREATE INDEX idx_matches_game_created ON matches (game_id, created_at);
CREATE INDEX idx_matches_created ON matches (created_at);
CREATE UNIQUE INDEX ux_matches_join_code_open ON matches (join_code)
  WHERE join_code IS NOT NULL AND status IN ('CREATED', 'WAITING_FOR_OPPONENT', 'STAKE_LOCKING');

CREATE TABLE match_players (
  id                     TEXT PRIMARY KEY,
  match_id               TEXT NOT NULL REFERENCES matches (id),
  user_id                TEXT NOT NULL REFERENCES users (id),
  seat                   INTEGER NOT NULL,
  stake_units            INTEGER NOT NULL CHECK (stake_units > 0),
  stake_bonus_units      INTEGER NOT NULL DEFAULT 0 CHECK (stake_bonus_units >= 0),
  stake_available_units  INTEGER NOT NULL DEFAULT 0 CHECK (stake_available_units >= 0),
  status                 TEXT NOT NULL DEFAULT 'JOINED' CHECK (status IN ('JOINED', 'LEFT')),
  result                 TEXT CHECK (result IN ('WIN', 'LOSS', 'DRAW', 'REFUNDED')),
  payout_units           INTEGER,
  joined_at              INTEGER NOT NULL,
  left_at                INTEGER,
  CHECK (stake_bonus_units + stake_available_units = stake_units),
  UNIQUE (match_id, user_id),
  UNIQUE (match_id, seat)
);
CREATE INDEX idx_match_players_user ON match_players (user_id, joined_at);
CREATE INDEX idx_match_players_match ON match_players (match_id, status);

-- Only authoritative, important events (results, joins, disconnects, settlement) — never frames.
CREATE TABLE match_events (
  id          TEXT PRIMARY KEY,
  match_id    TEXT NOT NULL REFERENCES matches (id),
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  actor_type  TEXT NOT NULL,
  actor_id    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_match_events_match ON match_events (match_id, created_at);
CREATE TRIGGER match_events_no_update BEFORE UPDATE ON match_events BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER match_events_no_delete BEFORE DELETE ON match_events BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- ---------------------------------------------------------------- crash game (Aviator, house-banked)

-- One row per round. The crash point is fixed BEFORE betting opens (provably fair: the SHA-256
-- of the server seed is published first, the seed is revealed after the crash).
CREATE TABLE crash_rounds (
  id                TEXT PRIMARY KEY,
  round_number      INTEGER NOT NULL UNIQUE,
  game_id           TEXT NOT NULL REFERENCES games (id),
  status            TEXT NOT NULL CHECK (status IN ('BETTING', 'FLYING', 'CRASHED')),
  server_seed_hash  TEXT NOT NULL,
  server_seed       TEXT,
  crash_x100        INTEGER,
  betting_ends_at   INTEGER NOT NULL,
  started_at        INTEGER,
  crashed_at        INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_crash_rounds_game ON crash_rounds (game_id, round_number);
CREATE INDEX idx_crash_rounds_status ON crash_rounds (status, updated_at);

CREATE TABLE crash_bets (
  id                     TEXT PRIMARY KEY,
  round_id               TEXT NOT NULL REFERENCES crash_rounds (id),
  user_id                TEXT NOT NULL REFERENCES users (id),
  -- Aviator lets a player hold two independent bets per round (bet panel 1 and 2)
  panel                  INTEGER NOT NULL DEFAULT 1 CHECK (panel IN (1, 2)),
  stake_units            INTEGER NOT NULL CHECK (stake_units > 0),
  stake_bonus_units      INTEGER NOT NULL DEFAULT 0 CHECK (stake_bonus_units >= 0),
  stake_available_units  INTEGER NOT NULL DEFAULT 0 CHECK (stake_available_units >= 0),
  max_profit_units       INTEGER NOT NULL CHECK (max_profit_units >= 0),
  auto_cashout_x100      INTEGER CHECK (auto_cashout_x100 IS NULL OR auto_cashout_x100 >= 101),
  status                 TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CASHED_OUT', 'LOST', 'REFUNDED')),
  cashout_x100           INTEGER,
  payout_units           INTEGER,
  client_key             TEXT NOT NULL,
  lock_tx_id             TEXT NOT NULL REFERENCES ledger_transactions (id),
  resolution_tx_id       TEXT REFERENCES ledger_transactions (id),
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  CHECK (stake_bonus_units + stake_available_units = stake_units),
  UNIQUE (round_id, user_id, panel),
  UNIQUE (user_id, client_key)
);
CREATE INDEX idx_crash_bets_user ON crash_bets (user_id, created_at);
CREATE INDEX idx_crash_bets_round ON crash_bets (round_id, status);

-- ---------------------------------------------------------------- buy / sell requests

CREATE TABLE buy_requests (
  id                             TEXT PRIMARY KEY,
  request_number                 INTEGER NOT NULL UNIQUE,
  user_id                        TEXT NOT NULL REFERENCES users (id),
  status                         TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'TOKEN_CREDITED', 'COMPLETED', 'REJECTED', 'CANCELLED')),
  amount_poisha                  INTEGER NOT NULL CHECK (amount_poisha > 0),
  token_units                    INTEGER NOT NULL CHECK (token_units > 0),
  rate_tokens_per_bdt            INTEGER NOT NULL CHECK (rate_tokens_per_bdt > 0),
  payment_method                 TEXT NOT NULL,
  sender_number                  TEXT NOT NULL,
  payment_reference              TEXT NOT NULL,
  payment_reference_normalized   TEXT NOT NULL,
  note                           TEXT,
  client_key                     TEXT NOT NULL,
  rejection_reason               TEXT,
  admin_notes                    TEXT,
  reviewed_by                    TEXT REFERENCES users (id),
  reviewed_at                    INTEGER,
  completed_at                   INTEGER,
  ledger_tx_id                   TEXT REFERENCES ledger_transactions (id),
  created_at                     INTEGER NOT NULL,
  updated_at                     INTEGER NOT NULL,
  UNIQUE (user_id, client_key),
  CHECK (token_units = amount_poisha * rate_tokens_per_bdt)
);
CREATE INDEX idx_buy_requests_status ON buy_requests (status, created_at);
CREATE INDEX idx_buy_requests_user ON buy_requests (user_id, created_at);
CREATE INDEX idx_buy_requests_sender ON buy_requests (sender_number);
-- A payment reference used by an active or successful request can never be used again.
CREATE UNIQUE INDEX ux_buy_requests_reference_active ON buy_requests (payment_method, payment_reference_normalized)
  WHERE status NOT IN ('REJECTED', 'CANCELLED');

CREATE TABLE sell_requests (
  id                     TEXT PRIMARY KEY,
  request_number         INTEGER NOT NULL UNIQUE,
  user_id                TEXT NOT NULL REFERENCES users (id),
  status                 TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'TOKENS_LOCKED', 'UNDER_REVIEW', 'APPROVED', 'PAYMENT_PROCESSING',
                           'PAYMENT_SENT', 'COMPLETED', 'REJECTED', 'TOKENS_UNLOCKED', 'CANCELLED')),
  amount_units           INTEGER NOT NULL CHECK (amount_units > 0),
  bdt_poisha             INTEGER NOT NULL CHECK (bdt_poisha > 0),
  rate_tokens_per_bdt    INTEGER NOT NULL CHECK (rate_tokens_per_bdt > 0),
  payment_method         TEXT NOT NULL,
  receiving_number       TEXT NOT NULL,
  note                   TEXT,
  client_key             TEXT NOT NULL,
  rejection_reason       TEXT,
  admin_notes            TEXT,
  reviewed_by            TEXT REFERENCES users (id),
  reviewed_at            INTEGER,
  approved_by            TEXT REFERENCES users (id),
  approved_at            INTEGER,
  payment_amount_poisha  INTEGER,
  payment_reference      TEXT,
  payment_note           TEXT,
  payment_sent_by        TEXT REFERENCES users (id),
  payment_sent_at        INTEGER,
  completed_at           INTEGER,
  lock_tx_id             TEXT REFERENCES ledger_transactions (id),
  resolution_tx_id       TEXT REFERENCES ledger_transactions (id),
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  UNIQUE (user_id, client_key),
  CHECK (bdt_poisha = amount_units / rate_tokens_per_bdt)
);
CREATE INDEX idx_sell_requests_status ON sell_requests (status, created_at);
CREATE INDEX idx_sell_requests_user ON sell_requests (user_id, created_at);
CREATE INDEX idx_sell_requests_receiving ON sell_requests (receiving_number);
CREATE UNIQUE INDEX ux_sell_requests_payment_reference ON sell_requests (payment_method, payment_reference)
  WHERE payment_reference IS NOT NULL;

-- Status timeline of each buy/sell request (append-only).
CREATE TABLE finance_request_events (
  id            TEXT PRIMARY KEY,
  request_kind  TEXT NOT NULL CHECK (request_kind IN ('BUY', 'SELL')),
  request_id    TEXT NOT NULL,
  status        TEXT NOT NULL,
  note          TEXT,
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('PLAYER', 'ADMIN', 'SYSTEM')),
  actor_id      TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_finance_request_events ON finance_request_events (request_kind, request_id, created_at);
CREATE TRIGGER finance_request_events_no_update BEFORE UPDATE ON finance_request_events BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER finance_request_events_no_delete BEFORE DELETE ON finance_request_events BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

-- Private player ↔ admin chat per buy/sell request. Messages can never be edited or deleted;
-- only read_at may be set, once.
CREATE TABLE finance_messages (
  id            TEXT PRIMARY KEY,
  request_kind  TEXT NOT NULL CHECK (request_kind IN ('BUY', 'SELL')),
  request_id    TEXT NOT NULL,
  sender_type   TEXT NOT NULL CHECK (sender_type IN ('PLAYER', 'ADMIN', 'SYSTEM')),
  sender_id     TEXT REFERENCES users (id),
  message       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  read_at       INTEGER
);
CREATE INDEX idx_finance_messages_request ON finance_messages (request_kind, request_id, created_at);
CREATE INDEX idx_finance_messages_unread ON finance_messages (request_kind, request_id, sender_type, read_at);
CREATE TRIGGER finance_messages_no_delete BEFORE DELETE ON finance_messages BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER finance_messages_only_read_at BEFORE UPDATE ON finance_messages
WHEN NEW.id IS NOT OLD.id OR NEW.request_kind IS NOT OLD.request_kind OR NEW.request_id IS NOT OLD.request_id
  OR NEW.sender_type IS NOT OLD.sender_type OR NEW.sender_id IS NOT OLD.sender_id OR NEW.message IS NOT OLD.message
  OR NEW.created_at IS NOT OLD.created_at OR OLD.read_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'APPEND_ONLY');
END;

-- ---------------------------------------------------------------- notifications, disputes, risk

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id),
  audience    TEXT NOT NULL CHECK (audience IN ('PLAYER', 'ADMIN')),
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  link        TEXT,
  read_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications (user_id, audience, created_at);
CREATE INDEX idx_notifications_unread ON notifications (user_id, audience, read_at);

CREATE TABLE disputes (
  id                 TEXT PRIMARY KEY,
  dispute_number     INTEGER NOT NULL UNIQUE,
  match_id           TEXT NOT NULL REFERENCES matches (id),
  user_id            TEXT NOT NULL REFERENCES users (id),
  category           TEXT NOT NULL CHECK (category IN ('CONNECTION_PROBLEM', 'INCORRECT_RESULT', 'SUSPECTED_CHEATING', 'SETTLEMENT_PROBLEM', 'OTHER')),
  description        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),
  match_status_at_open TEXT NOT NULL,
  resolution         TEXT,
  resolution_note    TEXT,
  resolution_tx_id   TEXT REFERENCES ledger_transactions (id),
  resolved_by        TEXT REFERENCES users (id),
  resolved_at        INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX idx_disputes_status ON disputes (status, created_at);
CREATE INDEX idx_disputes_user ON disputes (user_id, created_at);
CREATE INDEX idx_disputes_match ON disputes (match_id);
CREATE UNIQUE INDEX ux_disputes_open_per_player ON disputes (match_id, user_id) WHERE status IN ('OPEN', 'UNDER_REVIEW');

CREATE TABLE fraud_flags (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users (id),
  type          TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'REVIEWED', 'DISMISSED', 'CONFIRMED')),
  details       TEXT NOT NULL DEFAULT '{}',
  related_type  TEXT,
  related_id    TEXT,
  dedupe_key    TEXT NOT NULL UNIQUE,
  reviewed_by   TEXT REFERENCES users (id),
  reviewed_at   INTEGER,
  review_note   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_fraud_flags_status ON fraud_flags (status, severity, created_at);
CREATE INDEX idx_fraud_flags_user ON fraud_flags (user_id, status);
CREATE INDEX idx_fraud_flags_related ON fraud_flags (related_type, related_id);

CREATE TABLE audit_logs (
  id             TEXT PRIMARY KEY,
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('ADMIN', 'SYSTEM', 'PLAYER')),
  admin_user_id  TEXT REFERENCES users (id),
  action         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  before_json    TEXT,
  after_json     TEXT,
  reason         TEXT,
  ip             TEXT,
  user_agent     TEXT,
  request_id     TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs (created_at);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id, created_at);
CREATE INDEX idx_audit_admin ON audit_logs (admin_user_id, created_at);
CREATE INDEX idx_audit_action ON audit_logs (action, created_at);
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY'); END;

CREATE TABLE platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT REFERENCES users (id)
);

CREATE TABLE login_security_events (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users (id),
  firebase_uid  TEXT,
  event_type    TEXT NOT NULL CHECK (event_type IN ('REGISTER', 'LOGIN', 'AUTH_FAILED', 'ADMIN_ACCESS_DENIED', 'BLOCKED_STATUS')),
  ip            TEXT,
  country       TEXT,
  user_agent    TEXT,
  detail        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_login_events_user ON login_security_events (user_id, created_at);
CREATE INDEX idx_login_events_created ON login_security_events (created_at);
CREATE INDEX idx_login_events_ip ON login_security_events (ip, created_at);

-- Fixed-window rate limit counters (old windows are purged by the cron job).
CREATE TABLE rate_limit_counters (
  key           TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX idx_rate_limit_window ON rate_limit_counters (window_start);
