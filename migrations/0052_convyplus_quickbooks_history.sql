-- ConvyPlus LTD's 2026 invoices and payments, brought in from QuickBooks.
--
-- A one-off, done here rather than through a screen at the firm's request. The figures
-- are read from three QuickBooks exports, cross-checked against each other before this
-- was written:
--
--  - Sales by Customer Type Detail (every invoice line), for the invoices;
--  - Deposit Detail (Fidelity GHS), for the eleven payments;
--  - the customer's invoice list, whose totals and paid / open / overdue statuses these
--    match exactly: 12 invoices, GHS 38,463.56 billed after withholding, GHS 34,649.06
--    paid, GHS 3,814.50 outstanding on CPL202607_1.
--
-- CPL202607_4 (25 Sep 2026) is left out on the firm's instruction.
--
-- Written so it cannot do harm wherever it runs:
--  - it attaches to the client whose name is ConvyPlus LTD (in any case or spacing),
--    or failing that whose code is CPL; where there is no such client - a fresh
--    database, the CI check - every statement inserts nothing;
--  - an invoice whose number is already in use is not inserted, and neither are its
--    lines or payments;
--  - these invoices carry imported_from = 'QuickBooks', so nothing was or will be
--    emailed for them and the reminder schedule leaves them alone (0050).
--
-- Withholding is the deduction printed on each invoice; the balance due is what the
-- client was asked to pay. Payments are matched to the oldest invoice open for exactly
-- that amount on or before the day it was banked, as the deposit report does not name
-- the invoice. Due dates are the invoice date plus the firm's payment terms.

-- CPL202601: 2 line(s), balance 2,824.06, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT '73d207d5-daf0-4322-807a-63f91f589ae5', 'CPL202601', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-01-31',
       date('2026-01-31', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 3087.16, 0, 3087.16,
       7.5, 263.1, 2824.06, 0, '2026-01-31T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202601');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT 'cf14b51d-f8c3-4541-b3aa-d5927dbd5b7f', id, client_id, 'Accounting, tax and payroll', 1, 3508.1, 3508.1,
       'manual', 0, 1, 'Consultancy services'
  FROM invoices WHERE id = '73d207d5-daf0-4322-807a-63f91f589ae5';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '8d4c349b-fe44-4955-94fa-94369a7b9c93', id, client_id, 'Dec 2025 overpayment', 1, -420.94, -420.94,
       'manual', 1, 0, 'Prepayments'
  FROM invoices WHERE id = '73d207d5-daf0-4322-807a-63f91f589ae5';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT 'fe3d92e7-9ec5-4605-b381-13ef4a986309', id, 2824.06, 0, '2026-02-06', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = '73d207d5-daf0-4322-807a-63f91f589ae5';

-- CPL202602: 1 line(s), balance 3,245.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT '41c61fb8-93e8-4669-8a39-448098503df3', 'CPL202602', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-02-27',
       date('2026-02-27', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 3508.1, 0, 3508.1,
       7.5, 263.1, 3245, 0, '2026-02-27T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202602');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '54798597-ac19-4b6e-a3eb-058535884914', id, client_id, 'Accounting, tax and payroll', 1, 3508.1, 3508.1,
       'manual', 0, 1, 'Consultancy services'
  FROM invoices WHERE id = '41c61fb8-93e8-4669-8a39-448098503df3';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT 'ada96353-dca7-4e71-bc62-a88be469464d', id, 3245, 0, '2026-03-12', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = '41c61fb8-93e8-4669-8a39-448098503df3';

