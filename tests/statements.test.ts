/**
 * Statements of account: the three kinds agree with each other and with the ledger
 * they are drawn from. The figures are ConvyPlus's 2026 account as it came in from
 * QuickBooks, cut down to a few months, so they are ones the firm can check by hand.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { buildStatement, daysBetween, type StatementInvoice, type StatementPayment } from "../shared/statements";
import { renderStatementPdf, statementFilename } from "../shared/statement-pdf";
import { composeStatementEmail, STANDARD_STATEMENT_EMAIL } from "../shared/invoice-email-wording";
import { toWinAnsi } from "../shared/pdf";

const INVOICES: StatementInvoice[] = [
  { id: "1", number: "CPL202601", issued_on: "2026-01-31", due_on: "2026-02-15", amount: 2824.06 },
  { id: "2", number: "CPL202602", issued_on: "2026-02-27", due_on: "2026-03-14", amount: 3245 },
  { id: "3", number: "CPL202606_2", issued_on: "2026-07-02", due_on: "2026-07-17", amount: 5460 },
  { id: "4", number: "CPL202607_1", issued_on: "2026-07-23", due_on: "2026-08-07", amount: 3814.5 },
  { id: "5", number: "CPL202609", issued_on: "2026-09-25", due_on: "2026-10-10", amount: 3245 },
];
const PAYMENTS: StatementPayment[] = [
  { invoice_id: "1", paid_on: "2026-02-06", amount: 2824.06, method: "Bank deposit" },
  { invoice_id: "2", paid_on: "2026-03-12", amount: 3245, method: "Bank deposit" },
  { invoice_id: "3", paid_on: "2026-07-06", amount: 2000, method: null },
  // A payment against an invoice that is not on the account is ignored.
  { invoice_id: "void", paid_on: "2026-07-06", amount: 999, method: null },
];

test("balance forward: opening balance, a running balance, and the amount due at the end", () => {
  const s = buildStatement({
    type: "balance_forward",
    statementDate: "2026-09-26",
    start: "2026-03-01",
    end: "2026-09-26",
    invoices: INVOICES,
    payments: PAYMENTS,
  });
  // Owed on 1 March: CPL202602, raised in February and not yet paid.
  assert.equal(s.opening, 3245);
  assert.deepEqual(
    s.rows.map((r) => [r.date, r.kind, r.reference, r.balance]),
    [
      ["2026-03-01", "opening", "", 3245],
      ["2026-03-12", "payment", "CPL202602", 0],
      ["2026-07-02", "invoice", "CPL202606_2", 5460],
      ["2026-07-06", "payment", "CPL202606_2", 3460],
      ["2026-07-23", "invoice", "CPL202607_1", 7274.5],
      ["2026-09-25", "invoice", "CPL202609", 10519.5],
    ],
  );
  assert.equal(s.amount_due, 10519.5);
  assert.equal(s.total_invoiced, 12519.5);
  assert.equal(s.total_received, 5245);
  // Ageing on the last day: 3,460 part-paid invoice 71 days late, 3,814.50 50 days late,
  // and the September one not yet due.
  assert.deepEqual(s.ageing, { current: 3245, days_1_30: 0, days_31_60: 3814.5, days_61_90: 3460, over_90: 0 });
});

test("open item: only what is unpaid on the statement date, with what is left and how late", () => {
  const s = buildStatement({
    type: "open_item",
    statementDate: "2026-09-26",
    start: "2026-01-01",
    end: "2026-09-26",
    invoices: INVOICES,
    payments: PAYMENTS,
  });
  assert.deepEqual(
    s.rows.map((r) => [r.reference, r.amount, r.balance, r.days_overdue]),
    [
      ["CPL202606_2", 5460, 3460, 71],
      ["CPL202607_1", 3814.5, 3814.5, 50],
      ["CPL202609", 3245, 3245, 0],
    ],
  );
  assert.equal(s.amount_due, 10519.5);
  assert.equal(s.start, null);
  // As at an earlier date, a payment made after it does not count.
  const early = buildStatement({ type: "open_item", statementDate: "2026-02-28", start: "", end: "", invoices: INVOICES, payments: PAYMENTS });
  assert.deepEqual(early.rows.map((r) => r.reference), ["CPL202602"]);
});

test("transaction statement: the period's invoices and payments, with no running balance", () => {
  const s = buildStatement({
    type: "transaction",
    statementDate: "2026-09-26",
    start: "2026-07-01",
    end: "2026-07-31",
    invoices: INVOICES,
    payments: PAYMENTS,
  });
  assert.deepEqual(s.rows.map((r) => [r.kind, r.reference, r.balance]), [
    ["invoice", "CPL202606_2", null],
    ["payment", "CPL202606_2", null],
    ["invoice", "CPL202607_1", null],
  ]);
  assert.equal(s.total_invoiced, 9274.5);
  assert.equal(s.total_received, 2000);
  // What is owed on the statement date, the whole account, not just July's movement.
  assert.equal(s.amount_due, 10519.5);
  assert.equal(s.ageing, null);
});

test("an invoice paid on the day it was raised reads as charged, then settled", () => {
  const s = buildStatement({
    type: "balance_forward",
    statementDate: "2026-05-31",
    start: "2026-05-01",
    end: "2026-05-31",
    invoices: [{ id: "a", number: "X1", issued_on: "2026-05-21", due_on: "2026-06-05", amount: 1150 }],
    payments: [{ invoice_id: "a", paid_on: "2026-05-21", amount: 1150, method: null }],
  });
  assert.deepEqual(s.rows.map((r) => [r.kind, r.balance]), [
    ["opening", 0],
    ["invoice", 1150],
    ["payment", 0],
  ]);
  assert.equal(daysBetween("2026-08-07", "2026-09-26"), 50);
});

test("the statement PDF is well formed and says what the statement says", async () => {
  const statement = buildStatement({
    type: "balance_forward",
    statementDate: "2026-09-26",
    start: "2026-01-01",
    end: "2026-09-26",
    invoices: INVOICES,
    payments: PAYMENTS,
  });
  const pdf = await renderStatementPdf({
    firm: { name: "Kesmic Consultancy Hub", address_lines: [], city: "Accra", phone: "", email: "", website: "", logo: "", tax_id: "" },
    client: { name: "ConvyPlus LTD", address_lines: [], tax_id: "" },
    bank: { account_name: "Kesmic", account_number: "1", bank: "Fidelity", branch: "", swift: "" },
    currency: "GHS",
    statement,
  });
  const raw = Buffer.from(pdf).toString("latin1");
  assert.ok(raw.startsWith("%PDF-1.4") && raw.endsWith("%%EOF\n"));
  let text = "";
  for (const m of raw.matchAll(/stream\n/g)) {
    const start = m.index! + m[0].length;
    try {
      text += inflateSync(Buffer.from(pdf.subarray(start, raw.indexOf("\nendstream", start)))).toString("latin1");
    } catch {
      /* not text */
    }
  }
  const hex = (s: string) => `<${Buffer.from(toWinAnsi(s)).toString("hex")}>`;
  for (const s of ["STATEMENT", "ConvyPlus LTD", "Balance forward", "Invoice CPL202607_1", "GHS 10,519.50", "31-60 days past due"]) {
    assert.ok(text.includes(hex(s)), s);
  }
  assert.equal(statementFilename("ConvyPlus LTD", "2026-09-26"), "statement-convyplus-ltd-2026-09-26.pdf");
});

test("the statement email fills in its own words", () => {
  const { subject, text } = composeStatementEmail(STANDARD_STATEMENT_EMAIL, {
    name: "Kofi Adom",
    firmName: "Kesmic Consultancy Hub",
    statementDate: "26 September 2026",
    amountDue: "GHS 3,814.50",
    link: "https://portal.example/client/invoices",
  });
  assert.equal(subject, "Statement of account from Kesmic Consultancy Hub - 26 September 2026");
  assert.match(text, /Dear Kofi Adom,/);
  assert.match(text, /statement of account as at 26 September 2026/);
  assert.match(text, /Amount due: GHS 3,814\.50/);
  assert.match(text, /here \(https:\/\/portal\.example\/client\/invoices\)/);
});
