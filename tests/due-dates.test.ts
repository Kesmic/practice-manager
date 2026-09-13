/**
 * How a deadline reads once the work is finished.
 *
 * The bug this pins: a deliverable closed on 11 August against a 23 August target was
 * delivered twelve days early, and the screen said "21 days late" - because the chip
 * measured the deadline against today rather than against the day the work was done, and
 * so accrued a day of lateness every morning after closure. Not merely stale; the
 * opposite of what happened.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { describeOutcome } from "../src/lib/format";
import { SETTLED_STATUSES, TASK_STATUSES, isSettled } from "../shared/workflow";

test("the case from the screenshot reads as met, not late", () => {
  // Internal target 23 Aug 2026, closed 11 Aug 2026 00:44.
  const outcome = describeOutcome("2026-08-23", "2026-08-11T00:44:00.000Z");
  assert.equal(outcome.text, "Met");
  assert.equal(outcome.tone, "met");
});

test("finishing after the deadline reports the overrun, and only the overrun", () => {
  assert.deepEqual(describeOutcome("2026-08-23", "2026-08-24T09:00:00.000Z"), {
    text: "1 day late",
    tone: "late",
  });
  assert.deepEqual(describeOutcome("2026-08-23", "2026-09-02T09:00:00.000Z"), {
    text: "10 days late",
    tone: "late",
  });
});

test("the figure does not move as time passes", () => {
  // The whole point: two readings of the same finished deliverable, taken a month apart,
  // give the same answer, because neither consults today's date.
  const first = describeOutcome("2026-08-23", "2026-08-30T12:00:00.000Z");
  const second = describeOutcome("2026-08-23", "2026-08-30T12:00:00.000Z");
  assert.deepEqual(first, second);
  assert.equal(first.text, "7 days late");
});

test("finishing on the deadline itself is met, whatever the time of day", () => {
  assert.equal(describeOutcome("2026-08-23", "2026-08-23T23:59:59.000Z").tone, "met");
  assert.equal(describeOutcome("2026-08-23", "2026-08-23T00:00:00.000Z").tone, "met");
});

test("no deadline, or no completion date, produces no claim either way", () => {
  // A cancelled deliverable has no completion date. Saying "Met" would claim an
  // achievement; saying "late" would chase work nobody is doing.
  assert.equal(describeOutcome("2026-08-23", null).tone, "none");
  assert.equal(describeOutcome(null, "2026-08-11T00:44:00.000Z").tone, "none");
  assert.equal(describeOutcome(undefined, undefined).tone, "none");
  assert.equal(describeOutcome("not-a-date", "2026-08-11T00:44:00.000Z").tone, "none");
});

test("the settled statuses are exactly the ones the server excludes from overdue", () => {
  // worker/routes/task-sql.ts: status NOT IN ('approved','closed','cancelled').
  // If these two drift, a dashboard reporting nothing overdue will sit beside a
  // deliverable stamped "21 days late".
  assert.deepEqual([...SETTLED_STATUSES].sort(), ["approved", "cancelled", "closed"]);
  for (const status of SETTLED_STATUSES) {
    assert.ok(TASK_STATUSES.includes(status), `${status} is not a real status`);
  }
});

test("live work is not settled, so it keeps counting down", () => {
  for (const status of ["draft", "not_started", "in_progress", "submitted", "under_review", "rework", "on_hold", "awaiting_client"] as const) {
    assert.equal(isSettled(status), false, `${status} was treated as settled`);
  }
  for (const status of ["approved", "closed", "cancelled"] as const) {
    assert.equal(isSettled(status), true, `${status} was not treated as settled`);
  }
});
