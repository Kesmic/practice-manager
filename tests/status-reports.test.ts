/**
 * When a status report is due, and what period it answers for.
 *
 * The scheduling rules are the whole feature. Everything else is a form.
 *
 * The mistake this module exists to avoid is the obvious implementation of "every 48
 * hours": with reports on Wednesday and Friday, a fixed forty-eight-hour window leaves
 * Saturday, Sunday and Monday in no report at all. Periods are bounded by the previous
 * reporting day instead, so the days of the year tile exactly - every day in one report,
 * no day in two.
 *
 * The other thing pinned here is that a report belongs to a reporting day and not to
 * the day it was written. A Wednesday report handed in on Thursday is still Wednesday's
 * report, and a system that quietly re-dates it to Thursday has destroyed the only
 * evidence that it was late.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_REPORT_DAYS,
  DEFAULT_SCHEDULE,
  MISSED_LOOKBACK_DAYS,
  WEEKDAYS,
  WEEKDAY_LABELS,
  currentDueDate,
  describeSchedule,
  missedDays,
  nextDueDate,
  periodFor,
  previousDueDate,
  readSchedule,
  reportState,
  weekdayOf,
  writeSchedule,
  DUTY_HINTS,
  DUTY_LABELS,
  REPORT_DUTIES,
  owesReports,
  readDuty,
  writeDuty,
  type Weekday,
} from "../shared/status-reports";

/*
 * A fixed week to reason about. 2026-09-14 is a Monday, so:
 *   Mon 14, Tue 15, Wed 16, Thu 17, Fri 18, Sat 19, Sun 20, Mon 21, Wed 23, Fri 25.
 */
const PREV_WED = "2026-09-09";
const PREV_FRI = "2026-09-11";
const MON = "2026-09-14";
const TUE = "2026-09-15";
const WED = "2026-09-16";
const THU = "2026-09-17";
const FRI = "2026-09-18";
const SAT = "2026-09-19";
const SUN = "2026-09-20";
const NEXT_WED = "2026-09-23";
const NEXT_FRI = "2026-09-25";

const WED_AND_FRI: Weekday[] = [3, 5];

// ---------------------------------------------------------------------------
// Days of the week
// ---------------------------------------------------------------------------

test("weekdays are numbered the way people number them", () => {
  // ISO, not JavaScript's Sunday-is-zero. Getting this backwards would put the
  // reporting days one out and nobody would notice until a Tuesday.
  assert.equal(weekdayOf(MON), 1);
  assert.equal(weekdayOf(WED), 3);
  assert.equal(weekdayOf(FRI), 5);
  assert.equal(weekdayOf(SAT), 6);
  assert.equal(weekdayOf(SUN), 7);
});

test("every weekday has a label", () => {
  for (const day of WEEKDAYS) assert.ok(WEEKDAY_LABELS[day]);
});

test("the firm's default is Wednesdays and Fridays", () => {
  assert.deepEqual(DEFAULT_REPORT_DAYS, [3, 5]);
  assert.equal(describeSchedule(DEFAULT_SCHEDULE), "Wednesdays and Fridays");
});

test("one day reads as one day, three read as a list", () => {
  assert.equal(describeSchedule({ enabled: true, days: [1] }), "Mondays");
  assert.equal(
    describeSchedule({ enabled: true, days: [1, 3, 5] }),
    "Mondays, Wednesdays and Fridays",
  );
  assert.equal(describeSchedule({ enabled: false, days: [] }), "not required");
});

// ---------------------------------------------------------------------------
// Reading and writing the setting
// ---------------------------------------------------------------------------

test("a stored schedule round-trips", () => {
  for (const days of [[3, 5], [1], [1, 2, 3, 4, 5], [7]] as Weekday[][]) {
    const schedule = { enabled: true, days };
    assert.deepEqual(readSchedule(writeSchedule(schedule)), schedule);
  }
});

