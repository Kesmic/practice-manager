/**
 * When a written status report is due, and what period it answers for.
 *
 * The firm requires a short written report from every member of staff carrying client
 * work, on Wednesdays and Fridays. Not one per deliverable: one per person, covering
 * everything assigned to them, with the deliverables it concerns named as references.
 * A report per deliverable would ask somebody with nine open jobs to write nine
 * reports twice a week, which is how a reporting requirement becomes a ritual that
 * everybody satisfies and nobody reads.
 *
 * Three things this module is careful about.
 *
 * **The schedule is the firm's to set.** Wednesdays and Fridays are the default, not a
 * constant. A practice whose filing week runs differently should be able to say so
 * without a deployment, so the days live in settings and everything here takes them as
 * an argument.
 *
 * **A period is bounded by the previous reporting day, not by a fixed number of
 * hours.** With Wednesday and Friday, the Friday report covers Thursday and Friday and
 * the Wednesday report covers the weekend through Wednesday. Counting back a fixed
 * forty-eight hours would leave Saturday, Sunday and Monday in no report at all.
 *
 * **Nothing is due on a day the firm does not report.** There is no rounding forward to
 * "the nearest reporting day", because a report that arrives on Thursday for a
 * Wednesday deadline is late, and a system that quietly re-dates it says otherwise.
 */

// ---------------------------------------------------------------------------
// Days of the week
// ---------------------------------------------------------------------------

/**
 * ISO weekday numbering: Monday is 1, Sunday is 7.
 *
 * Deliberately not JavaScript's own numbering, where Sunday is 0 and the week runs
 * Sunday to Saturday. Every place this is read or written by a person - the settings
 * screen, the stored value, this file - uses the numbering people already have, and the
 * one conversion to JavaScript's lives in `weekdayOf` below.
 */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

/** Wednesday and Friday, which is what the firm asked for. */
export const DEFAULT_REPORT_DAYS: Weekday[] = [3, 5];

/** The ISO weekday of a YYYY-MM-DD date. */
export function weekdayOf(date: string): Weekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  // JavaScript counts Sunday as 0; ISO counts it as 7.
  return (day === 0 ? 7 : day) as Weekday;
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

export interface ReportSchedule {
  /** Whether the firm requires reports at all. */
  enabled: boolean;
  /** Which days of the week, in order. Never empty while enabled. */
  days: Weekday[];
}

export const DEFAULT_SCHEDULE: ReportSchedule = {
  enabled: true,
  days: DEFAULT_REPORT_DAYS,
};

/**
 * Reads a stored schedule, falling back to the default rather than throwing.
 *
 * A malformed settings value must not stop the portal loading. The worst outcome of
 * falling back is that the firm is asked for reports on the default days until somebody
 * fixes the setting; the worst outcome of throwing is that nobody can sign in.
 */
export function readSchedule(raw: string | null | undefined): ReportSchedule {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_SCHEDULE;
  if (raw.trim() === "off") return { enabled: false, days: [] };

  /*
   * Each part must be a bare digit and nothing else. Number.parseInt is too forgiving
   * here: it reads "3;5" as 3, so a value typed with the wrong separator would silently
   * halve the firm's reporting days rather than being rejected as the mistake it is.
   */
  const days = [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => /^[1-7]$/.test(part))
        .map((part) => Number(part) as Weekday),
    ),
  ].sort((a, b) => a - b);

  // Anything unreadable in the value means it was not written by this system. Salvaging
  // half of it would ask the firm for reports on a schedule nobody chose.
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (days.length !== parts.length) return DEFAULT_SCHEDULE;

  // A schedule with no days is not "reports on no days" - it is a broken value, and
  // the honest reading of it is that nobody deliberately asked for that.
  return days.length ? { enabled: true, days } : DEFAULT_SCHEDULE;
}

export function writeSchedule(schedule: ReportSchedule): string {
  if (!schedule.enabled || schedule.days.length === 0) return "off";
  return [...new Set(schedule.days)].sort((a, b) => a - b).join(",");
}

