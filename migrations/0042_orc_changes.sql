-- The three changes at the ORC a client most often asks for, as three services, and
-- two renewals the firm is asked to keep on top of.
--
-- 0041 seeded one line, "Changes at the ORC", covering directors, shareholders,
-- secretary, name and registered office together. The firm quotes and does these
-- separately, so a client asking for one should find one. The three are added as
-- their own lines and the old line is narrowed to what is left under it, unless the
-- firm has already renamed it, in which case it is theirs and is left alone.

INSERT OR IGNORE INTO additional_services
  (id, name, summary, fee, fee_basis, currency, service_line, active, position, created_at)
VALUES
  ('adhoc_36', 'Change of directors', 'Appointing or removing a director: the resolution, the consent, the ORC forms and the certified filing.', NULL, 'from', 'GHS', 'company_secretarial', 1, 35, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_37', 'Change of shareholders', 'A change in who holds the shares: the resolutions, the register entries and the certified ORC filing.', NULL, 'from', 'GHS', 'company_secretarial', 1, 36, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_38', 'Change of registered office', 'Moving the registered office or principal place of business, filed with the ORC and certified.', NULL, 'from', 'GHS', 'company_secretarial', 1, 37, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_39', 'District Assembly business operating permit renewal', 'The annual business operating permit from the Metropolitan, Municipal or District Assembly, renewed on time with the receipt kept on file.', NULL, 'from', 'GHS', 'regulatory_filing', 1, 38, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_40', 'GIPC registration renewal and returns', 'The GIPC certificate renewed when due and the periodic returns to the Centre prepared and filed.', NULL, 'from', 'GHS', 'regulatory_filing', 1, 39, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

UPDATE additional_services
   SET name = 'Other changes at the ORC',
       summary = 'A change of company secretary, name, constitution or business activity, filed and certified.'
 WHERE id = 'adhoc_27' AND name = 'Changes at the ORC';
