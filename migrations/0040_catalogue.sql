-- The firm's services, as the firm actually sells them.
--
-- The catalogue 0038 seeded was the old inclusion lines from the proposal: honest, and
-- thin - it was really just tax broken out, and Firm listed exactly what Growth did.
-- This replaces it with the six lines the firm works in, each with the sub-services a
-- client actually touches, and a note where a package gets the same thing at a
-- different depth ("monthly" against "weekly"). The Partners can rename, retire or
-- remove any of it in Portal settings; this is a starting point, not a rule.
--
-- Anything a client has already been given as an extra follows its service to the new
-- catalogue by name, so no record loses what it says. Old rows that still have an
-- extra pointing at them and no equivalent here are retired rather than removed.

-- A note on an inclusion: how often, or at what depth, this package gets it.
ALTER TABLE package_service_inclusions ADD COLUMN note TEXT;

CREATE TEMP TABLE old_services AS SELECT id, name, parent_id FROM package_services;

INSERT OR IGNORE INTO package_services (id, name, parent_id, position, active, created_at, updated_at) VALUES
  ('svc_book', 'Bookkeeping', NULL, 0, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_book_txn', 'Transaction recording (sales, purchases, expenses)', 'svc_book', 0, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_book_bank', 'Bank and mobile-money reconciliation', 'svc_book', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_book_ar_ap', 'Receivables and payables ledgers', 'svc_book', 2, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_book_fixed', 'Fixed asset register and depreciation', 'svc_book', 3, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_book_stock', 'Inventory and cost of sales', 'svc_book', 4, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_book_multi', 'Multi-entity and multi-currency books', 'svc_book', 5, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_report', 'Financial reporting', NULL, 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_report_mgmt', 'Management accounts', 'svc_report', 0, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_report_afs', 'Annual financial statements', 'svc_report', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_report_budget', 'Budget vs actual and cash-flow forecast', 'svc_report', 2, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_report_board', 'Board pack and KPI dashboard', 'svc_report', 3, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_report_audit', 'Audit support (auditor liaison and schedules)', 'svc_report', 4, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_pay', 'Payroll administration', NULL, 2, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_pay_run', 'Monthly payroll and payslips', 'svc_pay', 0, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_pay_ssnit', 'SSNIT Tier 1 and Tier 2 contributions and returns', 'svc_pay', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_pay_paye', 'PAYE computation and remittance', 'svc_pay', 2, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_pay_joiners', 'Staff onboarding and exit (SSNIT registration, final pay)', 'svc_pay', 3, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_pay_annual', 'Annual PAYE returns and employee tax certificates', 'svc_pay', 4, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_pay_expat', 'Expatriate payroll and tax equalisation', 'svc_pay', 5, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax', 'Tax compliance', NULL, 3, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_vat', 'VAT, NHIL, GETFund and COVID-19 levy returns', 'svc_tax', 0, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_wht', 'Withholding tax returns and WHT certificates', 'svc_tax', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_pit', 'Directors'' PIT compliance', 'svc_tax', 2, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_cit', 'Corporate income tax return', 'svc_tax', 3, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_instal', 'Quarterly self-assessment estimates and instalments', 'svc_tax', 4, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_emp', 'Annual employer tax compliance', 'svc_tax', 5, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_tcc', 'Tax clearance certificate', 'svc_tax', 6, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_capall', 'Capital allowance schedules', 'svc_tax', 7, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_gra', 'GRA audit and query representation', 'svc_tax', 8, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_tp', 'Transfer pricing return and local file', 'svc_tax', 9, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_tax_health', 'Tax health check', 'svc_tax', 10, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_reg', 'Regulatory and company secretarial', NULL, 4, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_reg_orc', 'Annual return to the ORC', 'svc_reg', 0, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_reg_bo', 'Beneficial ownership updates', 'svc_reg', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_reg_changes', 'Changes of directors, shareholders and registered office', 'svc_reg', 2, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_reg_bop', 'District Assembly business operating permit renewal', 'svc_reg', 3, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_reg_licences', 'Sector licence renewals (FDA, GSA, GIPC, DPC, as applicable)', 'svc_reg', 4, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_reg_gipc', 'GIPC registration renewal and returns', 'svc_reg', 5, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_reg_calendar', 'Compliance calendar and deadline tracking', 'svc_reg', 6, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_adv', 'Advisory', NULL, 5, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_adv_review', 'Review call with your accountant', 'svc_adv', 0, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_adv_planning', 'Tax planning and structuring', 'svc_adv', 1, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_adv_deals', 'Transactions advisory and client representation', 'svc_adv', 2, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  ('svc_adv_cfo', 'Virtual CFO (strategy, financing, investor reporting)', 'svc_adv', 3, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- Extras already given follow their service by name.
UPDATE client_service_extras SET service_id = 'svc_book'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Bookkeeping');
UPDATE client_service_extras SET service_id = 'svc_pay'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Payroll administration');
UPDATE client_service_extras SET service_id = 'svc_tax'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Tax services');
UPDATE client_service_extras SET service_id = 'svc_reg_orc'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Annual filings with the ORC');
UPDATE client_service_extras SET service_id = 'svc_adv_deals'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Transactions advisory & client representation');
UPDATE client_service_extras SET service_id = 'svc_tax_vat'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'VAT & levies');
UPDATE client_service_extras SET service_id = 'svc_tax_wht'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Withholding tax');
UPDATE client_service_extras SET service_id = 'svc_pay_paye'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'PAYE');
UPDATE client_service_extras SET service_id = 'svc_tax_pit'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Directors'' PIT compliance');
UPDATE client_service_extras SET service_id = 'svc_tax_emp'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Annual employer tax compliance');
UPDATE client_service_extras SET service_id = 'svc_tax_cit'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Corporate tax compliance');
UPDATE client_service_extras SET service_id = 'svc_tax_tp'
 WHERE service_id IN (SELECT id FROM old_services WHERE name = 'Transfer pricing compliance');

