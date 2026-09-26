/**
 * Customer statements, the three kinds QuickBooks Online offers:
 *
 *  - **Balance forward**: what the client owed at the start of the period, every
 *    invoice and payment in it with a running balance, and what they owe at the end.
 *    The one to send a client whose account moves every month.
 *  - **Open item**: only the invoices still unpaid on the statement date, each with what
 *    is left on it and how late it is. The one to send when chasing.
 *  - **Transaction statement**: every invoice and payment in the period, without the
 *    running balance - a list of what happened, for a client reconciling their books.
 *
 * Balance forward and open item end with the ageing QuickBooks prints: what is not yet
 * due, and what is 1-30, 31-60, 61-90 and over 90 days past due.
 *
 * An invoice counts for what the client was asked to pay - its balance due, after any
 * withholding printed on its face - and a payment for what it settled, money received
 * plus any tax withheld against it. Drafts and cancelled invoices are not part of a
 * client's account and never appear. One currency at a time: a GHS balance and a USD
 * balance are two balances, and nothing here converts between them.
 *
 * Pure, so the tests pin every figure; the Worker feeds it and the PDF and the screen
 * both draw from its result.
 */

export const STATEMENT_TYPES = ["balance_forward", "open_item", "transaction"] as const;
export type StatementType = (typeof STATEMENT_TYPES)[number];

export const STATEMENT_TYPE_LABELS: Record<StatementType, string> = {
  balance_forward: "Balance forward",
  open_item: "Open item",
  transaction: "Transaction statement",
};

export const STATEMENT_TYPE_HINTS: Record<StatementType, string> = {
  balance_forward:
    "The balance at the start, every invoice and payment in the period with a running balance, and what is owed at the end.",
  open_item: "Only the invoices still unpaid on the statement date, with what is left on each and how late it is.",
  transaction: "Every invoice and payment in the period, listed, without a running balance.",
};

export interface StatementInvoice {
  id: string;
  number: string;
  issued_on: string;
  due_on: string;
  /** What the client was asked to pay: the balance due after withholding. */
  amount: number;
}

export interface StatementPayment {
  invoice_id: string;
  paid_on: string;
  /** Money received plus any tax withheld against the invoice. */
  amount: number;
  method: string | null;
}

export interface StatementRow {
  date: string;
  kind: "opening" | "invoice" | "payment";
  /** "Invoice CPL202601", "Payment", "Balance forward". */
  activity: string;
  /** The invoice number, for both an invoice and a payment against it. */
  reference: string;
  due_on: string | null;
  /** Charged: an invoice's amount. */
  amount: number | null;
  /** Received: a payment. */
  received: number | null;
  /** Balance forward: the balance after this row. Open item: what is left on the invoice. */
  balance: number | null;
  /** Open item: days past due on the statement date, 0 when not yet due. */
  days_overdue?: number;
}

export interface Ageing {
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  over_90: number;
}

export interface Statement {
  type: StatementType;
  statement_date: string;
  /** Null for an open-item statement, which has no period. */
  start: string | null;
  end: string | null;
  opening: number | null;
  rows: StatementRow[];
  total_invoiced: number;
  total_received: number;
  /** What the client owes on the statement date. */
  amount_due: number;
  /** Null for a transaction statement, which QuickBooks prints without one. */
  ageing: Ageing | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Whole days from one date to another: positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** What is left on each invoice once the payments made by `asOf` are taken off. */
function openOn(
  invoices: StatementInvoice[],
  payments: StatementPayment[],
  asOf: string,
): Array<{ invoice: StatementInvoice; open: number }> {
  return invoices
    .filter((i) => i.issued_on <= asOf)
    .map((invoice) => {
      const paid = payments
        .filter((p) => p.invoice_id === invoice.id && p.paid_on <= asOf)
        .reduce((sum, p) => sum + p.amount, 0);
      return { invoice, open: round2(Math.max(invoice.amount - paid, 0)) };
    })
    .filter((o) => o.open > 0.004);
}

function ageingOf(open: Array<{ invoice: StatementInvoice; open: number }>, asOf: string): Ageing {
  const out: Ageing = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, over_90: 0 };
  for (const { invoice, open: amount } of open) {
    const late = daysBetween(invoice.due_on, asOf);
    const bucket: keyof Ageing =
      late <= 0 ? "current" : late <= 30 ? "days_1_30" : late <= 60 ? "days_31_60" : late <= 90 ? "days_61_90" : "over_90";
    out[bucket] = round2(out[bucket] + amount);
  }
  return out;
}

