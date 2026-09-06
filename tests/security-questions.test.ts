/**
 * Security questions: normalisation, and what a usable set is.
 *
 * Two things are worth pinning down. Normalisation, because somebody who enrols
 * "St. Mary's Road" and later types "st marys road" has given the same answer, and a
 * system that refuses the second one has failed rather than protected anybody. And the
 * rules on a set, because the entire value of this factor rests on the set being three
 * or more real answers rather than "x" typed three times to get past a form.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_QUESTIONS,
  SECURITY_QUESTIONS_OFF,
  SECURITY_QUESTIONS_ON,
  SUGGESTED_QUESTIONS,
  answerIsUsable,
  describeSetProblem,
  normaliseAnswer,
  questionsEnabled,
  readQuestionsPolicy,
} from "../shared/security-questions";

const set = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    question: `Question number ${i + 1}?`,
    answer: `answer number ${i + 1}`,
  }));

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

test("an absent or damaged setting means off, never on", () => {
  for (const raw of [undefined, null, "", "  ", "yes", "true", "1", "ON!", "garbage"]) {
    assert.equal(
      readQuestionsPolicy(raw),
      SECURITY_QUESTIONS_OFF,
      `${JSON.stringify(raw)} was read as on`,
    );
  }
});

test("only the exact stored value turns it on", () => {
  assert.equal(readQuestionsPolicy("on"), SECURITY_QUESTIONS_ON);
  assert.equal(readQuestionsPolicy("  on  "), SECURITY_QUESTIONS_ON);
  assert.equal(questionsEnabled(readQuestionsPolicy("on")), true);
  assert.equal(questionsEnabled(readQuestionsPolicy("off")), false);
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

test("the same answer typed differently still matches", () => {
  const expected = "st marys road";
  for (const written of [
    "St. Mary's Road",
    "st marys road",
    "  ST   MARYS    ROAD  ",
    "St Mary's Road!",
  ]) {
    assert.equal(normaliseAnswer(written), expected, `${written} did not normalise`);
  }
});

test("accents are folded, so an answer typed without them still matches", () => {
  assert.equal(normaliseAnswer("Kofí"), normaliseAnswer("Kofi"));
  assert.equal(normaliseAnswer("École"), "ecole");
});

test("normalisation does not collapse genuinely different answers", () => {
  assert.notEqual(normaliseAnswer("Ford Escort"), normaliseAnswer("Ford Escorts"));
  assert.notEqual(normaliseAnswer("blue"), normaliseAnswer("blues"));
});

test("an answer of nothing but punctuation is not an answer", () => {
  assert.equal(normaliseAnswer("!!! ???"), "");
  assert.equal(answerIsUsable("!!!"), false);
  assert.equal(answerIsUsable("x"), false);
  assert.equal(answerIsUsable("Ford"), true);
});

// ---------------------------------------------------------------------------
// What makes a set usable
// ---------------------------------------------------------------------------

test("a set of three real questions is accepted", () => {
  assert.equal(describeSetProblem(set(MIN_QUESTIONS)), null);
});

test("fewer than three is refused", () => {
  assert.match(String(describeSetProblem(set(2))), /at least 3/);
  assert.notEqual(describeSetProblem([]), null);
});

test("more than the maximum is refused", () => {
  assert.notEqual(describeSetProblem(set(6)), null);
});

test("the same question twice is refused", () => {
  const entries = set(3);
  entries[1].question = entries[0].question;
  assert.match(String(describeSetProblem(entries)), /only be used once/);
});

test("one answer reused across questions is refused", () => {
  // Three questions with one answer is a single secret asked three times, which is the
  // whole thing this factor is meant not to be.
  const entries = set(3).map((entry) => ({ ...entry, answer: "the same answer" }));
  assert.match(String(describeSetProblem(entries)), /single secret/);
});

test("a one-character answer is refused however many questions there are", () => {
  const entries = set(3);
  entries[2].answer = "x";
  assert.match(String(describeSetProblem(entries)), /at least 4/);
});

test("an answer that merely repeats its question is refused", () => {
  const entries = set(3);
  entries[0].answer = entries[0].question;
  assert.match(String(describeSetProblem(entries)), /repeat its question/);
});

test("the suggested questions avoid what the portal already holds", () => {
  // Date of birth, school and mother's maiden name are all either on the HR record this
  // system stores or a matter of public record, which would make them worthless here.
  const joined = SUGGESTED_QUESTIONS.join(" ").toLowerCase();
  for (const banned of ["maiden name", "date of birth", "born", "school"]) {
    assert.equal(joined.includes(banned), false, `a suggestion mentions "${banned}"`);
  }
  assert.ok(SUGGESTED_QUESTIONS.length >= 5);
});
