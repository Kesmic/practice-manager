-- Growth partners: people outside the firm who sell for it.
--
-- shared/growth-partners.ts holds the arrangement and argues for the shape. Four things
-- in here follow from it and are worth reading before changing anything.
--
-- **A third population, in its own tables.** Staff are in `users`, clients in
-- `client_users`, and growth partners here. The obvious design - another value in the
-- role CHECK on `users` - would mean every `requireRole` already written, and every
-- query that says "all active users", silently starts including people who do not work
-- for the firm. worker/client-auth.ts makes the same argument at greater length, and it
-- applies word for word.
--
-- **The hold is held by an index.** Registering a prospect buys ninety days of
-- exclusivity on that business, and two partners working the same company and both
-- claiming it is the failure the whole idea exists to prevent. A partial unique index on
-- a normalised name is what actually stops the second registration, rather than a check
-- in a route that two people pressing the button at once could both pass.
--
-- **A commission is a row, accrued once per invoice.** The unique index on `invoice_id`
-- is what makes accrual safe to repeat: a run that fails half way, or an invoice issued
-- twice by a retry, cannot pay a partner twice for the same month.
--
-- **A partner never marks their own prospect won.** That is in the stage machine rather
-- than here, but the `client_id` column is why it matters: won means the firm has a
-- signed client, and a partner who could declare it would be declaring their own
-- commission.

-- ---------------------------------------------------------------------------
-- Who they are
-- ---------------------------------------------------------------------------

