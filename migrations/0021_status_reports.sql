-- Twice-weekly written status reports.
--
-- One report per person per reporting day, covering everything assigned to them, with
-- the deliverables it concerns named as references. Not one report per deliverable:
-- that would ask somebody carrying nine open jobs to write nine reports twice a week,
-- which is how a reporting requirement becomes a ritual everybody satisfies and nobody
-- reads.

CREATE TABLE IF NOT EXISTS status_reports (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The reporting day this report answers for, as YYYY-MM-DD. Not the day it was
  -- written: a Wednesday report handed in on Thursday is still Wednesday's report, and
  -- recording it against Thursday would hide that it was late.
  due_on      TEXT NOT NULL,
  -- The first day the report covers. Stored rather than recomputed, so that changing
  -- the firm's reporting days later does not silently re-describe what an already
  -- submitted report was answering for.
  period_from TEXT NOT NULL,
  body        TEXT NOT NULL,
  -- What is in the person's way. Separate from the narrative because it is the part a
  -- manager reads first, and a blocker buried in the fourth paragraph is a blocker
  -- nobody acted on.
  blockers    TEXT,
  submitted_at TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  -- One report per person per reporting day. A second submission amends the first
  -- rather than creating a parallel account of the same days.
  UNIQUE (user_id, due_on)
);

CREATE INDEX IF NOT EXISTS idx_status_reports_due
  ON status_reports (due_on, user_id);

CREATE INDEX IF NOT EXISTS idx_status_reports_user
  ON status_reports (user_id, due_on DESC);

-- The deliverables a report is about.
--
-- A join table rather than a list of ids in a column, so that a report can be found
-- from the deliverable as well as the other way round - "what has been said about this
-- job" is the question a reviewer actually asks.
CREATE TABLE IF NOT EXISTS status_report_tasks (
  report_id TEXT NOT NULL REFERENCES status_reports(id) ON DELETE CASCADE,
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- What this report says about this one deliverable, where the person wanted to say
  -- something specific. Optional: naming the job as covered is itself information.
  note      TEXT,
  PRIMARY KEY (report_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_status_report_tasks_task
  ON status_report_tasks (task_id);

-- Which days of the week the firm requires reports on, as ISO weekday numbers
-- (Monday 1 ... Sunday 7). "3,5" is Wednesdays and Fridays, which is the default and
-- what a new deployment gets. "off" switches the requirement off entirely.
--
-- Held in settings rather than in code so that a practice whose filing week runs
-- differently can say so without a deployment. Edited through /api/status-report-policy,
-- which validates it - a malformed value here would otherwise ask the whole firm for
-- reports on days that do not exist.
INSERT INTO settings (key, value, updated_at)
  VALUES ('status_report_days', '3,5', datetime('now'))
  ON CONFLICT (key) DO NOTHING;
