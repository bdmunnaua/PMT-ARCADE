-- 1) Messages from players to the team: advice, requests, problems. Admins read and reply.
CREATE TABLE player_messages (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id),
  category     TEXT NOT NULL CHECK (category IN ('ADVICE', 'REQUEST', 'PROBLEM', 'OTHER')),
  body         TEXT NOT NULL CHECK (length(body) BETWEEN 5 AND 2000),
  status       TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'READ', 'REPLIED', 'CLOSED')),
  admin_reply  TEXT,
  replied_by   TEXT REFERENCES users (id),
  replied_at   INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_player_messages_status ON player_messages (status, created_at);
CREATE INDEX idx_player_messages_user ON player_messages (user_id, created_at);

-- 2) Creator rewards: a player who has played makes an original post about PMT Arcade, submits the
--    link, and an admin approves it. One reward per account and per social account per campaign.
CREATE TABLE creator_submissions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id),
  campaign       INTEGER NOT NULL DEFAULT 1,
  platform       TEXT NOT NULL CHECK (platform IN ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'OTHER')),
  post_url       TEXT NOT NULL,
  social_handle  TEXT NOT NULL,
  social_key     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  review_note    TEXT,
  reviewed_by    TEXT REFERENCES users (id),
  reviewed_at    INTEGER,
  reward_units   INTEGER,
  reward_tx_id   TEXT REFERENCES ledger_transactions (id),
  ip             TEXT,
  user_agent     TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (campaign, user_id),
  UNIQUE (campaign, social_key),
  UNIQUE (post_url)
);
CREATE INDEX idx_creator_submissions_status ON creator_submissions (campaign, status, created_at);
