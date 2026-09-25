-- A catalogue of one-off work, for the Additional services list.
--
-- The packages are what a client gets every month. This is what they ask for once: a
-- company to incorporate, a backlog to clear, a GRA letter to answer, a valuation for
-- a sale. The firm had an empty list here and added to it by hand; this seeds the
-- pieces of work the firm is actually asked for in Ghana, with no fees - every one is
-- "quoted, from" until a Partner prices it in Portal settings, because a number
-- invented here would be quoted to a client. Each is tagged with the service line the
-- work lands in. Rename, reprice or retire any of them from Portal settings.

INSERT OR IGNORE INTO additional_services
  (id, name, summary, fee, fee_basis, currency, service_line, active, position, created_at)
VALUES
  ('adhoc_01', 'Company incorporation at the ORC', 'Name reservation, constitution, TIN and certificate of incorporation for a new company.', NULL, 'from', 'GHS', 'company_secretarial', 1, 0, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_02', 'Business name registration', 'Registering a sole proprietorship or partnership name with the ORC.', NULL, 'from', 'GHS', 'company_secretarial', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_03', 'TIN and GRA tax type registration', 'Getting a business and its directors registered with the GRA for the taxes that apply.', NULL, 'from', 'GHS', 'tax_compliance', 1, 2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_04', 'VAT registration', 'Registering for VAT, NHIL and GETFund once turnover requires it, and setting up the first return.', NULL, 'from', 'GHS', 'tax_compliance', 1, 3, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_05', 'SSNIT employer registration', 'Registering as an employer and enrolling the first staff for Tier 1 and Tier 2.', NULL, 'from', 'GHS', 'payroll', 1, 4, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_06', 'GIPC registration', 'Registering a foreign-owned or joint-venture business with the Ghana Investment Promotion Centre.', NULL, 'from', 'GHS', 'regulatory_filing', 1, 5, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_07', 'Data Protection Commission registration', 'Registering as a data controller and the first annual renewal.', NULL, 'from', 'GHS', 'regulatory_filing', 1, 6, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_08', 'Sector licence application (FDA, GSA and others)', 'Preparing and lodging a first application with a sector regulator.', NULL, 'from', 'GHS', 'regulatory_filing', 1, 7, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_09', 'Accounting system set-up', 'Chart of accounts, opening balances and bank feeds on QuickBooks, Xero or Sage, with a handover session.', NULL, 'from', 'GHS', 'bookkeeping', 1, 8, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_10', 'Payroll set-up and first run', 'Staff records, allowances, SSNIT and PAYE set up, and the first month run alongside you.', NULL, 'from', 'GHS', 'payroll', 1, 9, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_11', 'Backlog bookkeeping clean-up', 'Bringing months or years of records up to date so returns can be filed and accounts prepared.', NULL, 'from', 'GHS', 'bookkeeping', 1, 10, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_12', 'Overdue return filed', 'One outstanding VAT, PAYE, withholding or income tax return prepared and filed, with penalty position explained.', NULL, 'from', 'GHS', 'tax_compliance', 1, 11, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_13', 'Reconstruction of records', 'Rebuilding the books from bank statements and source documents where records were lost or never kept.', NULL, 'from', 'GHS', 'bookkeeping', 1, 12, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_14', 'Tax health check', 'A review of the last three years'' filings and positions, with a written report of exposures and fixes.', NULL, 'from', 'GHS', 'tax_advisory', 1, 13, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_15', 'GRA objection and appeal', 'Preparing and pursuing an objection to an assessment, and representation at the GRA or the tribunal.', NULL, 'from', 'GHS', 'tax_advisory', 1, 14, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_16', 'GRA audit representation', 'Handling a GRA audit or desk query on your behalf, from the first letter to the closing position.', NULL, 'from', 'GHS', 'tax_advisory', 1, 15, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_17', 'Transfer pricing benchmarking study', 'A benchmarking study and local file for related-party transactions, to the GRA''s regulations.', NULL, 'from', 'GHS', 'tax_advisory', 1, 16, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_18', 'Tax due diligence', 'Tax review of a business being bought, sold or invested in, with a report of liabilities and warranties to seek.', NULL, 'from', 'GHS', 'tax_advisory', 1, 17, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_19', 'Tax opinion', 'A written opinion on the tax treatment of a transaction or arrangement before it is entered into.', NULL, 'from', 'GHS', 'tax_advisory', 1, 18, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_20', 'Audit preparation', 'Schedules, reconciliations and the audit file for a statutory audit, and liaison with the auditors.', NULL, 'from', 'GHS', 'audit_assurance', 1, 19, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_21', 'Business plan', 'A business plan for a bank, an investor or a board, with three-year projections.', NULL, 'from', 'GHS', 'advisory', 1, 20, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_22', 'Financial model and projections', 'A driver-based model with scenarios, for financing, pricing or expansion decisions.', NULL, 'from', 'GHS', 'advisory', 1, 21, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_23', 'Business valuation', 'An indicative valuation for a sale, a share issue, a shareholder exit or a dispute.', NULL, 'from', 'GHS', 'advisory', 1, 22, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_24', 'Loan or grant application support', 'Financial statements, projections and the narrative a lender or funder asks for.', NULL, 'from', 'GHS', 'advisory', 1, 23, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_25', 'Donor and grant reporting', 'Financial reports in the funder''s format for an NGO or a funded project, with the supporting reconciliation.', NULL, 'from', 'GHS', 'bookkeeping', 1, 24, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_26', 'Annual budget preparation', 'A budget built with management, with the monthly phasing the accounts will be measured against.', NULL, 'from', 'GHS', 'advisory', 1, 25, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_27', 'Changes at the ORC', 'A change of directors, shareholders, secretary, name or registered office, filed and certified.', NULL, 'from', 'GHS', 'company_secretarial', 1, 26, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_28', 'Share transfer or allotment', 'The resolutions, forms, register entries and ORC filing for shares changing hands or being issued.', NULL, 'from', 'GHS', 'company_secretarial', 1, 27, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_29', 'Board minutes and resolutions pack', 'Minutes and resolutions for a year''s board and shareholder decisions, kept to the Companies Act.', NULL, 'from', 'GHS', 'company_secretarial', 1, 28, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_30', 'Annual return to the ORC (one-off)', 'One year''s annual return prepared and filed, for a business not on a package that includes it.', NULL, 'from', 'GHS', 'regulatory_filing', 1, 29, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_31', 'Beneficial ownership filing (one-off)', 'The beneficial ownership register and ORC filing brought up to date.', NULL, 'from', 'GHS', 'regulatory_filing', 1, 30, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_32', 'Work and residence permit support', 'The Ghana Immigration Service application for an expatriate employee, and the quota it sits under.', NULL, 'from', 'GHS', 'regulatory_filing', 1, 31, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_33', 'Employment contract and HR policy pack', 'Contracts of employment and the core HR policies a Ghanaian employer needs, drafted for the business.', NULL, 'from', 'GHS', 'advisory', 1, 32, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_34', 'Payroll audit', 'A check of a year''s payroll against SSNIT and PAYE, with under- and over-payments identified.', NULL, 'from', 'GHS', 'payroll', 1, 33, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('adhoc_35', 'Staff training: bookkeeping and tax basics', 'A half-day session for your finance or admin staff on keeping records the GRA and your accountant can use.', NULL, 'from', 'GHS', 'advisory', 1, 34, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
