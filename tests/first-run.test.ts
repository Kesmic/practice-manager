/**
 * What a new joiner has to finish, and in which order.
 *
 * The firm asked for onboarding first, then the password, then two-step sign-in - so
 * that somebody's first morning starts on the page explaining what is coming rather
 * than on a bare password form.
 *
 * The property that actually matters here is that the server and the browser agree.
 * The Worker uses this module to decide what a request may reach; the browser uses it
 * to decide where to send somebody. If those came apart, a person could be routed to a
 * screen the server was not going to let them past - a loop with no way out and no
 * error message to explain it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FIRST_RUN_MESSAGES,
  FIRST_RUN_PROMPTS,
  FIRST_RUN_STEPS,
  firstRunDestination,
  nextFirstRunStep,
  stepNumber,
  type FirstRunState,
} from "../shared/first-run";
import { programmeFor } from "../shared/onboarding";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const state = (over: Partial<FirstRunState> = {}): FirstRunState => ({
  onboarding_done: false,
  password_set: false,
  two_factor_ready: false,
  ...over,
});

// ---------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------

test("onboarding comes first, before the password", () => {
  // The whole point of the change. A new joiner meets the page that explains what is
  // coming, not a password form with no context.
  assert.equal(nextFirstRunStep(state()), "onboarding");
});

test("the password is asked for once the onboarding is in", () => {
  assert.equal(nextFirstRunStep(state({ onboarding_done: true })), "password");
});

test("two-step sign-in is last", () => {
  assert.equal(
    nextFirstRunStep(state({ onboarding_done: true, password_set: true })),
    "two_factor",
  );
});

test("nothing is outstanding once all three are done", () => {
  assert.equal(
    nextFirstRunStep(
      state({ onboarding_done: true, password_set: true, two_factor_ready: true }),
    ),
    null,
  );
});

test("a later step does not jump the queue when an earlier one is outstanding", () => {
  // Somebody who happened to set a password before finishing their details is still
  // asked for the details first, so the sequence reads the same for everybody.
  assert.equal(
    nextFirstRunStep(state({ password_set: true, two_factor_ready: true })),
    "onboarding",
  );
  assert.equal(
    nextFirstRunStep(state({ onboarding_done: true, two_factor_ready: true })),
    "password",
  );
});

test("somebody whose grade needs no second factor is finished after two steps", () => {
  // two_factor_ready is true for them, because there is nothing to be ready for.
  assert.equal(
    nextFirstRunStep(
      state({ onboarding_done: true, password_set: true, two_factor_ready: true }),
    ),
    null,
  );
});

test("the sequence is exactly these three, in this order", () => {
  assert.deepEqual([...FIRST_RUN_STEPS], ["onboarding", "password", "two_factor"]);
});

// ---------------------------------------------------------------------------
// Where each step sends somebody
// ---------------------------------------------------------------------------

test("onboarding goes to the onboarding page; the other two to the account screen", () => {
  assert.equal(firstRunDestination("onboarding"), "/onboarding");
  assert.equal(firstRunDestination("password"), "/account");
  assert.equal(firstRunDestination("two_factor"), "/account");
});

test("every step has somewhere to send somebody", () => {
  // A step with no destination would route to undefined and blank the screen.
  for (const step of FIRST_RUN_STEPS) {
    const to = firstRunDestination(step);
    assert.ok(to.startsWith("/"), step);
  }
});

test("every step has a refusal message and an on-screen prompt", () => {
  for (const step of FIRST_RUN_STEPS) {
    assert.ok(FIRST_RUN_MESSAGES[step], step);
    assert.ok(FIRST_RUN_PROMPTS[step].title, step);
    assert.ok(FIRST_RUN_PROMPTS[step].detail, step);
  }
});

test("the step numbers run from one, in order", () => {
  assert.deepEqual(
    FIRST_RUN_STEPS.map(stepNumber),
    [1, 2, 3],
  );
});

// ---------------------------------------------------------------------------
// The property that keeps the two sides together
// ---------------------------------------------------------------------------

test("the destination for a step is somewhere the server still lets them reach", () => {
  /*
   * Both destinations have to be reachable while confined, or the guard sends somebody
   * to a page whose own API call is refused. The endpoints behind them carry the
   * allow-pending flags; this pins the pair of paths those flags have to cover.
   */
  const reachable = new Set(["/onboarding", "/account"]);
  for (const step of FIRST_RUN_STEPS) {
    assert.ok(reachable.has(firstRunDestination(step)), step);
  }
});

test("walking the sequence terminates, whatever order things are completed in", () => {
  // Guards against a rule that could return a step already done and loop the guard.
  const seen: string[] = [];
  let current = state();
  for (let i = 0; i < 10; i += 1) {
    const step = nextFirstRunStep(current);
    if (!step) break;
    assert.ok(!seen.includes(step), `${step} came round twice`);
    seen.push(step);
    current = {
      ...current,
      ...(step === "onboarding"
        ? { onboarding_done: true }
        : step === "password"
          ? { password_set: true }
          : { two_factor_ready: true }),
    };
  }
  assert.deepEqual(seen, ["onboarding", "password", "two_factor"]);
  assert.equal(nextFirstRunStep(current), null);
});

