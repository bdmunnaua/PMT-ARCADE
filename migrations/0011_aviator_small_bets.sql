-- Aviator: bets from 10 PMT (was 1,000 PMT), so the quick amounts 10 / 50 / 100 / 500 all work.
-- Aviator stays switched off until an admin enables it in Game registry (and funds the house bankroll).
UPDATE games SET minimum_stake_units = 1000 WHERE id = 'game-04';
