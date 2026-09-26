-- Statements of account sent to clients, one row per recipient, as QuickBooks keeps
-- them on the customer's record.
--
-- The statement itself is not stored: it is worked out from the invoices and payments
-- whenever it is asked for, so a copy drawn up again for the same dates says the same
-- thing unless a payment has since been recorded against that period. What is kept is
-- what went to whom and when, the figures it showed, and the words it went with.
CREATE TABLE statements_sent (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('balance_forward', 'open_item', 'transaction')),
  statement_date  TEXT NOT NULL,
  start_on        TEXT,
  end_on          TEXT,
  currency        TEXT NOT NULL,
  amount_due      REAL NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name  TEXT,
  cc              TEXT,
  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error           TEXT,
  subject         TEXT,
  body            TEXT,
  sent_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  sent_at         TEXT NOT NULL
);
CREATE INDEX idx_statements_sent_client ON statements_sent (client_id, sent_at);