-- The old rows: their inclusions go, and so do they unless a client still points at one.
DELETE FROM package_service_inclusions WHERE service_id IN (SELECT id FROM old_services);
DELETE FROM package_services
 WHERE id IN (SELECT id FROM old_services)
   AND id NOT IN (SELECT service_id FROM client_service_extras);
UPDATE package_services SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
 WHERE id IN (SELECT id FROM old_services);
DROP TABLE old_services;

-- What each package includes.
INSERT OR IGNORE INTO package_service_inclusions (tier, service_id, note) VALUES
  ('starter', 'svc_book_txn', NULL),
  ('growth', 'svc_book_txn', NULL),
  ('firm', 'svc_book_txn', NULL),
  ('enterprise', 'svc_book_txn', NULL),
  ('starter', 'svc_book_bank', 'monthly'),
  ('growth', 'svc_book_bank', 'monthly'),
  ('firm', 'svc_book_bank', 'weekly'),
  ('enterprise', 'svc_book_bank', 'weekly'),
  ('growth', 'svc_book_ar_ap', NULL),
  ('firm', 'svc_book_ar_ap', NULL),
  ('enterprise', 'svc_book_ar_ap', NULL),
  ('growth', 'svc_book_fixed', NULL),
  ('firm', 'svc_book_fixed', NULL),
  ('enterprise', 'svc_book_fixed', NULL),
  ('firm', 'svc_book_stock', NULL),
  ('enterprise', 'svc_book_stock', NULL),
  ('enterprise', 'svc_book_multi', NULL),
  ('starter', 'svc_report_mgmt', 'quarterly'),
  ('growth', 'svc_report_mgmt', 'monthly'),
  ('firm', 'svc_report_mgmt', 'monthly'),
  ('enterprise', 'svc_report_mgmt', 'monthly'),
  ('starter', 'svc_report_afs', 'IFRS for SMEs'),
  ('growth', 'svc_report_afs', 'IFRS for SMEs'),
  ('firm', 'svc_report_afs', 'IFRS for SMEs'),
  ('enterprise', 'svc_report_afs', 'full IFRS'),
  ('firm', 'svc_report_budget', NULL),
  ('enterprise', 'svc_report_budget', NULL),
  ('enterprise', 'svc_report_board', NULL),
  ('growth', 'svc_report_audit', NULL),
  ('firm', 'svc_report_audit', NULL),
  ('enterprise', 'svc_report_audit', NULL),
  ('starter', 'svc_pay_run', NULL),
  ('growth', 'svc_pay_run', NULL),
  ('firm', 'svc_pay_run', NULL),
  ('enterprise', 'svc_pay_run', NULL),
  ('starter', 'svc_pay_ssnit', NULL),
  ('growth', 'svc_pay_ssnit', NULL),
  ('firm', 'svc_pay_ssnit', NULL),
  ('enterprise', 'svc_pay_ssnit', NULL),
  ('starter', 'svc_pay_paye', NULL),
  ('growth', 'svc_pay_paye', NULL),
  ('firm', 'svc_pay_paye', NULL),
  ('enterprise', 'svc_pay_paye', NULL),
  ('growth', 'svc_pay_joiners', NULL),
  ('firm', 'svc_pay_joiners', NULL),
  ('enterprise', 'svc_pay_joiners', NULL),
  ('growth', 'svc_pay_annual', NULL),
  ('firm', 'svc_pay_annual', NULL),
  ('enterprise', 'svc_pay_annual', NULL),
  ('enterprise', 'svc_pay_expat', NULL),
  ('starter', 'svc_tax_vat', NULL),
  ('growth', 'svc_tax_vat', NULL),
  ('firm', 'svc_tax_vat', NULL),
  ('enterprise', 'svc_tax_vat', NULL),
  ('starter', 'svc_tax_wht', NULL),
  ('growth', 'svc_tax_wht', NULL),
  ('firm', 'svc_tax_wht', NULL),
  ('enterprise', 'svc_tax_wht', NULL),
  ('starter', 'svc_tax_pit', NULL),
  ('growth', 'svc_tax_pit', NULL),
  ('firm', 'svc_tax_pit', NULL),
  ('enterprise', 'svc_tax_pit', NULL),
  ('growth', 'svc_tax_cit', NULL),
  ('firm', 'svc_tax_cit', NULL),
  ('enterprise', 'svc_tax_cit', NULL),
  ('growth', 'svc_tax_instal', NULL),
  ('firm', 'svc_tax_instal', NULL),
  ('enterprise', 'svc_tax_instal', NULL),
  ('growth', 'svc_tax_emp', NULL),
  ('firm', 'svc_tax_emp', NULL),
  ('enterprise', 'svc_tax_emp', NULL),
  ('growth', 'svc_tax_tcc', NULL),
  ('firm', 'svc_tax_tcc', NULL),
  ('enterprise', 'svc_tax_tcc', NULL),
  ('firm', 'svc_tax_capall', NULL),
  ('enterprise', 'svc_tax_capall', NULL),
  ('firm', 'svc_tax_gra', NULL),
  ('enterprise', 'svc_tax_gra', NULL),
  ('enterprise', 'svc_tax_tp', NULL),
  ('firm', 'svc_tax_health', 'annual'),
  ('enterprise', 'svc_tax_health', 'annual'),
  ('growth', 'svc_reg_orc', NULL),
  ('firm', 'svc_reg_orc', NULL),
  ('enterprise', 'svc_reg_orc', NULL),
  ('growth', 'svc_reg_bo', NULL),
  ('firm', 'svc_reg_bo', NULL),
  ('enterprise', 'svc_reg_bo', NULL),
  ('firm', 'svc_reg_changes', NULL),
  ('enterprise', 'svc_reg_changes', NULL),
  ('starter', 'svc_reg_bop', NULL),
  ('growth', 'svc_reg_bop', NULL),
  ('firm', 'svc_reg_bop', NULL),
  ('enterprise', 'svc_reg_bop', NULL),
  ('firm', 'svc_reg_licences', NULL),
  ('enterprise', 'svc_reg_licences', NULL),
  ('enterprise', 'svc_reg_gipc', NULL),
  ('starter', 'svc_reg_calendar', NULL),
  ('growth', 'svc_reg_calendar', NULL),
  ('firm', 'svc_reg_calendar', NULL),
  ('enterprise', 'svc_reg_calendar', NULL),
  ('starter', 'svc_adv_review', 'quarterly'),
  ('growth', 'svc_adv_review', 'monthly'),
  ('firm', 'svc_adv_review', 'monthly'),
  ('enterprise', 'svc_adv_review', 'monthly, with a named engagement partner'),
  ('firm', 'svc_adv_planning', NULL),
  ('enterprise', 'svc_adv_planning', NULL),
  ('enterprise', 'svc_adv_deals', NULL),
  ('enterprise', 'svc_adv_cfo', NULL);