-- CPL202603: 1 line(s), balance 3,245.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT 'd0684e43-e9b2-49dc-af88-b6513d6b704d', 'CPL202603', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-03-25',
       date('2026-03-25', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 3508.1, 0, 3508.1,
       7.5, 263.1, 3245, 0, '2026-03-25T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202603');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '60e086b4-d422-4fca-98fa-82e1128df9b1', id, client_id, 'Accounting, tax and payroll', 1, 3508.1, 3508.1,
       'manual', 0, 1, 'Consultancy services'
  FROM invoices WHERE id = 'd0684e43-e9b2-49dc-af88-b6513d6b704d';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT '6e2eb84e-7119-4a96-a57c-9ca10886bda7', id, 3245, 0, '2026-04-20', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = 'd0684e43-e9b2-49dc-af88-b6513d6b704d';

-- CPL202604: 1 line(s), balance 3,245.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT '96d7f84e-50ec-4b30-b746-409bac1bb33f', 'CPL202604', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-04-25',
       date('2026-04-25', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 3508.1, 0, 3508.1,
       7.5, 263.1, 3245, 0, '2026-04-25T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202604');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '16be3f3d-5a66-498f-856b-d6ec7037bce6', id, client_id, 'Accounting, tax and payroll', 1, 3508.1, 3508.1,
       'manual', 0, 1, 'Consultancy services'
  FROM invoices WHERE id = '96d7f84e-50ec-4b30-b746-409bac1bb33f';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT '1539d577-1dc5-4b93-b860-a74280ffe0b6', id, 3245, 0, '2026-05-21', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = '96d7f84e-50ec-4b30-b746-409bac1bb33f';

-- CPL202605_1: 1 line(s), balance 1,150.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT '67ba17b4-5415-44d4-9e83-6481c1005681', 'CPL202605_1', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-05-21',
       date('2026-05-21', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 1150, 0, 1150,
       0, 0, 1150, 0, '2026-05-21T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202605_1');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT 'e87f580e-c53f-47cb-9d9b-f3a04ecc3652', id, client_id, 'Beneficial Ownership Profile Update & Acquisition', 1, 1150, 1150,
       'manual', 0, 0, 'Reimbursable'
  FROM invoices WHERE id = '67ba17b4-5415-44d4-9e83-6481c1005681';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT '7bf7d3dc-6a29-4827-8ba4-f5e32c8d57aa', id, 1150, 0, '2026-05-21', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = '67ba17b4-5415-44d4-9e83-6481c1005681';

-- CPL202605_2: 1 line(s), balance 2,500.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT 'd5a3a933-23c9-4503-aafe-5745a7797268', 'CPL202605_2', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-05-21',
       date('2026-05-21', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 2500, 0, 2500,
       0, 0, 2500, 0, '2026-05-21T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202605_2');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT 'afee3dc7-ec5f-4953-b563-c6103eaf992d', id, client_id, 'Facilitation of Business Valuation', 1, 2500, 2500,
       'manual', 0, 1, 'Regulatory services'
  FROM invoices WHERE id = 'd5a3a933-23c9-4503-aafe-5745a7797268';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT '2fe486fd-189b-4266-8388-8f46c18fc344', id, 2500, 0, '2026-07-06', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = 'd5a3a933-23c9-4503-aafe-5745a7797268';

-- CPL202605_3: 1 line(s), balance 3,245.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT 'f53031f3-9421-4fa1-8fb9-0935072af4b7', 'CPL202605_3', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-05-25',
       date('2026-05-25', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 3508.1, 0, 3508.1,
       7.5, 263.1, 3245, 0, '2026-05-25T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202605_3');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '113d0c0f-60ce-4b37-8e28-ff15be487d39', id, client_id, 'Accounting, tax and payroll', 1, 3508.1, 3508.1,
       'manual', 0, 1, 'Consultancy services'
  FROM invoices WHERE id = 'f53031f3-9421-4fa1-8fb9-0935072af4b7';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT '1d983c73-fe1f-4079-a634-9178596b1d99', id, 3245, 0, '2026-06-09', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = 'f53031f3-9421-4fa1-8fb9-0935072af4b7';

