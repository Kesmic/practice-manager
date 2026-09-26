/**
 * The invoice PDF: that it is a well-formed file a reader will open, that it says what
 * the invoice says, and that nothing in an invoice can turn into PDF instructions.
 *
 * The page streams are compressed, so the tests inflate them and look for the text as
 * the writer encodes it - hex, in WinAnsi. The structure is checked the way a reader
 * finds its way round a file: from startxref to the table, and from each entry in the
 * table to the object it claims is there.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { renderInvoicePdf } from "../shared/invoice-pdf";
import { invoiceFilename, type InvoiceDocument } from "../shared/invoice-document";
import { imageFromDataUri, readPng, textWidth, toWinAnsi, wrapText } from "../shared/pdf";

const DOC: InvoiceDocument = {
  firm: {
    name: "Kesmic Consultancy Hub",
    address_lines: ["No. 12 Ring Road East"],
    city: "Accra",
    phone: "+233 30 123 4567",
    email: "finance@kesmic.org",
    website: "www.kesmic.org",
    logo: "",
    tax_id: "C0012345678",
  },
  client: { name: "Acme Trading Ltd", address_lines: ["P.O. Box 123", "Kumasi"], tax_id: "C0098765432" },
  number: "ACME202610",
  issued_on: "2026-10-01",
  due_on: "2026-10-16",
  terms: "Net 15",
  currency: "GHS",
  lines: [
    {
      date: "2026-10-01",
      activity: "Growth package",
      description: "Bookkeeping and payroll - October 2026",
      quantity: 1,
      unit_amount: 3500,
      amount: 3500,
    },
  ],
  taxes: [{ name: "VAT", rate: 15, amount: 525 }],
  discount: null,
  net: 3500,
  tax_total: 525,
  gross: 4025,
  withholding: { label: "Withholding tax", rate: 7.5, amount: 262.5 },
  balance_due: 3762.5,
  paid: 0,
  note: null,
  bank: { account_name: "Kesmic Consultancy Hub", account_number: "1234567890", bank: "GCB Bank", branch: "Osu", swift: "" },
};

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const hexOf = (text: string) => Buffer.from(toWinAnsi(text)).toString("hex");

/** Every compressed stream in the file, inflated, joined. */
function pageText(pdf: Uint8Array): string {
  const raw = latin1(pdf);
  let out = "";
  const re = /stream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("\nendstream", start);
    try {
      out += inflateSync(Buffer.from(pdf.subarray(start, end))).toString("latin1") + "\n";
    } catch {
      // Not every stream is text (a picture's pixels inflate too, harmlessly).
    }
  }
  return out;
}

/** A small PNG, drawn by hand: `transparent` punches a clear corner into it. */
function png(width: number, height: number, transparent: boolean): Uint8Array {
  const raw: number[] = [];
  for (let y = 0; y < height; y++) {
    raw.push(y % 5); // every filter type, in turn
    for (let x = 0; x < width; x++) raw.push(200, 30, (x * 7) & 255, transparent && x < 3 && y < 3 ? 0 : 255);
  }
  // Filters are applied by the encoder; to test unfiltering with real data, filter here.
  const stride = width * 4;
  const filtered: number[] = [];
  let prev = new Array(stride).fill(0);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    filtered.push(type);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const predictor = [0, a, b, (a + b) >> 1, paeth][type];
      filtered.push((line[x] - predictor) & 255);
    }
    prev = line;
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(Buffer.from(type, "latin1"), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(filtered))),
    chunk("IEND", new Uint8Array()),
  ]);
}

