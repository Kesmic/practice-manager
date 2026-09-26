/**
 * A customer statement as a PDF, in the invoice's letterhead so the two read as one
 * firm's documents.
 *
 *   letterhead, with STATEMENT set large
 *   TO: the client, and the reference block: statement date, period, amount due
 *   the table, its columns depending on the kind (shared/statements.ts):
 *     balance forward - DATE, ACTIVITY, REFERENCE, AMOUNT, RECEIVED, BALANCE
 *     transaction     - DATE, ACTIVITY, DUE DATE, AMOUNT, RECEIVED
 *     open item       - DATE, INVOICE, DUE DATE, DAYS LATE, AMOUNT, OPEN
 *   the ageing, as QuickBooks prints it, ending in AMOUNT DUE
 *   the bank details
 *
 * Long statements run over pages with the headings repeated and pages numbered.
 */

import { PdfDocument, imageFromDataUri, type PdfPage } from "./pdf";
import { figure, money, slashDate, type InvoiceDocument } from "./invoice-document";
import { BAND, BODY, BOTTOM, INK, LABEL, LEFT, MUTED, RIGHT, RULE, TITLE, TOP, billTo, label, letterhead } from "./invoice-pdf";
import { AGEING_LABELS, STATEMENT_TYPE_LABELS, type Statement, type StatementRow } from "./statements";

export interface StatementDocument {
  firm: InvoiceDocument["firm"];
  client: InvoiceDocument["client"];
  bank: InvoiceDocument["bank"];
  currency: string;
  statement: Statement;
}

type Column = { key: string; title: string; w: number; right?: boolean; cell: (r: StatementRow) => string };

function columnsFor(statement: Statement): Column[] {
  const amount = (n: number | null) => (n === null ? "" : figure(n));
  const date: Column = { key: "date", title: "Date", w: 62, cell: (r) => slashDate(r.date) };
  if (statement.type === "open_item") {
    return [
      date,
      { key: "invoice", title: "Invoice", w: 0, cell: (r) => r.reference },
      { key: "due", title: "Due date", w: 70, cell: (r) => slashDate(r.due_on) },
      { key: "late", title: "Days late", w: 56, right: true, cell: (r) => (r.days_overdue ? String(r.days_overdue) : "-") },
      { key: "amount", title: "Amount", w: 78, right: true, cell: (r) => amount(r.amount) },
      { key: "open", title: "Open", w: 78, right: true, cell: (r) => amount(r.balance) },
    ];
  }
  if (statement.type === "transaction") {
    return [
      date,
      { key: "activity", title: "Activity", w: 0, cell: (r) => r.activity },
      { key: "due", title: "Due date", w: 70, cell: (r) => slashDate(r.due_on) },
      { key: "amount", title: "Amount", w: 80, right: true, cell: (r) => amount(r.amount) },
      { key: "received", title: "Received", w: 80, right: true, cell: (r) => amount(r.received) },
    ];
  }
  return [
    date,
    { key: "activity", title: "Activity", w: 0, cell: (r) => r.activity },
    { key: "ref", title: "Reference", w: 78, cell: (r) => (r.kind === "payment" ? r.reference : "") },
    { key: "amount", title: "Amount", w: 72, right: true, cell: (r) => amount(r.amount) },
    { key: "received", title: "Received", w: 72, right: true, cell: (r) => amount(r.received) },
    { key: "balance", title: "Balance", w: 76, right: true, cell: (r) => amount(r.balance) },
  ];
}

