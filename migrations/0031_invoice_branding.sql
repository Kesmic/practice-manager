-- Withholding shown on the invoice itself, the way the firm already issues them.
--
-- The invoice this was modelled on shows the fee, then a negative "Withholding tax" line
-- at 7.5%, and a Balance Due already net of it. That is not the same as recording a
-- deduction when payment arrives: the client is being told up front what to pay, and
-- what they pay is the balance, not the fee.
--
-- Both now exist, because both happen. An invoice may anticipate the deduction, and
-- `invoice_payments.withheld` still records one that was not anticipated - a client who
-- withholds without being asked to is a fact about the payment, not about the document.
--
-- Held on the invoice rather than derived from a setting, for the reason the tax lines
-- are frozen: a rate change next year must not alter a document already in a client's
-- hands.
ALTER TABLE invoices ADD COLUMN withholding_rate REAL;
ALTER TABLE invoices ADD COLUMN withholding_amount REAL NOT NULL DEFAULT 0;

-- What the client is actually asked to pay: gross less anything withheld on the face of
-- the invoice. Stored rather than computed so that every screen, every reminder and
-- every statement quote the same figure the document quotes.
ALTER TABLE invoices ADD COLUMN balance_due REAL NOT NULL DEFAULT 0;
