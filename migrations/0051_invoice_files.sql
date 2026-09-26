-- Files attached to an invoice, and whether the client may see each one.
--
-- The papers behind a bill - a receipt for a filing fee passed on at cost, a timesheet,
-- an acknowledgement from the ORC. The bytes live in the R2 bucket under the invoice's
-- id; this row is what the portal knows about each. `shared` is the firm's decision,
-- file by file, as in Xero: a shared file is listed on the client's invoice page and
-- can go out with the invoice email, and one that is not never leaves the firm.
CREATE TABLE invoice_files (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  object_key   TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  shared       INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  TEXT NOT NULL
);
CREATE INDEX idx_invoice_files_invoice ON invoice_files (invoice_id, uploaded_at);

-- Which files went out with each invoice email, for the History's "What it said".
ALTER TABLE invoice_emails ADD COLUMN files TEXT;
