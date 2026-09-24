-- Services and sub-services as things in their own right, not lines of text under a
-- package.
--
-- Until now what a package included was a list of labels per package: "Tax services"
-- under Starter, "Tax services" again under Growth, and so on, with a sub-item hanging
-- off the line above it. That reads well on a proposal and is useless the moment the
-- firm wants to say that one client on Starter also gets Growth's "Directors' PIT
-- compliance": there was no one thing called Directors' PIT compliance to point at.
--
-- So: a catalogue of services (Bookkeeping, Payroll administration, Tax services) with
-- sub-services under them (VAT & levies, Withholding tax, PAYE ...); one row per package
-- per thing it includes; and one row per client per thing they get on top of their
-- package. The old `tier_inclusions` table stays, unread, so that nothing that ran
-- yesterday breaks today; its rows are what seeds the catalogue below.
--
-- `client_subscriptions.service_tier` from 0037 is superseded by the extras table and
-- nothing reads or writes it now. A whole level is too blunt: the firm gives a client
-- one service from the next package up, not the package.

CREATE TABLE package_services (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  -- A sub-service sits under a service: "VAT & levies" under "Tax services". One level
  -- only; a sub-sub-service is a sign the catalogue wants a new service.
  parent_id  TEXT REFERENCES package_services(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  -- Retired rather than deleted once a client has ever had it, so their record keeps
  -- saying what they were given.
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_package_services_parent ON package_services (parent_id, position);

-- What each package includes. A sub-service included here implies its service as a
-- heading; a service included with no sub-services is the whole of it.
CREATE TABLE package_service_inclusions (
  tier       TEXT NOT NULL REFERENCES subscription_tiers(tier) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES package_services(id) ON DELETE CASCADE,
  PRIMARY KEY (tier, service_id)
);

-- What a client gets on top of their package: a service or sub-service that belongs to
-- a higher one. Ended rather than deleted, for the same reason as a discount.
CREATE TABLE client_service_extras (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES package_services(id) ON DELETE CASCADE,
  note       TEXT,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  ended_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  ended_at   TEXT,
  ended_reason TEXT
);

-- One live extra per client per service. Past ones can pile up.
CREATE UNIQUE INDEX idx_client_service_extras_live
  ON client_service_extras (client_id, service_id) WHERE ended_at IS NULL;
CREATE INDEX idx_client_service_extras_client ON client_service_extras (client_id, ended_at);

-- ---------------------------------------------------------------------------
-- Seed the catalogue from what the packages already say, so nothing on a proposal or
-- a package card changes by itself. Distinct names become services; distinct names
-- under a given service become its sub-services; every package keeps what it had.
-- ---------------------------------------------------------------------------

INSERT INTO package_services (id, name, parent_id, position, active, created_at, updated_at)
SELECT 'svc_' || lower(hex(randomblob(6))), label, NULL, MIN(position), 1,
       strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  FROM tier_inclusions
 WHERE parent_id IS NULL
 GROUP BY label;

INSERT INTO package_services (id, name, parent_id, position, active, created_at, updated_at)
SELECT 'svc_' || lower(hex(randomblob(6))), c.label, ps.id, MIN(c.position), 1,
       strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  FROM tier_inclusions c
  JOIN tier_inclusions p ON p.id = c.parent_id
  JOIN package_services ps ON ps.name = p.label AND ps.parent_id IS NULL
 GROUP BY p.label, c.label;

INSERT OR IGNORE INTO package_service_inclusions (tier, service_id)
SELECT t.tier, ps.id
  FROM tier_inclusions t
  JOIN package_services ps ON ps.name = t.label AND ps.parent_id IS NULL
 WHERE t.parent_id IS NULL;

INSERT OR IGNORE INTO package_service_inclusions (tier, service_id)
SELECT c.tier, cs.id
  FROM tier_inclusions c
  JOIN tier_inclusions p ON p.id = c.parent_id
  JOIN package_services ps ON ps.name = p.label AND ps.parent_id IS NULL
  JOIN package_services cs ON cs.name = c.label AND cs.parent_id = ps.id;
