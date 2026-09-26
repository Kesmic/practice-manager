-- Invoices brought in from the firm's previous accounting system.
--
-- A client moving onto the portal has a year of invoices already in their hands, from
-- QuickBooks. Bringing them in lets the client see their whole account in one place.
-- Two things are needed that the portal's own invoices never had:
--
--  - `invoice_lines.activity`: the item name the old system printed beside each line
--    ("Regulatory services", "Prepayments"). The portal's own invoices work their
--    activity out from the kind of line; an imported one keeps the words the client's
--    copy already says.
--  - `invoices.imported_from`: where the invoice came from, and so that the portal
--    treats it as a record rather than a bill it raised - it was never emailed from
--    here, it is not chased by the reminder schedule, and its History says so.
ALTER TABLE invoice_lines ADD COLUMN activity TEXT;
ALTER TABLE invoices ADD COLUMN imported_from TEXT;
