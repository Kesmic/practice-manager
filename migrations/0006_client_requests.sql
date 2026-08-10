-- Client intake: two shareable links, and the requests that arrive through them.
--
-- One link is for organisations that are not clients yet, the other for clients
-- asking for more work. Both are public pages, so nothing here trusts what it is
-- given: a submission is a request for the firm's attention and nothing more. It
-- becomes a client record only when someone at Manager grade or above accepts it.
--
-- Never edit an applied migration; add a new one.

CREATE TABLE client_requests (
  id              TEXT PRIMARY KEY,
  -- REQ-0001. Given back to the sender so they can quote it, and used in the
  -- notification subject line.
  reference       TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('new','existing')),
  status          TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','in_review','accepted','declined')),

  -- What the sender typed. `organisation` is the name they gave; for an existing
  -- client `client_ref` is whatever they believe their reference to be. Neither is
  -- matched automatically: the portal must never confirm to an anonymous visitor
  -- whether a given organisation is a client of the firm.
  organisation    TEXT NOT NULL,
  client_ref      TEXT,
  -- Set when a person matches the request to a client, or when accepting a new
  -- request creates one. ON DELETE SET NULL so removing a client leaves the
  -- request as a record of what was asked rather than deleting the history.
  client_id       TEXT REFERENCES clients(id) ON DELETE SET NULL,

  entity_type     TEXT CHECK (entity_type IS NULL OR entity_type IN
                    ('company','individual','partnership','trust','ngo','branch','public_sector')),
  contact_name    TEXT NOT NULL,
  contact_email   TEXT NOT NULL,
  contact_phone   TEXT,
  tax_id          TEXT,
  registration_no TEXT,
  industry        TEXT,
  -- MM-DD, as on clients: the year varies by period.
  fiscal_year_end TEXT,
  address         TEXT,

  -- JSON array of service line keys, validated against shared/workflow.ts before
  -- it is written. Stored as JSON rather than a join table because it is the
  -- sender's wish list, not a structural fact, and it is never queried across.
  services        TEXT NOT NULL,
  details         TEXT,
  preferred_start TEXT,

  -- SHA-256 of the sender's address salted with the link token. Enough to rate
  -- limit a flood from one place without holding anybody's IP address.
  ip_hash         TEXT,

  handled_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  handled_at      TEXT,
  decision_note   TEXT,

  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- The queue is read by status and age, which is also how the list screen sorts.
CREATE INDEX idx_client_requests_status ON client_requests (status, created_at);
CREATE INDEX idx_client_requests_client ON client_requests (client_id);
-- Supports the rate-limit count, which is by sender within a time window.
CREATE INDEX idx_client_requests_ip ON client_requests (ip_hash, created_at);

INSERT INTO counters (name, value) VALUES ('request', 0);
