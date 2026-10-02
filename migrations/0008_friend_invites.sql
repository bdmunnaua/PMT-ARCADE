-- Play with friends: small stakes and a joining reward big enough to play with.
--   * stake games start at 10 PMT (was 5,000 PMT)
--   * every new player gets 1,000 bonus PMT once (was 50), paid from the rewards pool
-- Admins can still change both in Admin -> Settings / Game registry.
UPDATE platform_settings SET value = '10' WHERE key = 'minimum_match_stake';
UPDATE platform_settings SET value = '1000' WHERE key = 'arcade_welcome_bonus_tokens';
UPDATE games SET minimum_stake_units = 1000 WHERE kind = 'ROOM';
