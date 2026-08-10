/** Date arithmetic for recurring compliance jobs and statutory deadlines. */

import type { DueDateRule } from "../shared/types";
import type { Recurrence } from "../shared/workflow";

export const RECURRENCE_MONTHS: Record<Recurrence, number> = {
  none: 0,
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

function daysInMonth(year: number, month: number): number {
  // month is 1-based; day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Adds whole months to a YYYY-MM-DD date, clamping the day to the target
 * month's length so 31 January + 1 month lands on 28/29 February rather than
 * rolling into March.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map((part) => Number.parseInt(part, 10));
  const total = (y * 12 + (m - 1)) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return format(year, month, day);
}

export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  const dt = new Date(ms);
  return format(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Applies a template's statutory due-date rule to the end of a reporting
 * period: `{ month_offset: 1, day: 15 }` against a period ending 31 March gives
 * 15 April. The day is clamped to the length of the target month.
 */
export function statutoryDueDate(periodEnd: string, rule: DueDateRule): string {
  const shifted = addMonths(periodEnd, rule.month_offset);
  const [year, month] = shifted.split("-").map((p) => Number.parseInt(p, 10));
  const day = Math.min(Math.max(rule.day, 1), daysInMonth(year, month));
  return format(year, month, day);
}

export function parseDueDateRule(raw: string | null): DueDateRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DueDateRule>;
    if (
      typeof parsed?.month_offset !== "number" ||
      typeof parsed?.day !== "number" ||
      !Number.isFinite(parsed.month_offset) ||
      !Number.isFinite(parsed.day)
    ) {
      return null;
    }
    return { month_offset: parsed.month_offset, day: parsed.day };
  } catch {
    return null;
  }
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Derives the reporting period covered by an occurrence, given the period end
 * and the recurrence. Used to label generated jobs ("Mar 2026", "2026-Q1").
 */
export function periodLabel(periodEnd: string, recurrence: Recurrence): string {
  const [year, month] = periodEnd.split("-").map((p) => Number.parseInt(p, 10));
  switch (recurrence) {
    case "quarterly":
      return `${year}-Q${Math.ceil(month / 3)}`;
    case "semiannual":
      return `${year}-H${month <= 6 ? 1 : 2}`;
    case "annual":
      return `FY${year}`;
    case "monthly":
    default:
      return `${MONTH_NAMES[month - 1]} ${year}`;
  }
}

/**
 * Advances an existing period label by one recurrence interval.
 *
 * Used when a recurring job carries a label but no stored period end - the
 * label describes the period being reported on, so it cannot be re-derived from
 * the filing deadline (a March return filed in April would otherwise be
 * relabelled as an April one). Returns null when the label is free text we do
 * not recognise, leaving the caller to fall back.
 */
export function advancePeriodLabel(
  label: string,
  recurrence: Recurrence,
): string | null {
  const months = RECURRENCE_MONTHS[recurrence];
  if (!months) return null;
  const text = label.trim();

  const monthly = /^([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(text);
  if (monthly) {
    const index = MONTH_NAMES.findIndex(
      (name) => name.toLowerCase() === monthly[1].slice(0, 3).toLowerCase(),
    );
    if (index >= 0) {
      const total = Number.parseInt(monthly[2], 10) * 12 + index + months;
      return `${MONTH_NAMES[total % 12]} ${Math.floor(total / 12)}`;
    }
  }

  const quarterly = /^(\d{4})-Q([1-4])$/.exec(text);
  if (quarterly && months % 3 === 0) {
    const total =
      Number.parseInt(quarterly[1], 10) * 4 +
      (Number.parseInt(quarterly[2], 10) - 1) +
      months / 3;
    return `${Math.floor(total / 4)}-Q${(total % 4) + 1}`;
  }

  const half = /^(\d{4})-H([12])$/.exec(text);
  if (half && months % 6 === 0) {
    const total =
      Number.parseInt(half[1], 10) * 2 +
      (Number.parseInt(half[2], 10) - 1) +
      months / 6;
    return `${Math.floor(total / 2)}-H${(total % 2) + 1}`;
  }

  const fiscal = /^FY\s?(\d{4})$/i.exec(text);
  if (fiscal && months % 12 === 0) {
    return `FY${Number.parseInt(fiscal[1], 10) + months / 12}`;
  }

  const bareYear = /^(\d{4})$/.exec(text);
  if (bareYear && months % 12 === 0) {
    return String(Number.parseInt(bareYear[1], 10) + months / 12);
  }

  return null;
}
