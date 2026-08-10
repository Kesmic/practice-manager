-- Employee portal: HR records, onboarding, and documents that must be read,
-- acknowledged or signed on the portal.
--
-- Sensitive data is deliberately split across three tables rather than widening
-- `users`: general employment facts, personal contact details, and pay/bank
-- details each carry different access rules, and separating them means a query
-- that forgets a filter cannot leak the most sensitive fields.

-- ---------------------------------------------------------------------------
-- Firm-wide settings (welcome message, firm identity)
-- ---------------------------------------------------------------------------

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Employment record
-- ---------------------------------------------------------------------------

CREATE TABLE employee_profiles (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  staff_no            TEXT,
  job_title           TEXT,
  department          TEXT,
  employment_type     TEXT NOT NULL DEFAULT 'permanent'
                        CHECK (employment_type IN ('permanent','fixed_term','probation',
                                                   'intern','contractor','consultant')),
  employment_status   TEXT NOT NULL DEFAULT 'onboarding'
                        CHECK (employment_status IN ('onboarding','probation','active',
                                                     'notice','exited')),
  start_date          TEXT,
  probation_end_date  TEXT,
  confirmed_on        TEXT,
  exit_date           TEXT,
  line_manager_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  work_location       TEXT,

  -- Personal details. Visible to the employee and to HR administrators only, -- deliberately not to a line manager.
  date_of_birth                  TEXT,
  gender                         TEXT,
  marital_status                 TEXT,
  personal_email                 TEXT,
  phone                          TEXT,
  residential_address            TEXT,
  emergency_contact_name         TEXT,
  emergency_contact_phone        TEXT,
  emergency_contact_relationship TEXT,
  next_of_kin_name               TEXT,
  next_of_kin_phone              TEXT,

  -- Professional standing, which matters for an accounting practice.
  highest_qualification TEXT,
  professional_body     TEXT,
  membership_number     TEXT,

  -- Set when the employee first completes their own details during onboarding.
  profile_completed_at TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_profiles_staff_no
  ON employee_profiles (staff_no) WHERE staff_no IS NOT NULL;
CREATE INDEX idx_profiles_status ON employee_profiles (employment_status);
CREATE INDEX idx_profiles_manager ON employee_profiles (line_manager_id);

-- Pay and bank details. Partner grade only, in its own table so that no
-- ordinary employee query can reach it by accident.
CREATE TABLE employee_compensation (
  user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  annual_salary         REAL,
  currency              TEXT NOT NULL DEFAULT 'GHS',
  pay_frequency         TEXT NOT NULL DEFAULT 'monthly'
                          CHECK (pay_frequency IN ('monthly','fortnightly','weekly','hourly')),
  bank_name             TEXT,
  bank_branch           TEXT,
  account_name          TEXT,
  account_number        TEXT,
  tax_identification_no TEXT,
  social_security_no    TEXT,
  notes                 TEXT,
  updated_at            TEXT NOT NULL,
  updated_by            TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Documents: contracts, policies, handbook sections, notices
-- ---------------------------------------------------------------------------

CREATE TABLE documents (
  id       TEXT PRIMARY KEY,
  kind     TEXT NOT NULL
             CHECK (kind IN ('contract','policy','handbook','notice','form')),
  category TEXT,
  title    TEXT NOT NULL,
  summary  TEXT,
  -- Markdown. Rendered to React elements client-side, never injected as HTML.
  body     TEXT NOT NULL,

  -- Incremented whenever the text of a published document changes. Signatures
  -- are recorded per version, so an amended policy needs fresh acknowledgement
  -- and the old record still shows exactly what was agreed before.
  version  INTEGER NOT NULL DEFAULT 1,
  status   TEXT NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft','published','archived')),

  requires_signature       INTEGER NOT NULL DEFAULT 0,
  requires_acknowledgement INTEGER NOT NULL DEFAULT 0,

  -- 'all' targets every employee; 'individual' targets assigned_user_id, which
  -- is how a personal employment contract is issued.
  audience         TEXT NOT NULL DEFAULT 'all'
                     CHECK (audience IN ('all','individual')),
  assigned_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,

  effective_from TEXT,
  position       INTEGER NOT NULL DEFAULT 0,
  published_at   TEXT,
  published_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,

  -- An individually-addressed document must say who it is for.
  CHECK (audience = 'all' OR assigned_user_id IS NOT NULL)
);

CREATE INDEX idx_documents_kind ON documents (kind, status, position);
CREATE INDEX idx_documents_assignee ON documents (assigned_user_id, status);

-- The evidentiary record of agreement.
CREATE TABLE document_signatures (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('acknowledged','signed')),
  -- Typed by the employee; the API requires it to match their recorded name.
  typed_name  TEXT NOT NULL,
  -- SHA-256 of the exact body agreed to, so the record stands even if the
  -- document is later amended.
  content_hash TEXT NOT NULL,
  signed_at    TEXT NOT NULL,
  ip_address   TEXT,
  user_agent   TEXT,
  UNIQUE (document_id, version, user_id)
);

CREATE INDEX idx_signatures_user ON document_signatures (user_id, signed_at);

-- ---------------------------------------------------------------------------
-- Onboarding
-- ---------------------------------------------------------------------------

CREATE TABLE onboarding_items (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  label      TEXT NOT NULL,
  detail     TEXT,
  -- Who is responsible: the new joiner, or the HR administrator.
  owner      TEXT NOT NULL DEFAULT 'employee' CHECK (owner IN ('employee','hr')),
  category   TEXT,
  is_done    INTEGER NOT NULL DEFAULT 0,
  done_at    TEXT,
  done_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_onboarding_user ON onboarding_items (user_id, position);

-- Personnel file: certificates, identification, letters. Stored as links into
-- the firm's document store, consistent with deliverable attachments.
CREATE TABLE employee_documents (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label                TEXT NOT NULL,
  category             TEXT,
  url                  TEXT NOT NULL,
  -- Some personnel-file items are internal (e.g. reference checks).
  visible_to_employee  INTEGER NOT NULL DEFAULT 1,
  expires_on           TEXT,
  added_by             TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at             TEXT NOT NULL
);

CREATE INDEX idx_employee_documents_user ON employee_documents (user_id);

-- Append-only HR audit trail, separate from the deliverable trail.
CREATE TABLE hr_events (
  id            TEXT PRIMARY KEY,
  subject_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,
  detail        TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_hr_events_subject ON hr_events (subject_id, created_at);
