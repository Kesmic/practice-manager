/**
 * When the month's subscription invoices go out on their own.
 *
 * The firm names a day of the month. A scheduled job asks the portal once a day, and
 * the portal decides here whether today is a day to raise the month's invoices: the
 * billing day itself, or one of the few days after it, so that a job that did not run
 * on the day catches up rather than loses the month. Outside that window nothing is
 * raised - in particular, turning this on late in a month does not send everybody a
 * bill for a month a Partner may already have invoiced by hand.
 *
 * Shared so that the settings screen can say exactly what the Worker will do.
 */

/** Days after the billing day on which a missed run is still made up. */
export const BILLING_CATCH_UP_DAYS = 5;

/** The latest day of the month a billing day may be, so that every month has one. */
export const MAX_BILLING_DAY = 28;

export function normaliseBillingDay(raw: string | number | null | undefined): number {
  const day = Math.trunc(Number(raw));
  if (!Number.isFinite(day) || day < 1) return 1;
  return Math.min(day, MAX_BILLING_DAY);
}

/**
 * Whether a run today should raise the month's invoices, and for which month.
 *
 * `today` is an ISO date; the month it is in is the month billed. The window is
 * [billing day, billing day + catch-up], inclusive.
 */
export function billingDue(
  today: string,
  billingDay: number,
): { period: string; due: boolean; why: string } {
  const day = Number(today.slice(8, 10));
  const period = today.slice(0, 7);
  const start = normaliseBillingDay(billingDay);
  const end = start + BILLING_CATCH_UP_DAYS;
  if (day < start) {
    return { period, due: false, why: `Billing day is the ${ordinal(start)}; today is the ${ordinal(day)}.` };
  }
  if (day > end) {
    return {
      period,
      due: false,
      why: `The billing window for ${period} closed on the ${ordinal(end)}. Anything still to bill is raised by hand.`,
    };
  }
  return { period, due: true, why: `Within the billing window for ${period}.` };
}

export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
