-- Reference data: RBAC matrix (mirrors packages/shared/src/permissions.ts — a test keeps them in sync),
-- system wallets, public-number counters, the 10 game registry slots and default settings.

INSERT INTO admin_roles (id, name, description, created_at) VALUES ('SUPER_ADMIN', 'Super Admin', 'Every permission, including treasury issuance, adjustments, settings and administrators.', 0);
INSERT INTO admin_roles (id, name, description, created_at) VALUES ('FINANCE_ADMIN', 'Finance Admin', 'Buy/sell requests, finance chat, token distribution, ledger and integrity checks.', 0);
INSERT INTO admin_roles (id, name, description, created_at) VALUES ('GAME_ADMIN', 'Game Admin', 'Game registry, matches and disputes.', 0);
INSERT INTO admin_roles (id, name, description, created_at) VALUES ('SUPPORT_ADMIN', 'Support Admin', 'Views players, requests and matches; writes support notes. Cannot move tokens.', 0);
INSERT INTO admin_roles (id, name, description, created_at) VALUES ('RISK_ADMIN', 'Risk Admin', 'Fraud flags, account restrictions, login activity and audit logs.', 0);

INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'players.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'players.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'players.view_sensitive');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'support.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'support.notes');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'finance.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'finance.buy.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'finance.sell.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'finance.chat');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'finance.distribute');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'finance.treasury');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'finance.ledger.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'finance.integrity');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'games.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'games.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'matches.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'matches.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'disputes.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'disputes.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'risk.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'risk.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'security.login_activity');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'audit.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'admins.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'settings.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'settings.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPER_ADMIN', 'dev.simulator');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'players.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'players.view_sensitive');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'finance.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'finance.buy.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'finance.sell.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'finance.chat');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'finance.distribute');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'finance.ledger.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'finance.integrity');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'risk.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'matches.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('FINANCE_ADMIN', 'settings.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('GAME_ADMIN', 'players.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('GAME_ADMIN', 'games.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('GAME_ADMIN', 'games.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('GAME_ADMIN', 'matches.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('GAME_ADMIN', 'matches.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('GAME_ADMIN', 'disputes.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('GAME_ADMIN', 'disputes.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('GAME_ADMIN', 'settings.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('GAME_ADMIN', 'dev.simulator');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPPORT_ADMIN', 'players.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPPORT_ADMIN', 'support.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPPORT_ADMIN', 'support.notes');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPPORT_ADMIN', 'finance.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPPORT_ADMIN', 'matches.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPPORT_ADMIN', 'disputes.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('SUPPORT_ADMIN', 'games.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'players.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'players.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'players.view_sensitive');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'risk.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'risk.manage');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'security.login_activity');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'audit.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'finance.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'finance.ledger.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'matches.view');
INSERT INTO admin_permissions (role_id, permission) VALUES ('RISK_ADMIN', 'disputes.view');

-- System wallets. ISSUANCE is the only account allowed to go negative (−total issued supply).
INSERT INTO wallet_accounts (id, owner_type, user_id, bucket, balance, allow_negative, created_at, updated_at) VALUES ('sys_admin_treasury', 'SYSTEM', NULL, 'ADMIN_TREASURY', 0, 0, 0, 0);
INSERT INTO wallet_accounts (id, owner_type, user_id, bucket, balance, allow_negative, created_at, updated_at) VALUES ('sys_platform_fees', 'SYSTEM', NULL, 'PLATFORM_FEES', 0, 0, 0, 0);
INSERT INTO wallet_accounts (id, owner_type, user_id, bucket, balance, allow_negative, created_at, updated_at) VALUES ('sys_issuance', 'SYSTEM', NULL, 'ISSUANCE', 0, 1, 0, 0);
INSERT INTO wallet_accounts (id, owner_type, user_id, bucket, balance, allow_negative, created_at, updated_at) VALUES ('sys_house_bankroll', 'SYSTEM', NULL, 'HOUSE_BANKROLL', 0, 0, 0, 0);
INSERT INTO wallet_accounts (id, owner_type, user_id, bucket, balance, allow_negative, created_at, updated_at) VALUES ('sys_rewards_pool', 'SYSTEM', NULL, 'REWARDS_POOL', 0, 0, 0, 0);

-- Counters hold the LAST issued value. First player = #100001.
INSERT INTO counters (name, value) VALUES ('player_number', 100000);
INSERT INTO counters (name, value) VALUES ('buy_request', 1000);
INSERT INTO counters (name, value) VALUES ('sell_request', 1000);
INSERT INTO counters (name, value) VALUES ('match', 1000);
INSERT INTO counters (name, value) VALUES ('dispute', 1000);
INSERT INTO counters (name, value) VALUES ('crash_round', 0);

-- Game registry: 10 configurable slots. Slots 1–6 have installed modules; 7–10 are free.
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-01', 'ludo', 'Ludo', 'Classic Ludo for 2–4 players. Roll a 6 to enter, capture opponents, bring all four tokens home first to win the pot.', '/games/ludo.svg', 'ludo', 'ROOM', 1, 0, 500000, 1000000000, 2, 4, '1.0.0', 1, 0, 0);
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-02', 'call-bridge', 'Call Bridge', 'Bangladesh-style Call Bridge (Call Break) for 4 players. Call your tricks, spades are trump, highest score after 5 rounds wins.', '/games/call-bridge.svg', 'call-bridge', 'ROOM', 1, 0, 500000, 1000000000, 4, 4, '1.0.0', 2, 0, 0);
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-03', 'twenty-nine', 'Twenty-Nine (29)', 'The Bangladeshi team card game: bid 16–28, set a hidden trump, partners win together.', '/games/twenty-nine.svg', 'twenty-nine', 'ROOM', 1, 0, 500000, 1000000000, 4, 4, '1.0.0', 3, 0, 0);
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-04', 'aviator', 'Aviator', 'Crash game: the plane climbs, the multiplier rises — cash out before it flies away. Provably fair rounds.', '/games/aviator.svg', 'aviator', 'CRASH', 0, 0, 100000, 100000000, 1, 1, '1.0.0', 4, 0, 0);
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-05', 'carrom', 'Carrom', 'Bangladesh’s favourite board game. Pocket all your coins and cover the queen to win.', '/games/carrom.svg', 'carrom', 'ROOM', 1, 0, 500000, 1000000000, 2, 2, '1.0.0', 5, 0, 0);
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-06', 'chess', 'Chess', 'Blitz chess, 5 minutes + 3 seconds per move. Checkmate, flag or resignation decides the winner.', '/games/chess.svg', 'chess', 'ROOM', 1, 0, 500000, 1000000000, 2, 2, '1.0.0', 6, 0, 0);
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-07', 'game-07', 'Game 07', 'Coming Soon', NULL, NULL, 'ROOM', 0, 0, 1000, 10000000, 2, 2, '0.0.0', 7, 0, 0);
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-08', 'game-08', 'Game 08', 'Coming Soon', NULL, NULL, 'ROOM', 0, 0, 1000, 10000000, 2, 2, '0.0.0', 8, 0, 0);
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-09', 'game-09', 'Game 09', 'Coming Soon', NULL, NULL, 'ROOM', 0, 0, 1000, 10000000, 2, 2, '0.0.0', 9, 0, 0);
INSERT INTO games (id, slug, name, description, thumbnail_url, module_key, kind, enabled, maintenance_mode, minimum_stake_units, maximum_stake_units, minimum_players, maximum_players, game_version, sort_order, created_at, updated_at) VALUES ('game-10', 'game-10', 'Game 10', 'Coming Soon', NULL, NULL, 'ROOM', 0, 0, 1000, 10000000, 2, 2, '0.0.0', 10, 0, 0);

-- Default platform settings (JSON values). Changed only through the audited admin settings API.
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('platform_name', '"PMT Arcade"', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('maintenance_mode', 'false', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('MATCH_FEE_BPS', '100', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('BUY_TOKENS_PER_BDT', '1000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('SELL_TOKENS_PER_BDT', '1100', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('minimum_buy_bdt', '100', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('maximum_buy_bdt', '50000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('minimum_sell_tokens', '110000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('maximum_sell_tokens', '55000000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('minimum_match_stake', '5000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('maximum_match_stake', '10000000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('buy_requests_enabled', 'true', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('sell_requests_enabled', 'true', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('games_enabled', 'true', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('enabled_payment_methods', '["BKASH_MANUAL"]', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('bkash_receiving_number', '""', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('payment_provider_notice', '"Send the exact amount from your own bKash account, then submit the transaction ID. Never share your bKash PIN or OTP with anyone — we will never ask for it."', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('large_transaction_tokens', '10000000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('crash_max_multiplier_x100', '10000', 0, NULL);
INSERT INTO platform_settings (key, value, updated_at, updated_by) VALUES ('crash_max_profit_tokens', '1000000', 0, NULL);
