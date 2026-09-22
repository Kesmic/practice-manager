-- Money taken off what a client is charged.
--
-- shared/discounts.ts holds the arithmetic and argues for the shape. Four things in here
-- follow from that argument and are worth reading before changing anything.
--
-- **One active discount per client, enforced by the database.** The partial unique index
-- below is what actually holds that, rather than a check in a route that two people
-- pressing the same button at the same time could both pass. Two live discounts would
-- raise a question nobody wants to answer on an invoice - do they compound, does the
-- second come off the first - and every answer is one somebody has to explain to a
-- client looking at a figure they did not expect.
--
-- **The discount row is the trail.** There is no event written elsewhere. Who granted
-- it, when, why, how many invoices it has carried and who ended it are all on the row,
-- and a discount is never deleted - it moves to 'spent' or 'ended' and stays readable.
--
-- **What came off is frozen onto the invoice.** `invoices.discount_amount` and
-- `discount_label` are written when the draft is worked out and never recomputed, for
-- the reason `invoice_taxes` is frozen: a document already in a client's hands cannot
-- quietly change because somebody ended the discount this morning.
--
-- **`discount_id` is nulled rather than cascaded.** What a client was charged has to
-- survive the discount row going, in the same way an invoice line survives the service
-- catalogue being reorganised.

CREATE TABLE client_discounts (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- 'percentage' reads value as a percentage, 'amount' reads it as money.
  kind       TEXT NOT NULL CHECK (kind IN ('percentage', 'amount')),
  value      REAL NOT NULL CHECK (value > 0),

  -- What it bites on. A discount on the subscription must not come off an audit fee
  -- that happens to be on the same invoice.
  applies_to TEXT NOT NULL
               CHECK (applies_to IN ('subscription', 'services', 'everything')),

  -- How long it lasts: the next invoice only, a number of invoices, or a date.
  runs       TEXT NOT NULL CHECK (runs IN ('once', 'count', 'until')),
  invoice_count INTEGER,
  until_on      TEXT,

  -- Issued invoices that have carried it. Counted at issue rather than at draft, so a
  -- cancelled draft does not burn a one-off discount.
  used_count INTEGER NOT NULL DEFAULT 0,

  reason     TEXT,
  status     TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'spent', 'ended')),

  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  ended_at     TEXT,
  ended_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  ended_reason TEXT,

  -- A run with nothing to run against is not a discount, it is a row nobody can read.
  -- Spelled with an explicit IS NOT NULL rather than leaning on the comparison: a CHECK
  -- that evaluates to NULL passes in SQLite, so `invoice_count >= 1` alone would let a
  -- missing count straight through - which is exactly the row this is meant to refuse.
  CHECK (runs <> 'count' OR (invoice_count IS NOT NULL AND invoice_count >= 1)),
  CHECK (runs <> 'until' OR until_on IS NOT NULL)
);

-- The one rule the database keeps for itself. See the header.
CREATE UNIQUE INDEX idx_client_discounts_one_active
  ON client_discounts (client_id) WHERE status = 'active';

CREATE INDEX idx_client_discounts_client
  ON client_discounts (client_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- What came off this invoice
-- ---------------------------------------------------------------------------
--
-- `net` stays what it has always been: the amount tax is charged on. With a discount
-- that is the lines less the discount, because tax is charged on what the firm actually
-- bills and not on what it would have billed - a discount applied after tax would have
-- the firm paying VAT on money it never received. The subtotal a document shows is
-- therefore `net + discount_amount`, which needs no column of its own.
ALTER TABLE invoices ADD COLUMN discount_id TEXT REFERENCES client_discounts(id) ON DELETE SET NULL;
-- Frozen wording: "20% off the subscription", as it was on the day.
ALTER TABLE invoices ADD COLUMN discount_label TEXT;
ALTER TABLE invoices ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;

-- No backfill. Every invoice raised before today carried no discount, and zero is
-- exactly right for all of them - unlike `balance_due`, where zero would have read as
-- "nothing to pay".
