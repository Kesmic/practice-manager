-- The tools the practice works in, the certifications it asks people to hold, and
-- where each person has got to.
--
-- The list is the firm's, not the portal's. A practice picks up Odoo, drops Sage, and
-- the vendors rename their courses every couple of years - so these are rows an
-- administrator maintains rather than names written into the code. Adding a tool is a
-- screen, not a release.
CREATE TABLE practice_tools (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- What kind of thing it is, in the firm's own words: Accounting, Payroll, ERP. Free
  -- text rather than a fixed list, because the next tool will not fit the list.
  category    TEXT,
  sign_in_url TEXT,
  -- The order the firm wants them read in, which is not alphabetical: the tool most of
  -- the practice lives in belongs at the top.
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- No two tools with the same name. Two rows called Xero is two lists of who holds a
-- login, and the firm believing whichever it happened to open.
CREATE UNIQUE INDEX idx_practice_tools_name ON practice_tools (lower(name));

CREATE TABLE tool_certifications (
  id         TEXT PRIMARY KEY,
  tool_id    TEXT NOT NULL REFERENCES practice_tools(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  course_url TEXT,
  -- How long it lasts. NULL means it does not expire, which is a real case: a course
  -- the firm runs on its own procedures is done when it is done. Xero Advisor and the
  -- QuickBooks ProAdvisor certification are both 12.
  validity_months      INTEGER,
  -- Whether a copy of the certificate is wanted, or ticking it off is enough.
  requires_certificate INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_tool_certifications_tool ON tool_certifications (tool_id);

-- A person's login to the practice's account on a tool.
--
-- As with the work email, the portal does not create the account and never holds the
-- password: an administrator invites them at the tool, then records the username here
-- so the person is told and the firm knows who holds what.
CREATE TABLE staff_tool_logins (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id    TEXT NOT NULL REFERENCES practice_tools(id) ON DELETE CASCADE,
  username   TEXT NOT NULL,
  issued_at  TEXT,
  issued_to  TEXT,
  issued_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

-- One login per person per tool.
CREATE UNIQUE INDEX idx_staff_tool_logins ON staff_tool_logins (user_id, tool_id);

-- What the firm has asked somebody to hold, and how far they have got.
--
-- `progress` is what was recorded; the status somebody reads is worked out from it
-- together with the dates, in shared/certifications.ts. Overdue and expired are facts
-- about the calendar rather than about the person, so storing them would mean a row
-- that silently goes stale.
CREATE TABLE staff_certifications (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  certification_id TEXT NOT NULL REFERENCES tool_certifications(id) ON DELETE CASCADE,
  progress         TEXT NOT NULL DEFAULT 'assigned'
                     CHECK (progress IN ('assigned', 'in_progress', 'certified')),
  assigned_at      TEXT NOT NULL,
  assigned_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_on           TEXT,
  started_at       TEXT,
  completed_on     TEXT,
  -- Worked out from the completion date and the certification's validity when it is
  -- marked done, and kept, so that changing how long a certification lasts does not
  -- silently re-date every certificate already issued.
  expires_on       TEXT,

  -- The certificate itself. Held here rather than in `staff_files` because that table's
  -- CHECK constraint names two kinds, and widening it means rebuilding a table that
  -- already holds people's identification. The bytes live in the same R2 bucket under
  -- the same per-person prefix, so account removal sweeps these too.
  object_key       TEXT,
  filename         TEXT,
  content_type     TEXT,
  size_bytes       INTEGER,
  uploaded_at      TEXT,

  last_reminded_at TEXT,
  created_at       TEXT NOT NULL
);

-- One row per person per certification. Asking somebody twice for the same course is
-- two rows disagreeing about whether they hold it.
CREATE UNIQUE INDEX idx_staff_certifications ON staff_certifications (user_id, certification_id);
CREATE INDEX idx_staff_certifications_user ON staff_certifications (user_id);
