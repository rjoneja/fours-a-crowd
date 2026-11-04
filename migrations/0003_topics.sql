-- Adds topics plus richer analytics. Run once on a database created before this change:
-- paste into the D1 Console (one statement at a time if it only runs one),
-- or: npx wrangler d1 execute fours-a-crowd --remote --file=migrations/0003_topics.sql
-- Rows recorded before this change were all Premier League.
ALTER TABLE sessions ADD COLUMN topic TEXT;
ALTER TABLE sessions ADD COLUMN end_phase TEXT;
ALTER TABLE sessions ADD COLUMN last_set_id INTEGER;
ALTER TABLE attempts ADD COLUMN topic TEXT;
ALTER TABLE attempts ADD COLUMN pos INTEGER;
ALTER TABLE attempts ADD COLUMN odd_pos INTEGER;
ALTER TABLE attempts ADD COLUMN blurs INTEGER;
ALTER TABLE attempts ADD COLUMN hidden_ms INTEGER;
UPDATE sessions SET topic = 'premier-league' WHERE topic IS NULL;
UPDATE attempts SET topic = 'premier-league' WHERE topic IS NULL;
CREATE INDEX IF NOT EXISTS idx_attempts_topic_set ON attempts(topic, set_id);
