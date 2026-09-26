/**
 * Reading a client's invoice history out of QuickBooks, to bring it into the portal.
 *
 * Two of QuickBooks' standard reports carry everything needed, exported to Excel:
 *
 *  - **Sales by Customer Detail** (or "by Customer Type Detail"), run for the one
 *    customer: every invoice line - date, number, item, description, quantity, price,
 *    amount. Withholding tax appears as a line of its own. QuickBooks prints it as a
 *    positive amount (a quantity of -1 at a price of -263.10), and the report's own
 *    total adds it on; on the invoice itself it is a deduction, and that is how it is
 *    read here. The report leaves tax out, and so does this: an invoice brought in says
 *    exactly what the client's copy says.
 *  - **Deposit Detail**: the payments banked, by customer. It does not say which invoice
 *    a payment settled, so each is matched to the oldest invoice still open for exactly
 *    that amount and issued on or before the day it came in - which is how a client
 *    pays a monthly bill. A payment that matches nothing is shown and left out, never
 *    guessed onto an invoice.
 *
 * Pure, so the tests can pin it with rows as the spreadsheet reader returns them; the
 * screen shows the result for a Partner to check before anything is saved, and the
 * Worker checks it again when it is.
 */

export type Cell = string | number | null;

export interface ImportedLine {
  /** The QuickBooks item, printed beside the line: "Consultancy services". */
  activity: string;
  description: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  /** A fee (1), or passed on at cost - a reimbursable, a prepayment brought forward (0). */
  taxable: 0 | 1;
}

export interface ImportedInvoice {
  number: string;
  issued_on: string;
  lines: ImportedLine[];
  /** Withholding tax shown on the invoice as a deduction. */
  withheld: number;
}

export interface ImportedPayment {
  paid_on: string;
  amount: number;
  customer: string;
  /** Where it was banked, from the report's account heading: "Fidelity GHS". */
  account: string;
}