// ---------------------------------------------------------------------------
// The checklist has to say the same thing
// ---------------------------------------------------------------------------

test("the onboarding checklist asks for things in the order the portal does", () => {
  /*
   * The programme is what a new joiner reads; first-run.ts is what the portal enforces.
   * Listed the other way round, the checklist tells somebody to choose a password while
   * the portal is still asking for their bank details.
   */
  const steps = programmeFor("permanent")
    .filter((s) => s.stage === "first_signin" && s.owner === "employee")
    .map((s) => s.label);

  const details = steps.findIndex((l) => l.startsWith("Give your"));
  const password = steps.findIndex((l) => l.includes("password"));
  const twoStep = steps.findIndex((l) => l.includes("two-step"));

  assert.ok(details >= 0 && password >= 0 && twoStep >= 0);
  assert.ok(details < password, "details should be asked for before the password");
  assert.ok(password < twoStep, "the password should come before two-step sign-in");
});

test("every detail the first sign-in collects is asked for before the password", () => {
  const steps = programmeFor("consultant")
    .filter((s) => s.stage === "first_signin" && s.owner === "employee")
    .map((s) => s.label);
  const password = steps.findIndex((l) => l.includes("password"));
  const lastDetail = steps.reduce(
    (last, label, i) => (label.startsWith("Give your") ? i : last),
    -1,
  );
  assert.ok(lastDetail < password);
});

// ---------------------------------------------------------------------------
// Who the gate is for
// ---------------------------------------------------------------------------

/**
 * The gate applies to somebody the firm has actually onboarded, and to nobody else.
 *
 * The bug it is guarding against, which reached the firm: a System Administrator was
 * held on the first-run form with no way past it. The test for "has anything been asked
 * of this person" was "is there an employee_profiles row", which looked equivalent to
 * "have they been onboarded" and was not - `ensureProfile` creates that row the moment
 * anybody touches an employment record, including the person editing their own details.
 * So a founder who had never been onboarded acquired an empty profile row through
 * ordinary use and was locked out of their own portal, with no route back but a
 * database client.
 *
 * Exercised against the real schema rather than by reading the code, because the whole
 * mistake was that the rule looked right.
 */
function firm(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  const n = new Date().toISOString();
  db.exec(`
    INSERT INTO users (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
      VALUES ('boss','b@x.test','Founder','admin','active','x',0,'${n}','${n}'),
             ('newbie','n@x.test','New Joiner','associate','active','x',0,'${n}','${n}'),
             ('quiet','q@x.test','Never Onboarded','associate','active','x',0,'${n}','${n}');
    -- Every one of them has a profile row, as ordinary use of the portal creates.
    INSERT INTO employee_profiles (user_id,created_at,updated_at)
      VALUES ('boss','${n}','${n}'), ('newbie','${n}','${n}'), ('quiet','${n}','${n}');
    -- Only the new joiner has actually been put through onboarding.
    INSERT INTO onboarding_items (id,user_id,label,owner,category,stage,is_done,created_at)
      VALUES ('i1','newbie','Give your details','employee','Your details','first_signin',0,'${n}');
  `);
  return db;
}

/** The rule as worker/auth.ts applies it. */
function through(db: DatabaseSync, userId: string, role: string): boolean {
  if (role === "admin") return true;
  const row = db
    .prepare(
      `SELECT p.profile_completed_at AS done,
              (SELECT COUNT(*) FROM onboarding_items o WHERE o.user_id = ?) AS programme
         FROM (SELECT ? AS id) anchor
         LEFT JOIN employee_profiles p ON p.user_id = anchor.id`,
    )
    .get(userId, userId) as { done: string | null; programme: number } | undefined;
  if (!row) return true;
  if (Number(row.programme) === 0) return true;
  return Boolean(row.done);
}

test("an administrator is never held on the first-run form", () => {
  // They are who fixes a misconfiguration. A firm whose administrator cannot reach
  // Portal settings has no route back that does not involve a database client.
  const db = firm();
  assert.equal(through(db, "boss", "admin"), true);
  db.close();
});

test("an empty profile row is not by itself a reason to confine anybody", () => {
  // The exact bug. ensureProfile creates this row through ordinary use.
  const db = firm();
  assert.equal(through(db, "quiet", "associate"), true);
  db.close();
});

test("somebody the firm has actually onboarded is confined until they finish", () => {
  const db = firm();
  assert.equal(through(db, "newbie", "associate"), false);
  db.close();
});

test("finishing it lets them through", () => {
  const db = firm();
  db.exec(
    `UPDATE employee_profiles SET profile_completed_at = '2026-09-15T09:00:00Z' WHERE user_id = 'newbie'`,
  );
  assert.equal(through(db, "newbie", "associate"), true);
  db.close();
});

test("an administrator who has been onboarded is still not held", () => {
  // A programme started against an administrator must not trap them either.
  const db = firm();
  const n = new Date().toISOString();
  db.exec(
    `INSERT INTO onboarding_items (id,user_id,label,owner,category,stage,is_done,created_at)
       VALUES ('i2','boss','Give your details','employee','Your details','first_signin',0,'${n}')`,
  );
  assert.equal(through(db, "boss", "admin"), true);
  db.close();
});
