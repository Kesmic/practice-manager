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
// Who reports
// ---------------------------------------------------------------------------

/**
 * Whether a particular person owes status reports.
 *
 * The firm-wide schedule says *when* reports are due. This says *who* owes them, and it
 * is the firm's to decide person by person - a Partner who carries no deliverables but
 * runs three engagements may well owe one, and a bookkeeper on a fixed routine may not.
 *
 * Three states rather than a tick box, because "not required" and "not required yet"
 * are different facts and collapsing them loses the useful one:
 *
 * - **automatic** - owed while they are carrying live client work. The default, and the
 *   behaviour the firm already had. A new joiner starts reporting when somebody assigns
 *   them a deliverable, without anybody remembering to turn it on.
 * - **always** - owed whether or not they hold any deliverables.
 * - **never** - not owed at all.
 *
 * `automatic` is a null in the database rather than a stored word, so a person nobody
 * has ever thought about carries no setting instead of a decision they were never part
 * of. That also means the default can change without rewriting every row.
 */
export const REPORT_DUTIES = ["automatic", "always", "never"] as const;
export type ReportDuty = (typeof REPORT_DUTIES)[number];

export const DUTY_LABELS: Record<ReportDuty, string> = {
  automatic: "While carrying client work",
  always: "Always",
  never: "Never",
};

export const DUTY_HINTS: Record<ReportDuty, string> = {
  automatic:
    "Reports while they hold a live deliverable, and stops when they do not. The default.",
  always: "Reports every reporting day, whether or not they hold any deliverables.",
  never: "Never asked, and never counted as behind.",
};

/** Reads the stored column. Anything unrecognised means nobody has decided. */
export function readDuty(value: string | null | undefined): ReportDuty {
  return value === "always" || value === "never" ? value : "automatic";
}

/** What to store. `automatic` is absence, so it writes null. */
export function writeDuty(duty: ReportDuty): string | null {
  return duty === "automatic" ? null : duty;
}

/**
 * Whether this person owes a report at all.
 *
 * Consulted before anything else in this module. Somebody who owes nothing is not
 * "up to date" - they are outside the requirement, and calling them up to date would
 * put them in a list of people who have reported when they were never asked.
 */
export function owesReports(duty: ReportDuty, carryingWork: boolean): boolean {
  if (duty === "never") return false;
  if (duty === "always") return true;
  return carryingWork;
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
  /** The day they joined, if known. Nothing is due for a reporting day before it. */
  since?: string | null,
  /** False for somebody the firm does not ask. Defaults to true for callers that do
   *  not yet know, so an omission cannot silently excuse anybody. */
  owes = true,
): { state: ReportState; due_on: string | null; from: string | null } {
  if (!schedule.enabled || !owes) {
    return { state: "not_required", due_on: null, from: null };
  }

  const dueOn = currentDueDate(today, schedule.days);
  if (!dueOn) return { state: "not_required", due_on: null, from: null };

  /*
   * Somebody who joined on Saturday does not owe Friday's report.
   *
   * `missedDays` has always stopped at the joining date; this did not, so a new joiner
   * arriving between two reporting days was shown a form for a period that ended before
   * their first day, marked overdue, covering work they could not have done. They report
   * from their first reporting day onwards.
   */
  if (since && dueOn < since) {
    return { state: "not_required", due_on: null, from: null };
  }

  const { from } = periodFor(dueOn, schedule.days);
  if (submittedFor.includes(dueOn)) {
    return { state: "submitted", due_on: dueOn, from };
  }
  return { state: dueOn === today ? "due" : "overdue", due_on: dueOn, from };
}

/**
 * What the sidebar badge counts: the report they owe now, and nothing else.
 *
 * One or zero, never seven.
 *
 * The badge used to count missed reporting days, and a missed day cannot be filed - the
 * current report is the only one there is. So somebody who joined a firm that had the
 * schedule switched on carried a badge of eight that dropped to seven when they filed
 * and then never moved again. `shared/attention.ts` says why that is the one thing a
 * badge must not do: a count that never reaches zero teaches people the numbers are
 * decoration, and it makes the badge that *is* news easier to miss.
 *
 * The missed days are still worth showing - they are a record, and a manager reading a
 * colleague's page should see them. They are just not a badge, because nothing the
 * person does clears them.
 */
export function outstandingReports(
  today: string,
  schedule: ReportSchedule,
  submittedFor: string[],
  since?: string | null,
  owes = true,
): number {
  const { state } = reportState(today, schedule, submittedFor, since, owes);
  return state === "submitted" || state === "not_required" ? 0 : 1;
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
  /** As in reportState: defaulted to true so an omission cannot excuse anybody. */
  owes = true,
): string[] {
  if (!schedule.enabled || !owes) return [];

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
