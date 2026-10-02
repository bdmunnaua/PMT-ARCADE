-- Players can play the room games (Ludo, Call Bridge, 29, Carrom, Chess) straight away, without an
-- admin switching them on. While bKash buy/sell and crypto withdrawals stay off, every stake is free
-- (bonus) PMT: no taka goes in or out. Aviator stays off (the house can lose there).
UPDATE platform_settings SET value = 'true' WHERE key = 'games_enabled';
