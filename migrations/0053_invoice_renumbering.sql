-- A Partner may correct an invoice's number, and the History says so.
--
-- invoice_events (0048) only allowed three kinds, fixed by a CHECK, and SQLite cannot
-- change a CHECK in place - so the table is rebuilt with 'renumbered' added and its
-- rows carried across. Nothing refers to this table, so the swap is safe. A renumbering
-- keeps the old and new number in `detail` ("CPL202607_4 → CPL202609"), because the
-- client may be holding a copy with the old one on it.
CREATE TABLE invoice_events_new (
  id         TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('issued', 'cancelled', 'redrafted', 'renumbered')),
  detail     TEXT,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  at         TEXT NOT NULL
);
INSERT INTO invoice_events_new (id, invoice_id, kind, detail, actor_id, at)
  SELECT id, invoice_id, kind, detail, actor_id, at FROM invoice_events;
DROP TABLE invoice_events;
ALTER TABLE invoice_events_new RENAME TO invoice_events;
CREATE INDEX idx_invoice_events_invoice ON invoice_events (invoice_id, at);
