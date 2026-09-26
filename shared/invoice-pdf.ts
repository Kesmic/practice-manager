/**
 * The invoice as a PDF: what is downloaded, and what travels with every invoice email.
 *
 * The same document shared/invoice-document.ts describes - the firm's own layout, kept
 * deliberately (see there) - set on A4:
 *
 *   letterhead, with INVOICE set large on the right
 *   BILL TO on the left, the reference block (invoice, date, terms, due date) on the right
 *   the lines: DATE, ACTIVITY, DESCRIPTION, QTY, RATE, AMOUNT, with the discount and
 *     the withholding as negative lines in the body, where the firm's invoices put them
 *   "Thanks for your business!" and the totals, ending in BALANCE DUE
 *   the bank details, and any note
 *
 * A long invoice runs onto further pages, the table's headings repeated at the top of
 * each and "Page 2 of 3" at the foot, and the totals never split from each other.
 */

import { PdfDocument, imageFromDataUri, textWidth, wrapText, type PdfPage } from "./pdf";
import { figure, money, slashDate, type InvoiceDocument } from "./invoice-document";

const INK = "#1b2431";
const BODY = "#46505f";
const MUTED = "#6b7686";
const LABEL = "#8b95a3";
const TITLE = "#5b6673";
const RULE = "#e4e8ee";
const BAND = "#f2f2f2";
const DEDUCTION = "#8a1c13";

const LEFT = 48;
const RIGHT = 595.28 - 48;
const TOP = 48;
/** Where the body stops, leaving room for the page number. */
const BOTTOM = 841.89 - 56;

/** The table's columns: where each starts, how wide, and which way it aligns. */
const COLUMNS = (() => {
  const widths = { date: 56, activity: 100, qty: 30, rate: 62, amount: 66 };
  const description = RIGHT - LEFT - (widths.date + widths.activity + widths.qty + widths.rate + widths.amount);
  let x = LEFT;
  const col = (w: number) => {
    const c = { x, w };
    x += w;
    return c;
  };
  return {
    date: col(widths.date),
    activity: col(widths.activity),
    description: col(description),
    qty: col(widths.qty),
    rate: col(widths.rate),
    amount: col(widths.amount),
  };
})();
const PAD = 6;

/** A small spaced capital label, as the firm's invoices set them. */
function label(page: PdfPage, text: string, x: number, y: number, align: "left" | "right" = "left", colour = LABEL) {
  page.text(text.toUpperCase(), x, y, { font: "bold", size: 6.8, colour, spacing: 0.9, align });
}

