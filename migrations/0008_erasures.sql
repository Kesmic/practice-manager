-- A record of every erasure.
--
-- The point of this table is that it is not in scope for the thing that writes it.
-- If a period of data is removed, the fact that it was removed, by whom and when
-- survives, so a gap in the records is explainable rather than merely a gap. It is
-- append-only in practice: nothing in the application updates or deletes a row here.

CREATE TABLE IF NOT EXISTS erasures (
  id             TEXT PRIMARY KEY,
  -- Kept even if the account is later removed, so the row never loses its author.
  actor_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name     TEXT NOT NULL,
  actor_email    TEXT NOT NULL,
  -- The period the firm chose, inclusive at both ends.
  period_from    TEXT NOT NULL,
  period_to      TEXT NOT NULL,
  -- Comma-separated scope keys, as named in shared/erase.ts.
  scopes         TEXT NOT NULL,
  -- Counts per scope as JSON, plus the total actually removed.
  removed        TEXT NOT NULL,
  total_removed  INTEGER NOT NULL,
  -- Why the firm erased it. Required by the endpoint: an unexplained gap in the
  -- records is worse than no gap, and the person who knows the reason is the person
  -- pressing the button.
  reason         TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_erasures_created ON erasures(created_at DESC);