export interface SalesReading {
  invoices: ImportedInvoice[];
  /** Rows that were not invoice lines - a credit note, a sales receipt - and were left out. */
  skipped: string[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A report date - "31/01/2026" as exported, or an Excel day number - as 2026-01-31. */
export function reportDate(value: Cell): string | null {
  if (typeof value === "number" && value > 20000 && value < 80000) {
    // Excel counts days from 30 December 1899.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function num(value: Cell): number {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

const text = (value: Cell) => String(value ?? "").trim();

/** Where the header row is, and which column holds each thing it names. */
function columns(rows: Cell[][], wanted: Record<string, RegExp>): { at: number; col: Record<string, number> } | null {
  for (let at = 0; at < Math.min(rows.length, 30); at++) {
    const headers = rows[at].map((c) => text(c).toLowerCase());
    const col: Record<string, number> = {};
    for (const [key, pattern] of Object.entries(wanted)) {
      const i = headers.findIndex((h) => pattern.test(h));
      if (i >= 0) col[key] = i;
    }
    if (Object.keys(col).length === Object.keys(wanted).length) return { at, col };
  }
  return null;
}

/** Items passed on at cost rather than charged as the firm's fee. */
const AT_COST = /reimburs|disburse|prepay|overpay|at cost|filing fee/i;
const WITHHOLDING = /withholding/i;

/**
 * The invoices in a Sales by Customer Detail report, in date order. Throws, in words a
 * Partner can act on, when the file is not that report.
 */
export function readSalesDetail(rows: Cell[][]): SalesReading {
  const found = columns(rows, {
    date: /^(transaction )?date$/,
    type: /^(transaction )?type$/,
    number: /^(num|no\.?|number)$/,
    item: /product\/service/,
    description: /^(memo\/)?description$/,
    quantity: /^(qty|quantity)$/,
    price: /^(sales price|rate)$/,
    amount: /^amount$/,
  });
  if (!found) {
    throw new Error(
      "That does not look like a Sales by Customer Detail report. Run it in QuickBooks for the one customer, and export it to Excel as it is.",
    );
  }
  const { at, col } = found;
  const byNumber = new Map<string, ImportedInvoice>();
  const skipped: string[] = [];

  for (const row of rows.slice(at + 1)) {
    const type = text(row[col.type]);
    if (!type) continue; // headings, section totals, the footer
    const number = text(row[col.number]);
    const date = reportDate(row[col.date]);
    if (type.toLowerCase() !== "invoice") {
      skipped.push(`${type} ${number}`.trim() + (date ? ` of ${date}` : ""));
      continue;
    }
    if (!number || !date) {
      skipped.push(`An invoice line with no ${number ? "date" : "number"}`);
      continue;
    }
    let invoice = byNumber.get(number);
    if (!invoice) {
      invoice = { number, issued_on: date, lines: [], withheld: 0 };
      byNumber.set(number, invoice);
    }
    const item = text(row[col.item]);
    const amount = round2(num(row[col.amount]));
    if (WITHHOLDING.test(item)) {
      invoice.withheld = round2(invoice.withheld + Math.abs(amount));
      continue;
    }
    invoice.lines.push({
      activity: item,
      description: text(row[col.description]) || item,
      quantity: num(row[col.quantity]) || 1,
      unit_amount: round2(num(row[col.price])),
      amount,
      taxable: AT_COST.test(item) ? 0 : 1,
    });
  }

  const invoices = [...byNumber.values()].sort(
    (a, b) => a.issued_on.localeCompare(b.issued_on) || a.number.localeCompare(b.number),
  );
  return { invoices, skipped };
}

/** The payments in a Deposit Detail report, with the customer and account each came from. */
export function readDeposits(rows: Cell[][]): ImportedPayment[] {
  const found = columns(rows, {
    date: /^(transaction )?date$/,
    type: /^(transaction )?type$/,
    customer: /^customer( full name)?$/,
    amount: /^amount$/,
  });
  if (!found) {
    throw new Error(
      "That does not look like a Deposit Detail report. Run it in QuickBooks and export it to Excel as it is.",
    );
  }
  const { at, col } = found;
  const payments: ImportedPayment[] = [];
  let account = "";
  for (const row of rows.slice(at + 1)) {
    const type = text(row[col.type]);
    const first = text(row[0]);
    // An account heading sits on a row of its own: "Fidelity GHS".
    if (!type && first && !/^total/i.test(first) && row.slice(1).every((c) => !text(c))) {
      account = first;
      continue;
    }
    if (type.toLowerCase() !== "payment") continue;
    const amount = round2(num(row[col.amount]));
    const paid_on = reportDate(row[col.date]);
    // Each deposit is printed twice, in and out; the positive side is the money received.
    if (amount <= 0 || !paid_on) continue;
    payments.push({ paid_on, amount, customer: text(row[col.customer]), account });
  }
  return payments;
}

/** What an invoice comes to, as QuickBooks' invoice list shows it: after withholding. */
export function balanceOf(invoice: ImportedInvoice): number {
  return round2(invoice.lines.reduce((sum, l) => sum + l.amount, 0) - invoice.withheld);
}

export interface Matched {
  payments: Array<ImportedPayment & { invoice: string }>;
  unmatched: ImportedPayment[];
}

/**
 * Puts each payment against the oldest invoice still open for exactly that amount and
 * issued no later than the day it was paid. Payments are taken in date order, so the
 * earliest money settles the earliest bill.
 */
export function matchPayments(invoices: ImportedInvoice[], payments: ImportedPayment[]): Matched {
  const open = [...invoices]
    .sort((a, b) => a.issued_on.localeCompare(b.issued_on) || a.number.localeCompare(b.number))
    .map((invoice) => ({ invoice, balance: balanceOf(invoice) }));
  const out: Matched = { payments: [], unmatched: [] };
  for (const payment of [...payments].sort((a, b) => a.paid_on.localeCompare(b.paid_on))) {
    const hit = open.find(
      (o) => Math.abs(o.balance - payment.amount) < 0.005 && o.invoice.issued_on <= payment.paid_on,
    );
    if (!hit) {
      out.unmatched.push(payment);
      continue;
    }
    open.splice(open.indexOf(hit), 1);
    out.payments.push({ ...payment, invoice: hit.invoice.number });
  }
  return out;
}

/** The customer names in a deposit report, to pick the client's from. */
export function customersIn(payments: ImportedPayment[]): string[] {
  return [...new Set(payments.map((p) => p.customer).filter(Boolean))].sort();
}

/**
 * The name in the report that is this client's: an exact match ignoring case and
 * punctuation ("ConvyPlus LTD" for "Convyplus Ltd."), or none.
 */
export function customerFor(clientName: string, names: string[]): string | null {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return names.find((n) => squash(n) === squash(clientName)) ?? null;
}
