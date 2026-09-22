-- The packages the firm actually sells.
--
-- Until now the portal carried three tiers I had inferred from Schedule 2 of the
-- Associate agreement, with ceilings and summaries I had made up to go with them. The
-- firm's own pricing proposal - the document it sends clients - has four packages, each
-- with its own "ideal for", its own list of what is included, and a price. This puts the
-- real ones in, and takes the invented ceilings out.
--
-- ## Four packages: Starter, Growth, Firm, Enterprise
--
-- `firm` is the new one, and it sits between Growth and Enterprise: established local
-- businesses with high transaction volumes, where Enterprise is for multinationals with
-- complex transactions. That distinction is a judgement rather than a threshold, which
-- is why Firm carries no ceiling - see the ceilings below.
--
-- ## The tier list stops being a CHECK and becomes a foreign key
--
-- Four tables spelled the three tiers into CHECK constraints, and SQLite cannot alter a
-- CHECK: adding one package meant rebuilding all four tables, which is what most of this
-- migration is. Rebuilt, they point at `subscription_tiers` instead, so the next package
-- the firm adds is a row rather than another migration like this one.
--
-- The rebuilds are the standard SQLite procedure - create, copy, drop, rename - and are
-- safe here because nothing has a foreign key pointing at any of these four tables.
--
-- ## Prices
--
-- Taken from the proposal, in the currency the proposal quotes: USD 400, 750, 1,250 and
-- 2,800 a month. Written only where a fee has not already been set, so a price a Partner
-- has entered is never overwritten by a migration. GHS remains the portal's default
-- currency everywhere else; a package is quoted in whichever of the two the firm sets.

-- ---------------------------------------------------------------------------
-- 1. The packages themselves
-- ---------------------------------------------------------------------------

