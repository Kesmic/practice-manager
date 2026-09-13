/**
 * Completing a contract from what the firm knows.
 *
 * The most valuable test here is the one that reads the actual seeded templates out of
 * the migrations and checks the field registry against them. Everything else in this
 * feature is only as good as that correspondence: a placeholder in the template with no
 * field behind it is one that will still be a bracket when somebody signs, and a field
 * with no placeholder is a question asked of an administrator for no reason.
 *
 * Two real defects are pinned below, both found by writing that test.
 *
 * `[DAYS]` appeared twice in the contract of employment with two different meanings -
 * the days of the working week in clause 4, and the annual leave entitlement in clause
 * 6. One placeholder cannot hold both, so whichever value was substituted, one of the
 * two clauses was going to be wrong.
 *
 * `[PROBATION NOTICE]` was wrapped across a line break, so the stored text held
 * "[PROBATION" and "NOTICE]" on separate lines. Nothing scanning for a placeholder
 * would find it, and nobody proofreading the rendered document would see anything odd.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  CONTRACT_FIELDS,
  MANUAL_TOKENS,
  fieldFor,
  fieldsFor,
  fillContract,
  groupedFields,
  templateFor,
  tokensIn,
} from "../shared/contract-fields";
import { EMPLOYMENT_TYPES } from "../shared/hr";
import { presentDate } from "../worker/contract-fields";

// ---------------------------------------------------------------------------
// The templates as the firm will actually have them
// ---------------------------------------------------------------------------

/**
 * Applies every migration to an in-memory database and reads the two templates back.
 *
 * Reading the SQL as text would not do. The Associate agreement is rewritten by a later
 * migration than the one that seeds it, and the contract of employment is amended by a
 * later one still - so the only honest answer to "what does the template say" is the
 * one you get by running the migrations in order, which is also what the deployment
 * does.
 */
function seededTemplates(): Record<string, string> {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  const rows = db
    .prepare(
      `SELECT id, body FROM documents WHERE id IN ('tpl_contract', 'tpl_associate_contract')`,
    )
    .all() as Array<{ id: string; body: string }>;
  db.close();

  const out: Record<string, string> = {};
  for (const row of rows) out[row.id] = row.body;
  return out;
}

const TEMPLATES = seededTemplates();
const EMPLOYMENT_BODY = TEMPLATES.tpl_contract;
const ASSOCIATE_BODY = TEMPLATES.tpl_associate_contract;

test("the migrations apply cleanly and both templates are seeded", () => {
  assert.ok(EMPLOYMENT_BODY, "the contract of employment is missing");
  assert.ok(ASSOCIATE_BODY, "the Associate Consultant Agreement is missing");
});

// ---------------------------------------------------------------------------
// The registry against the templates
// ---------------------------------------------------------------------------

test("every placeholder in the contract of employment has a field behind it", () => {
  for (const token of tokensIn(EMPLOYMENT_BODY)) {
    if (MANUAL_TOKENS.has(token)) continue;
    const field = fieldFor(token);
    assert.ok(field, `[${token}] is in the template with nothing to fill it`);
    assert.ok(
      field.templates.includes("employment"),
      `[${token}] is in the employment template but the registry does not say so`,
    );
  }
});

test("every placeholder in the Associate agreement has a field behind it", () => {
  for (const token of tokensIn(ASSOCIATE_BODY)) {
    if (MANUAL_TOKENS.has(token)) continue;
    const field = fieldFor(token);
    assert.ok(field, `[${token}] is in the template with nothing to fill it`);
    assert.ok(
      field.templates.includes("associate"),
      `[${token}] is in the Associate template but the registry does not say so`,
    );
  }
});

test("no field asks for something neither template uses", () => {
  const inTemplates = new Set([
    ...tokensIn(EMPLOYMENT_BODY),
    ...tokensIn(ASSOCIATE_BODY),
  ]);
  for (const field of CONTRACT_FIELDS) {
    assert.ok(
      inTemplates.has(field.token),
      `${field.label} asks for [${field.token}], which no template contains`,
    );
  }
});

