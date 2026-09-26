/**
 * Finding invoices on the Invoices tab: searching, filtering, sorting and grouping.
 *
 * The firm's whole list is small enough to hold in the browser - a few thousand rows
 * at the most - so it is fetched once and everything here runs on it as the Partner
 * types, with no round trip per keystroke. Pure, so the tests pin what a search finds.
 *
 * - **Search** takes several words and wants all of them, each matching anywhere: the
 *   number, the client's name or code, the month it covers, either date in any of the
 *   ways the firm writes one (2026-07-23, 23/07/2026, 23 Jul 2026, July 2026), or an
 *   amount with or without its commas.
 * - **Filters**: where it stands (including overdue and unpaid, which are questions
 *   asked of a row rather than stored states), which client, which currency, and a
 *   date range on either the issue date or the due date.
 * - **Grouping**: by client, by the month issued or due, by where it stands, or by
 *   currency - each group with its own count and totals.
 *
 * Totals are always per currency. A cedi and a dollar are not added together anywhere
 * in the portal, and a total that did so would be a number nobody could use.
 */

import type { InvoiceSummary } from "./types";

export const INVOICE_STATUS_FILTERS = [
  ["", "All"],
  ["unpaid", "Unpaid"],
  ["overdue", "Overdue"],
  ["sent", "Awaiting payment"],
  ["part_paid", "Part paid"],
  ["paid", "Paid"],
  ["draft", "Drafts"],
  ["void", "Cancelled"],
] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number][0];

export const GROUPINGS = [
  ["none", "No grouping"],
  ["client", "Client"],
  ["issued_month", "Month issued"],
  ["due_month", "Month due"],
  ["status", "Standing"],
  ["currency", "Currency"],
] as const;
export type Grouping = (typeof GROUPINGS)[number][0];

export type SortKey = "number" | "client" | "issued" | "due" | "total" | "outstanding";

export interface InvoiceCriteria {
  q: string;
  status: InvoiceStatusFilter;
  clientId: string;
  currency: string;
  dateField: "issued" | "due";
  /** Inclusive, YYYY-MM-DD; empty for open-ended. */
  from: string;
  to: string;
}

export const NO_CRITERIA: InvoiceCriteria = {
  q: "",
  status: "",
  clientId: "",
  currency: "",
  dateField: "issued",
  from: "",
  to: "",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * What the client owes on an invoice. Only an issued invoice can be owed: a draft has
 * not been sent and a cancelled one has been withdrawn, whatever figure they carry.
 */
export function owedOn(i: InvoiceSummary): number {
  return i.state === "sent" || i.state === "part_paid" ? i.standing.outstanding : 0;
}

/** Whether it is late: owed, and past its due date. */
export function isOverdue(i: InvoiceSummary): boolean {
  return owedOn(i) > 0 && i.standing.overdue;
}

/** Where an invoice stands, in the words the list uses. */
export function standingOfRow(i: InvoiceSummary): string {
  if (i.state === "draft") return "Draft";
  if (i.state === "void") return "Cancelled";
  if (i.state === "paid") return "Paid";
  if (isOverdue(i)) return "Overdue";
  return i.state === "part_paid" ? "Part paid" : "Awaiting payment";
}

/** Every way the firm might type this date. */
function dateWords(iso: string | null): string[] {
  if (!iso) return [];
  const [y, m, d] = iso.slice(0, 10).split("-");
  const month = MONTHS[Number(m) - 1] ?? "";
  return [iso, `${d}/${m}/${y}`, `${Number(d)} ${month.slice(0, 3)} ${y}`, `${Number(d)} ${month} ${y}`, `${month} ${y}`, `${month.slice(0, 3)} ${y}`];
}

function amountWords(n: number): string[] {
  const fixed = n.toFixed(2);
  return [fixed, n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
}

/** Everything a search can match on one row, lower-cased and joined. */
export function haystackOf(i: InvoiceSummary): string {
  return [
    i.number,
    i.client_name,
    i.client_code,
    i.period_label ?? "",
    i.currency,
    standingOfRow(i),
    ...dateWords(i.issued_on),
    ...dateWords(i.due_on),
    ...amountWords(i.gross),
    ...amountWords(i.balance_due),
    ...(owedOn(i) > 0 ? amountWords(owedOn(i)) : []),
  ]
    .join(" | ")
    .toLowerCase();
}

/** Whether a row matches every word of the search. */
export function matchesSearch(i: InvoiceSummary, q: string, haystack = haystackOf(i)): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => haystack.includes(w));
}

export function matchesStatus(i: InvoiceSummary, status: InvoiceStatusFilter): boolean {
  switch (status) {
    case "":
      return true;
    case "unpaid":
      return owedOn(i) > 0;
    case "overdue":
      return isOverdue(i);
    case "sent":
      return i.state === "sent" && !isOverdue(i);
    case "part_paid":
      return i.state === "part_paid";
    default:
      return i.state === status;
  }
}

export function filterInvoices(rows: InvoiceSummary[], c: InvoiceCriteria): InvoiceSummary[] {
  return rows.filter((i) => {
    if (c.clientId && i.client_id !== c.clientId) return false;
    if (c.currency && i.currency !== c.currency) return false;
    if (!matchesStatus(i, c.status)) return false;
    const date = c.dateField === "due" ? i.due_on : i.issued_on;
    if ((c.from || c.to) && !date) return false;
    if (c.from && date! < c.from) return false;
    if (c.to && date! > c.to) return false;
    return !c.q.trim() || matchesSearch(i, c.q);
  });
}

