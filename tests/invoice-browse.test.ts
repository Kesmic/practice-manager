/**
 * Finding invoices on the Invoices tab: what a search finds, what each filter keeps,
 * how groups and totals come out, and that the CSV cannot carry a formula.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_CRITERIA,
  datePresets,
  filterInvoices,
  groupInvoices,
  invoicesCsv,
  matchesSearch,
  sortInvoices,
  totalsByCurrency,
} from "../shared/invoice-browse";
import type { InvoiceSummary } from "../shared/types";

function inv(over: Partial<InvoiceSummary> & { number: string }): InvoiceSummary {
  return {
    id: over.number,
    client_id: "c1",
    client_name: "Convyplus LTD",
    client_code: "CPL",
    state: "paid",
    issued_on: "2026-07-23",
    due_on: "2026-08-07",
    currency: "GHS",
    net: 3508.1,
    tax_total: 0,
    gross: 3508.1,
    balance_due: 3245,
    withholding_amount: 263.1,
    discount_amount: 0,
    discount_label: null,
    period_label: null,
    reminders_sent: 0,
    last_reminder_at: null,
    standing: { outstanding: 0, overdue: false, days_to_due: 0, paid: 3245, awaiting_certificate: 0 } as InvoiceSummary["standing"],
    ...over,
  };
}

const ROWS = [
  inv({ number: "CPL202607_1", gross: 4002, balance_due: 3814.5, state: "sent", standing: { outstanding: 3814.5, overdue: true, days_to_due: -50, paid: 0, awaiting_certificate: 0 } as InvoiceSummary["standing"] }),
  inv({ number: "CPL202608", issued_on: "2026-08-25", due_on: "2026-09-09" }),
  inv({ number: "ACME202610", client_id: "c2", client_name: "Acme Trading Ltd", client_code: "ACME", issued_on: "2026-09-21", due_on: "2026-10-06", period_label: "2026-10", currency: "USD", gross: 1250, balance_due: 1250 }),
  inv({ number: "ACME-DRAFT", client_id: "c2", client_name: "Acme Trading Ltd", client_code: "ACME", state: "draft", issued_on: null, due_on: "2026-10-11" }),
];

test("a search wants every word, found in the number, client, dates or amounts", () => {
  const find = (q: string) => filterInvoices(ROWS, { ...NO_CRITERIA, q }).map((i) => i.number);
  assert.deepEqual(find("cpl2026"), ["CPL202607_1", "CPL202608"]);
  // "2026-10" is the month one covers and the month the draft falls due.
  assert.deepEqual(find("acme 2026-10"), ["ACME202610", "ACME-DRAFT"]);
  assert.deepEqual(find("acme 2026-10-06"), ["ACME202610"]);
  assert.deepEqual(find("3,814.50"), ["CPL202607_1"]);
  assert.deepEqual(find("3814.5"), ["CPL202607_1"]);
  // Dates in the ways the firm writes them.
  assert.deepEqual(find("25/08/2026"), ["CPL202608"]);
  assert.deepEqual(find("july 2026"), ["CPL202607_1"]);
  assert.deepEqual(find("23 jul"), ["CPL202607_1"]);
  assert.deepEqual(find("overdue"), ["CPL202607_1"]);
  assert.deepEqual(find("nothing like this"), []);
  assert.ok(matchesSearch(ROWS[0], "  CONVYPLUS   ltd "));
});

test("filters: standing, client, currency and a date range on either date", () => {
  const f = (c: Partial<typeof NO_CRITERIA>) => filterInvoices(ROWS, { ...NO_CRITERIA, ...c }).map((i) => i.number);
  assert.deepEqual(f({ status: "unpaid" }), ["CPL202607_1"]);
  assert.deepEqual(f({ status: "overdue" }), ["CPL202607_1"]);
  assert.deepEqual(f({ status: "sent" }), []);
  assert.deepEqual(f({ status: "draft" }), ["ACME-DRAFT"]);
  assert.deepEqual(f({ clientId: "c2" }), ["ACME202610", "ACME-DRAFT"]);
  assert.deepEqual(f({ currency: "USD" }), ["ACME202610"]);
  assert.deepEqual(f({ from: "2026-08-01", to: "2026-08-31" }), ["CPL202608"]);
  // By due date instead: the draft has no issue date but does have a due date.
  assert.deepEqual(f({ dateField: "due", from: "2026-10-01" }), ["ACME202610", "ACME-DRAFT"]);
});

test("grouping by client, month and standing, with totals kept apart by currency", () => {
  const byClient = groupInvoices(ROWS, "client");
  assert.deepEqual(byClient.map((g) => [g.label, g.rows.length]), [
    ["Acme Trading Ltd", 2],
    ["Convyplus LTD", 2],
  ]);
  const cpl = byClient[1].totals;
  assert.deepEqual(cpl, [{ currency: "GHS", count: 2, billed: 7059.5, outstanding: 3814.5, overdue: 3814.5, awaiting_certificate: 0 }]);
  // A draft is not billed; USD and GHS are never added together.
  assert.deepEqual(totalsByCurrency(ROWS).map((t) => [t.currency, t.billed]), [
    ["GHS", 7059.5],
    ["USD", 1250],
  ]);
  assert.deepEqual(groupInvoices(ROWS, "issued_month").map((g) => g.label), ["September 2026", "August 2026", "July 2026", "Not issued yet"]);
  assert.deepEqual(groupInvoices(ROWS, "status").map((g) => g.label), ["Overdue", "Draft", "Paid"]);
  assert.equal(groupInvoices(ROWS, "none").length, 1);
});

test("a draft or a cancelled invoice is never counted as owed, whatever it carries", () => {
  const late = { outstanding: 999, overdue: true, days_to_due: -9, paid: 0, awaiting_certificate: 0 } as InvoiceSummary["standing"];
  const rows = [inv({ number: "V1", state: "void", standing: late }), inv({ number: "D1", state: "draft", standing: late })];
  assert.deepEqual(totalsByCurrency(rows)[0], { currency: "GHS", count: 2, billed: 0, outstanding: 0, overdue: 0, awaiting_certificate: 0 });
  assert.deepEqual(filterInvoices(rows, { ...NO_CRITERIA, status: "overdue" }), []);
  assert.deepEqual(groupInvoices(rows, "status").map((g) => g.label), ["Draft", "Cancelled"]);
});

test("sorting by any column, either way, numbers in number order", () => {
  assert.deepEqual(sortInvoices(ROWS, "total", true).map((i) => i.gross), [4002, 3508.1, 3508.1, 1250]);
  assert.deepEqual(sortInvoices(ROWS, "client", false).map((i) => i.client_code), ["ACME", "ACME", "CPL", "CPL"]);
});

test("date shortcuts are whole months, quarters and years", () => {
  const p = Object.fromEntries(datePresets("2026-09-26").map((x) => [x.key, [x.from, x.to]]));
  assert.deepEqual(p.this_month, ["2026-09-01", "2026-09-30"]);
  assert.deepEqual(p.last_month, ["2026-08-01", "2026-08-31"]);
  assert.deepEqual(p.this_quarter, ["2026-07-01", "2026-09-30"]);
  assert.deepEqual(p.last_quarter, ["2026-04-01", "2026-06-30"]);
  assert.deepEqual(p.last_year, ["2025-01-01", "2025-12-31"]);
  assert.deepEqual(Object.fromEntries(datePresets("2026-01-15").map((x) => [x.key, [x.from, x.to]])).last_quarter, ["2025-10-01", "2025-12-31"]);
});

test("the CSV quotes everything and never lets a cell start a formula", () => {
  const csv = invoicesCsv([inv({ number: "=HYPERLINK(1)", client_name: 'Say "hi"', gross: -420.94 })]);
  const [header, row] = csv.split("\r\n");
  assert.match(header, /^"Invoice","Client"/);
  assert.match(row, /^"'=HYPERLINK\(1\)","Say ""hi"""/);
  assert.match(row, /"-420\.94"/);
});
