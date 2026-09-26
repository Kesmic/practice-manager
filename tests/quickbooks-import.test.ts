/**
 * Reading QuickBooks reports: the rows are as the firm's own exports of ConvyPlus's
 * 2026 reports come out, so the tests pin the real shape - withholding printed as a
 * positive amount, each deposit printed twice, account headings on rows of their own.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  balanceOf,
  customerFor,
  matchPayments,
  readDeposits,
  readSalesDetail,
  reportDate,
  type Cell,
} from "../shared/quickbooks-import";
import { readFirstSheet } from "../shared/xlsx";

const SALES: Cell[][] = [
  ["Kesmic Consultancy Hub"],
  ["Sales by Customer Type Detail"],
  ["January-December, 2026"],
  [null, "Transaction date", "Transaction type", "Number", "Product/Service full name", "Description", "Quantity", "Sales price", "Amount", "Balance"],
  ["", null],
  [null, "31/01/2026", "Invoice", "CPL202601", "Consultancy services", "Accounting, tax and payroll", 1, 3508.1, 3508.1, 3508.1],
  [null, "31/01/2026", "Invoice", "CPL202601", "Withholding tax", "Withholding tax", -1, -263.1, 263.1, 3771.2],
  [null, "31/01/2026", "Invoice", "CPL202601", "Prepayments", "Dec 2025 overpayment", 1, -420.94, -420.94, 3350.26],
  [null, "27/02/2026", "Invoice", "CPL202602", "Consultancy services", "Accounting, tax and payroll", 1, 3508.1, 3508.1, 6858.36],
  [null, "27/02/2026", "Invoice", "CPL202602", "Withholding tax", "Withholding tax", -1, -263.1, 263.1, 7121.46],
  [null, "02/07/2026", "Invoice", "CPL202606_2", "Reimbursable", "Addition of director", 1, 1150, 1150, 8271.46],
  [null, "02/07/2026", "Invoice", "CPL202606_2", "Regulatory services", "Service charge for the above amendments", 1, 2000, 2000, 10271.46],
  [null, "02/07/2026", "Invoice", "CPL202606_2", "Withholding tax", "", -1, -150, 150, 10421.46],
  [null, "03/07/2026", "Credit Note", "CN-1", "Consultancy services", "Refund", 1, -10, -10, 10411.46],
  ["Total for --", null, null, null, null, null, 7, null, 10411.46, null],
  ["TOTAL", null, null, null, null, null, 7, null, 10411.46, null],
];

const DEPOSITS: Cell[][] = [
  ["Kesmic Consultancy Hub"],
  ["Deposit Detail"],
  [null, "Transaction date", "Transaction type", "Line number", "Customer full name", "Supplier", "Description", "Cleared", "Amount"],
  ["Fidelity GHS"],
  [null, "06/02/2026", "Payment", "", "ConvyPlus LTD", "", "", "Uncleared", 2824.06],
  [null, "06/02/2026", "Payment", "", "ConvyPlus LTD", "", "", "", -2824.06],
  [null, "12/03/2026", "Payment", "", "ConvyPlus LTD", "", "", "Uncleared", 3245],
  [null, "12/03/2026", "Payment", "", "ConvyPlus LTD", "", "", "", -3245],
  [null, "13/03/2026", "Payment", "", "Someone Else", "", "", "Uncleared", 99],
  [null, "06/07/2026", "Payment", "", "ConvyPlus LTD", "", "", "Uncleared", 777],
];

test("invoices come out with withholding as a deduction and each item's own name", () => {
  const { invoices, skipped } = readSalesDetail(SALES);
  assert.deepEqual(invoices.map((i) => i.number), ["CPL202601", "CPL202602", "CPL202606_2"]);
  const [jan, , jul] = invoices;
  assert.equal(jan.issued_on, "2026-01-31");
  assert.equal(jan.withheld, 263.1);
  assert.deepEqual(jan.lines.map((l) => [l.activity, l.amount, l.taxable]), [
    ["Consultancy services", 3508.1, 1],
    ["Prepayments", -420.94, 0],
  ]);
  // What the client's copy asks for, after withholding and the credit brought forward.
  assert.equal(balanceOf(jan), 2824.06);
  assert.equal(balanceOf(jul), 3000);
  assert.equal(jul.lines[0].taxable, 0);
  assert.deepEqual(skipped, ["Credit Note CN-1 of 2026-07-03"]);
});

test("a file that is not the sales report is refused in words", () => {
  assert.throws(() => readSalesDetail([["Name", "Amount"]]), /Sales by Customer Detail/);
  assert.throws(() => readDeposits([["Name", "Amount"]]), /Deposit Detail/);
});

test("deposits are read once each, with who paid and which account they went to", () => {
  const payments = readDeposits(DEPOSITS);
  assert.equal(payments.length, 4);
  assert.deepEqual(payments[0], { paid_on: "2026-02-06", amount: 2824.06, customer: "ConvyPlus LTD", account: "Fidelity GHS" });
  assert.equal(customerFor("Convyplus Ltd.", ["ConvyPlus LTD", "Someone Else"]), "ConvyPlus LTD");
  assert.equal(customerFor("Acme", ["ConvyPlus LTD"]), null);
});

test("each payment settles the oldest open invoice of exactly its amount, and a stray one is left out", () => {
  const { invoices } = readSalesDetail(SALES);
  const theirs = readDeposits(DEPOSITS).filter((p) => p.customer === "ConvyPlus LTD");
  const matched = matchPayments(invoices, theirs);
  assert.deepEqual(matched.payments.map((p) => [p.paid_on, p.invoice]), [
    ["2026-02-06", "CPL202601"],
    ["2026-03-12", "CPL202602"],
  ]);
  assert.deepEqual(matched.unmatched.map((p) => p.amount), [777]);
  // Never onto an invoice issued after the money arrived.
  const early = matchPayments(invoices, [{ paid_on: "2026-02-01", amount: 3245, customer: "", account: "" }]);
  assert.equal(early.payments.length, 0);
});

test("dates are read as the report writes them, or as Excel stores them", () => {
  assert.equal(reportDate("31/01/2026"), "2026-01-31");
  assert.equal(reportDate(46053), "2026-01-31");
  assert.equal(reportDate("2026-01-31"), null);
  assert.equal(reportDate("32/13/2026"), null);
});

// ------------------------------------------------------------- the workbook itself

/** A minimal .xlsx: a zip of the XML parts the reader looks at. */
function workbook(parts: Record<string, string>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const data = deflateRawSync(Buffer.from(text));
    const nameBytes = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(text.length, 22);
    head.writeUInt16LE(nameBytes.length, 26);
    local.push(head, nameBytes, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(text.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBytes, end]);
}

test("an .xlsx is read into rows: shared strings, inline strings, numbers, gaps kept", async () => {
  const bytes = workbook({
    "xl/workbook.xml": `<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>Invoice</t></si><si><r><t>Tom &amp; </t></r><r><t xml:space="preserve">Jerry</t></r></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
      <row r="1"><c r="B1" t="s"><v>0</v></c><c r="D1"><v>3508.1</v></c></row>
      <row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="inlineStr"><is><t>&lt;ok&gt;</t></is></c></row>
    </sheetData></worksheet>`,
  });
  const rows = await readFirstSheet(bytes);
  assert.deepEqual(rows[0], [null, "Invoice", null, 3508.1]);
  assert.deepEqual(rows[1], []);
  assert.deepEqual(rows[2], ["Tom & Jerry", "<ok>"]);
});

test("an old .xls or a file that is not a workbook is refused with what to do", async () => {
  await assert.rejects(readFirstSheet(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), /save it as \.xlsx/);
  await assert.rejects(readFirstSheet(new TextEncoder().encode("hello, not a zip")), /could not be read/);
});
