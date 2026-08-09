-- Kesmic Practice Manager — initial schema (Cloudflare D1 / SQLite)
--
-- Applied automatically by the GitHub Actions deploy workflow via
-- `wrangler d1 migrations apply`. Never edit an applied migration; add a new one.

-- ---------------------------------------------------------------------------
-- People and sessions
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('associate','senior_associate','manager','partner','admin')),
  title                TEXT,
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  password_hash        TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at        TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- Emails are matched case-insensitively at login, so the uniqueness constraint
-- has to be case-insensitive too.
CREATE UNIQUE INDEX idx_users_email ON users (lower(email));
CREATE INDEX idx_users_role ON users (role, status);

CREATE TABLE sessions (
  -- SHA-256 of the session token; the raw token only ever lives in the cookie.
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Clients and engagements
-- ---------------------------------------------------------------------------

CREATE TABLE clients (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  entity_type     TEXT NOT NULL DEFAULT 'company'
                    CHECK (entity_type IN ('company','individual','partnership','trust','ngo','branch','public_sector')),
  tax_id          TEXT,
  registration_no TEXT,
  industry        TEXT,
  -- Stored as MM-DD; the year varies by period.
  fiscal_year_end TEXT,
  contact_name    TEXT,
  contact_email   TEXT,
  contact_phone   TEXT,
  address         TEXT,
  risk_rating     TEXT NOT NULL DEFAULT 'medium' CHECK (risk_rating IN ('low','medium','high')),
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('prospect','active','dormant','exited')),
  partner_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  manager_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  onboarded_on    TEXT,
  notes           TEXT,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE INDEX idx_clients_status ON clients (status);
CREATE INDEX idx_clients_partner ON clients (partner_id);
CREATE INDEX idx_clients_name ON clients (name);

CREATE TABLE engagements (
  id                    TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  service_line          TEXT NOT NULL,
  period_label          TEXT,
  period_start          TEXT,
  period_end            TEXT,
  fee_amount            REAL,
  currency              TEXT NOT NULL DEFAULT 'GHS',
  budget_hours          REAL,
  status                TEXT NOT NULL DEFAULT 'planned'
                          CHECK (status IN ('planned','active','on_hold','completed','cancelled')),
  partner_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  manager_id            TEXT REFERENCES users(id) ON DELETE SET NULL,
  engagement_letter_ref TEXT,
  notes                 TEXT,
  created_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_engagements_client ON engagements (client_id);
CREATE INDEX idx_engagements_status ON engagements (status);

-- ---------------------------------------------------------------------------
-- Recurring compliance job templates
--
-- Defined before `tasks` because tasks carry a foreign key back to a template.
-- ---------------------------------------------------------------------------

CREATE TABLE task_templates (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  service_line       TEXT NOT NULL,
  task_type          TEXT,
  description        TEXT,
  default_priority   TEXT NOT NULL DEFAULT 'normal',
  default_recurrence TEXT NOT NULL DEFAULT 'none',
  budget_hours       REAL,
  -- JSON array of { label, mandatory }
  checklist          TEXT NOT NULL DEFAULT '[]',
  -- JSON { month_offset, day } describing the statutory filing deadline
  due_date_rule      TEXT,
  internal_lead_days INTEGER NOT NULL DEFAULT 5,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX idx_templates_active ON task_templates (active, service_line);

-- ---------------------------------------------------------------------------
-- Deliverables (tasks)
-- ---------------------------------------------------------------------------

CREATE TABLE tasks (
  id                 TEXT PRIMARY KEY,
  ref                TEXT NOT NULL UNIQUE,
  client_id          TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  engagement_id      TEXT REFERENCES engagements(id) ON DELETE SET NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  service_line       TEXT NOT NULL,
  task_type          TEXT,
  priority           TEXT NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('low','normal','high','urgent')),
  status             TEXT NOT NULL DEFAULT 'not_started'
                       CHECK (status IN ('draft','not_started','in_progress','awaiting_client','on_hold',
                                         'submitted','under_review','rework','approved','closed','cancelled')),
  review_round       INTEGER NOT NULL DEFAULT 0,
  assignee_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewer_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  period_label       TEXT,
  -- Last day of the reporting period this job covers. Statutory deadlines are
  -- derived from it, and recurrence rolls it forward to get the next period.
  period_end         TEXT,
  planned_start_date TEXT,
  internal_due_date  TEXT,
  statutory_due_date TEXT,
  budget_hours       REAL,
  recurrence         TEXT NOT NULL DEFAULT 'none'
                       CHECK (recurrence IN ('none','monthly','quarterly','semiannual','annual')),
  template_id        TEXT REFERENCES task_templates(id) ON DELETE SET NULL,
  -- Who last submitted for review, carried onto the review round record.
  submitted_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at       TEXT,
  approved_at        TEXT,
  closed_at          TEXT,
  created_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX idx_tasks_client ON tasks (client_id);
CREATE INDEX idx_tasks_engagement ON tasks (engagement_id);
CREATE INDEX idx_tasks_assignee ON tasks (assignee_id, status);
CREATE INDEX idx_tasks_reviewer ON tasks (reviewer_id, status);
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_due ON tasks (internal_due_date);
CREATE INDEX idx_tasks_statutory_due ON tasks (statutory_due_date);

CREATE TABLE task_checklist_items (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  label     TEXT NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 0,
  is_done   INTEGER NOT NULL DEFAULT 0,
  done_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_at   TEXT
);

CREATE INDEX idx_checklist_task ON task_checklist_items (task_id, position);

-- ---------------------------------------------------------------------------
-- Review cycle
-- ---------------------------------------------------------------------------

-- One row per review round. A round opens when a reviewer takes up a
-- submission and closes when they approve or return it for rework.
CREATE TABLE task_reviews (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  round        INTEGER NOT NULL,
  reviewer_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TEXT,
  started_at   TEXT NOT NULL,
  decided_at   TEXT,
  decision     TEXT CHECK (decision IN ('approved','rework')),
  summary      TEXT,
  UNIQUE (task_id, round)
);

CREATE INDEX idx_reviews_task ON task_reviews (task_id, round);

-- Individual review points ("review notes") raised within a round. These are
-- the items the preparer has to clear before the deliverable can be approved.
CREATE TABLE review_points (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  review_id     TEXT REFERENCES task_reviews(id) ON DELETE SET NULL,
  round         INTEGER NOT NULL DEFAULT 1,
  seq           INTEGER NOT NULL DEFAULT 1,
  severity      TEXT NOT NULL DEFAULT 'must_fix'
                  CHECK (severity IN ('must_fix','should_fix','observation')),
  body          TEXT NOT NULL,
  -- Free-text pointer to the working paper, schedule or line item at issue.
  reference     TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','addressed','resolved','waived')),
  raised_by     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raised_at     TEXT NOT NULL,
  response      TEXT,
  responded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  responded_at  TEXT,
  closed_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  closed_at     TEXT
);

CREATE INDEX idx_review_points_task ON review_points (task_id, round, seq);
CREATE INDEX idx_review_points_status ON review_points (task_id, status, severity);

-- ---------------------------------------------------------------------------
-- Collaboration, time and audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE task_comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_comments_task ON task_comments (task_id, created_at);

-- Documents live in the firm's existing document store; we record the pointer.
CREATE TABLE task_attachments (
  id       TEXT PRIMARY KEY,
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label    TEXT NOT NULL,
  url      TEXT NOT NULL,
  kind     TEXT,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL
);

CREATE INDEX idx_attachments_task ON task_attachments (task_id);

CREATE TABLE time_entries (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date  TEXT NOT NULL,
  hours      REAL NOT NULL CHECK (hours > 0 AND hours <= 24),
  narrative  TEXT,
  billable   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_time_task ON time_entries (task_id);
CREATE INDEX idx_time_user ON time_entries (user_id, work_date);

-- Append-only audit trail. Nothing in the API updates or deletes these rows.
CREATE TABLE task_events (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_events_task ON task_events (task_id, created_at);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notifications_user ON notifications (user_id, read_at, created_at);

-- Monotonic counters for human-readable references (TSK-000123, CLI-0042 …).
CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

INSERT INTO counters (name, value) VALUES ('task', 0), ('client', 0), ('engagement', 0);