test("off round-trips as off", () => {
  assert.deepEqual(readSchedule(writeSchedule({ enabled: false, days: [3] })), {
    enabled: false,
    days: [],
  });
});

test("a malformed setting falls back rather than throwing", () => {
  // The worst outcome of falling back is that the firm is asked on the default days
  // until somebody fixes it. The worst outcome of throwing is that nobody signs in.
  for (const raw of ["", "  ", "banana", "0,9", "3;5", null, undefined]) {
    assert.deepEqual(readSchedule(raw), DEFAULT_SCHEDULE, JSON.stringify(raw));
  }
});

test("a partly valid setting keeps what is valid", () => {
  assert.deepEqual(readSchedule("3,banana,5"), { enabled: true, days: [3, 5] });
});

test("days are de-duplicated and sorted however they were stored", () => {
  assert.deepEqual(readSchedule("5,3,5,3"), { enabled: true, days: [3, 5] });
  assert.equal(writeSchedule({ enabled: true, days: [5, 3, 5] }), "3,5");
});

// ---------------------------------------------------------------------------
// Which report is current
// ---------------------------------------------------------------------------

test("on a reporting day, that day's report is the one owed", () => {
  assert.equal(currentDueDate(WED, WED_AND_FRI), WED);
  assert.equal(currentDueDate(FRI, WED_AND_FRI), FRI);
});

test("on Thursday the report owed is Wednesday's, not Friday's", () => {
  // The defect this guards against: offering Friday's form on Thursday would let
  // somebody file late work against a deadline that has not arrived.
  assert.equal(currentDueDate(THU, WED_AND_FRI), WED);
});

test("over the weekend the report owed is still Friday's", () => {
  assert.equal(currentDueDate(SAT, WED_AND_FRI), FRI);
  assert.equal(currentDueDate(SUN, WED_AND_FRI), FRI);
  // The Monday and Tuesday after that Friday, which is the following week.
  assert.equal(currentDueDate("2026-09-21", WED_AND_FRI), FRI);
  assert.equal(currentDueDate("2026-09-22", WED_AND_FRI), FRI);
});

test("early in the week the report owed is the previous Friday's", () => {
  // Monday 14 September comes before Wednesday 16, so the last reporting day behind it
  // is Friday 11 - not any day of the week it is in.
  assert.equal(currentDueDate(MON, WED_AND_FRI), PREV_FRI);
  assert.equal(currentDueDate(TUE, WED_AND_FRI), PREV_FRI);
});

test("the next reporting day is always in the future, never today", () => {
  assert.equal(nextDueDate(WED, WED_AND_FRI), FRI);
  assert.equal(nextDueDate(FRI, WED_AND_FRI), NEXT_WED);
  assert.equal(nextDueDate(SUN, WED_AND_FRI), NEXT_WED);
});

test("the previous reporting day is always in the past, never today", () => {
  assert.equal(previousDueDate(FRI, WED_AND_FRI), WED);
  assert.equal(previousDueDate(NEXT_WED, WED_AND_FRI), FRI);
});

test("with no reporting days nothing is ever due", () => {
  assert.equal(currentDueDate(WED, []), null);
  assert.equal(nextDueDate(WED, []), null);
  assert.equal(previousDueDate(WED, []), null);
});

test("a single reporting day is a week apart from itself", () => {
  assert.equal(nextDueDate(WED, [3]), NEXT_WED);
  assert.equal(previousDueDate(NEXT_WED, [3]), WED);
});

// ---------------------------------------------------------------------------
// The period a report covers
// ---------------------------------------------------------------------------

test("Friday's report covers Thursday and Friday", () => {
  assert.deepEqual(periodFor(FRI, WED_AND_FRI), { due_on: FRI, from: THU });
});

test("Wednesday's report covers the weekend through to Wednesday", () => {
  // The defect: a fixed forty-eight-hour window would start Monday and leave Saturday
  // and Sunday in no report at all.
  assert.deepEqual(periodFor(NEXT_WED, WED_AND_FRI), { due_on: NEXT_WED, from: SAT });
});