test("the invoice is a well-formed PDF whose cross-reference table points at its objects", async () => {
  const pdf = await renderInvoicePdf(DOC, new Date("2026-10-01T09:00:00Z"));
  const raw = latin1(pdf);
  assert.ok(raw.startsWith("%PDF-1.4\n"));
  assert.ok(raw.endsWith("%%EOF\n"));
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(raw)![1]);
  assert.equal(raw.slice(startxref, startxref + 4), "xref");
  const entries = [...raw.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.ok(entries.length >= 6);
  entries.forEach((offset, i) => assert.equal(raw.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.match(raw, /\/Size (\d+) \/Root 1 0 R/);
});

test("it says what the invoice says", async () => {
  const text = pageText(await renderInvoicePdf(DOC));
  for (const s of ["INVOICE", "Acme Trading Ltd", "ACME202610", "16/10/2026", "Net 15", "3,500.00", "VAT 15%", "-262.50", "GHS 3,762.50", "Withholding tax at 7.5%", "GCB Bank", "Thanks for your business!"]) {
    assert.ok(text.includes(`<${hexOf(s)}>`), `missing ${s}`);
  }
});

test("nothing in an invoice can close a string and become an instruction", async () => {
  const name = "Evil) Tj /F2 99 Tf (x \\ Ltd";
  const pdf = await renderInvoicePdf({ ...DOC, client: { ...DOC.client, name } });
  const text = pageText(pdf);
  assert.ok(!text.includes("Evil)"));
  assert.ok(text.includes(hexOf(name)));
  assert.ok(!text.includes("99 Tf"));
});

test("letters outside the font are spelt as near as they can be", () => {
  const spell = (s: string) => Buffer.from(toWinAnsi(s)).toString("latin1");
  assert.equal(spell("Asɔrɔ Ɛnam"), "Asoro Enam");
  assert.equal(spell("Café"), "Café");
  assert.equal(toWinAnsi("€")[0], 0x80);
  assert.equal(toWinAnsi("–")[0], 0x96);
  assert.equal(spell("₵100"), "C100");
  assert.equal(spell("Łódź"), "L\u00f3dz"); // ó is in the font; Ł and ź are not
  assert.equal(spell("漢"), "?");
  assert.equal(spell("two\nlines"), "two lines");
});

test("text wraps within its column, and a word too long for a line is broken", () => {
  const lines = wrapText("Bookkeeping, payroll and monthly PAYE filings for October", "regular", 9, 120);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(textWidth(line, "regular", 9) <= 120, line);
  const long = wrapText("A".repeat(80), "bold", 10, 100);
  assert.ok(long.length > 1);
  for (const line of long) assert.ok(textWidth(line, "bold", 10) <= 100);
  assert.deepEqual(wrapText("", "regular", 9, 100), [""]);
});

test("a long invoice runs over pages, numbered, and still ends with the balance", async () => {
  const lines = Array.from({ length: 40 }, (_, i) => ({ ...DOC.lines[0], description: `Line ${i + 1}` }));
  const pdf = await renderInvoicePdf({ ...DOC, lines });
  const raw = latin1(pdf);
  const count = Number(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/.exec(raw)![1]);
  assert.ok(count >= 2);
  const text = pageText(pdf);
  assert.ok(text.includes(hexOf(`ACME202610 · Page 1 of ${count}`)));
  assert.ok(text.includes(hexOf("Line 40")));
  assert.ok(text.includes(hexOf("GHS 3,762.50")));
});

test("a PNG logo is decoded through every filter, its transparency kept as a mask", async () => {
  const image = await readPng(png(9, 10, true));
  assert.ok(image && image.kind === "pixels");
  assert.equal(image.width, 9);
  assert.equal(image.alpha![0], 0);
  assert.equal(image.alpha![9 * 10 - 1], 255);
  // Every pixel decodes to the colour it was drawn in, whichever filter its row used.
  for (let i = 0; i < 90; i++) {
    assert.equal(image.rgb[i * 3], 200);
    assert.equal(image.rgb[i * 3 + 2], ((i % 9) * 7) & 255);
  }
  const opaque = await readPng(png(4, 4, false));
  assert.equal(opaque && opaque.kind === "pixels" ? opaque.alpha : "x", null);

  const uri = `data:image/png;base64,${Buffer.from(png(20, 8, true)).toString("base64")}`;
  const pdf = latin1(await renderInvoicePdf({ ...DOC, firm: { ...DOC.firm, logo: uri } }));
  assert.match(pdf, /\/Subtype \/Image \/Width 20 \/Height 8 \/ColorSpace \/DeviceRGB/);
  assert.match(pdf, /\/SMask \d+ 0 R/);
});

test("a logo a PDF cannot show without a renderer gives way to the firm's name", async () => {
  assert.equal(await imageFromDataUri("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), null);
  assert.equal(await imageFromDataUri("data:image/png;base64,bm90IGEgcG5n"), null);
  const pdf = await renderInvoicePdf({ ...DOC, firm: { ...DOC.firm, logo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" } });
  assert.ok(pageText(pdf).includes(hexOf("Kesmic Consultancy Hub")));
  assert.doesNotMatch(latin1(pdf), /\/Subtype \/Image/);
});

test("the file is named for the invoice and the client, as a PDF", () => {
  assert.equal(invoiceFilename(DOC), "acme202610-acme-trading-ltd.pdf");
});

// ---------------------------------------------------------------- SVG logos

import { isRasterLogo, logoFingerprint, pdfLogo } from "../shared/logo-print";

test("an SVG logo reaches a PDF through the copy drawn from it, and only that logo's copy", async () => {
  const svg = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
  const copy = `data:image/png;base64,${Buffer.from(png(4, 4, false)).toString("base64")}`;
  const drawnFrom = await logoFingerprint(svg);
  assert.match(drawnFrom, /^[0-9a-f]{32}$/);

  assert.equal(await pdfLogo({ logo_data_url: svg, logo_print_data_url: copy, logo_print_for: drawnFrom }), copy);
  // The logo changed since the copy was drawn: the firm's name, never the old picture.
  assert.equal(await pdfLogo({ logo_data_url: `${svg}x`, logo_print_data_url: copy, logo_print_for: drawnFrom }), "");
  assert.equal(await pdfLogo({ logo_data_url: svg, logo_print_data_url: "", logo_print_for: "" }), "");
  // A PNG or JPEG goes in as it is, whatever copy is lying about.
  assert.equal(await pdfLogo({ logo_data_url: copy, logo_print_data_url: "", logo_print_for: "" }), copy);
  assert.equal(await pdfLogo({}), "");
  assert.ok(isRasterLogo("data:image/jpeg;base64,/9j/"));
  assert.ok(!isRasterLogo(svg));
});
