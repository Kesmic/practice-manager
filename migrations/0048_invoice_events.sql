-- Things done to an invoice that would otherwise leave no trace.
--
-- Most of an invoice's history is already on record: when it was raised and by whom,
-- when it was issued, every email since the log began, payments, and the client's views
-- in the portal. Two actions were not: a cancellation is overwritten when the invoice is
-- put back to draft, and putting it back to draft is recorded nowhere. These rows keep
-- both, with who did it and why, for the invoice's History - and, because going back to
-- draft clears the date it was issued, an 'issued' row keeps that date too.
CREATE TABLE invoice_events (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('issued', 'cancelled', 'redrafted')),
  detail     TEXT,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  at         TEXT NOT NULL
);
CREATE INDEX idx_invoice_events_invoice ON invoice_events (invoice_id, at);