-- CPL202606: 1 line(s), balance 3,245.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT '87bc2c11-c1ad-4d84-a4e7-bbbf3c0a7edb', 'CPL202606', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-06-25',
       date('2026-06-25', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 3508.1, 0, 3508.1,
       7.5, 263.1, 3245, 0, '2026-06-25T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202606');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT 'b60ee43f-51f6-44cf-8172-8457b0d032e7', id, client_id, 'Accounting, tax and payroll', 1, 3508.1, 3508.1,
       'manual', 0, 1, 'Consultancy services'
  FROM invoices WHERE id = '87bc2c11-c1ad-4d84-a4e7-bbbf3c0a7edb';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT 'd764b95a-220c-4881-a679-ff28842fb8d6', id, 3245, 0, '2026-07-06', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = '87bc2c11-c1ad-4d84-a4e7-bbbf3c0a7edb';

-- CPL202606_2: 6 line(s), balance 5,460.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT '3153fb11-319d-4ac4-8658-e233f9730318', 'CPL202606_2', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-07-02',
       date('2026-07-02', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 5610, 0, 5610,
       7.5, 150, 5460, 0, '2026-07-02T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202606_2');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '7830eb57-2927-46d0-80b2-736abf5fe3ea', id, client_id, 'Addition of director', 1, 1150, 1150,
       'manual', 0, 0, 'Reimbursable'
  FROM invoices WHERE id = '3153fb11-319d-4ac4-8658-e233f9730318';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '778d3946-4a3b-4dd6-9930-a69d3a107b08', id, client_id, 'Change of auditors', 1, 1150, 1150,
       'manual', 1, 0, 'Reimbursable'
  FROM invoices WHERE id = '3153fb11-319d-4ac4-8658-e233f9730318';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '928e5d03-0306-46f9-841b-b14f47cc9c5b', id, client_id, 'Change of business address', 1, 1150, 1150,
       'manual', 2, 0, 'Reimbursable'
  FROM invoices WHERE id = '3153fb11-319d-4ac4-8658-e233f9730318';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT 'dc138953-bd82-4339-837b-b25e81bf753a', id, client_id, 'Removal of director', 1, 100, 100,
       'manual', 3, 0, 'Reimbursable'
  FROM invoices WHERE id = '3153fb11-319d-4ac4-8658-e233f9730318';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '3c086aff-3044-4030-8093-d66c07f2c761', id, client_id, 'Director''s name correction', 1, 60, 60,
       'manual', 4, 0, 'Reimbursable'
  FROM invoices WHERE id = '3153fb11-319d-4ac4-8658-e233f9730318';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '0bcb020d-8ed7-430c-a5f1-cca402c10425', id, client_id, 'Service charge for the above amendments', 1, 2000, 2000,
       'manual', 5, 1, 'Regulatory services'
  FROM invoices WHERE id = '3153fb11-319d-4ac4-8658-e233f9730318';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT '9fdf0c64-2afb-4f94-952e-a459ecce663c', id, 5460, 0, '2026-07-06', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = '3153fb11-319d-4ac4-8658-e233f9730318';

