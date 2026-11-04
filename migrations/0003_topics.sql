-- Adds the topic to goes and picks. Run once on a database created before topics existed:
-- paste into the D1 Console, or: npx wrangler d1 execute fours-a-crowd --remote --file=migrations/0003_topics.sql
-- Rows recorded before this change were all Premier League.
ALTER TABLE sessions ADD COLUMN topic TEXT;
ALTER TABLE attempts ADD COLUMN topic TEXT;
UPDATE sessions SET topic = 'premier-league' WHERE topic IS NULL;
UPDATE attempts SET topic = 'premier-league' WHERE topic IS NULL;
CREATE INDEX IF NOT EXISTS idx_attempts_topic_set ON attempts(topic, set_id);
