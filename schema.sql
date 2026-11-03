-- Four's a Crowd analytics schema (Cloudflare D1 / SQLite)
-- Apply with: npx wrangler d1 execute fours-a-crowd --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,          -- anonymous id stored in the player's browser
  nickname    TEXT,
  country     TEXT,                      -- from Cloudflare's request.cf.country
  first_seen  INTEGER NOT NULL,          -- unix ms
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,          -- one "go" from kick-off to game over
  player_id   TEXT NOT NULL,
  nickname    TEXT,
  country     TEXT,
  device      TEXT,                      -- mobile | tablet | desktop
  tz          TEXT,
  started_at  INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  ended_at    INTEGER,
  end_reason  TEXT,                      -- out_of_lives | completed | left
  furthest    INTEGER NOT NULL DEFAULT 0,-- highest set number reached (1-based)
  score       INTEGER NOT NULL DEFAULT 0,
  fails       INTEGER NOT NULL DEFAULT 0,
  lives_left  INTEGER NOT NULL DEFAULT 3
);

-- One row per click on a card. These rows are the training data for a future difficulty model.
CREATE TABLE IF NOT EXISTS attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  set_id      INTEGER NOT NULL,
  d           INTEGER,                   -- authored difficulty 1-5
  q_index     INTEGER,                   -- 0-based position in that session
  attempt_no  INTEGER,                   -- 1 = first pick on this set
  correct     INTEGER NOT NULL,          -- 1 / 0
  ms          INTEGER,                   -- ms from set shown to this pick
  chosen      TEXT,
  lives_left  INTEGER,                   -- after this pick
  names_hidden INTEGER DEFAULT 0,        -- how many of the 4 names were hidden (photo-only cards)
  ts          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_set     ON attempts(set_id);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_attempts_ts      ON attempts(ts);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_player  ON sessions(player_id);
