/** Display formatting helpers. */

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return "-";
  return DATE_FMT.format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return DATETIME_FMT.format(date);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from today to `value`; negative when the date has passed. */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const target = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const now = Date.parse(`${today()}T00:00:00Z`);
  return Math.round((target - now) / 86_400_000);
}

/**
 * How a deadline turned out, for work that is finished.
 *
 * `describeDue` below measures against today, which is right while somebody still has to
 * act and wrong the moment they have. A deliverable closed on 11 August against a 23
 * August target was delivered twelve days early; measured against today it accrues a day
 * of lateness every morning and eventually reads "21 days late", which is not merely
 * stale but the opposite of what happened.
 *
 * So once the work is settled the comparison moves from today to the day it was actually
 * finished, and the pill stops being a countdown and becomes a fact.
 */
export function describeOutcome(
  due: string | null | undefined,
  completedOn: string | null | undefined,
): { text: string; tone: "late" | "met" | "none" } {
  if (!due || !completedOn) return { text: "", tone: "none" };

  const target = Date.parse(`${due}T00:00:00Z`);
  // `completedOn` is a full timestamp; the date part is what a deadline is measured in.
  const done = Date.parse(`${completedOn.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(done)) return { text: "", tone: "none" };

  const days = Math.round((done - target) / 86_400_000);
  if (days <= 0) return { text: "Met", tone: "met" };
  return { text: `${days} ${days === 1 ? "day" : "days"} late`, tone: "late" };
}

/** "3 days late", "due today", "in 5 days" - the phrasing a reviewer scans for. */
export function describeDue(value: string | null | undefined): {
  text: string;
  tone: "late" | "soon" | "ok" | "none";
} {
  const days = daysUntil(value);
  if (days === null) return { text: "No date set", tone: "none" };
  if (days < 0) {
    const n = Math.abs(days);
    return { text: `${n} ${n === 1 ? "day" : "days"} late`, tone: "late" };
  }
  if (days === 0) return { text: "Due today", tone: "soon" };
  if (days <= 3) return { text: `In ${days} ${days === 1 ? "day" : "days"}`, tone: "soon" };
  return { text: `In ${days} days`, tone: "ok" };
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "-";
  const then = Date.parse(value);
  if (Number.isNaN(then)) return "-";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${Number(value).toLocaleString("en-GB", { maximumFractionDigits: 2 })}h`;
}

export function formatMoney(
  amount: number | null | undefined,
  currency = "GHS",
): string {
  if (amount === null || amount === undefined) return "-";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-GB")}`;
  }
}

/**
 * Money to the pesewa, for anything that has to add up in a column.
 *
 * `formatMoney` above rounds to whole cedis, which is right for a fee on a card - "GHS
 * 4,500 a month" - and wrong for an invoice. Rounded, a tax line of 112.50 prints as 113
 * and a column of them no longer sums to the total printed beneath it. An invoice whose
 * total does not equal its own column is the one thing an invoice must never do.
 */
export function formatMoneyExact(
  amount: number | null | undefined,
  currency = "GHS",
): string {
  if (amount === null || amount === undefined) return "-";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Turns a snake_case identifier into readable text for values without a label map. */
export function humanise(value: string | null | undefined): string {
  if (!value) return "-";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
