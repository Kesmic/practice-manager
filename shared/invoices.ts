/**
 * Invoices: what is owed, what has been paid, and what is still outstanding.
 *
 * The arithmetic lives here rather than in the Worker because four different places need
 * the same answer and must not each work it out: the invoice a client reads, the list a
 * Partner chases from, the reminder that goes out when one is late, and the statement at
 * the foot of a client's account. A total that differed between the email and the page
 * would be the worst kind of bug in this feature - not a crash, just a number nobody can
 * reconcile.
 *
 * ## Tax is configured, never coded
 *
 * A Ghanaian invoice from a VAT-registered practice is not one tax line. It is NHIL at
 * 2.5%, GETFund at 2.5% and the COVID-19 levy at 1%, each on the fee, and then VAT at
 * 15% on the fee *plus those levies*. The rates move; the levies get added and removed;
 * a firm on the flat-rate scheme has one line instead of four; a firm that is not
 * registered has none.
 *
 * So there is no VAT constant anywhere below. An administrator defines the lines, each
 * with a rate and a basis - charged on the fee alone, or on the fee plus every line
 * before it - and that one mechanism produces all three arrangements. Changing the law
 * becomes a settings change rather than a deploy.
 *
 * ## Overdue is derived, never stored
 *
 * An invoice is overdue because its due date has passed and it is not settled. Storing
 * that as a status would mean a row that was true when it was written and silently wrong
 * the next morning, and a reminder that fires on a stale flag is a reminder to somebody
 * who has already paid.
 *
 * ## Withholding is not short payment
 *
 * Clients here deduct withholding tax and remit it to the GRA on the firm's behalf. An
 * invoice settled with 7.5% withheld has been paid in full: the firm has the cash for
 * part and a credit for the rest. Treating the deduction as a shortfall would leave a
 * permanent tail of invoices that look unpaid, and would chase clients who have paid
 * everything they owe. What the firm is actually owed in that case is a certificate, and
 * that is tracked separately.
 */

/**
 * Close enough to settled.
 *
 * A client who rounds to the cedi leaves a pesewa outstanding, and an invoice held open
 * for it would be chased by email forever over less than it costs to send.
 *
 * Applied in exactly one place so that "is it settled" and "what status is it" cannot
 * disagree - which they did, until a test put a payment a pesewa short through both and
 * got "paid" from one and "overdue" from the other.
 */
export const SETTLED_TOLERANCE = 0.01;

/** Whether what has been settled clears the invoice, give or take a pesewa. */
export function isSettled(gross: number, settled: number): boolean {
  return settled >= round2(gross - SETTLED_TOLERANCE);
}