export function buildStatement(input: {
  type: StatementType;
  statementDate: string;
  start: string;
  end: string;
  invoices: StatementInvoice[];
  payments: StatementPayment[];
}): Statement {
  const { type, statementDate, invoices, payments } = input;
  const byId = new Map(invoices.map((i) => [i.id, i]));
  // Payments against invoices that are not on the account (a cancelled one) are left out.
  const counted = payments.filter((p) => byId.has(p.invoice_id));

  if (type === "open_item") {
    const open = openOn(invoices, counted, statementDate).sort(
      (a, b) => a.invoice.issued_on.localeCompare(b.invoice.issued_on) || a.invoice.number.localeCompare(b.invoice.number),
    );
    const rows: StatementRow[] = open.map(({ invoice, open: left }) => ({
      date: invoice.issued_on,
      kind: "invoice",
      activity: `Invoice ${invoice.number}`,
      reference: invoice.number,
      due_on: invoice.due_on,
      amount: invoice.amount,
      received: null,
      balance: left,
      days_overdue: Math.max(daysBetween(invoice.due_on, statementDate), 0),
    }));
    const due = round2(open.reduce((s, o) => s + o.open, 0));
    return {
      type,
      statement_date: statementDate,
      start: null,
      end: null,
      opening: null,
      rows,
      total_invoiced: round2(open.reduce((s, o) => s + o.invoice.amount, 0)),
      total_received: 0,
      amount_due: due,
      ageing: ageingOf(open, statementDate),
    };
  }

  const { start, end } = input;
  const inRange = (d: string) => d >= start && d <= end;
  // Invoices before payments on the same day, so a bill paid on the day it went out
  // reads as charged then settled rather than as a credit first.
  const events = [
    ...invoices.filter((i) => inRange(i.issued_on)).map((i) => ({ date: i.issued_on, order: 0, invoice: i, payment: null })),
    ...counted
      .filter((p) => inRange(p.paid_on))
      .map((p) => ({ date: p.paid_on, order: 1, invoice: byId.get(p.invoice_id)!, payment: p })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.invoice.number.localeCompare(b.invoice.number));

  const before = (d: string) => d < start;
  const opening = round2(
    invoices.filter((i) => before(i.issued_on)).reduce((s, i) => s + i.amount, 0) -
      counted.filter((p) => before(p.paid_on)).reduce((s, p) => s + p.amount, 0),
  );

  let running = opening;
  const rows: StatementRow[] = [];
  if (type === "balance_forward") {
    rows.push({
      date: start,
      kind: "opening",
      activity: "Balance forward",
      reference: "",
      due_on: null,
      amount: null,
      received: null,
      balance: opening,
    });
  }
  let invoiced = 0;
  let received = 0;
  for (const e of events) {
    if (e.payment) {
      running = round2(running - e.payment.amount);
      received = round2(received + e.payment.amount);
      rows.push({
        date: e.date,
        kind: "payment",
        activity: `Payment${e.payment.method ? ` - ${e.payment.method}` : ""}`,
        reference: e.invoice.number,
        due_on: null,
        amount: null,
        received: e.payment.amount,
        balance: type === "balance_forward" ? running : null,
      });
    } else {
      running = round2(running + e.invoice.amount);
      invoiced = round2(invoiced + e.invoice.amount);
      rows.push({
        date: e.date,
        kind: "invoice",
        activity: `Invoice ${e.invoice.number}`,
        reference: e.invoice.number,
        due_on: e.invoice.due_on,
        amount: e.invoice.amount,
        received: null,
        balance: type === "balance_forward" ? running : null,
      });
    }
  }

  // What is owed on the statement date: every invoice issued by then, less every
  // payment by then - which for a period ending on the statement date is the closing
  // running balance, and stays right when the period ends earlier.
  const owed = round2(openOn(invoices, counted, statementDate).reduce((s, o) => s + o.open, 0));
  return {
    type,
    statement_date: statementDate,
    start,
    end,
    opening: type === "balance_forward" ? opening : null,
    rows,
    total_invoiced: invoiced,
    total_received: received,
    amount_due: type === "balance_forward" ? running : owed,
    ageing: type === "balance_forward" ? ageingOf(openOn(invoices, counted, end), end) : null,
  };
}

/** The ageing buckets, labelled as QuickBooks prints them. */
export const AGEING_LABELS: Array<[keyof Ageing, string]> = [
  ["current", "Current"],
  ["days_1_30", "1-30 days past due"],
  ["days_31_60", "31-60 days past due"],
  ["days_61_90", "61-90 days past due"],
  ["over_90", "Over 90 days past due"],
];