export async function renderStatementPdf(doc: StatementDocument, now = new Date()): Promise<Uint8Array<ArrayBuffer>> {
  const s = doc.statement;
  const pdf = new PdfDocument({
    title: `Statement - ${doc.client.name} - ${slashDate(s.statement_date)}`,
    author: doc.firm.name,
    subject: `${STATEMENT_TYPE_LABELS[s.type]} statement`,
  });
  const logo = doc.firm.logo ? await imageFromDataUri(doc.firm.logo) : null;
  const logoIndex = logo ? pdf.addImage(logo) : null;
  let page: PdfPage = pdf.addPage();

  let y = await letterhead(page, doc.firm, logo, logoIndex, "STATEMENT");
  const to = billTo(page, doc.client, y, "To");
  let refs = y;
  const refsLeft = RIGHT - 200;
  const facts: Array<[string, string]> = [
    ["Statement date", slashDate(s.statement_date)],
    ...(s.start && s.end ? ([["Period", `${slashDate(s.start)} - ${slashDate(s.end)}`]] as Array<[string, string]>) : []),
    ["Kind", STATEMENT_TYPE_LABELS[s.type]],
    ["Amount due", money(s.amount_due, doc.currency)],
  ];
  for (const [k, v] of facts) {
    label(page, k, refsLeft, refs);
    page.text(v, RIGHT, refs, { font: "bold", size: 9.5, colour: INK, align: "right" });
    refs += 15;
  }
  y = Math.max(to, refs) + 14;

  // ------------------------------------------------------------------ table
  const columns = columnsFor(s);
  const fixed = columns.reduce((n, c) => n + c.w, 0);
  let x = LEFT;
  const placed = columns.map((c) => {
    const w = c.w || RIGHT - LEFT - fixed;
    const out = { ...c, x, w };
    x += w;
    return out;
  });
  const PAD = 6;
  const header = () => {
    page.box(LEFT, y, RIGHT - LEFT, 20, BAND);
    for (const c of placed) {
      label(page, c.title, c.right ? c.x + c.w - PAD : c.x + PAD, y + 13, c.right ? "right" : "left", TITLE);
    }
    y += 20;
  };
  header();
  if (!s.rows.length) {
    y += 20;
    page.text(
      s.type === "open_item" ? "Nothing is outstanding. Thank you." : "Nothing was invoiced or paid in this period.",
      LEFT + PAD,
      y,
      { size: 9, colour: MUTED },
    );
    y += 12;
  }
  for (const row of s.rows) {
    if (y + 24 > BOTTOM) {
      page = pdf.addPage();
      y = TOP;
      header();
    }
    const base = y + 15;
    const colour = row.kind === "payment" ? "#1d6b45" : row.kind === "opening" ? BODY : INK;
    for (const c of placed) {
      const text = c.cell(row);
      const font = row.kind === "opening" && c.key === "balance" ? "bold" : "regular";
      page.text(text, c.right ? c.x + c.w - PAD : c.x + PAD, base, { size: 9, colour, font, align: c.right ? "right" : "left" });
    }
    y += 24;
    page.line(LEFT, y, RIGHT, y, { width: 0.6, colour: RULE });
  }

  // ------------------------------------------------------- ageing and amount due
  const blockHeight = s.ageing ? 82 : 52;
  y += 18;
  if (y + blockHeight > BOTTOM) {
    page = pdf.addPage();
    y = TOP;
  }
  if (s.ageing) {
    const cells = [...AGEING_LABELS.map(([k, l]) => [l, figure(s.ageing![k])] as [string, string]), ["Amount due", money(s.amount_due, doc.currency)] as [string, string]];
    const w = (RIGHT - LEFT) / cells.length;
    page.box(LEFT, y, RIGHT - LEFT, 44, "#f7f8fa");
    cells.forEach(([k, v], i) => {
      const cx = LEFT + w * i + w / 2;
      page.text(k, cx, y + 15, { size: 7, colour: LABEL, align: "centre" });
      const last = i === cells.length - 1;
      page.text(v, cx, y + 32, { size: last ? 10.5 : 9.5, font: last ? "bold" : "regular", colour: INK, align: "centre" });
    });
    y += 64;
  } else {
    page.line(RIGHT - 230, y, RIGHT, y, { width: 1.5, colour: INK });
    page.text(money(s.amount_due, doc.currency), RIGHT, y + 24, { font: "bold", size: 16, colour: INK, align: "right" });
    label(page, "Amount due", RIGHT - 170, y + 23, "right", TITLE);
    y += 44;
  }

  // -------------------------------------------------------------------- bank
  const bank = [
    ["Account Name", doc.bank.account_name],
    ["Account Number", doc.bank.account_number],
    ["Bank", doc.bank.bank],
    ["Branch", doc.bank.branch],
    ["Swift Code", doc.bank.swift],
  ].filter(([, v]) => v);
  if (bank.length && s.amount_due > 0) {
    if (y + 40 + bank.length * 13 > BOTTOM) {
      page = pdf.addPage();
      y = TOP;
    }
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

  if (pdf.pages.length > 1) {
    pdf.pages.forEach((p, i) =>
      p.text(`Statement ${slashDate(s.statement_date)} · Page ${i + 1} of ${pdf.pages.length}`, RIGHT, 841.89 - 28, {
        size: 7.5,
        colour: LABEL,
        align: "right",
      }),
    );
  }
  return pdf.save(now);
}

/** "statement-convyplus-ltd-2026-09-26.pdf" */
export function statementFilename(clientName: string, statementDate: string): string {
  const slug = clientName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  return `statement-${slug || "client"}-${statementDate}.pdf`;
}
