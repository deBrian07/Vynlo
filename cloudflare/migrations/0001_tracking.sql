CREATE TABLE IF NOT EXISTS trackings (
  id TEXT PRIMARY KEY CHECK(length(id) = 64),
  read_hash TEXT NOT NULL CHECK(length(read_hash) = 64),
  delete_hash TEXT NOT NULL CHECK(length(delete_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  armed_at INTEGER,
  first_opened_at INTEGER,
  last_opened_at INTEGER,
  open_count INTEGER NOT NULL DEFAULT 0 CHECK(open_count BETWEEN 0 AND 1000)
);
CREATE INDEX IF NOT EXISTS trackings_expiry ON trackings(expires_at);