export async function renderInvoicePdf(
  doc: InvoiceDocument,
  now = new Date(),
): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = new PdfDocument({
    title: `Invoice ${doc.number} - ${doc.client.name}`,
    author: doc.firm.name,
    subject: `Invoice ${doc.number}`,
  });
  const logo = doc.firm.logo ? await imageFromDataUri(doc.firm.logo) : null;
  const logoIndex = logo ? pdf.addImage(logo) : null;

  let page = pdf.addPage();
  let y = TOP;

  // ------------------------------------------------------------ letterhead
  let left = TOP;
  if (logo && logoIndex !== null) {
    const scale = Math.min(180 / logo.width, 52 / logo.height);
    const w = logo.width * scale;
    const h = logo.height * scale;
    page.image(logoIndex, LEFT, TOP, w, h);
    left = TOP + h + 14;
  } else {
    page.text(doc.firm.name, LEFT, TOP + 12, { font: "bold", size: 13, colour: INK });
    left = TOP + 28;
  }
  const address = [
    ...doc.firm.address_lines,
    doc.firm.city,
    doc.firm.phone,
    doc.firm.email,
    doc.firm.website,
    doc.firm.tax_id ? `TIN ${doc.firm.tax_id}` : "",
  ].filter(Boolean);
  for (const line of address) {
    page.text(line, LEFT, left, { size: 8.5, colour: MUTED });
    left += 11.5;
  }
  page.text("INVOICE", RIGHT, TOP + 22, { size: 24, colour: TITLE, spacing: 2.6, align: "right" });
  y = Math.max(left, TOP + 40) + 18;

  // ------------------------------------------------- bill to and references
  let bill = y;
  label(page, "Bill to", LEFT, bill);
  bill += 15;
  for (const line of wrapText(doc.client.name, "bold", 10.5, 260)) {
    page.text(line, LEFT, bill, { font: "bold", size: 10.5, colour: INK });
    bill += 13;
  }
  for (const line of doc.client.address_lines.flatMap((l) => wrapText(l, "regular", 9, 260))) {
    page.text(line, LEFT, bill, { size: 9, colour: BODY });
    bill += 12;
  }
  if (doc.client.tax_id) {
    bill += 2;
    page.text(`TIN ${doc.client.tax_id}`, LEFT, bill, { size: 8.5, colour: MUTED });
    bill += 12;
  }

  let refs = y;
  const refsLeft = RIGHT - 200;
  for (const [k, v] of [
    ["Invoice", doc.number],
    ["Date", slashDate(doc.issued_on)],
    ["Terms", doc.terms],
    ["Due date", slashDate(doc.due_on)],
  ]) {
    label(page, k, refsLeft, refs);
    page.text(v, RIGHT, refs, { font: "bold", size: 9.5, colour: INK, align: "right" });
    refs += 15;
  }
  y = Math.max(bill, refs) + 14;

  // --------------------------------------------------------------- the lines
  const tableHeader = () => {
    page.box(LEFT, y, RIGHT - LEFT, 20, BAND);
    const base = y + 13;
    label(page, "Date", COLUMNS.date.x + PAD, base, "left", TITLE);
    label(page, "Activity", COLUMNS.activity.x + PAD, base, "left", TITLE);
    label(page, "Description", COLUMNS.description.x + PAD, base, "left", TITLE);
    label(page, "Qty", COLUMNS.qty.x + COLUMNS.qty.w - PAD, base, "right", TITLE);
    label(page, "Rate", COLUMNS.rate.x + COLUMNS.rate.w - PAD, base, "right", TITLE);
    label(page, "Amount", COLUMNS.amount.x + COLUMNS.amount.w - PAD, base, "right", TITLE);
    y += 20;
  };
  const newPage = () => {
    page = pdf.addPage();
    y = TOP;
  };

  type Row = {
    date: string;
    activity: string;
    description: string;
    qty: string;
    rate: string;
    amount: string;
    colour?: string;
  };
  const rows: Row[] = doc.lines.map((line) => ({
    date: slashDate(line.date),
    activity: line.activity,
    description: line.description,
    qty: String(line.quantity),
    rate: figure(line.unit_amount),
    amount: figure(line.amount),
  }));
  if (doc.discount) {
    rows.push({
      date: "",
      activity: "Discount",
      description: doc.discount.label,
      qty: "1",
      rate: `-${figure(doc.discount.amount)}`,
      amount: `-${figure(doc.discount.amount)}`,
      colour: DEDUCTION,
    });
  }
  if (doc.withholding) {
    rows.push({
      date: "",
      activity: doc.withholding.label,
      description: `${doc.withholding.label} at ${doc.withholding.rate}%`,
      qty: "1",
      rate: `-${figure(doc.withholding.amount)}`,
      amount: `-${figure(doc.withholding.amount)}`,
      colour: DEDUCTION,
    });
  }

  const size = 9;
  const leading = 12;
  tableHeader();
  for (const row of rows) {
    const activity = wrapText(row.activity, "regular", size, COLUMNS.activity.w - PAD * 2);
    const description = wrapText(row.description, "regular", size, COLUMNS.description.w - PAD * 2);
    const height = Math.max(activity.length, description.length, 1) * leading + 12;
    if (y + height > BOTTOM) {
      newPage();
      tableHeader();
    }
    const colour = row.colour ?? INK;
    const base = y + 6 + 9;
    page.text(row.date, COLUMNS.date.x + PAD, base, { size, colour });
    activity.forEach((l, i) => page.text(l, COLUMNS.activity.x + PAD, base + i * leading, { size, colour }));
    description.forEach((l, i) => page.text(l, COLUMNS.description.x + PAD, base + i * leading, { size, colour }));
    for (const [key, text] of [["qty", row.qty], ["rate", row.rate], ["amount", row.amount]] as const) {
      const c = COLUMNS[key];
      page.text(text, c.x + c.w - PAD, base, { size, colour, align: "right" });
    }
    y += height;
    page.line(LEFT, y, RIGHT, y, { width: 0.6, colour: RULE });
  }

  // ------------------------------------------------------------------ totals
  type Total = { k: string; v: string } | "rule";
  const totals: Total[] = [{ k: "Subtotal", v: figure(doc.net + (doc.discount?.amount ?? 0)) }];
  if (doc.discount) {
    totals.push({ k: doc.discount.label, v: `-${figure(doc.discount.amount)}` });
    totals.push({ k: "Before tax", v: figure(doc.net) });
  }
  for (const tax of doc.taxes) totals.push({ k: `${tax.name} ${tax.rate}%`, v: figure(tax.amount) });
  if (doc.withholding) {
    totals.push("rule", { k: "Total", v: figure(doc.gross) });
    totals.push({ k: doc.withholding.label, v: `-${figure(doc.withholding.amount)}` });
  }
  if (doc.paid > 0) totals.push("rule", { k: "Paid", v: `-${figure(doc.paid)}` });

  const totalsHeight = totals.reduce((h, t) => h + (t === "rule" ? 7 : 14), 0) + 48;
  y += 18;
  if (y + totalsHeight > BOTTOM) newPage();

  const totalsLeft = RIGHT - 230;
  let t = y + 9;
  for (const row of totals) {
    if (row === "rule") {
      page.line(totalsLeft, t - 6, RIGHT, t - 6, { width: 0.6, colour: "#d7dce4" });
      t += 7;
      continue;
    }
    page.text(row.k, totalsLeft, t, { size: 9, colour: MUTED });
    page.text(row.v, RIGHT, t, { size: 9, colour: INK, align: "right" });
    t += 14;
  }
  t += 2;
  page.line(totalsLeft, t, RIGHT, t, { width: 1.5, colour: INK });
  const balance = money(Math.max(doc.balance_due - doc.paid, 0), doc.currency);
  page.text(balance, RIGHT, t + 26, { font: "bold", size: 18, colour: INK, align: "right" });
  label(page, "Balance due", RIGHT - textWidth(balance, "bold", 18) - 14, t + 25, "right", TITLE);
  page.text("Thanks for your business!", LEFT, t + 25, { size: 10, colour: BODY });
  y = t + 44;

  // -------------------------------------------------------------------- bank
  const bank = [
    ["Account Name", doc.bank.account_name],
    ["Account Number", doc.bank.account_number],
    ["Bank", doc.bank.bank],
    ["Branch", doc.bank.branch],
    ["Swift Code", doc.bank.swift],
  ].filter(([, v]) => v);
  if (bank.length) {
    const height = 40 + bank.length * 13;
    if (y + height > BOTTOM) newPage();
    else y += 8;
    page.line(LEFT, y, RIGHT, y, { width: 0.6, colour: RULE });
    y += 20;
    page.text("Kindly remit payment into our bank account with the details below:", LEFT, y, { size: 9, colour: BODY });
    y += 16;
    for (const [k, v] of bank) {
      page.text(k, LEFT, y, { size: 8.5, colour: LABEL });
      page.text(v, LEFT + 100, y, { size: 8.5, colour: INK });
      y += 13;
    }
  }

  // -------------------------------------------------------------------- note
  if (doc.note) {
    const lines = wrapText(doc.note, "regular", 8.5, RIGHT - LEFT);
    y += 10;
    for (const line of lines) {
      if (y + 12 > BOTTOM) newPage();
      page.text(line, LEFT, y, { size: 8.5, colour: MUTED });
      y += 12;
    }
  }

  // ------------------------------------------------------------ page numbers
  if (pdf.pages.length > 1) {
    pdf.pages.forEach((p, i) =>
      p.text(`${doc.number} · Page ${i + 1} of ${pdf.pages.length}`, RIGHT, 841.89 - 28, {
        size: 7.5,
        colour: LABEL,
        align: "right",
      }),
    );
  }

  return pdf.save(now);
}