CREATE TABLE growth_partners (
  id            TEXT PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  -- The business they sell through, where they have one. Many do not.
  business_name TEXT,

  -- They apply; the firm admits them. An applicant has no portal beyond the page that
  -- says the firm is looking at it.
  status        TEXT NOT NULL DEFAULT 'applied'
                  CHECK (status IN ('applied', 'active', 'suspended', 'ended')),

  -- Null until they set one from a one-time link. The firm never knows it.
  password_hash TEXT,

  -- The terms as they stand for this partner. Held per partner rather than read from a
  -- constant, because a deal struck with somebody in 2026 must not change because the
  -- firm's standard terms changed in 2028.
  commission_rate   REAL NOT NULL DEFAULT 25,
  commission_months INTEGER NOT NULL DEFAULT 6,
  hold_days         INTEGER NOT NULL DEFAULT 90,

  -- What they signed to work this way, and when.
  agreement_signed_at TEXT,
  agreement_copy_key  TEXT,

  applied_at   TEXT NOT NULL,
  approved_at  TEXT,
  approved_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  ended_at     TEXT,
  ended_reason TEXT,
  note         TEXT,
  last_login_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- One account per address, however it is capitalised.
CREATE UNIQUE INDEX idx_growth_partners_email ON growth_partners (email COLLATE NOCASE);
CREATE INDEX idx_growth_partners_status ON growth_partners (status, full_name);

-- Their sessions, in their own table for the reason in the header. Same shape as
-- `sessions` and `client_sessions`: the id is the SHA-256 of the cookie's token.
CREATE TABLE growth_partner_sessions (
  id           TEXT PRIMARY KEY,
  partner_id   TEXT NOT NULL REFERENCES growth_partners(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
);

CREATE INDEX idx_growth_partner_sessions_partner
  ON growth_partner_sessions (partner_id);

-- One-time links: the invitation that lets them set a password, and the reset that lets
-- them set another. The id is the digest of the token, never the token.
CREATE TABLE growth_partner_invitations (
  id         TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES growth_partners(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_growth_partner_invitations_partner
  ON growth_partner_invitations (partner_id);

-- ---------------------------------------------------------------------------
-- What they are working on
-- ---------------------------------------------------------------------------

CREATE TABLE partner_prospects (
  id         TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES growth_partners(id) ON DELETE CASCADE,

  business_name TEXT NOT NULL,
  -- The name with case, punctuation and the company suffix taken out, which is what two
  -- registrations of one business collide on. Written by the Worker from
  -- shared/growth-partners.ts so the index and the screens agree about what a collision
  -- is.
  name_key      TEXT NOT NULL,

  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  sector        TEXT,
  note          TEXT,

  stage TEXT NOT NULL DEFAULT 'registered'
          CHECK (stage IN ('registered', 'pitching', 'proposal_sent',
                           'contract_sent', 'won', 'lost')),

  registered_on TEXT NOT NULL,
  -- Ninety days on, and the firm may push it out where a sale is genuinely still moving.
  hold_until    TEXT NOT NULL,
  hold_extended_at   TEXT,
  hold_extended_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  hold_extension_note TEXT,

  -- Set by the firm when the prospect becomes a client. Never by the partner.
  client_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
  won_on      TEXT,
  lost_at     TEXT,
  lost_reason TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_partner_prospects_partner ON partner_prospects (partner_id, stage);
CREATE INDEX idx_partner_prospects_client ON partner_prospects (client_id);

-- The hold itself. One live registration of a business across every partner: a second
-- one fails on the write rather than on a check that could race.
--
-- 'lost' is outside it deliberately - a partner who has been told no releases the
-- business at once, and somebody else may register it the same afternoon.
CREATE UNIQUE INDEX idx_partner_prospects_hold
  ON partner_prospects (name_key)
  WHERE stage IN ('registered', 'pitching', 'proposal_sent', 'contract_sent', 'won');

-- ---------------------------------------------------------------------------
-- What they send
-- ---------------------------------------------------------------------------

-- A proposal is a document, not a view: what it quoted is written onto it and never
-- recomputed, for the reason an invoice's figures are frozen. A prospect holding a PDF
-- that says GHS 4,500 and a portal that says otherwise because the package was repriced
-- is the worst outcome this feature has available to it.
CREATE TABLE partner_proposals (
  id          TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES partner_prospects(id) ON DELETE CASCADE,
  partner_id  TEXT NOT NULL REFERENCES growth_partners(id) ON DELETE CASCADE,
  reference   TEXT NOT NULL,

  -- Who it is addressed to, as it will print.
  prepared_for TEXT NOT NULL,
  address      TEXT,
  salutation   TEXT,

  -- The package being proposed, and the price actually quoted for it.
  tier        TEXT REFERENCES subscription_tiers(tier),
  currency    TEXT NOT NULL DEFAULT 'GHS',
  monthly_fee REAL,
  -- Taken off the quoted total, the way the firm's own proposal shows a discount line.
  discount    REAL NOT NULL DEFAULT 0,

  note   TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
           CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'withdrawn')),

  -- The link the prospect opens. The digest, never the token.
  token_digest     TEXT,
  token_expires_at TEXT,

  sent_at        TEXT,
  viewed_at      TEXT,
  decided_at     TEXT,
  decline_reason TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_partner_proposals_reference ON partner_proposals (reference);
CREATE INDEX idx_partner_proposals_prospect ON partner_proposals (prospect_id, created_at);
CREATE UNIQUE INDEX idx_partner_proposals_token
  ON partner_proposals (token_digest) WHERE token_digest IS NOT NULL;

-- Work quoted beside the package: an audit, a health check, a registration. Held as
-- rows because the proposal prints them as a table and the client reads each line.
CREATE TABLE partner_proposal_lines (
  id          TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES partner_proposals(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  -- How often it is charged, which is what the proposal's Frequency column says.
  frequency   TEXT NOT NULL DEFAULT 'one_off'
                CHECK (frequency IN ('monthly', 'quarterly', 'annual', 'one_off')),
  amount      REAL NOT NULL DEFAULT 0,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_partner_proposal_lines_proposal
  ON partner_proposal_lines (proposal_id, position);

-- ---------------------------------------------------------------------------
-- What they earn
-- ---------------------------------------------------------------------------

CREATE TABLE partner_commissions (
  id          TEXT PRIMARY KEY,
  partner_id  TEXT NOT NULL REFERENCES growth_partners(id) ON DELETE CASCADE,
  -- Nulled rather than cascaded: what a partner earned survives the client record going.
  client_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
  prospect_id TEXT REFERENCES partner_prospects(id) ON DELETE SET NULL,
  invoice_id  TEXT REFERENCES invoices(id) ON DELETE SET NULL,

  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'one_off')),
  -- Which of the six billed months this is, or null on one-off work.
  month_index INTEGER,
  -- 'YYYY-MM' for a subscription month, the assignment's key for one-off work. What
  -- stops the same month or the same annual assignment earning twice.
  reference   TEXT,

  basis    REAL NOT NULL,
  rate     REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'GHS',
  amount   REAL NOT NULL,

  status TEXT NOT NULL DEFAULT 'accrued'
           CHECK (status IN ('accrued', 'approved', 'paid', 'cancelled')),

  approved_at TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  paid_at     TEXT,
  paid_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  paid_reference TEXT,
  cancelled_reason TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_partner_commissions_partner
  ON partner_commissions (partner_id, status, created_at);
CREATE INDEX idx_partner_commissions_client ON partner_commissions (client_id, kind);

-- One accrual per invoice per kind. This is what makes accrual safe to repeat: a run
-- that fails half way, or an invoice issued twice by a retry, cannot pay twice for the
-- same month.
CREATE UNIQUE INDEX idx_partner_commissions_once
  ON partner_commissions (invoice_id, kind, reference)
  WHERE invoice_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The client's side of it
-- ---------------------------------------------------------------------------
--
-- Which partner sold this client, and when they were signed. The date is what the
-- six-month window for one-off work is measured from; the months themselves are counted
-- from the accruals, so a client who pauses does not burn their partner's entitlement.
ALTER TABLE clients ADD COLUMN growth_partner_id TEXT REFERENCES growth_partners(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN partner_won_on TEXT;

CREATE INDEX idx_clients_growth_partner ON clients (growth_partner_id);
