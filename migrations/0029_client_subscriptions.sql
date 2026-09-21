-- What a client subscribes to, what it costs them, and who may sign in to look at it.
--
-- shared/subscriptions.ts argues for the shape of this. Briefly: the firm sells one
-- thing at one of three tiers, the tiers are contractual and fixed, and everything else
-- here - the criteria a client is measured on, the ceilings each tier sets, the fees - is
-- data the firm edits.
--
-- The tiers are NOT a table. `client_allocations.tier` already has a CHECK constraint on
-- 'starter'/'growth'/'enterprise', Schedule 2 of the Associate agreement names those
-- three and prices what associates are paid by them, and a fourth tier added through a
-- settings screen would be a tier no signed agreement has heard of. What was missing was
-- never the tiers; it was the other side of them - what the client pays - and that is
-- what `subscription_tiers` below holds.

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

-- What the firm prices on. Seeded with the three the tier descriptions in
-- shared/allocations.ts already imply, and extended by the firm whenever it starts
-- pricing on something else - bank accounts, branches, VAT registration.
CREATE TABLE subscription_criteria (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  unit         TEXT NOT NULL CHECK (unit IN ('count', 'money')),
  -- How the firm arrives at the number. Shown wherever one is entered or read, because
  -- "470 transactions" means nothing without "averaged over three months".
  how_measured TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Two people must not be able to add "Staff" and "staff on payroll" and then record
-- figures against different ones for the same client.
CREATE UNIQUE INDEX idx_subscription_criteria_name
  ON subscription_criteria (name COLLATE NOCASE);

-- What each tier costs a client. One row per tier, made at migration time so the
-- settings screen edits rather than creates - there will only ever be these three.
--
-- The fee is nullable and starts null on purpose: the firm's own prices are not
-- something a migration should invent. Until a Partner sets them, the screens say the
-- fee has not been set rather than showing a made-up number.
CREATE TABLE subscription_tiers (
  tier        TEXT PRIMARY KEY CHECK (tier IN ('starter', 'growth', 'enterprise')),
  monthly_fee REAL,
  currency    TEXT NOT NULL DEFAULT 'GHS',
  -- What the tier covers, in the firm's words, shown to the client.
  summary     TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- The ceiling each tier puts on each criterion. A missing row and a null ceiling both
-- mean "no ceiling", which is what makes the top tier catch everybody.
CREATE TABLE tier_ceilings (
  tier         TEXT NOT NULL CHECK (tier IN ('starter', 'growth', 'enterprise')),
  criterion_id TEXT NOT NULL REFERENCES subscription_criteria(id) ON DELETE CASCADE,
  ceiling      REAL,
  PRIMARY KEY (tier, criterion_id)
);

-- Work sold on its own, outside any tier. Not seeded: these are the firm's services at
-- the firm's prices, and guessing at either would put invented fees in front of clients.
CREATE TABLE additional_services (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  summary      TEXT,
  fee          REAL,
  fee_basis    TEXT NOT NULL DEFAULT 'fixed' CHECK (fee_basis IN ('fixed', 'daily', 'from')),
  currency     TEXT NOT NULL DEFAULT 'GHS',
  -- Which of the firm's service lines this belongs to, so the work it becomes lands in
  -- the right place. Free text against shared/workflow.ts rather than a CHECK, so a new
  -- service line does not need a table rebuild.
  service_line TEXT,
  -- Retired rather than deleted, because client_services rows point at it.
  active       INTEGER NOT NULL DEFAULT 1,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_additional_services_name
  ON additional_services (name COLLATE NOCASE);

-- ---------------------------------------------------------------------------
-- Client logins
-- ---------------------------------------------------------------------------
--
-- A separate table from `users`, and this is the single most important decision in this
-- migration.
--
-- The obvious alternative - a 'client' value added to the role CHECK on `users` - would
-- mean every `requireRole` call already written, and every query that says "all active
-- users", silently starts including clients. There are dozens of both. One of them being
-- wrong is a client reading somebody's payroll. Held in its own table with its own
-- sessions, a client session cannot satisfy a staff check at all, because the staff path
-- never looks in here.
CREATE TABLE client_users (
  id            TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  -- Null until they accept their invitation and set one. The firm never knows a
  -- client's password: nobody types a temporary one on their behalf.
  password_hash TEXT,
  status        TEXT NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited', 'active', 'suspended')),
  invited_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  invited_at    TEXT,
  accepted_at   TEXT,
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- One address, one login, across every client. Two clients naming the same accountant
-- would otherwise give one address two sign-ins and no way to tell which is meant.
CREATE UNIQUE INDEX idx_client_users_email ON client_users (email COLLATE NOCASE);
CREATE INDEX idx_client_users_client ON client_users (client_id, status);

-- The one-time link that lets somebody set their first password. The row holds the
-- SHA-256 of the token, never the token, so a copy of this table opens nothing.
CREATE TABLE client_invitations (
  id             TEXT PRIMARY KEY,
  client_user_id TEXT NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  expires_at     TEXT NOT NULL,
  used_at        TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_client_invitations_user ON client_invitations (client_user_id);

-- Client sessions, in their own table for the reason above. Same shape as `sessions`:
-- the id is the SHA-256 of the cookie's token.
CREATE TABLE client_sessions (
  id             TEXT PRIMARY KEY,
  client_user_id TEXT NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  user_agent     TEXT
);

CREATE INDEX idx_client_sessions_user ON client_sessions (client_user_id);

-- ---------------------------------------------------------------------------
-- What a client is on
-- ---------------------------------------------------------------------------

-- One subscription per client. The fee is held here as well as on the tier so that a
-- client on a negotiated rate keeps it when the tier's list price changes; null means
-- "whatever the tier says", which is the ordinary case.
CREATE TABLE client_subscriptions (
  client_id   TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  tier        TEXT NOT NULL CHECK (tier IN ('starter', 'growth', 'enterprise')),
  monthly_fee REAL,
  currency    TEXT NOT NULL DEFAULT 'GHS',
  started_on  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'ended')),
  ended_on    TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_client_subscriptions_tier ON client_subscriptions (status, tier);

-- What was measured, kept as history rather than overwritten.
--
-- History because the interesting question is rarely "how many transactions now" but
-- "how long have they been over" - a client one month past a ceiling is noise, three
-- months past it is a conversation. The screens read the newest row per criterion; the
-- older ones are what make the trend readable.
CREATE TABLE client_figures (
  id           TEXT PRIMARY KEY,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL REFERENCES subscription_criteria(id) ON DELETE CASCADE,
  value        REAL NOT NULL,
  -- The date the figure describes, not the date it was typed. A February figure entered
  -- in April is still a February figure.
  as_of        TEXT NOT NULL,
  note         TEXT,
  recorded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  recorded_at  TEXT NOT NULL
);

-- One figure per criterion per date, so recording August twice corrects it rather than
-- quietly keeping both and letting "newest" pick between them by insertion order.
CREATE UNIQUE INDEX idx_client_figures_one_per_date
  ON client_figures (client_id, criterion_id, as_of);
CREATE INDEX idx_client_figures_latest
  ON client_figures (client_id, criterion_id, as_of DESC);

-- Every change to a subscription, so what somebody paid and when is answerable later.
CREATE TABLE subscription_events (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL
               CHECK (kind IN ('subscribed', 'moved', 'fee_changed', 'paused',
                               'resumed', 'ended')),
  from_tier  TEXT,
  to_tier    TEXT,
  from_fee   REAL,
  to_fee     REAL,
  detail     TEXT,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_subscription_events_client
  ON subscription_events (client_id, created_at DESC);

-- A piece of additional work, from the client asking to the firm delivering.
CREATE TABLE client_services (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Nulled rather than cascaded if the catalogue entry is ever removed: what the client
  -- asked for and what they were charged has to survive the firm reorganising its menu.
  service_id        TEXT REFERENCES additional_services(id) ON DELETE SET NULL,
  -- Copied at the moment of asking, for the same reason.
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'quoted', 'agreed', 'delivered',
                                        'declined')),
  quoted_fee        REAL,
  currency          TEXT NOT NULL DEFAULT 'GHS',
  note              TEXT,
  -- Which of the two sides started it. Null on both means a Partner added it directly.
  requested_by      TEXT REFERENCES client_users(id) ON DELETE SET NULL,
  requested_at      TEXT,
  quoted_at         TEXT,
  decided_at        TEXT,
  delivered_at      TEXT,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_client_services_client ON client_services (client_id, status);

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------
--
-- The three criteria and their ceilings, because the firm has already written them
-- down. shared/allocations.ts describes Starter as "One to five members of staff and a
-- low volume of transactions", Growth as "Six to twenty-five members of staff and
-- moderate complexity", Enterprise as "Twenty-six or more members of staff, and a high
-- volume or complexity". The staff ceilings below are those sentences. The transaction
-- and turnover ceilings are a starting point the firm will move; they are seeded so the
-- screens have something to show rather than an empty settings page nobody knows how to
-- fill in.
--
-- No fees are seeded. Those are the firm's prices, and a migration must not invent them.

INSERT INTO subscription_criteria (id, name, unit, how_measured, position, created_at) VALUES
  ('crit_transactions', 'Transactions a month', 'count',
   'Averaged over three months, from the client''s bank and cash books.', 0,
   '2026-09-21T00:00:00.000Z'),
  ('crit_staff', 'Staff on payroll', 'count',
   'Headcount on the most recent payroll run.', 1,
   '2026-09-21T00:00:00.000Z'),
  ('crit_turnover', 'Annual turnover', 'money',
   'Rolling twelve months.', 2,
   '2026-09-21T00:00:00.000Z');

INSERT INTO subscription_tiers (tier, currency, summary, updated_at) VALUES
  ('starter', 'GHS',
   'Bookkeeping, statutory filings and the annual accounts. For a small business with a low volume of transactions.',
   '2026-09-21T00:00:00.000Z'),
  ('growth', 'GHS',
   'Adds payroll, VAT and PAYE, and advice each quarter. For a business of moderate size and complexity.',
   '2026-09-21T00:00:00.000Z'),
  ('enterprise', 'GHS',
   'Bookkeeping weekly rather than monthly, a named manager, an audit-readiness review, and advice each month.',
   '2026-09-21T00:00:00.000Z');

-- Starter: one to five staff, a low volume.
INSERT INTO tier_ceilings (tier, criterion_id, ceiling) VALUES
  ('starter', 'crit_transactions', 100),
  ('starter', 'crit_staff', 5),
  ('starter', 'crit_turnover', 500000),
-- Growth: six to twenty-five staff, moderate complexity.
  ('growth', 'crit_transactions', 500),
  ('growth', 'crit_staff', 25),
  ('growth', 'crit_turnover', 5000000),
-- Enterprise: twenty-six or more, high volume. No ceilings, which is what makes it the
-- tier everybody who does not fit below lands on.
  ('enterprise', 'crit_transactions', NULL),
  ('enterprise', 'crit_staff', NULL),
  ('enterprise', 'crit_turnover', NULL);
