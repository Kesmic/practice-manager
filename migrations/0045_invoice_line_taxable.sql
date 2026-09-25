-- A line on an invoice is either a fee or a reimbursable.
--
-- The firm pays things on a client's behalf - a filing fee at the ORC, a courier, a
-- stamp duty - and passes them on at cost. Those are not the firm's fee, so tax is not
-- charged on them and the client does not withhold on them. Until now every line was
-- treated as a fee. This marks the difference: taxable = 1 is a fee, taxable = 0 is a
-- reimbursable passed on at cost. Everything already on file was a fee.
ALTER TABLE invoice_lines ADD COLUMN taxable INTEGER NOT NULL DEFAULT 1;
