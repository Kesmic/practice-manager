/**
 * Probation and annual reviews.
 *
 * A performance record matters at exactly one kind of moment - somebody not confirmed at
 * the end of probation, a promotion between two candidates, a dismissal challenged - and
 * never during a good year. So what is pinned here is the set of rules that decide
 * whether the record is worth anything when that moment arrives: who may write one, who
 * may read one, and what has to be filled in before it is put in front of a person.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CRITERIA,
  MIN_REVIEWER_GRADE,
  RATINGS,
  RATING_LABELS,
  RATING_SCORE,
  canReadReview,
  canReview,
  criteriaFor,
  criterionByKey,
  describeShareProblem,
} from "../shared/performance";
import { ROLES, type Role } from "../shared/workflow";

const subject = { id: "u-subject", line_manager_id: "u-manager" };
const manager = { id: "u-manager", role: "manager" as Role };
const stranger = { id: "u-other", role: "manager" as Role };
const partner = { id: "u-partner", role: "partner" as Role };

// ---------------------------------------------------------------------------
// Who may write one
// ---------------------------------------------------------------------------

test("a line manager of manager grade may review their report", () => {
  assert.equal(canReview(manager, subject, false), true);
});

test("an unrelated manager may not, whatever their grade", () => {
  // "Manager grade" is not a need to know. A manager elsewhere in the firm has no
  // standing to record a judgement about somebody they do not work with.
  assert.equal(canReview(stranger, subject, false), false);
  assert.equal(canReview({ ...stranger, role: "partner" }, subject, false), false);
});

test("an HR administrator may review anybody but themselves", () => {
  assert.equal(canReview(partner, subject, true), true);
  assert.equal(canReview(partner, { id: partner.id, line_manager_id: null }, true), false);
});

test("nobody reviews themselves, at any grade, with no override", () => {
  for (const role of ROLES) {
    const self = { id: "u-self", role };
    assert.equal(
      canReview(self, { id: "u-self", line_manager_id: "u-self" }, true),
      false,
      `${role} was allowed to review themselves`,
    );
  }
});

test("a line manager below the reviewing grade cannot review", () => {
  // Somebody can be named as a line manager before they hold the grade that reviews.
  const junior = { id: "u-manager", role: "senior_associate" as Role };
  assert.equal(canReview(junior, subject, false), false);
  assert.equal(MIN_REVIEWER_GRADE, "manager");
});

// ---------------------------------------------------------------------------
// Who may read one
// ---------------------------------------------------------------------------

test("a draft is invisible to the person it is about", () => {
  // A judgement still being formed is not yet a judgement, and reading half of one is
  // worse than reading none.
  const self = { id: subject.id, role: "associate" as Role };
  assert.equal(canReadReview(self, subject, "draft", false), false);
  assert.equal(canReadReview(self, subject, "shared", false), true);
  assert.equal(canReadReview(self, subject, "complete", false), true);
});

test("a peer cannot read a review at any stage", () => {
  for (const status of ["draft", "shared", "complete"] as const) {
    assert.equal(canReadReview(stranger, subject, status, false), false, status);
  }
});

test("whoever may write one may read it at every stage", () => {
  for (const status of ["draft", "shared", "complete"] as const) {
    assert.equal(canReadReview(manager, subject, status, false), true, status);
  }
});

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

test("supervision is rated only at grades that supervise", () => {
  // Rating an Associate on supervising juniors is rating them on a job they do not have.
  const keys = (role: Role) => criteriaFor(role).map((c) => c.key);
  assert.equal(keys("associate").includes("supervision"), false);
  assert.equal(keys("senior_associate").includes("supervision"), true);
  assert.equal(keys("partner").includes("supervision"), true);
});

test("every criterion has a key, a label and something to judge", () => {
  const keys = new Set<string>();
  for (const c of CRITERIA) {
    assert.ok(c.key && c.label && c.detail, `${c.key} is incomplete`);
    assert.equal(keys.has(c.key), false, `${c.key} is declared twice`);
    keys.add(c.key);
    assert.equal(criterionByKey(c.key)?.label, c.label);
  }
});

test("an unknown criterion key resolves to nothing", () => {
  assert.equal(criterionByKey("made_up"), undefined);
});

// ---------------------------------------------------------------------------
// The scale
// ---------------------------------------------------------------------------

test("the scale has no middle box to hide in", () => {
  // Four points, deliberately. A five-point scale collapses into everybody scoring
  // three, which records nothing and tells the person nothing they can act on.
  assert.equal(RATINGS.length, 4);
  assert.equal(RATINGS.length % 2, 0);
  for (const r of RATINGS) assert.ok(RATING_LABELS[r], `${r} has no label`);
});

test("the scale is ordered, so it can be aggregated later", () => {
  const scores = RATINGS.map((r) => RATING_SCORE[r]);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
  assert.equal(new Set(scores).size, RATINGS.length);
});

// ---------------------------------------------------------------------------
// What must be finished before somebody reads it
// ---------------------------------------------------------------------------

const applicable = criteriaFor("associate");
const allRated = applicable.map((c) => ({ criterion: c.key, rating: "meets" as const }));

test("an unrated criterion blocks sharing, and is named", () => {
  const problem = describeShareProblem({
    kind: "annual",
    overall: "meets",
    ratings: allRated.slice(0, -1),
    applicable,
    probation_decision: null,
    probation_extend_to: null,
  });
  assert.match(String(problem), /Rate every criterion first/);
  assert.match(String(problem), new RegExp(applicable[applicable.length - 1].label));
});

test("a missing overall outcome blocks sharing", () => {
  assert.match(
    String(
      describeShareProblem({
        kind: "annual",
        overall: null,
        ratings: allRated,
        applicable,
        probation_decision: null,
        probation_extend_to: null,
      }),
    ),
    /overall outcome/,
  );
});

test("a complete annual review may be shared", () => {
  assert.equal(
    describeShareProblem({
      kind: "annual",
      overall: "meets",
      ratings: allRated,
      applicable,
      probation_decision: null,
      probation_extend_to: null,
    }),
    null,
  );
});

test("a probation review has to decide, and an extension needs a date", () => {
  const base = {
    kind: "probation" as const,
    overall: "meets" as const,
    ratings: allRated,
    applicable,
  };
  assert.match(
    String(describeShareProblem({ ...base, probation_decision: null, probation_extend_to: null })),
    /whether the person is confirmed/,
  );
  assert.match(
    String(
      describeShareProblem({ ...base, probation_decision: "extend", probation_extend_to: null }),
    ),
    /needs a date/,
  );
  assert.equal(
    describeShareProblem({
      ...base,
      probation_decision: "extend",
      probation_extend_to: "2027-03-31",
    }),
    null,
  );
  // Confirming needs no date.
  assert.equal(
    describeShareProblem({ ...base, probation_decision: "confirm", probation_extend_to: null }),
    null,
  );
});