/** Money, to the pesewa. Everything below rounds the same way for the same reason. */
export function round2(value: number): number {
  /*
   * Scaled, rounded and unscaled rather than toFixed, and with a nudge for the binary
   * representation: 1.005 is stored as 1.00499999... so Math.round gives 1.00 where
   * every accountant expects 1.01. On a line of tax that is a pesewa; across a year of
   * invoices it is a reconciliation nobody can close.
   */
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

/**
 * What a tax line is charged on.
 *
 * `net` is the amount invoiced before any tax - what Ghana's levies are charged on.
 * `net_plus_preceding` is that amount plus every line above it, which is how VAT sits on
 * top of the levies. Two values rather than a formula language, because these are the
 * only two shapes any of this actually takes.
 */
export const TAX_BASES = ["net", "net_plus_preceding"] as const;
export type TaxBasis = (typeof TAX_BASES)[number];

export const TAX_BASIS_LABELS: Record<TaxBasis, string> = {
  net: "On the amount before tax",
  net_plus_preceding: "On the amount plus the lines above",
};

export interface TaxLine {
  id: string;
  name: string;
  /** A percentage: 2.5 means 2.5%, not 0.025. */
  rate: number;
  basis: TaxBasis;
  position: number;
}

export interface ComputedTaxLine {
  id: string;
  name: string;
  rate: number;
  basis: TaxBasis;
  amount: number;
}

export interface Totals {
  net: number;
  taxes: ComputedTaxLine[];
  tax_total: number;
  gross: number;
}

/**
 * The foot of an invoice, from its net amount and the firm's tax lines.
 *
 * Lines are applied in `position` order, and that order is load-bearing: VAT on
 * `net_plus_preceding` means "plus the lines that came before it", so putting VAT above
 * the levies produces a different and wrong number. The settings screen therefore orders
 * them explicitly rather than by name or by id.
 *
 * Each line is rounded as it is worked out, and the total is the sum of the rounded
 * lines. That is what the invoice prints, so anything else would print a total that does
 * not equal its own column.
 */
export function computeTotals(net: number, lines: TaxLine[]): Totals {
  const ordered = [...lines].sort((a, b) => a.position - b.position);
  const base = round2(net);
  const taxes: ComputedTaxLine[] = [];
  let preceding = 0;

  for (const line of ordered) {
    const chargedOn = line.basis === "net" ? base : round2(base + preceding);
    const amount = round2((chargedOn * line.rate) / 100);
    taxes.push({
      id: line.id,
      name: line.name,
      rate: line.rate,
      basis: line.basis,
      amount,
    });
    preceding = round2(preceding + amount);
  }

  const tax_total = round2(taxes.reduce((sum, t) => sum + t.amount, 0));
  return { net: base, taxes, tax_total, gross: round2(base + tax_total) };
}

// ---------------------------------------------------------------------------
// Withholding shown on the face of the invoice
// ---------------------------------------------------------------------------

/**
 * Tax the client will deduct and remit to the revenue authority, shown as a deduction
 * on the invoice so that what they are asked to pay is what they should pay.
 *
 * Charged on the amount before tax, which is how withholding on services works here and
 * what the firm's own invoices do: a fee of 3,508.10 carries 263.10 at 7.5%, and the
 * balance due is 3,245.00.
 *
 * This is not the same thing as `invoice_payments.withheld`. That records a deduction
 * the firm did not anticipate - a fact about a payment. This is the firm saying in
 * advance that it expects one.
 */
export function withholdingOn(net: number, rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return round2((round2(net) * rate) / 100);
}

/** What the client is asked to pay: the total, less anything withheld on its face. */
export function balanceDue(gross: number, withheld: number): number {
  return round2(gross - round2(withheld));
}

// ---------------------------------------------------------------------------
// What state an invoice is in
// ---------------------------------------------------------------------------

/**
 * The statuses actually stored.
 *
 * `overdue` is deliberately absent - see the module header. It is a question asked of a
 * due date, not a fact written down.
 */
export const INVOICE_STATES = ["draft", "sent", "part_paid", "paid", "void"] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export const INVOICE_STATE_LABELS: Record<InvoiceState, string> = {
  draft: "Draft",
  sent: "Sent",
  part_paid: "Part paid",
  paid: "Paid",
  void: "Cancelled",
};

/** What the client is told, which is not always the firm's word for it. */
export const INVOICE_STATE_CLIENT_LABELS: Record<InvoiceState, string> = {
  draft: "Not yet issued",
  sent: "Awaiting payment",
  part_paid: "Part paid",
  paid: "Paid",
  void: "Cancelled",
};

/** Everything a screen says about where an invoice stands. */
export interface Standing {
  state: InvoiceState;
  /** Gross less what has been settled, including anything withheld. */
  outstanding: number;
  /** True when it is unsettled and the due date has gone. */
  overdue: boolean;
  /** Negative once it is late; positive while there is still time. */
  days_to_due: number;
  /** Withheld and not yet evidenced by a certificate. */
  awaiting_certificate: number;
}

export interface PaymentLike {
  /** Cash actually received. */
  amount: number;
  /** Deducted by the client and remitted to the revenue authority on the firm's behalf. */
  withheld: number;
  /** Whether the certificate evidencing that deduction has arrived. */
  certificate_received?: 0 | 1 | boolean;
}

/** Whole days between two dates, negative once `due` is in the past. */
export function daysBetween(today: string, due: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${due}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Where an invoice stands, from its own figures and its payments.
 *
 * A settled invoice is never overdue, whatever its date, and a draft is never overdue
 * either: the firm has not asked for the money yet, so the client cannot be late paying
 * it. Both are the kind of thing that looks obvious written down and produces a chasing
 * email to the wrong person when it is not.
 */
export function standingOf(
  invoice: {
    state: InvoiceState;
    gross: number;
    due_on: string;
    /**
     * What the client was actually asked to pay. Absent on invoices raised before
     * withholding could be shown on the face of one, where it is the gross.
     */
    balance_due?: number | null;
  },
  payments: PaymentLike[],
  today: string,
): Standing {
  const settled = round2(
    payments.reduce((sum, p) => sum + p.amount + p.withheld, 0),
  );
  /*
   * Measured against what the client was asked to pay. An invoice that already shows
   * the withholding deduction has a balance below its total, and reading the total
   * would leave it looking permanently short by exactly the tax the client remitted.
   */
  const asked = invoice.balance_due ?? invoice.gross;
  const outstanding = isSettled(asked, settled) ? 0 : round2(Math.max(asked - settled, 0));
  const awaiting = round2(
    payments
      .filter((p) => !(p.certificate_received === 1 || p.certificate_received === true))
      .reduce((sum, p) => sum + p.withheld, 0),
  );
  const days = daysBetween(today, invoice.due_on);
  const chaseable = invoice.state === "sent" || invoice.state === "part_paid";

  return {
    state: invoice.state,
    outstanding,
    overdue: chaseable && outstanding > 0 && days < 0,
    days_to_due: days,
    awaiting_certificate: awaiting,
  };
}

/**
 * The status an invoice should now be in, given what has been paid.
 *
 * Derived rather than set by hand so that recording a payment cannot leave an invoice
 * marked "sent" with nothing outstanding. A void invoice stays void: cancelling is a
 * decision, and a late payment against it is a conversation, not a state change.
 */
export function stateAfterPayments(
  current: InvoiceState,
  /**
   * What the client was asked to pay - the balance due, which on an invoice that shows
   * a withholding deduction is below its total. Passing the total here would leave such
   * an invoice permanently "part paid" by exactly the tax the client remitted.
   */
  asked: number,
  payments: PaymentLike[],
): InvoiceState {
  if (current === "void" || current === "draft") return current;
  const settled = round2(payments.reduce((sum, p) => sum + p.amount + p.withheld, 0));
  if (settled <= 0) return "sent";
  if (isSettled(asked, settled)) return "paid";
  return "part_paid";
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/**
 * When a reminder goes out, counted in days after the due date.
 *
 * Three, and then it stops. A portal that emails every week forever is a portal whose
 * emails are filtered, and by the fourth reminder the problem is not that the client has
 * forgotten - it is that somebody at the firm needs to telephone them. The schedule is a
 * setting; these are the defaults.
 */
export const DEFAULT_REMINDER_DAYS = [3, 14, 30];

/** How a reminder reads, which changes with how late it is. */
export function reminderTone(daysLate: number): "gentle" | "firm" | "final" {
  if (daysLate <= 7) return "gentle";
  if (daysLate <= 21) return "firm";
  return "final";
}

/**
 * Whether this invoice is due a reminder today, and which one.
 *
 * Returns the step number so that the row can record it and the same reminder is never
 * sent twice - the check is "have we sent step 2", not "did we send anything today",
 * because a run that fails half way through must be safe to repeat.
 */
export function reminderDue(
  invoice: { state: InvoiceState; gross: number; due_on: string },
  payments: PaymentLike[],
  remindersSent: number,
  today: string,
  schedule: number[] = DEFAULT_REMINDER_DAYS,
): { due: boolean; step: number; days_late: number } {
  const standing = standingOf(invoice, payments, today);
  const daysLate = -standing.days_to_due;

  if (!standing.overdue) return { due: false, step: remindersSent, days_late: daysLate };
  if (remindersSent >= schedule.length) {
    return { due: false, step: remindersSent, days_late: daysLate };
  }

  const nextAt = schedule[remindersSent];
  return {
    due: daysLate >= nextAt,
    step: remindersSent + 1,
    days_late: daysLate,
  };
}

// ---------------------------------------------------------------------------
// Lines and refusals
// ---------------------------------------------------------------------------

/** Where an invoice line came from, so a subscription month is never billed twice. */
export const LINE_SOURCES = ["subscription", "service", "manual"] as const;
export type LineSource = (typeof LINE_SOURCES)[number];

export interface InvoiceLine {
  description: string;
  quantity: number;
  unit_amount: number;
  source: LineSource;
}

export function lineTotal(line: { quantity: number; unit_amount: number }): number {
  return round2(line.quantity * line.unit_amount);
}

export function netOf(lines: Array<{ quantity: number; unit_amount: number }>): number {
  return round2(lines.reduce((sum, l) => sum + lineTotal(l), 0));
}

export function whyNotARate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Give the rate as a percentage.";
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "A rate has to be a number.";
  if (value < 0) return "A rate cannot be negative.";
  if (value > 100) return "A rate above 100% is almost certainly a typo.";
  return null;
}

export function whyNotAnAmount(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter an amount.";
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "That is not an amount.";
  if (value < 0) return "An amount cannot be negative.";
  if (value > 1_000_000_000) return "That amount is implausibly large.";
  return null;
}

/**
 * Why this payment cannot be recorded, or null.
 *
 * The one that matters is overpayment. A client paying more than the invoice is either a
 * typo or a payment meant for another invoice, and quietly accepting it leaves a credit
 * nobody can find. Refusing it makes somebody look.
 */
export function whyNotAPayment(
  amount: number,
  withheld: number,
  outstanding: number,
): string | null {
  if (!Number.isFinite(amount) || amount < 0) return "The amount received is not valid.";
  if (!Number.isFinite(withheld) || withheld < 0) return "The amount withheld is not valid.";
  if (amount + withheld <= 0) return "Record what was received, or what was withheld.";
  if (round2(amount + withheld) > round2(outstanding + 0.01)) {
    return "That is more than is outstanding on this invoice. Check the amount, or which invoice it belongs to.";
  }
  return null;
}
