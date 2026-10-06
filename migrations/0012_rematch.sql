-- "Play another one": a finished room can point to the next room its players opened.
ALTER TABLE matches ADD COLUMN rematch_match_id TEXT;