/** "Wednesdays and Fridays", for a sentence rather than a list. */
export function describeSchedule(schedule: ReportSchedule): string {
  if (!schedule.enabled || !schedule.days.length) return "not required";
  const names = schedule.days.map((d) => `${WEEKDAY_LABELS[d]}s`);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Which report is current
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The most recent reporting day on or before `date`.
 *
 * This, rather than the next one, is what a person is answering for. On Thursday the
 * report you owe is Wednesday's, and the screen should say Wednesday - not offer you
 * Friday's as though Wednesday had not happened.
 */
export function currentDueDate(date: string, days: Weekday[]): string | null {
  if (!days.length) return null;
  for (let back = 0; back < 7; back += 1) {
    const candidate = shift(date, -back);
    if (days.includes(weekdayOf(candidate))) return candidate;
  }
  return null;
}

/** The next reporting day strictly after `date`. */
export function nextDueDate(date: string, days: Weekday[]): string | null {
  if (!days.length) return null;
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const candidate = shift(date, ahead);
    if (days.includes(weekdayOf(candidate))) return candidate;
  }
  return null;
}

/** The reporting day immediately before `dueOn`. */
export function previousDueDate(dueOn: string, days: Weekday[]): string | null {
  if (!days.length) return null;
  for (let back = 1; back <= 7; back += 1) {
    const candidate = shift(dueOn, -back);
    if (days.includes(weekdayOf(candidate))) return candidate;
  }
  return null;
}

export interface ReportPeriod {
  /** The reporting day this report answers for. */
  due_on: string;
  /**
   * The first day the report covers: the day after the previous reporting day, so
   * consecutive reports tile the calendar with no day in either two reports or none.
   */
  from: string;
}

/**
 * The period a given reporting day covers.
 *
 * With Wednesday and Friday: Friday's report covers Thursday and Friday; Wednesday's
 * covers Saturday through Wednesday. Every day of the year falls in exactly one period,
 * which is the property a fixed forty-eight-hour window does not have - that one leaves
 * the weekend in no report at all.
 */
export function periodFor(dueOn: string, days: Weekday[]): ReportPeriod {
  const previous = previousDueDate(dueOn, days);
  return { due_on: dueOn, from: previous ? shift(previous, 1) : dueOn };
}

// ---------------------------------------------------------------------------
// Whether somebody is behind
// ---------------------------------------------------------------------------

export type ReportState = "not_required" | "due" | "overdue" | "submitted";

/**
 * Where one person stands today.
 *
 * `due` on the reporting day itself, `overdue` once it has passed. The distinction
 * matters because they are different messages: one is a task for today and the other is
 * a failure to be explained.
 */
export function reportState(
  today: string,
  schedule: ReportSchedule,
  submittedFor: string[],
): { state: ReportState; due_on: string | null; from: string | null } {
  if (!schedule.enabled) return { state: "not_required", due_on: null, from: null };

  const dueOn = currentDueDate(today, schedule.days);
  if (!dueOn) return { state: "not_required", due_on: null, from: null };

  const { from } = periodFor(dueOn, schedule.days);
  if (submittedFor.includes(dueOn)) {
    return { state: "submitted", due_on: dueOn, from };
  }
  return { state: dueOn === today ? "due" : "overdue", due_on: dueOn, from };
}

/**
 * How many reporting days somebody has missed, up to a limit.
 *
 * Bounded deliberately. The number a manager acts on is "two" or "several"; counting
 * back through a person's whole employment to report 143 would be true, useless, and a
 * table scan on every sidebar draw.
 */
export const MISSED_LOOKBACK_DAYS = 28;

export function missedDays(
  today: string,
  schedule: ReportSchedule,
  submittedFor: string[],
  since?: string | null,
): string[] {
  if (!schedule.enabled) return [];

  const missed: string[] = [];
  let cursor = currentDueDate(today, schedule.days);
  const floor = shift(today, -MISSED_LOOKBACK_DAYS);

  while (cursor && cursor >= floor) {
    // Somebody who joined on Thursday did not miss Wednesday's report.
    if (since && cursor < since) break;
    if (!submittedFor.includes(cursor)) missed.push(cursor);
    cursor = previousDueDate(cursor, schedule.days);
  }
  return missed;
}
