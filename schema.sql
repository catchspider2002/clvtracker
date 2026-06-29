-- CLV Tracker D1 schema
-- Apply: wrangler d1 execute clvtracker --remote --file ./schema.sql

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS matches (
  match_id        TEXT PRIMARY KEY,
  home_team       TEXT, away_team TEXT,
  kickoff         INTEGER,            -- ms
  opening_implied TEXT, opening_decimal TEXT, opening_at INTEGER,
  closing_implied TEXT, closing_decimal TEXT, closing_at INTEGER,
  last_rolling_at INTEGER DEFAULT 0,
  outcome         TEXT,               -- home_win | draw | away_win
  final_score     TEXT,
  clv             TEXT,               -- computed CLV breakdown (JSON)
  narrative       TEXT,               -- Claude analysis
  total_movement  REAL,               -- sum of |CLV| across markets (for sorting/leaderboard)
  status          TEXT,               -- open | done
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches (status);

-- Rolling pre-match odds snapshots (for the per-match timeline chart).
CREATE TABLE IF NOT EXISTS rolling (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id  TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  home      REAL, draw REAL, away REAL   -- implied probabilities
);
CREATE INDEX IF NOT EXISTS idx_rolling_match ON rolling (match_id, ts);
