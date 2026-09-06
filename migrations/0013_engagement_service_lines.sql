-- An engagement may cover more than one service line.
--
-- The original model gave each engagement exactly one, which is wrong about how the
-- work is actually sold. A single signed letter and a single fee routinely cover
-- bookkeeping, payroll and tax compliance together - the whole point of a subscription
-- engagement - and forcing that into one line meant either three engagements where the
-- client signed one, or two of the three service lines quietly disappearing from the
-- record.
--
-- A join table rather than a widened column, for the reason a join table usually wins:
-- the set has no fixed size, and the list filter has to be able to ask "which
-- engagements touch payroll" without scanning strings.
--
-- `engagements.service_line` is deliberately NOT dropped. Migrations here run before
-- the new Worker goes out, so for a few seconds the released Worker is reading this
-- schema, and it selects that column and filters on it. It keeps its meaning as the
-- engagement's PRIMARY service line - the one it is principally filed under, and the
-- first one chosen - and is also carried in the join table, so a query against either
-- is correct. Nothing has to know about both.
CREATE TABLE IF NOT EXISTS engagement_service_lines (
  engagement_id TEXT NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  service_line  TEXT NOT NULL,
  -- Position 0 is the primary line, mirroring `engagements.service_line`. Ordering is
  -- stored rather than derived so the form gives back the list in the order it was
  -- shown, and so "the primary is the first one" survives a round trip.
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (engagement_id, service_line)
);

-- The filter's query: every engagement touching one service line.
CREATE INDEX IF NOT EXISTS idx_engagement_lines_line
  ON engagement_service_lines (service_line, engagement_id);

-- Every engagement that already exists covers exactly the one line it was created
-- with. Backfilled rather than left empty so that after this migration the join table
-- is the complete picture for every engagement, old and new, and no read has to fall
-- back to the column for rows that predate it.
INSERT OR IGNORE INTO engagement_service_lines (engagement_id, service_line, position)
SELECT id, service_line, 0 FROM engagements;
