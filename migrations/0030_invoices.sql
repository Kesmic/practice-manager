-- Invoices, what has been paid against them, and the chasing of the ones that are late.
--
-- shared/invoices.ts holds the arithmetic and argues for the shape. Three things in here
-- follow from that argument and are worth reading before changing anything.
--
-- **There is no VAT column, and no rate anywhere in the schema.** A Ghanaian invoice
-- from a VAT-registered practice is NHIL, GETFund and the COVID-19 levy on the fee, then
-- VAT on the fee plus those levies. A firm on the flat-rate scheme has one line; one
-- that is not registered has none. An administrator defines the lines and the order they
-- apply in, and that single mechanism produces all three. Changing the law is a settings
-- change, not a deploy.
--
-- **Tax is frozen onto the invoice at issue.** `invoice_taxes` holds the lines as they
-- were on the day, with their rates. If the rate changes next year, an invoice issued
-- this year must still say what it said - a document already in a client's hands cannot
-- quietly recompute itself, and a statement that disagreed with the paper would be worse
-- than having no statement.
--
-- **There is no `overdue` state.** Overdue is a question asked of a due date and a
-- balance. Stored, it would be true when written and wrong the next morning, and the
-- reminders would chase people who had already paid.

-- ---------------------------------------------------------------------------
-- What the firm charges tax at
-- ---------------------------------------------------------------------------

CREATE TABLE tax_lines (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  -- A percentage: 2.5 means 2.5%.
  rate       REAL NOT NULL,
  -- 'net' is the fee before any tax, which is what Ghana's levies are charged on.
  -- 'net_plus_preceding' is the fee plus every line above it, which is where VAT sits.
  basis      TEXT NOT NULL CHECK (basis IN ('net', 'net_plus_preceding')),
  -- Load-bearing. VAT applied before the levies would be VAT on nothing.
  position   INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- Nothing is seeded. Whether this firm is VAT-registered, and at what rates, is not
-- something a migration can know - and a wrong tax line is a wrong invoice in a client's
-- hands. The settings screen starts empty and says so.

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

CREATE TABLE invoices (
  id         TEXT PRIMARY KEY,
  -- Human reference, INV-2026-0041. Unique across the firm and never reused, including
  -- after a cancellation: a gap in the sequence is a question somebody can answer, a
  -- repeat is two documents with one name.
  number     TEXT NOT NULL,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  state      TEXT NOT NULL DEFAULT 'draft'
               CHECK (state IN ('draft', 'sent', 'part_paid', 'paid', 'void')),

  issued_on  TEXT,
  due_on     TEXT NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'GHS',

  -- Held rather than summed on read. These are what the client was shown; recomputing
  -- them later from lines and current tax rates would make an old invoice disagree with
  -- the copy the client is holding.
  net        REAL NOT NULL DEFAULT 0,
  tax_total  REAL NOT NULL DEFAULT 0,
  gross      REAL NOT NULL DEFAULT 0,

  -- What period this covers, for a subscription invoice.
  period_label TEXT,

  note             TEXT,
  -- How many reminders have gone out, so a run that fails half way is safe to repeat:
  -- the question asked is "have we sent step two", not "did anything go out today".
  reminders_sent   INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TEXT,

  sent_at     TEXT,
  voided_at   TEXT,
  void_reason TEXT,

  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_invoices_number ON invoices (number);
CREATE INDEX idx_invoices_client ON invoices (client_id, state, due_on);
-- The chasing query: everything unsettled with a due date behind it.
CREATE INDEX idx_invoices_chase ON invoices (state, due_on) WHERE state IN ('sent', 'part_paid');

CREATE TABLE invoice_lines (
  id          TEXT PRIMARY KEY,
  invoice_id  TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  -- Denormalised from the invoice for one reason: it makes "this client's subscription
  -- for this month is billed once" expressible as an index rather than as a rule
  -- somebody has to remember in the route.
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  description TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit_amount REAL NOT NULL,
  amount      REAL NOT NULL,

  source      TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('subscription', 'service', 'manual')),
  -- 'YYYY-MM' for a subscription line. Cleared when an invoice is cancelled, which is
  -- what frees the month to be billed again on a corrected invoice.
  subscription_period TEXT,
  -- Nulled rather than cascaded: what was billed survives the catalogue changing.
  client_service_id   TEXT REFERENCES client_services(id) ON DELETE SET NULL,

  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_invoice_lines_invoice ON invoice_lines (invoice_id, position);

-- One subscription month per client, ever. The failure this prevents is the expensive
-- one: a client billed twice for September because two people ran the month.
CREATE UNIQUE INDEX idx_invoice_lines_one_month
  ON invoice_lines (client_id, subscription_period)
  WHERE subscription_period IS NOT NULL;

-- And one invoice per piece of additional work.
CREATE UNIQUE INDEX idx_invoice_lines_one_service
  ON invoice_lines (client_service_id)
  WHERE client_service_id IS NOT NULL;

-- The tax as it stood on the day, frozen. See the header.
CREATE TABLE invoice_taxes (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  rate       REAL NOT NULL,
  basis      TEXT NOT NULL CHECK (basis IN ('net', 'net_plus_preceding')),
  amount     REAL NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_invoice_taxes_invoice ON invoice_taxes (invoice_id, position);

-- ---------------------------------------------------------------------------
-- Payment
-- ---------------------------------------------------------------------------
--
-- Recorded, not collected. The portal holds no card details and moves no money; this is
-- the firm writing down what arrived, which is what makes a status true and a reminder
-- safe to send.
CREATE TABLE invoice_payments (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

  -- Cash actually received.
  amount     REAL NOT NULL DEFAULT 0,
  -- Deducted by the client and remitted to the GRA on the firm's behalf. Part of what
  -- settles the invoice, not a shortfall: a client who withholds 7.5% has paid in full,
  -- and what they still owe the firm is the certificate, tracked below.
  withheld   REAL NOT NULL DEFAULT 0,

  paid_on    TEXT NOT NULL,
  method     TEXT,
  reference  TEXT,
  note       TEXT,

  certificate_received INTEGER NOT NULL DEFAULT 0,
  certificate_ref      TEXT,

  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_invoice_payments_invoice ON invoice_payments (invoice_id, paid_on);
-- Finding the certificates still owed, which is a real chase of its own.
CREATE INDEX idx_invoice_payments_certificates
  ON invoice_payments (certificate_received) WHERE withheld > 0;

-- Every reminder sent, automatic or by hand. Kept so that "we have chased them three
-- times" is a fact rather than somebody's recollection.
CREATE TABLE invoice_reminders (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  step       INTEGER NOT NULL,
  days_late  INTEGER NOT NULL,
  sent_to    TEXT NOT NULL,
  -- Whether the nightly run sent it or somebody pressed the button.
  automatic  INTEGER NOT NULL DEFAULT 1,
  sent_at    TEXT NOT NULL
);

CREATE INDEX idx_invoice_reminders_invoice ON invoice_reminders (invoice_id, sent_at);

-- The human reference sequence. Separate from the others so invoice numbers are
-- continuous whatever else the firm creates.
INSERT INTO counters (name, value) VALUES ('invoice', 0);
