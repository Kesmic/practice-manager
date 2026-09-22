/**
 * Money taken off what a client is charged.
 *
 * A Partner decides three things: how much, what it comes off, and how long it lasts.
 * Everything here is those three and the arithmetic that follows from them.
 *
 * ## One at a time
 *
 * A client has at most one active discount. Two would raise a question nobody wants to
 * answer on an invoice - do they compound, do they apply in order, does the second come
 * off the first - and every answer is one somebody has to explain to a client who is
 * looking at a figure they did not expect. A Partner who wants a different arrangement
 * ends the current one and starts another, and the trail shows both.
 *
 * ## It comes off before tax
 *
 * Tax is charged on what the firm actually bills, not on what it would have billed. So
 * the order on an invoice is: the lines, then the discount, then tax on what is left.
 * Putting the discount after tax would have the firm paying VAT on money it never
 * received.
 *
 * ## It is spent when the invoice is issued, not when it is drafted
 *
 * A draft that is cancelled must not burn a one-off discount - otherwise a mistyped
 * invoice costs the client their discount and somebody has to notice.
 */

/** Off a percentage, or off a flat amount. */
export const DISCOUNT_KINDS = ["percentage", "amount"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export const DISCOUNT_KIND_LABELS: Record<DiscountKind, string> = {
  percentage: "A percentage",
  amount: "A fixed amount",
};

/** What the discount bites on. */
export const DISCOUNT_SCOPES = ["subscription", "services", "everything"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

export const DISCOUNT_SCOPE_LABELS: Record<DiscountScope, string> = {
  subscription: "The subscription fee",
  services: "Additional services",
  everything: "Everything invoiced",
};

/** How long it lasts. */
export const DISCOUNT_RUNS = ["once", "count", "until"] as const;
export type DiscountRun = (typeof DISCOUNT_RUNS)[number];

export const DISCOUNT_RUN_LABELS: Record<DiscountRun, string> = {
  once: "Once, on the next invoice",
  count: "A number of invoices",
  until: "Until a date",
};

export const DISCOUNT_STATES = ["active", "spent", "ended"] as const;
export type DiscountState = (typeof DISCOUNT_STATES)[number];

export interface Discount {
  id: string;
  kind: DiscountKind;
  /** A percentage when `kind` is percentage, otherwise money. */
  value: number;
  applies_to: DiscountScope;
  runs: DiscountRun;
  /** How many invoices it covers, when `runs` is count. */
  invoice_count: number | null;
  /** The last day it applies, when `runs` is until. */
  until_on: string | null;
  /** How many issued invoices have carried it. */
  used_count: number;
  reason: string | null;
  status: DiscountState;
  currency?: string;
}

/** Money to the pesewa, the same way shared/invoices.ts rounds it. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Whether this discount applies to an invoice raised today.
 *
 * A date-limited discount is compared against the day the invoice is raised rather than
 * the period it covers: a September invoice raised in April is an April decision, and
 * the client would rightly ask why a discount that ended in March came off it.
 */
export function discountApplies(
  discount: Pick<Discount, "runs" | "invoice_count" | "until_on" | "used_count" | "status">,
  today: string,
): boolean {
  if (discount.status !== "active") return false;

  switch (discount.runs) {
    case "once":
      return discount.used_count < 1;
    case "count":
      return discount.used_count < (discount.invoice_count ?? 0);
    case "until":
      // Inclusive of the last day. "Until 31 March" means March is discounted.
      return !!discount.until_on && today <= discount.until_on;
    default:
      return false;
  }
}

/**
 * The state an active discount should now be in, or null while it is still live.
 *
 * A discount does not stop being active by itself: nothing runs at midnight to retire
 * one whose date has gone. So this is asked wherever a discount is read or a new one is
 * granted, and the row is moved then. Without it a client whose discount ran until March
 * could not be given a new one in April - the index holding "one active discount per
 * client" would refuse it, over a discount that had stopped applying weeks earlier.
 */
export function finishedState(
  discount: Pick<Discount, "runs" | "invoice_count" | "until_on" | "used_count" | "status">,
  today: string,
): DiscountState | null {
  if (discount.status !== "active") return null;
  if (discount.runs === "until") {
    return discount.until_on && today > discount.until_on ? "ended" : null;
  }
  return invoicesLeft(discount) === 0 ? "spent" : null;
}

/** How many more invoices it covers, or null when it runs to a date instead. */
export function invoicesLeft(
  discount: Pick<Discount, "runs" | "invoice_count" | "used_count">,
): number | null {
  if (discount.runs === "once") return Math.max(1 - discount.used_count, 0);
  if (discount.runs === "count") {
    return Math.max((discount.invoice_count ?? 0) - discount.used_count, 0);
  }
  return null;
}

/** Whether issuing one more invoice uses this discount up. */
export function spentAfterUse(
  discount: Pick<Discount, "runs" | "invoice_count" | "used_count">,
): boolean {
  const left = invoicesLeft(discount);
  return left !== null && left <= 1;
}

/**
 * The part of an invoice a discount bites on.
 *
 * A discount on the subscription must not come off an audit fee that happens to be on
 * the same invoice, and the other way round. Lines the scope does not cover are simply
 * not in the base.
 */
export function discountableBase(
  lines: Array<{ amount: number; source: string }>,
  scope: DiscountScope,
): number {
  const wanted =
    scope === "everything"
      ? () => true
      : scope === "subscription"
        ? (source: string) => source === "subscription"
        : (source: string) => source === "service";

  return round2(
    lines.filter((l) => wanted(l.source)).reduce((sum, l) => sum + l.amount, 0),
  );
}

/**
 * What comes off, given the part it bites on.
 *
 * Never more than the base. A fixed discount of GHS 1,000 against an invoice for GHS 600
 * takes the invoice to nothing, not to minus four hundred - a negative invoice is a
 * credit note, which is a different document and a different conversation.
 */
export function discountAmount(
  discount: Pick<Discount, "kind" | "value">,
  base: number,
): number {
  if (base <= 0) return 0;
  const raw =
    discount.kind === "percentage"
      ? (round2(base) * discount.value) / 100
      : discount.value;
  return round2(Math.min(Math.max(raw, 0), round2(base)));
}

/** How a discount reads on a screen or an invoice. */
export function describeDiscount(
  discount: Pick<Discount, "kind" | "value" | "applies_to" | "runs" | "invoice_count" | "until_on">,
  money: (amount: number) => string,
): string {
  const off =
    discount.kind === "percentage" ? `${discount.value}%` : money(discount.value);
  const scope =
    discount.applies_to === "everything"
      ? "off everything"
      : discount.applies_to === "subscription"
        ? "off the subscription"
        : "off additional services";
  const when =
    discount.runs === "once"
      ? "on the next invoice"
      : discount.runs === "count"
        ? `for ${discount.invoice_count} invoice${discount.invoice_count === 1 ? "" : "s"}`
        : `until ${discount.until_on}`;
  return `${off} ${scope}, ${when}`;
}

/** The label that goes on the invoice line, which a client will read. */
export function discountLabel(
  discount: Pick<Discount, "kind" | "value" | "applies_to">,
): string {
  const off = discount.kind === "percentage" ? `${discount.value}%` : "Discount";
  if (discount.applies_to === "subscription") return `${off} off the subscription`;
  if (discount.applies_to === "services") return `${off} off additional services`;
  return discount.kind === "percentage" ? `${off} discount` : "Discount";
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export function whyNotADiscount(input: {
  kind: DiscountKind;
  value: number;
  runs: DiscountRun;
  invoice_count?: number | null;
  until_on?: string | null;
  today?: string;
}): string | null {
  if (!Number.isFinite(input.value) || input.value <= 0) {
    return "Give the amount to come off.";
  }
  if (input.kind === "percentage" && input.value > 100) {
    return "A discount cannot be more than 100%.";
  }
  if (input.kind === "amount" && input.value > 1_000_000_000) {
    return "That amount is implausibly large.";
  }

  if (input.runs === "count") {
    const n = input.invoice_count ?? 0;
    if (!Number.isInteger(n) || n < 1) return "Say how many invoices it covers.";
    if (n > 120) return "That is ten years of invoices. Set an end date instead.";
  }

  if (input.runs === "until") {
    if (!input.until_on) return "Give the date it runs until.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.until_on)) return "Give the date as YYYY-MM-DD.";
    if (input.today && input.until_on < input.today) {
      return "That date has passed, so the discount would never apply.";
    }
  }

  return null;
}
