-- What each invoice email actually said.
--
-- The wording of an invoice email can now be edited before it is sent, so "Invoice
-- sent" in the History no longer tells anyone what the client read. Each logged email
-- keeps its subject and its text (without the tracking link, which is the recipient's
-- alone), and whether the invoice went with it. Rows from before this are left empty:
-- they went out in the standard wording.
ALTER TABLE invoice_emails ADD COLUMN subject TEXT;
ALTER TABLE invoice_emails ADD COLUMN body TEXT;
ALTER TABLE invoice_emails ADD COLUMN attached INTEGER NOT NULL DEFAULT 1;
