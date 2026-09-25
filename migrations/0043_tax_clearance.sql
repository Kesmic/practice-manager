-- A tax clearance certificate as a piece of one-off work.
--
-- Firm and Enterprise get it as part of their package; a client on Starter or Growth,
-- or with no package at all, is asked for one by a bank, a tender or the ORC and needs
-- it now. Quoted on request until a Partner prices it in Portal settings.

INSERT OR IGNORE INTO additional_services
  (id, name, summary, fee, fee_basis, currency, service_line, active, position, created_at)
VALUES
  ('adhoc_41', 'Tax clearance certificate', 'Bringing your GRA position up to date and obtaining the certificate a bank, a tender or the ORC has asked for.', NULL, 'from', 'GHS', 'tax_compliance', 1, 40, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
