/**
 * What may be attached to an invoice. The browser and the Worker both ask these
 * questions, so the answers are pinned once, here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INVOICE_FILE_BYTES,
  invoiceFileKey,
  invoiceFileType,
  whyNotInvoiceFile,
} from "../shared/invoice-files";

test("the papers people send with a bill are accepted, by type or by extension", () => {
  assert.equal(invoiceFileType("application/pdf", "receipt.pdf"), "application/pdf");
  assert.equal(invoiceFileType("image/jpeg; charset=binary", "x.jpg"), "image/jpeg");
  // Some browsers call a spreadsheet octet-stream; the extension settles it.
  assert.equal(
    invoiceFileType("application/octet-stream", "Timesheet.XLSX"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(invoiceFileType("", "notes.csv"), "text/csv");
});

test("anything that could run in a browser, or is empty or too large, is refused in words", () => {
  for (const [type, name] of [
    ["text/html", "page.html"],
    ["image/svg+xml", "logo.svg"],
    ["application/javascript", "x.js"],
    ["application/octet-stream", "setup.exe"],
  ]) {
    assert.equal(invoiceFileType(type, name), null, name);
    assert.match(whyNotInvoiceFile({ type, name, size: 10 })!, /not a kind of file/);
  }
  assert.match(whyNotInvoiceFile({ type: "application/pdf", name: "a.pdf", size: 0 })!, /empty/);
  assert.match(
    whyNotInvoiceFile({ type: "application/pdf", name: "a.pdf", size: MAX_INVOICE_FILE_BYTES + 1 })!,
    /limit is 10\.0 MB/,
  );
  assert.equal(whyNotInvoiceFile({ type: "application/pdf", name: "a.pdf", size: 1000 }), null);
});

test("a file lives under its invoice, so deleting the invoice can find it", () => {
  assert.equal(invoiceFileKey("inv-1", "file-2"), "invoices/inv-1/file-2");
});