-- CPL202607_1: 6 line(s), balance 3,814.50, sent
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT 'f63084c0-68b2-45b8-b0f4-e6b330458eb0', 'CPL202607_1', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'sent', '2026-07-23',
       date('2026-07-23', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 4002, 0, 4002,
       7.5, 187.5, 3814.5, 0, '2026-07-23T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202607_1');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '6ee8a305-0da1-4046-92eb-1c1878b6b904', id, client_id, 'Application for stamping non landed document', 1, 80, 80,
       'manual', 0, 0, 'Reimbursable'
  FROM invoices WHERE id = 'f63084c0-68b2-45b8-b0f4-e6b330458eb0';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '8b7625a0-360d-41d0-9da5-92bac59b7a72', id, client_id, 'Stamp duty', 1, 72, 72,
       'manual', 1, 0, 'Reimbursable'
  FROM invoices WHERE id = 'f63084c0-68b2-45b8-b0f4-e6b330458eb0';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT 'a6bffb82-cdd3-4690-95ec-2cde90e372fc', id, client_id, 'Stamp for Boost Ghana LTD + delivery', 1, 500, 500,
       'manual', 2, 0, 'Reimbursable'
  FROM invoices WHERE id = 'f63084c0-68b2-45b8-b0f4-e6b330458eb0';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT 'bd65f6f8-81b1-4cc7-810d-2ace8a2bbf6b', id, client_id, 'Change in shareholding', 1, 750, 750,
       'manual', 3, 0, 'Reimbursable'
  FROM invoices WHERE id = 'f63084c0-68b2-45b8-b0f4-e6b330458eb0';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '16bd0a71-f58f-4a38-b663-f6392d0be412', id, client_id, 'Annual returns filing', 1, 100, 100,
       'manual', 4, 0, 'Reimbursable'
  FROM invoices WHERE id = 'f63084c0-68b2-45b8-b0f4-e6b330458eb0';
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT 'a99132a7-8ec1-4cbb-851b-3244d89b78d3', id, client_id, 'Service charge - annual returns filing + change in shareholding', 1, 2500, 2500,
       'manual', 5, 1, 'Regulatory services'
  FROM invoices WHERE id = 'f63084c0-68b2-45b8-b0f4-e6b330458eb0';

-- CPL202607_2: 1 line(s), balance 3,245.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT '3da2205e-3b48-4cac-a8b1-06ebd3c95a8a', 'CPL202607_2', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-07-25',
       date('2026-07-25', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 3508.1, 0, 3508.1,
       7.5, 263.1, 3245, 0, '2026-07-25T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202607_2');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '977f6058-2caa-4827-9db5-608b0731df61', id, client_id, 'Accounting, tax and payroll', 1, 3508.1, 3508.1,
       'manual', 0, 1, 'Consultancy services'
  FROM invoices WHERE id = '3da2205e-3b48-4cac-a8b1-06ebd3c95a8a';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT '0d3d293b-b0fd-456d-b74e-d623e9ff9f16', id, 3245, 0, '2026-08-25', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = '3da2205e-3b48-4cac-a8b1-06ebd3c95a8a';

-- CPL202608: 1 line(s), balance 3,245.00, paid
INSERT INTO invoices
  (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
   withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
   imported_from, created_by, created_at, updated_at)
SELECT 'b26d1cf8-1469-4754-8bf1-6cc1d35a4ea3', 'CPL202608', (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1), 'paid', '2026-08-25',
       date('2026-08-25', '+' || COALESCE(NULLIF(CAST((SELECT value FROM settings WHERE key = 'invoice_terms_days') AS INTEGER), 0), 15) || ' days'), 'GHS', 3508.1, 0, 3508.1,
       7.5, 263.1, 3245, 0, '2026-08-25T00:00:00.000Z',
       'QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE (SELECT id FROM clients
      WHERE lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus')
         OR upper(code) = 'CPL'
      ORDER BY lower(replace(replace(name, ' ', ''), '.', '')) IN ('convyplusltd', 'convypluslimited', 'convyplus') DESC,
               created_at
      LIMIT 1) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE number = 'CPL202608');
INSERT INTO invoice_lines
  (id, invoice_id, client_id, description, quantity, unit_amount, amount, source, position, taxable, activity)
SELECT '45296f9a-21a2-43a9-960a-6514d0922e85', id, client_id, 'Accounting, tax and payroll', 1, 3508.1, 3508.1,
       'manual', 0, 1, 'Consultancy services'
  FROM invoices WHERE id = 'b26d1cf8-1469-4754-8bf1-6cc1d35a4ea3';
INSERT INTO invoice_payments
  (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
SELECT 'd9cf4c06-556d-4f02-9e20-271f3f512860', id, 3245, 0, '2026-09-10', 'Bank deposit', 'Fidelity GHS',
       'Imported from QuickBooks', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invoices WHERE id = 'b26d1cf8-1469-4754-8bf1-6cc1d35a4ea3';
