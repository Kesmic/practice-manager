-- What happened to an invoice after it left: every email, who opened it, who looked.
--
-- A Partner chasing a client needs to know three things the portal could not tell
-- them: whether the invoice actually went out, whether anybody read it, and whether the
-- client has looked at it since. Each email is one row per recipient, with the
-- provider's answer, and an unguessable token that the message's image and link carry
-- back. Opens are what the recipient's mail app reports when it loads images, which
-- some apps block and some do on arrival, so an open is a hint; a view in the portal,
-- recorded below, is a fact.

CREATE TABLE invoice_emails (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('issued', 'resent', 'due_today', 'overdue')),
  recipient_email TEXT NOT NULL,
  recipient_name  TEXT,
  cc              TEXT,
  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error           TEXT,
  token           TEXT NOT NULL,
  automatic       INTEGER NOT NULL DEFAULT 0,
  sent_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  sent_at         TEXT NOT NULL,
  opened_at       TEXT,
  last_opened_at  TEXT,
  open_count      INTEGER NOT NULL DEFAULT 0,
  clicked_at      TEXT,
  click_count     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_invoice_emails_token ON invoice_emails (token);
CREATE INDEX idx_invoice_emails_invoice ON invoice_emails (invoice_id, sent_at);

-- A client user opening the invoice in the portal, or downloading it.
CREATE TABLE invoice_views (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  client_user_id TEXT REFERENCES client_users(id) ON DELETE SET NULL,
  what           TEXT NOT NULL CHECK (what IN ('page', 'download')),
  viewed_at      TEXT NOT NULL
);
CREATE INDEX idx_invoice_views_invoice ON invoice_views (invoice_id, viewed_at);

-- The notice sent on the day payment falls due, once.
ALTER TABLE invoices ADD COLUMN due_notice_at TEXT;

-- What a cancellation let go of, so putting the invoice back to draft can take it back:
-- the month it billed and the piece of work it billed. Held beside the live columns,
-- which are cleared at cancellation so the month can be billed again elsewhere.
ALTER TABLE invoice_lines ADD COLUMN released_period TEXT;
ALTER TABLE invoice_lines ADD COLUMN released_service_id TEXT;

-- An invoice deleted outright. The client no longer sees it; the firm keeps a line
-- saying that number existed and why it went, because a gap in the sequence is a
-- question an auditor will ask.
CREATE TABLE invoice_deletions (
  id          TEXT PRIMARY KEY,
  number      TEXT NOT NULL,
  client_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  state       TEXT NOT NULL,
  gross       REAL NOT NULL,
  currency    TEXT NOT NULL,
  reason      TEXT NOT NULL,
  deleted_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  deleted_at  TEXT NOT NULL
);
CREATE INDEX idx_invoice_deletions_client ON invoice_deletions (client_id, deleted_at);