export function sortInvoices(rows: InvoiceSummary[], key: SortKey, descending: boolean): InvoiceSummary[] {
  const value = (i: InvoiceSummary): string | number => {
    switch (key) {
      case "number":
        return i.number;
      case "client":
        return i.client_name.toLowerCase();
      case "issued":
        return i.issued_on ?? "";
      case "due":
        return i.due_on;
      case "total":
        return i.gross;
      case "outstanding":
        return owedOn(i);
    }
  };
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "en", { numeric: true });
    return (descending ? -order : order) || a.number.localeCompare(b.number, "en", { numeric: true });
  });
}

export interface CurrencyTotals {
  currency: string;
  count: number;
  billed: number;
  outstanding: number;
  overdue: number;
  awaiting_certificate: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Totals for a set of rows, one line per currency, the most used first. */
export function totalsByCurrency(rows: InvoiceSummary[]): CurrencyTotals[] {
  const by = new Map<string, CurrencyTotals>();
  for (const i of rows) {
    const t = by.get(i.currency) ?? { currency: i.currency, count: 0, billed: 0, outstanding: 0, overdue: 0, awaiting_certificate: 0 };
    t.count += 1;
    if (i.state !== "draft" && i.state !== "void") t.billed = round2(t.billed + i.balance_due);
    t.outstanding = round2(t.outstanding + owedOn(i));
    if (isOverdue(i)) t.overdue = round2(t.overdue + owedOn(i));
    if (i.state !== "draft" && i.state !== "void") {
      t.awaiting_certificate = round2(t.awaiting_certificate + i.standing.awaiting_certificate);
    }
    by.set(i.currency, t);
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

export interface InvoiceGroup {
  key: string;
  label: string;
  rows: InvoiceSummary[];
  totals: CurrencyTotals[];
}

function monthLabel(iso: string | null): [string, string] {
  if (!iso) return ["", "Not issued yet"];
  const [y, m] = iso.split("-");
  return [`${y}-${m}`, `${MONTHS[Number(m) - 1]} ${y}`];
}

const STANDING_ORDER = ["Overdue", "Awaiting payment", "Part paid", "Draft", "Paid", "Cancelled"];

/**
 * The rows in groups, each group keeping the order the rows came in. Months run
 * newest first, clients alphabetically, standings with what needs attention first.
 */
export function groupInvoices(rows: InvoiceSummary[], by: Grouping): InvoiceGroup[] {
  if (by === "none") return [{ key: "all", label: "", rows, totals: totalsByCurrency(rows) }];
  const groups = new Map<string, { label: string; rows: InvoiceSummary[] }>();
  for (const i of rows) {
    const [key, label] =
      by === "client"
        ? [i.client_id, i.client_name]
        : by === "issued_month"
          ? monthLabel(i.issued_on)
          : by === "due_month"
            ? monthLabel(i.due_on)
            : by === "status"
              ? [standingOfRow(i), standingOfRow(i)]
              : [i.currency, i.currency];
    const g = groups.get(key) ?? { label, rows: [] };
    g.rows.push(i);
    groups.set(key, g);
  }
  const out = [...groups.entries()].map(([key, g]) => ({ key, label: g.label, rows: g.rows, totals: totalsByCurrency(g.rows) }));
  return out.sort((a, b) => {
    if (by === "issued_month" || by === "due_month") return b.key.localeCompare(a.key);
    if (by === "status") return STANDING_ORDER.indexOf(a.key) - STANDING_ORDER.indexOf(b.key);
    return a.label.localeCompare(b.label);
  });
}

/** The date ranges offered as shortcuts, worked out from today. */
export function datePresets(today: string): Array<{ key: string; label: string; from: string; to: string }> {
  const [y, m] = today.split("-").map(Number);
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  const lastDay = (yy: number, mm: number) => iso(yy, mm + 1, 0);
  const q = Math.floor((m - 1) / 3);
  const lq = q === 0 ? { y: y - 1, q: 3 } : { y, q: q - 1 };
  return [
    { key: "this_month", label: "This month", from: iso(y, m, 1), to: lastDay(y, m) },
    { key: "last_month", label: "Last month", from: iso(y, m - 1, 1), to: lastDay(y, m - 1) },
    { key: "this_quarter", label: "This quarter", from: iso(y, q * 3 + 1, 1), to: lastDay(y, q * 3 + 3) },
    { key: "last_quarter", label: "Last quarter", from: iso(lq.y, lq.q * 3 + 1, 1), to: lastDay(lq.y, lq.q * 3 + 3) },
    { key: "this_year", label: "This year", from: iso(y, 1, 1), to: iso(y, 12, 31) },
    { key: "last_year", label: "Last year", from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) },
  ];
}

/** The rows as a spreadsheet, for the firm's own records. */
export function invoicesCsv(rows: InvoiceSummary[]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    // Quoted, and a leading = + - @ neutralised so a spreadsheet never runs it as a formula.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["Invoice", "Client", "Client code", "Issued", "Due", "Covers", "Currency", "Total", "Amount due", "Outstanding", "Standing"];
  const lines = rows.map((i) =>
    [
      i.number,
      i.client_name,
      i.client_code,
      i.issued_on ?? "",
      i.due_on,
      i.period_label ?? "",
      i.currency,
      i.gross.toFixed(2),
      i.balance_due.toFixed(2),
      owedOn(i).toFixed(2),
      standingOfRow(i),
    ].map(cell).join(","),
  );
  return [header.map(cell).join(","), ...lines].join("\r\n");
}
