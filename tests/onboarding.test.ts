/**
 * The onboarding programme: who does what, when it falls due, and where somebody is.
 *
 * Three things pinned here, each of which was wrong at some point while this was built.
 *
 * **The two programmes must not drift.** An employee and an Associate Consultant differ
 * in exactly one step - how their tax and pension are handled. Everything else is
 * deliberately shared, and a test that only counted steps would not notice somebody
 * quietly dropping the contract or the bank details from the Associate's list.
 *
 * **A stage with no start date has no dates.** Counting from today instead would put
 * every step in the past the moment an incomplete record is opened.
 *
 * **"Where you have got to" is measured by the person's own steps.** Measuring across
 * everything told a new joiner on their first morning that they were at "Before you
 * start" - a stage made entirely of things the firm does - and left them looking for
 * something to act on that was never theirs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STAGES,
  STAGE_SPECS,
  contractTemplateFor,
  isEngagedNotEmployed,
  programmeFor,
  stageDueDate,
  stageIndex,
  stageProgress,
} from "../shared/onboarding";
import { EMPLOYMENT_TYPES } from "../shared/hr";

// ---------------------------------------------------------------------------
// Which programme somebody gets
// ---------------------------------------------------------------------------

test("every employment type the system offers has a programme", () => {
  // A type added to shared/hr without a thought here would otherwise hand somebody an
  // empty checklist on their first morning.
  for (const type of EMPLOYMENT_TYPES) {
    const programme = programmeFor(type);
    assert.ok(programme.length > 0, `${type} has no steps`);
    assert.ok(contractTemplateFor(type).length > 0, `${type} has no contract template`);
  }
});

test("employees are registered for payroll; Associates are not", () => {
  const employed = programmeFor("permanent").map((s) => s.label);
  const engaged = programmeFor("consultant").map((s) => s.label);

  assert.ok(employed.includes("Register for payroll and statutory deductions"));
  assert.ok(!engaged.includes("Register for payroll and statutory deductions"));

  assert.ok(engaged.includes("Confirm tax registration and invoicing arrangements"));
  assert.ok(!employed.includes("Confirm tax registration and invoicing arrangements"));
});

test("the two programmes differ in that one step and nothing else", () => {
  // The point of the whole module: an Associate is still paid, still signs a contract,
  // still acknowledges the handbook, still gets objectives and a review.
  const employed = new Set(programmeFor("permanent").map((s) => s.label));
  const engaged = new Set(programmeFor("consultant").map((s) => s.label));

  const onlyEmployed = [...employed].filter((l) => !engaged.has(l));
  const onlyEngaged = [...engaged].filter((l) => !employed.has(l));

  assert.deepEqual(onlyEmployed, ["Register for payroll and statutory deductions"]);
  assert.deepEqual(onlyEngaged, ["Confirm tax registration and invoicing arrangements"]);
});

test("an Associate still signs a contract, is paid, and is reviewed", () => {
  const engaged = programmeFor("consultant").map((s) => s.label);
  assert.ok(engaged.includes("Read and sign your contract"));
  assert.ok(engaged.includes("Give your bank details"));
  assert.ok(engaged.includes("Read and acknowledge every policy in the handbook"));
  assert.ok(engaged.includes("Complete the annual independence declaration"));
  assert.ok(engaged.includes("Set objectives and diarise the first review"));
});

test("the contract template follows the kind of engagement", () => {
  assert.equal(contractTemplateFor("permanent"), "Contract of Employment");
  assert.equal(contractTemplateFor("fixed_term"), "Contract of Employment");
  assert.equal(contractTemplateFor("intern"), "Contract of Employment");
  assert.equal(contractTemplateFor("consultant"), "Associate Consultant Agreement");
  assert.equal(contractTemplateFor("contractor"), "Associate Consultant Agreement");

  assert.equal(isEngagedNotEmployed("consultant"), true);
  assert.equal(isEngagedNotEmployed("permanent"), false);
});

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

test("the programme reads in the order it happens", () => {
  for (const type of EMPLOYMENT_TYPES) {
    const order = programmeFor(type).map((s) => stageIndex(s.stage));
    const sorted = [...order].sort((a, b) => a - b);
    assert.deepEqual(order, sorted, `${type} is out of order`);
  }
});

test("every step names a stage the module knows about", () => {
  for (const type of EMPLOYMENT_TYPES) {
    for (const step of programmeFor(type)) {
      assert.ok(STAGES.includes(step.stage), `${step.label} is in no stage`);
      assert.ok(step.owner === "employee" || step.owner === "hr");
    }
  }
});

test("nothing is asked of the new joiner before they arrive", () => {
  // "Before you start" is the firm's own preparation. A step of the person's own filed
  // there would be shown to somebody who has no account yet.
  for (const type of EMPLOYMENT_TYPES) {
    const theirs = programmeFor(type).filter(
      (s) => s.stage === "before_start" && s.owner === "employee",
    );
    assert.deepEqual(theirs, [], `${type} asks the joiner to act before they start`);
  }
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test("stages fall due around the start date", () => {
  assert.equal(stageDueDate("before_start", "2026-10-01"), "2026-09-30");
  assert.equal(stageDueDate("first_signin", "2026-10-01"), "2026-10-01");
  assert.equal(stageDueDate("first_week", "2026-10-01"), "2026-10-06");
  assert.equal(stageDueDate("first_month", "2026-10-01"), "2026-10-31");
});

test("no start date means no dates, rather than dates counted from today", () => {
  for (const stage of STAGES) {
    assert.equal(stageDueDate(stage, null), null);
    assert.equal(stageDueDate(stage, ""), null);
    assert.equal(stageDueDate(stage, undefined), null);
  }
});

test("a start date that is not a date yields no dates", () => {
  assert.equal(stageDueDate("first_week", "not a date"), null);
});

test("the first review is pinned to the probation date, not to an offset", () => {
  assert.equal(STAGE_SPECS.first_review.offsetDays, null);
  assert.equal(stageDueDate("first_review", "2026-10-01", "2026-12-31"), "2026-12-31");
  // No probation date recorded: no date, even though a start date exists.
  assert.equal(stageDueDate("first_review", "2026-10-01", null), null);
  // And it does not need a start date to answer.
  assert.equal(stageDueDate("first_review", null, "2026-12-31"), "2026-12-31");
});

test("the stages run forwards in time", () => {
  const dated = STAGES.map((s) => stageDueDate(s, "2026-10-01", "2026-12-31")).filter(
    (d): d is string => d !== null,
  );
  assert.deepEqual(dated, [...dated].sort());
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

const item = (stage: string, owner: string, done = false) => ({
  stage,
  owner,
  is_done: (done ? 1 : 0) as 0 | 1,
});

test("a new joiner on their first morning is at their first sign-in", () => {
  // The bug: measuring across every step said "Before you start", a stage made entirely
  // of the firm's own work, and gave the person nothing they could act on.
  const { current } = stageProgress([
    item("before_start", "hr"),
    item("before_start", "hr"),
    item("first_signin", "employee"),
    item("first_week", "employee"),
  ]);
  assert.equal(current, "first_signin");
});

test("finishing a later step does not move somebody past an earlier one", () => {
  const { current } = stageProgress([
    item("first_signin", "employee"),
    item("first_week", "employee", true),
  ]);
  assert.equal(current, "first_signin");
});

test("with nothing of their own outstanding, they are waiting on the firm", () => {
  const { current } = stageProgress([
    item("before_start", "hr"),
    item("first_signin", "employee", true),
    item("first_review", "hr"),
  ]);
  assert.equal(current, "before_start");
});

test("a finished programme is at no stage at all", () => {
  const { current } = stageProgress([
    item("before_start", "hr", true),
    item("first_signin", "employee", true),
  ]);
  assert.equal(current, null);
});

test("each stage counts the person's own steps apart from the firm's", () => {
  const { stages } = stageProgress([
    item("first_signin", "employee", true),
    item("first_signin", "employee"),
    item("first_signin", "hr", true),
  ]);
  const signin = stages.find((s) => s.stage === "first_signin")!;
  assert.equal(signin.total, 3);
  assert.equal(signin.done, 2);
  assert.equal(signin.own_total, 2);
  assert.equal(signin.own_done, 1);
  assert.equal(signin.complete, false);
});

test("an empty stage is not complete", () => {
  // Otherwise a programme that simply has no first-month step would read as finished.
  const { stages } = stageProgress([]);
  for (const s of stages) assert.equal(s.complete, false);
});

test("progress reports every stage, including ones with no steps", () => {
  const { stages } = stageProgress([item("first_signin", "employee")]);
  assert.deepEqual(
    stages.map((s) => s.stage),
    [...STAGES],
  );
});

test("done is read from either the database's 1 or a plain true", () => {
  const { stages } = stageProgress([
    { stage: "first_week", owner: "employee", is_done: true },
    { stage: "first_week", owner: "employee", is_done: 1 },
  ]);
  const week = stages.find((s) => s.stage === "first_week")!;
  assert.equal(week.done, 2);
  assert.equal(week.complete, true);
});

test("progress carries the dates through, so the caller need not recompute them", () => {
  const { stages } = stageProgress(
    [item("first_week", "employee")],
    "2026-10-01",
    "2026-12-31",
  );
  assert.equal(stages.find((s) => s.stage === "first_week")!.due, "2026-10-06");
  assert.equal(stages.find((s) => s.stage === "first_review")!.due, "2026-12-31");
});