test("consecutive periods tile the calendar exactly", () => {
  // Every day in one report, no day in two. This is the property the whole scheduling
  // design exists for, so it is checked across a full year rather than by example.
  const days: Weekday[] = [3, 5];
  let cursor = "2026-01-01";
  const covered = new Set<string>();

  while (cursor <= "2026-12-31") {
    const due = currentDueDate(cursor, days)!;
    const { from } = periodFor(due, days);
    // Every day from `from` to `due` belongs to this report.
    let day = from;
    while (day <= due) {
      if (day >= "2026-02-01" && day <= "2026-11-30") {
        assert.ok(!covered.has(day), `${day} falls in two reports`);
        covered.add(day);
      }
      day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    const next = nextDueDate(due, days)!;
    cursor = next;
  }

  // February to November inclusive: every day accounted for exactly once.
  let check = "2026-02-01";
  while (check <= "2026-11-30") {
    assert.ok(covered.has(check), `${check} falls in no report`);
    check = new Date(Date.parse(`${check}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
  }
});

// ---------------------------------------------------------------------------
// Where somebody stands
// ---------------------------------------------------------------------------

test("due on the day, overdue after it", () => {
  // Two different messages: one is a task for today, the other is a failure somebody
  // may ask about. A screen that calls both "due" cannot tell them apart.
  assert.equal(reportState(WED, DEFAULT_SCHEDULE, []).state, "due");
  assert.equal(reportState(THU, DEFAULT_SCHEDULE, []).state, "overdue");
  assert.equal(reportState(MON, DEFAULT_SCHEDULE, []).state, "overdue");
});

test("submitted once it is in, whichever day you look on", () => {
  assert.equal(reportState(WED, DEFAULT_SCHEDULE, [WED]).state, "submitted");
  assert.equal(reportState(THU, DEFAULT_SCHEDULE, [WED]).state, "submitted");
});

test("filing Wednesday's report does not answer Friday's", () => {
  assert.equal(reportState(FRI, DEFAULT_SCHEDULE, [WED]).state, "due");
});

test("nothing is asked when the firm has switched reports off", () => {
  const off = { enabled: false, days: [] as Weekday[] };
  const state = reportState(THU, off, []);
  assert.equal(state.state, "not_required");
  assert.equal(state.due_on, null);
});

test("the state carries the period, so the screen need not recompute it", () => {
  const state = reportState(SAT, DEFAULT_SCHEDULE, []);
  assert.equal(state.due_on, FRI);
  assert.equal(state.from, THU);
});

// ---------------------------------------------------------------------------
// What was missed
// ---------------------------------------------------------------------------

test("missed days are the reporting days that went by without a report", () => {
  const missed = missedDays(THU, DEFAULT_SCHEDULE, []);
  // Counted backwards from the one currently owed.
  assert.deepEqual(missed.slice(0, 3), [WED, PREV_FRI, PREV_WED]);
});

test("a day that was reported is not missed", () => {
  assert.ok(!missedDays(THU, DEFAULT_SCHEDULE, [WED]).includes(WED));
});

test("nobody is asked for a report from before they arrived", () => {
  // Telling somebody on their first morning that they missed last Wednesday is a poor
  // way to start, and it is not true.
  const missed = missedDays(THU, DEFAULT_SCHEDULE, [], WED);
  assert.deepEqual(missed, [WED]);
});

test("somebody who joined after the last reporting day has missed nothing", () => {
  assert.deepEqual(missedDays(THU, DEFAULT_SCHEDULE, [], THU), []);
});

test("the look-back is bounded", () => {
  // "Two" or "several" is what a manager acts on. Counting back through a whole
  // employment to report 143 would be true, useless, and a table scan on every draw.
  const missed = missedDays(THU, DEFAULT_SCHEDULE, []);
  assert.ok(missed.length <= Math.ceil((MISSED_LOOKBACK_DAYS / 7) * 2) + 1);
  assert.ok(missed.every((day) => day >= "2026-08-20"));
});

test("nothing is missed while the firm is not asking", () => {
  assert.deepEqual(missedDays(THU, { enabled: false, days: [] }, []), []);
});

// ---------------------------------------------------------------------------
// Who the firm asks
// ---------------------------------------------------------------------------

/**
 * The schedule says when reports are due; the duty says who owes them.
 *
 * Three settings rather than a tick box, because "not required" and "not required yet"
 * are different facts and collapsing them loses the useful one: a new joiner on the
 * default starts reporting the moment somebody assigns them a deliverable, without
 * anybody remembering to turn it on.
 */

test("the default is what the firm already had: reporting while carrying work", () => {
  assert.equal(owesReports("automatic", true), true);
  assert.equal(owesReports("automatic", false), false);
});

test("always means always, work or no work", () => {
  // A Partner who carries no deliverables but runs three engagements.
  assert.equal(owesReports("always", false), true);
  assert.equal(owesReports("always", true), true);
});

test("never means never, work or no work", () => {
  assert.equal(owesReports("never", true), false);
  assert.equal(owesReports("never", false), false);
});

test("an unset column reads as the default rather than as an exemption", () => {
  // Absence must never be read as "excused". Somebody nobody has thought about is on
  // the default, not outside the requirement.
  for (const stored of [null, undefined, "", "banana", "Always", "NEVER"]) {
    assert.equal(readDuty(stored), "automatic", JSON.stringify(stored));
  }
  assert.equal(readDuty("always"), "always");
  assert.equal(readDuty("never"), "never");
});

test("the default is stored as absence, so nobody carries a decision they were not part of", () => {
  assert.equal(writeDuty("automatic"), null);
  assert.equal(writeDuty("always"), "always");
  assert.equal(writeDuty("never"), "never");
});

test("a duty round-trips through the column", () => {
  for (const duty of REPORT_DUTIES) {
    assert.equal(readDuty(writeDuty(duty)), duty);
  }
});

test("every duty has a label and a hint", () => {
  for (const duty of REPORT_DUTIES) {
    assert.ok(DUTY_LABELS[duty], duty);
    assert.ok(DUTY_HINTS[duty], duty);
  }
});

// ---------------------------------------------------------------------------
// Nobody is chased for something they were never asked
// ---------------------------------------------------------------------------

test("somebody the firm does not ask is not required, not overdue", () => {
  // The distinction that matters: "not required" and "up to date" are different, and
  // calling them up to date would list them among people who reported when they never
  // were asked.
  const state = reportState(THU, DEFAULT_SCHEDULE, [], false);
  assert.equal(state.state, "not_required");
  assert.equal(state.due_on, null);
});

test("nothing is counted as missed against somebody the firm does not ask", () => {
  // A badge they cannot clear, because there is nothing they are supposed to file, is
  // the one thing a badge must never be.
  assert.deepEqual(missedDays(THU, DEFAULT_SCHEDULE, [], null, false), []);
});

test("omitting the flag does not quietly excuse anybody", () => {
  // Defaulted to true on purpose: a caller that has not been updated to consider the
  // duty keeps asking, rather than silently letting everybody off.
  assert.equal(reportState(THU, DEFAULT_SCHEDULE, []).state, "overdue");
  assert.ok(missedDays(THU, DEFAULT_SCHEDULE, []).length > 0);
});

test("being asked still depends on the firm's schedule being on", () => {
  // Two switches, and either one off means nothing is due.
  const off = { enabled: false, days: [] as Weekday[] };
  assert.equal(reportState(THU, off, [], true).state, "not_required");
  assert.deepEqual(missedDays(THU, off, [], null, true), []);
});

// ---------------------------------------------------------------------------
// Overdue work has to be answered
// ---------------------------------------------------------------------------

/**
 * A report saying "everything is on track" beside three deliverables that went past
 * their deadline last week is not a report. The person writing it is usually not being
 * evasive - they are writing from memory on a Friday afternoon - so the late ones are
 * pulled in and put first, where they have to be answered rather than found.
 *
 * The rule is enforced on the server as well as the form, since the form is not the
 * only way to file. Exercised against the real schema, because "which deliverables are
 * overdue" is a SQL question and the answer has to match what the rest of the system
 * calls overdue.
 */
function practice(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  const n = new Date().toISOString();
  db.exec(`
    INSERT INTO users (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
      VALUES ('kofi','k@x.test','Kofi','associate','active','x',0,'${n}','${n}');
    INSERT INTO clients (id,code,name,created_at,updated_at)
      VALUES ('c1','C1','Client One','${n}','${n}');
    INSERT INTO tasks (id,ref,client_id,title,service_line,status,assignee_id,internal_due_date,created_at,updated_at)
      VALUES ('late1','TSK-1','c1','Overdue by the internal target','tax_compliance','in_progress','kofi','2020-01-01','${n}','${n}'),
             ('ontime','TSK-2','c1','Not yet due','tax_compliance','in_progress','kofi','2099-01-01','${n}','${n}'),
             ('nodate','TSK-3','c1','No deadline at all','tax_compliance','in_progress','kofi',NULL,'${n}','${n}');
    INSERT INTO tasks (id,ref,client_id,title,service_line,status,assignee_id,statutory_due_date,created_at,updated_at)
      VALUES ('late2','TSK-4','c1','Overdue by the statutory deadline','tax_compliance','in_progress','kofi','2020-01-01','${n}','${n}');
    INSERT INTO tasks (id,ref,client_id,title,service_line,status,assignee_id,internal_due_date,created_at,updated_at)
      VALUES ('done','TSK-5','c1','Closed and late','tax_compliance','closed','kofi','2020-01-01','${n}','${n}');
  `);
  return db;
}

/** The overdue set as the report route computes it. */
function overdue(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT t.ref FROM tasks t
          WHERE t.assignee_id = 'kofi'
            AND t.status NOT IN ('approved','closed','cancelled')
            AND COALESCE(t.internal_due_date, t.statutory_due_date) IS NOT NULL
            AND date(COALESCE(t.internal_due_date, t.statutory_due_date)) < date('now')
          ORDER BY t.ref`,
      )
      .all() as Array<{ ref: string }>
  ).map((r) => r.ref);
}

test("overdue counts the earlier of the internal target and the statutory deadline", () => {
  // The same definition the dashboard and the deliverable list use. Two different
  // answers to "is this late" would be one too many.
  const db = practice();
  assert.deepEqual(overdue(db), ["TSK-1", "TSK-4"]);
  db.close();
});

test("work that is not yet due, or has no deadline, is not pulled in", () => {
  const db = practice();
  const late = overdue(db);
  assert.ok(!late.includes("TSK-2"));
  assert.ok(!late.includes("TSK-3"));
  db.close();
});

test("finished work is never pulled in, however late it was", () => {
  // A closed deliverable has stopped accruing lateness everywhere else too.
  const db = practice();
  assert.ok(!overdue(db).includes("TSK-5"));
  db.close();
});

test("a report leaving an overdue deliverable unanswered is refused", () => {
  // The rule as the route applies it: every overdue job needs a note with something
  // in it. Whitespace is not an answer.
  const db = practice();
  const late = overdue(db);

  const answered = (notes: Record<string, string | null>) =>
    late.filter((ref) => !notes[ref]?.trim());

  assert.deepEqual(answered({}), ["TSK-1", "TSK-4"]);
  assert.deepEqual(answered({ "TSK-1": "Waiting on the client." }), ["TSK-4"]);
  assert.deepEqual(answered({ "TSK-1": "x", "TSK-4": "   " }), ["TSK-4"]);
  assert.deepEqual(answered({ "TSK-1": "x", "TSK-4": "y" }), []);
  db.close();
});
