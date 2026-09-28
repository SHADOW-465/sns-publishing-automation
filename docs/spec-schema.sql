-- SQLite schema for the desktop app: the same data the web app keeps in the browser
-- (src/engine/spec/store.ts, BrowserStore). Implement SpecStore over these tables and pass it to
-- setStore() at start-up; nothing else changes.

-- One row per layer: the client's style (level 'client', name = publisher), a series, or a book
-- (name = e-ISBN or title). values/sources/waivers are JSON objects keyed by rule ID (RULES in
-- src/engine/spec/rules.ts).
CREATE TABLE IF NOT EXISTS spec_layer (
  level      TEXT NOT NULL CHECK (level IN ('house', 'client', 'series', 'book')),
  name       TEXT NOT NULL,              -- stored lower-cased and trimmed for lookup
  values_json  TEXT NOT NULL DEFAULT '{}',
  sources_json TEXT NOT NULL DEFAULT '{}',
  waivers_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,              -- ISO 8601
  PRIMARY KEY (level, name)
);

-- Append-only record: never UPDATE or DELETE. This is the proof of what the client set, waived
-- and accepted. snapshot_json holds the full resolved settings for 'accepted' / 'proceeded'.
CREATE TABLE IF NOT EXISTS spec_decision (
  id         TEXT PRIMARY KEY,
  at         TEXT NOT NULL,              -- ISO 8601
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('accepted', 'proceeded', 'waiver', 'waiver-withdrawn', 'import', 'change')),
  client     TEXT NOT NULL,
  book       TEXT NOT NULL,
  rule_id    TEXT,
  detail     TEXT NOT NULL,
  spec_hash  TEXT NOT NULL,
  snapshot_json TEXT
);
CREATE INDEX IF NOT EXISTS spec_decision_book ON spec_decision (client, book, at);

-- Enforce append-only at the database level too.
CREATE TRIGGER IF NOT EXISTS spec_decision_no_update BEFORE UPDATE ON spec_decision
BEGIN SELECT RAISE(ABORT, 'spec_decision is append-only'); END;
CREATE TRIGGER IF NOT EXISTS spec_decision_no_delete BEFORE DELETE ON spec_decision
BEGIN SELECT RAISE(ABORT, 'spec_decision is append-only'); END;