test("no placeholder is left wrapped across a line break", () => {
  // The defect: "[PROBATION\nNOTICE]" is invisible to anything looking for a
  // placeholder, and looks perfectly normal in the rendered document.
  for (const [id, body] of Object.entries(TEMPLATES)) {
    assert.ok(!/\[[A-Z][A-Z0-9 '’.,-]*\n/.test(body), `${id} splits a placeholder`);
  }
});

test("the contract of employment no longer uses one placeholder for two things", () => {
  // The defect: [DAYS] meant the working week in clause 4 and the leave entitlement in
  // clause 6. Whichever value went in, one clause was wrong.
  assert.ok(!tokensIn(EMPLOYMENT_BODY).includes("DAYS"));
  assert.ok(EMPLOYMENT_BODY.includes("[WORKING DAYS]"));
  assert.ok(EMPLOYMENT_BODY.includes("[LEAVE DAYS]"));
});

// ---------------------------------------------------------------------------
// The registry on its own terms
// ---------------------------------------------------------------------------

test("no two fields claim the same placeholder", () => {
  const seen = new Set<string>();
  for (const field of CONTRACT_FIELDS) {
    assert.ok(!seen.has(field.token), `[${field.token}] is defined twice`);
    seen.add(field.token);
  }
});

test("a record field says where it is read from, and nothing else does", () => {
  for (const field of CONTRACT_FIELDS) {
    if (field.supplier === "record") {
      assert.ok(field.from, `${field.label} is read from the record but does not say where`);
    } else {
      assert.equal(field.from, undefined, `${field.label} is not a record field`);
    }
  }
});

test("only a firm-wide term carries a starting value", () => {
  // A starting value on a per-person field would put the same answer in everybody's
  // contract, which is the opposite of what a per-person field is for.
  for (const field of CONTRACT_FIELDS) {
    if (field.fallback) assert.equal(field.supplier, "firm", field.label);
  }
});

test("every employment type resolves to a template with fields", () => {
  for (const type of EMPLOYMENT_TYPES) {
    const fields = fieldsFor(templateFor(type));
    assert.ok(fields.length > 0, `${type} has no contract fields`);
  }
});

test("an Associate is issued the Associate agreement, an employee is not", () => {
  assert.equal(templateFor("consultant"), "associate");
  assert.equal(templateFor("contractor"), "associate");
  assert.equal(templateFor("permanent"), "employment");
  assert.equal(templateFor("intern"), "employment");
});

test("the three things a new joiner supplies are marked as theirs", () => {
  // These are the fields an administrator may legitimately leave blank, because the
  // first-sign-in form asks for them. Marked wrongly, an administrator is sent chasing
  // something that was going to answer itself.
  for (const token of ["ASSOCIATE ADDRESS", "ASSOCIATE TIN", "ASSOCIATE GHANA CARD NUMBER"]) {
    assert.equal(fieldFor(token)?.from?.filledBy, "employee", token);
  }
});

test("pay and job title come from the record rather than being typed again", () => {
  for (const token of ["JOB TITLE", "AMOUNT", "START DATE", "EMPLOYEE FULL NAME"]) {
    assert.equal(fieldFor(token)?.supplier, "record", token);
  }
});

test("grouping keeps every field and repeats no heading", () => {
  for (const template of ["employment", "associate"] as const) {
    const groups = groupedFields(template);
    const headings = groups.map((g) => g.group);
    assert.equal(new Set(headings).size, headings.length, "a heading is repeated");
    assert.equal(
      groups.reduce((n, g) => n + g.fields.length, 0),
      fieldsFor(template).length,
    );
  }
});

// ---------------------------------------------------------------------------
// Reading placeholders out of text
// ---------------------------------------------------------------------------

test("a markdown link is not a placeholder", () => {
  // A pattern loose enough to catch [label](url) would mangle any document using one.
  assert.deepEqual(tokensIn("See [the handbook](https://example.test/h)."), []);
});

test("ordinary bracketed prose is not a placeholder", () => {
  assert.deepEqual(tokensIn("The Firm [as defined above] shall pay."), []);
});

test("a placeholder is found once however often it appears", () => {
  assert.deepEqual(tokensIn("[NOTICE DAYS] days, being [NOTICE DAYS] days."), [
    "NOTICE DAYS",
  ]);
});

// ---------------------------------------------------------------------------
// Filling one in
// ---------------------------------------------------------------------------

test("a value replaces every occurrence of its placeholder", () => {
  const result = fillContract("[A] and [A] and [B]", { A: "one", B: "two" });
  assert.equal(result.text, "one and one and two");
  assert.deepEqual(result.filled, ["A", "B"]);
});

test("a blank value leaves the bracket alone", () => {
  // The defect this guards against: substituting "" produces "holding Taxpayer
  // Identification Number and Ghana Card number ...", which is grammatical, reads as
  // finished, and is wrong.
  for (const blank of ["", "   ", null, undefined]) {
    const result = fillContract("Number [ASSOCIATE TIN] and", { "ASSOCIATE TIN": blank });
    assert.equal(result.text, "Number [ASSOCIATE TIN] and");
    assert.deepEqual(result.filled, []);
  }
});

test("what is left is reported, split by whether anything will ever fill it", () => {
  const result = fillContract("[NOTICE DAYS] and [CLIENT NAME] and [WHATEVER]", {});
  assert.deepEqual(result.outstanding, ["NOTICE DAYS"]);
  assert.deepEqual(result.manual.sort(), ["CLIENT NAME", "WHATEVER"]);
});

test("the schedules and the signature date are never counted as outstanding", () => {
  // Reporting them would train whoever issues contracts to ignore the sentence, which
  // is worse than not reporting anything at all.
  const result = fillContract("- [CLIENT NAME] - [TIER] tier\n\nDate: [DATE]", {});
  assert.deepEqual(result.outstanding, []);
});

test("values are trimmed on the way in", () => {
  assert.equal(fillContract("[A]", { A: "  spaced  " }).text, "spaced");
});

test("the whole Associate agreement fills from a complete set of values", () => {
  const values: Record<string, string> = {};
  for (const field of fieldsFor("associate")) values[field.token] = `«${field.token}»`;

  const result = fillContract(ASSOCIATE_BODY, values);
  assert.deepEqual(
    result.outstanding,
    [],
    `still outstanding: ${result.outstanding.join(", ")}`,
  );
  // Only the schedule entries and the signature date should survive.
  assert.deepEqual(result.manual.sort(), ["CLIENT NAME", "DATE", "TIER"]);
});

test("the whole contract of employment fills from a complete set of values", () => {
  const values: Record<string, string> = {};
  for (const field of fieldsFor("employment")) values[field.token] = `«${field.token}»`;

  const result = fillContract(EMPLOYMENT_BODY, values);
  assert.deepEqual(result.outstanding, []);
  assert.deepEqual(result.manual, []);
});

// ---------------------------------------------------------------------------
// How a date reads in a contract
// ---------------------------------------------------------------------------

test("a date is written out rather than left as an ISO string", () => {
  // No contract has ever commenced on 2026-10-01. The stored form is right for a
  // database and wrong for an instrument, and the form that collects it still needs
  // the ISO string, so the two are kept apart.
  assert.equal(presentDate("2026-10-01"), "1 October 2026");
  assert.equal(presentDate("2026-12-31"), "31 December 2026");
  assert.equal(presentDate("2027-01-09"), "9 January 2027");
});

test("anything that is not a plain date is left exactly as it was typed", () => {
  for (const value of [
    "the first Monday of October",
    "2026-10",
    "01/10/2026",
    "",
    "2026-13-01",
  ]) {
    assert.equal(presentDate(value), value);
  }
});

test("surrounding space does not stop a date being recognised", () => {
  assert.equal(presentDate(" 2026-10-01 "), "1 October 2026");
});