CREATE TABLE subscription_tiers_new (
  tier        TEXT PRIMARY KEY,
  monthly_fee REAL,
  currency    TEXT NOT NULL DEFAULT 'GHS',
  -- What the package covers, in a sentence.
  summary     TEXT,
  -- Who it is for: the proposal's own column, which is what a client reads first.
  ideal_for   TEXT,
  -- The order they are shown and compared in. Cheapest first; the ladder in
  -- shared/subscriptions.ts reads the same order.
  position    INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO subscription_tiers_new
  (tier, monthly_fee, currency, summary, position, updated_at, updated_by)
SELECT tier, monthly_fee, currency, summary,
       CASE tier WHEN 'starter' THEN 0 WHEN 'growth' THEN 1 ELSE 3 END,
       updated_at, updated_by
  FROM subscription_tiers;

DROP TABLE subscription_tiers;
ALTER TABLE subscription_tiers_new RENAME TO subscription_tiers;

INSERT INTO subscription_tiers (tier, currency, position, updated_at)
  VALUES ('firm', 'GHS', 2, '2026-09-21T00:00:00.000Z');

/*
  The summaries 0029 seeded were my invention, so they are replaced. Matched on their
  exact text rather than replaced outright, so that a summary a Partner has since
  rewritten is left alone - a migration that overwrote somebody's own words would be
  worse than one that left an old sentence in place. A summary that is empty is not
  somebody's own words, so those are filled too: a package with no description is a
  blank column on the page a client is asked to choose from.
*/
UPDATE subscription_tiers
   SET summary = 'Bookkeeping, payroll administration and tax services - VAT and levies, withholding tax, PAYE and directors'' PIT compliance.',
       ideal_for = 'Solo entrepreneurs and startups. Covers basic compliance and bookkeeping.'
 WHERE tier = 'starter'
   AND (summary IS NULL
        OR summary = 'Bookkeeping, statutory filings and the annual accounts. For a small business with a low volume of transactions.');

UPDATE subscription_tiers
   SET summary = 'Everything in Starter, and annual employer tax compliance, corporate tax compliance and annual filings with the ORC.',
       ideal_for = 'Growing businesses with minimal transactions.'
 WHERE tier = 'growth'
   AND (summary IS NULL
        OR summary = 'Adds payroll, VAT and PAYE, and advice each quarter. For a business of moderate size and complexity.');

UPDATE subscription_tiers
   SET summary = 'Everything in Growth, at the volume an established business runs at.',
       ideal_for = 'Established local businesses with high transaction volumes.'
 WHERE tier = 'firm' AND summary IS NULL;

UPDATE subscription_tiers
   SET summary = 'Everything in Firm, and transfer pricing compliance, transactions advisory and client representation.',
       ideal_for = 'Multinational enterprises handling complex transactions.'
 WHERE tier = 'enterprise'
   AND (summary IS NULL
        OR summary = 'Bookkeeping weekly rather than monthly, a named manager, an audit-readiness review, and advice each month.');

-- The proposal's prices, and only where nothing has been set.
UPDATE subscription_tiers SET monthly_fee =  400, currency = 'USD' WHERE tier = 'starter'    AND monthly_fee IS NULL;
UPDATE subscription_tiers SET monthly_fee =  750, currency = 'USD' WHERE tier = 'growth'     AND monthly_fee IS NULL;
UPDATE subscription_tiers SET monthly_fee = 1250, currency = 'USD' WHERE tier = 'firm'       AND monthly_fee IS NULL;
UPDATE subscription_tiers SET monthly_fee = 2800, currency = 'USD' WHERE tier = 'enterprise' AND monthly_fee IS NULL;

-- ---------------------------------------------------------------------------
-- 2. What is in each package
-- ---------------------------------------------------------------------------
--
-- A table rather than a paragraph, because the proposal prints these as a list per
-- package with sub-items under "Tax services", and a client comparing two packages is
-- comparing exactly these lines. Held as rows so a Partner can add one without a deploy.
CREATE TABLE tier_inclusions (
  id        TEXT PRIMARY KEY,
  tier      TEXT NOT NULL REFERENCES subscription_tiers(tier) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  -- A sub-item sits under the one above it: "VAT & levies" under "Tax services".
  parent_id TEXT REFERENCES tier_inclusions(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_tier_inclusions_tier ON tier_inclusions (tier, position);

-- Straight from the proposal. The sub-items under Tax services are what actually
-- separates one package from the next, which is why they are rows and not prose.
INSERT INTO tier_inclusions (id, tier, label, parent_id, position) VALUES
  ('inc_st_book', 'starter', 'Bookkeeping', NULL, 0),
  ('inc_st_pay',  'starter', 'Payroll administration', NULL, 1),
  ('inc_st_tax',  'starter', 'Tax services', NULL, 2),
  ('inc_st_vat',  'starter', 'VAT & levies', 'inc_st_tax', 0),
  ('inc_st_wht',  'starter', 'Withholding tax', 'inc_st_tax', 1),
  ('inc_st_paye', 'starter', 'PAYE', 'inc_st_tax', 2),
  ('inc_st_pit',  'starter', 'Directors'' PIT compliance', 'inc_st_tax', 3),

  ('inc_gr_book', 'growth', 'Bookkeeping', NULL, 0),
  ('inc_gr_pay',  'growth', 'Payroll administration', NULL, 1),
  ('inc_gr_tax',  'growth', 'Tax services', NULL, 2),
  ('inc_gr_vat',  'growth', 'VAT & levies', 'inc_gr_tax', 0),
  ('inc_gr_wht',  'growth', 'Withholding tax', 'inc_gr_tax', 1),
  ('inc_gr_paye', 'growth', 'PAYE', 'inc_gr_tax', 2),
  ('inc_gr_pit',  'growth', 'Directors'' PIT compliance', 'inc_gr_tax', 3),
  ('inc_gr_emp',  'growth', 'Annual employer tax compliance', 'inc_gr_tax', 4),
  ('inc_gr_corp', 'growth', 'Corporate tax compliance', 'inc_gr_tax', 5),
  ('inc_gr_orc',  'growth', 'Annual filings with the ORC', NULL, 3),

  ('inc_fi_book', 'firm', 'Bookkeeping', NULL, 0),
  ('inc_fi_pay',  'firm', 'Payroll administration', NULL, 1),
  ('inc_fi_tax',  'firm', 'Tax services', NULL, 2),
  ('inc_fi_vat',  'firm', 'VAT & levies', 'inc_fi_tax', 0),
  ('inc_fi_wht',  'firm', 'Withholding tax', 'inc_fi_tax', 1),
  ('inc_fi_paye', 'firm', 'PAYE', 'inc_fi_tax', 2),
  ('inc_fi_pit',  'firm', 'Directors'' PIT compliance', 'inc_fi_tax', 3),
  ('inc_fi_emp',  'firm', 'Annual employer tax compliance', 'inc_fi_tax', 4),
  ('inc_fi_corp', 'firm', 'Corporate tax compliance', 'inc_fi_tax', 5),
  ('inc_fi_orc',  'firm', 'Annual filings with the ORC', NULL, 3),

  ('inc_en_book', 'enterprise', 'Bookkeeping', NULL, 0),
  ('inc_en_pay',  'enterprise', 'Payroll administration', NULL, 1),
  ('inc_en_tax',  'enterprise', 'Tax services', NULL, 2),
  ('inc_en_vat',  'enterprise', 'VAT & levies', 'inc_en_tax', 0),
  ('inc_en_wht',  'enterprise', 'Withholding tax', 'inc_en_tax', 1),
  ('inc_en_paye', 'enterprise', 'PAYE', 'inc_en_tax', 2),
  ('inc_en_pit',  'enterprise', 'Directors'' PIT compliance', 'inc_en_tax', 3),
  ('inc_en_emp',  'enterprise', 'Annual employer tax compliance', 'inc_en_tax', 4),
  ('inc_en_corp', 'enterprise', 'Corporate tax compliance', 'inc_en_tax', 5),
  ('inc_en_tp',   'enterprise', 'Transfer pricing compliance', 'inc_en_tax', 6),
  ('inc_en_orc',  'enterprise', 'Annual filings with the ORC', NULL, 3),
  ('inc_en_adv',  'enterprise', 'Transactions advisory & client representation', NULL, 4);

-- ---------------------------------------------------------------------------
-- 3. The ceilings
-- ---------------------------------------------------------------------------

CREATE TABLE tier_ceilings_new (
  tier         TEXT NOT NULL REFERENCES subscription_tiers(tier) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL REFERENCES subscription_criteria(id) ON DELETE CASCADE,
  ceiling      REAL,
  PRIMARY KEY (tier, criterion_id)
);
INSERT INTO tier_ceilings_new SELECT tier, criterion_id, ceiling FROM tier_ceilings;
DROP TABLE tier_ceilings;
ALTER TABLE tier_ceilings_new RENAME TO tier_ceilings;

-- A money criterion is measured in a currency, and until now the screens assumed the
-- client's. The firm's own bands are in dollars while most of its clients are billed in
-- cedis, so a ceiling of 15,000 was being drawn as "GHS 15,000" on a client's own page -
-- a figure nobody had ever quoted them. The currency belongs to the criterion.
ALTER TABLE subscription_criteria ADD COLUMN currency TEXT NOT NULL DEFAULT 'GHS';

-- The proposal prices on monthly turnover: up to 8,000 is Starter, 8,000 to 15,000 is
-- Growth, above that is Firm. So that is the criterion the ladder measures on.
INSERT INTO subscription_criteria (id, name, unit, how_measured, position, currency, created_at) VALUES
  ('crit_monthly_turnover', 'Monthly turnover', 'money',
   'Averaged over three months, from the client''s own management accounts. In dollars, because the firm''s pricing proposal sets the bands that way.',
   0, 'USD', '2026-09-21T00:00:00.000Z');

INSERT INTO tier_ceilings (tier, criterion_id, ceiling) VALUES
  ('starter', 'crit_monthly_turnover', 8000),
  ('growth',  'crit_monthly_turnover', 15000),
  -- Firm has none, and neither does Enterprise. Nothing in the proposal separates them
  -- by a number: Firm is for established local businesses and Enterprise for
  -- multinationals with complex transactions, which is a judgement a Partner makes. The
  -- ladder therefore stops at Firm, and the screens say so rather than pretending a
  -- threshold exists.
  ('firm',       'crit_monthly_turnover', NULL),
  ('enterprise', 'crit_monthly_turnover', NULL);

-- Firm inherits its other ceilings from the tier above it in the old ladder, which had
-- none at all.
INSERT INTO tier_ceilings (tier, criterion_id, ceiling)
  SELECT 'firm', id, NULL FROM subscription_criteria WHERE id <> 'crit_monthly_turnover';

/*
  The staff, transaction and annual-turnover ceilings 0029 seeded were invented, and a
  made-up ceiling is worse than none: it flags a client as having outgrown a package on
  a number the firm never agreed to. They are cleared, leaving the criteria in place to
  be recorded against, and a Partner sets a real ceiling when the firm has one.
*/
UPDATE tier_ceilings SET ceiling = NULL
 WHERE criterion_id IN ('crit_transactions', 'crit_staff', 'crit_turnover')
   AND (tier, criterion_id, ceiling) IN (
     VALUES ('starter', 'crit_transactions', 100),
            ('starter', 'crit_staff', 5),
            ('starter', 'crit_turnover', 500000),
            ('growth', 'crit_transactions', 500),
            ('growth', 'crit_staff', 25),
            ('growth', 'crit_turnover', 5000000)
   );

-- ---------------------------------------------------------------------------
-- 4. What a client is on
-- ---------------------------------------------------------------------------

CREATE TABLE client_subscriptions_new (
  client_id   TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  tier        TEXT NOT NULL REFERENCES subscription_tiers(tier),
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
INSERT INTO client_subscriptions_new
  SELECT client_id, tier, monthly_fee, currency, started_on, status, ended_on, note,
         created_at, updated_at, updated_by
    FROM client_subscriptions;
DROP TABLE client_subscriptions;
ALTER TABLE client_subscriptions_new RENAME TO client_subscriptions;

CREATE INDEX idx_client_subscriptions_tier ON client_subscriptions (status, tier);

-- ---------------------------------------------------------------------------
-- 5. Allocations
-- ---------------------------------------------------------------------------
--
-- The tier on an allocation is what Schedule 2 prices the associate's fee by, and it is
-- the same tier the client subscribes to - there are not two answers to "what package is
-- this client on". It was being set twice, by two controls on the same screen, which is
-- exactly how the two would come to disagree. It is now kept in step with the
-- subscription by the Worker and has no control of its own; it stays on the row because
-- an allocation of a client who has no subscription still has to say it has no tier.
CREATE TABLE client_allocations_new (
  id        TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier      TEXT REFERENCES subscription_tiers(tier),
  status    TEXT NOT NULL DEFAULT 'offered'
              CHECK (status IN ('offered','accepted','declined','withdrawn','ended')),
  offered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  offered_at TEXT NOT NULL,
  note       TEXT,
  responded_at   TEXT,
  decline_ground TEXT CHECK (decline_ground IN ('capacity','conflict','other')),
  decline_reason TEXT,
  ended_at TEXT,
  ended_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  ended_note TEXT
);
INSERT INTO client_allocations_new
  SELECT id, client_id, user_id, tier, status, offered_by, offered_at, note,
         responded_at, decline_ground, decline_reason, ended_at, ended_by, ended_note
    FROM client_allocations;
DROP TABLE client_allocations;
ALTER TABLE client_allocations_new RENAME TO client_allocations;

CREATE INDEX idx_client_allocations_user ON client_allocations (user_id, status);
CREATE INDEX idx_client_allocations_client ON client_allocations (client_id, status);
CREATE UNIQUE INDEX idx_client_allocations_live
  ON client_allocations (client_id, user_id)
  WHERE status IN ('offered', 'accepted');

-- Every live allocation now reads the client's own package, which is the one place it
-- is decided from here on.
UPDATE client_allocations
   SET tier = (SELECT s.tier FROM client_subscriptions s WHERE s.client_id = client_allocations.client_id)
 WHERE status IN ('offered', 'accepted')
   AND EXISTS (SELECT 1 FROM client_subscriptions s WHERE s.client_id = client_allocations.client_id);

-- ---------------------------------------------------------------------------
-- 6. Schedule 2 of the Associate agreement
-- ---------------------------------------------------------------------------
--
-- The agreement pays an associate a fixed monthly fee per assigned client, set by that
-- client's package. A fourth package the agreement has never heard of would leave an
-- associate holding a Firm client with no rate to be paid at, so the schedule gains its
-- line and the profiles are restated as the proposal states them - by monthly turnover
-- rather than by the staff counts I had guessed at.
--
-- The associate's own fee stays in cedis. It is what the firm pays a Ghanaian contractor
-- and has nothing to do with the currency a client is quoted in.
--
-- Matched on the exact paragraph, so a template the firm has since edited is left alone:
-- replace() changes nothing when it finds nothing.
UPDATE documents
   SET body = replace(
         body,
         '- **Starter tier** - GHS [STARTER FEE]. Indicative client profile: one to five members of
  staff and a low volume of transactions.
- **Growth tier** - GHS [GROWTH FEE]. Indicative client profile: six to twenty-five
  members of staff and moderate complexity.
- **Enterprise tier** - GHS [ENTERPRISE FEE]. Indicative client profile: twenty-six or
  more members of staff, a high volume of transactions or multiple entities.',
         '- **Starter tier** - GHS [STARTER FEE]. Indicative client profile: a solo entrepreneur
  or startup, turning over up to 8,000 a month.
- **Growth tier** - GHS [GROWTH FEE]. Indicative client profile: a growing business with
  minimal transactions, turning over between 8,000 and 15,000 a month.
- **Firm tier** - GHS [FIRM FEE]. Indicative client profile: an established local
  business with high transaction volumes, above 15,000 a month.
- **Enterprise tier** - GHS [ENTERPRISE FEE]. Indicative client profile: a multinational
  enterprise handling complex transactions.'),
       updated_at = '2026-09-21T00:00:00.000Z'
 WHERE id = 'tpl_associate_contract';
