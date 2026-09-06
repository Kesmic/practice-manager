/**
 * Statutory deadline arithmetic.
 *
 * This is the calculation the firm's filing calendar is built out of, and getting it
 * wrong does not look like a bug - it looks like a return filed late. The cases below
 * are the ones that actually break naive date code: month ends, leap years, and a
 * deadline day that does not exist in the month it lands in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  addMonths,
  advancePeriodLabel,
  parseDueDateRule,
  periodLabel,
  statutoryDueDate,
} from "../worker/dates";

test("adding months clamps to the length of the target month", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29"); // leap year
  assert.equal(addMonths("2026-03-31", 1), "2026-04-30");
  assert.equal(addMonths("2026-01-15", 1), "2026-02-15");
});

test("adding months crosses year boundaries in both directions", () => {
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-01-15", -1), "2025-12-15");
  assert.equal(addMonths("2026-06-30", 12), "2027-06-30");
  assert.equal(addMonths("2026-06-30", -12), "2025-06-30");
});

test("adding days crosses a leap day", () => {
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("a statutory rule shifts the period end and clamps an impossible day", () => {
  // VAT: due the 15th of the month after the period.
  assert.equal(statutoryDueDate("2026-03-31", { month_offset: 1, day: 15 }), "2026-04-15");
  // The 31st, applied to a month that has 30 days.
  assert.equal(statutoryDueDate("2026-03-31", { month_offset: 1, day: 31 }), "2026-04-30");
  // Corporate tax: four months after a December year end.
  assert.equal(statutoryDueDate("2026-12-31", { month_offset: 4, day: 30 }), "2027-04-30");
  // A day below the first of the month is pulled up rather than rolling backwards.
  assert.equal(statutoryDueDate("2026-03-31", { month_offset: 0, day: 0 }), "2026-03-01");
});

test("a malformed rule is refused rather than guessed at", () => {
  assert.equal(parseDueDateRule(null), null);
  assert.equal(parseDueDateRule("not json"), null);
  assert.equal(parseDueDateRule('{"day": 15}'), null);
  assert.equal(parseDueDateRule('{"month_offset": "1", "day": 15}'), null);
  assert.deepEqual(parseDueDateRule('{"month_offset": 1, "day": 15}'), {
    month_offset: 1,
    day: 15,
  });
});

test("period labels describe the period, not the filing date", () => {
  assert.equal(periodLabel("2026-03-31", "monthly"), "Mar 2026");
  assert.equal(periodLabel("2026-03-31", "quarterly"), "2026-Q1");
  assert.equal(periodLabel("2026-12-31", "quarterly"), "2026-Q4");
  assert.equal(periodLabel("2026-06-30", "semiannual"), "2026-H1");
  assert.equal(periodLabel("2026-07-31", "semiannual"), "2026-H2");
  assert.equal(periodLabel("2026-12-31", "annual"), "FY2026");
});

test("advancing a label rolls the year over and refuses what it cannot read", () => {
  assert.equal(advancePeriodLabel("Dec 2026", "monthly"), "Jan 2027");
  assert.equal(advancePeriodLabel("2026-Q4", "quarterly"), "2027-Q1");
  assert.equal(advancePeriodLabel("FY2026", "annual"), "FY2027");
  assert.equal(advancePeriodLabel("Mar 2026", "none"), null);
  assert.equal(advancePeriodLabel("first half, ish", "monthly"), null);
});
