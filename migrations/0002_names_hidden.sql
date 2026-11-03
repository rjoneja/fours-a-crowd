-- Run once on a database created before photos were added:
-- npx wrangler d1 execute fours-a-crowd --remote --file=migrations/0002_names_hidden.sql
ALTER TABLE attempts ADD COLUMN names_hidden INTEGER DEFAULT 0;
