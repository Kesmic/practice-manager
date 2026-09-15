/**
 * Removing a person, and what it costs.
 *
 * "Delete the account" sounds like one action on one row. It is not. A user row is
 * referenced by forty-odd columns in this schema and about a third of them cascade, so
 * a plain DELETE takes with it things that are not about that person at all.
 *
 * That was measured rather than assumed, against the real migrations with foreign keys
 * on, and the measurement is repeated as a test below: deleting a reviewer removes the
 * review round, the review point and the comment from somebody ELSE's deliverable, and
 * leaves that deliverable sitting in `under_review` with no reviewer and no record of
 * what was asked for. The person whose deliverable it is did nothing.
 *
 * So the module this tests does not stop anybody deleting an account - it is the firm's
 * data. It makes sure nobody finds out afterwards.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  NO_FOOTPRINT,
  REMOVALS,
  REMOVAL_EFFECTS,
  REMOVAL_LABELS,
  RETIRED_NAME,
  adviseRemoval,
  canErase,
  confirmationMatches,
  footprintTotal,
  isRetiredEmail,
  removalConfirmation,
  retiredEmail,
  type RemovalFootprint,
} from "../shared/removal";

const footprint = (over: Partial<RemovalFootprint> = {}): RemovalFootprint => ({
  ...NO_FOOTPRINT,
  ...over,
});

// ---------------------------------------------------------------------------
// What a plain delete actually does
// ---------------------------------------------------------------------------

/** The real schema, with foreign keys enforced as D1 enforces them. */
function seeded(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");

  const now = new Date().toISOString();
  db.exec(`
    INSERT INTO users (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
      VALUES ('alice','a@x.test','Alice','senior_associate','active','x',0,'${now}','${now}'),
             ('bob','b@x.test','Bob','associate','active','x',0,'${now}','${now}');
    INSERT INTO clients (id,code,name,created_at,updated_at)
      VALUES ('c1','C1','Client One','${now}','${now}');
    INSERT INTO tasks (id,ref,client_id,title,service_line,status,assignee_id,reviewer_id,created_at,updated_at)
      VALUES ('t1','TSK-1','c1','Bob''s VAT return','tax_compliance','under_review','bob','alice','${now}','${now}');
    INSERT INTO task_reviews (id,task_id,round,reviewer_id,submitted_by,started_at)
      VALUES ('r1','t1',1,'alice','bob','${now}');
    INSERT INTO review_points (id,task_id,review_id,round,seq,severity,body,status,raised_by,raised_at)
      VALUES ('p1','t1','r1',1,1,'must_fix','Reconcile the control account','open','alice','${now}');
    INSERT INTO task_comments (id,task_id,author_id,body,created_at)
      VALUES ('cm1','t1','alice','Check the VAT treatment','${now}');
    INSERT INTO time_entries (id,task_id,user_id,work_date,hours,billable,created_at)
      VALUES ('te1','t1','bob','2026-09-01',7.5,1,'${now}');
  `);
  return db;
}

const count = (db: DatabaseSync, table: string): number =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

test("deleting a reviewer strips their work off somebody else's deliverable", () => {
  // The measurement this whole module exists for. If any of these ever come back as
  // non-zero, the cascade has been fixed in the schema and the advice can soften.
  const db = seeded();
  assert.equal(count(db, "review_points"), 1);
  assert.equal(count(db, "task_reviews"), 1);
  assert.equal(count(db, "task_comments"), 1);

  db.exec("DELETE FROM users WHERE id = 'alice'");

  assert.equal(count(db, "review_points"), 0, "the review point survived");
  assert.equal(count(db, "task_reviews"), 0, "the review round survived");
  assert.equal(count(db, "task_comments"), 0, "the comment survived");

  // And Bob's deliverable is left mid-review with nobody reviewing it.
  const task = db.prepare("SELECT status, reviewer_id FROM tasks WHERE id = 't1'").get() as {
    status: string;
    reviewer_id: string | null;
  };
  assert.equal(task.status, "under_review");
  assert.equal(task.reviewer_id, null);
  db.close();
});

test("deleting the preparer takes the hours logged against the client", () => {
  const db = seeded();
  assert.equal(count(db, "time_entries"), 1);
  db.exec("DELETE FROM users WHERE id = 'bob'");
  assert.equal(count(db, "time_entries"), 0);
  // The deliverable itself survives - tasks.assignee_id is SET NULL, not CASCADE.
  assert.equal(count(db, "tasks"), 1);
  db.close();
});

test("retiring instead leaves every one of those intact", () => {
  // The whole argument for keeping the row: the client work is untouched.
  const db = seeded();
  db.exec(
    `UPDATE users SET full_name = '${RETIRED_NAME}', email = '${retiredEmail("alice")}',
            status = 'suspended' WHERE id = 'alice'`,
  );
  assert.equal(count(db, "review_points"), 1);
  assert.equal(count(db, "task_reviews"), 1);
  assert.equal(count(db, "task_comments"), 1);

  const task = db.prepare("SELECT reviewer_id FROM tasks WHERE id = 't1'").get() as {
    reviewer_id: string | null;
  };
  assert.equal(task.reviewer_id, "alice", "the deliverable still knows who reviewed it");
  db.close();
});

// ---------------------------------------------------------------------------
// Which removal is honest
// ---------------------------------------------------------------------------

test("an account that has touched nothing can simply be deleted", () => {
  // The common reason to want a row gone: created by mistake, wrong address typed.
  const advice = adviseRemoval(NO_FOOTPRINT);
  assert.equal(advice.recommended, "erase");
  assert.deepEqual(advice.collateral, []);
  assert.equal(canErase(NO_FOOTPRINT), true);
});

test("deleting outright stays the default however much they are attached to", () => {
  /*
   * An earlier version recommended retiring once somebody had touched any client work.
   * That was the wrong call: the firm asked to be able to delete staff completely, and a
   * screen that answers "would you not rather do something else" to a decision its owner
   * has already made is arguing rather than informing.
   */
  for (const key of Object.keys(NO_FOOTPRINT) as Array<keyof RemovalFootprint>) {
    const one = footprint({ [key]: 1 });
    assert.equal(canErase(one), false, key);
    assert.equal(adviseRemoval(one).recommended, "erase", key);
  }
});

test("the full delete is the first option offered", () => {
  assert.equal(REMOVALS[0], "erase");
});

test("what goes with them is still counted, whatever is recommended", () => {
  // The count is the whole reason the dialog is more than a button: it is the thing an
  // administrator cannot work out for themselves.
  const advice = adviseRemoval(footprint({ review_points: 4, time_entries: 12 }));
  assert.ok(advice.collateral.length > 0);
  assert.ok(advice.summary.length > 0);
});

test("the full delete is never taken off the table", () => {
  // It is the firm's data. The system's job is to make sure nobody finds out
  // afterwards, not to decide for them.
  assert.equal(adviseRemoval(NO_FOOTPRINT).erase_available, true);
  assert.equal(adviseRemoval(footprint({ review_points: 40 })).erase_available, true);
});

test("the strongest wording is kept for the case that damages other people's records", () => {
  // Somebody with only their own signatures is losing their own history. Somebody who
  // reviewed other people's work is not, and the sentence should not read the same.
  const ownOnly = adviseRemoval(footprint({ signatures: 3 }));
  const othersToo = adviseRemoval(footprint({ review_points: 3 }));

  assert.ok(!ownOnly.summary.includes("other people"));
  assert.match(othersToo.summary, /other people/);
});

test("the wording states what happens rather than asking them to reconsider", () => {
  for (const f of [footprint({ review_points: 3 }), footprint({ signatures: 2 })]) {
    const { summary } = adviseRemoval(f);
    assert.ok(!/would you|are you sure|rather|instead|recommend/i.test(summary), summary);
  }
});

test("the collateral names what would actually go, in numbers", () => {
  const advice = adviseRemoval(
    footprint({ review_points: 4, comments: 1, time_entries: 12 }),
  );
  assert.ok(advice.collateral.some((line) => line.startsWith("4 review points")));
  assert.ok(advice.collateral.some((line) => line === "1 comment they wrote"));
  assert.ok(advice.collateral.some((line) => line.startsWith("12 hour entries")));
});

test("nothing is listed as collateral that the footprint does not contain", () => {
  assert.deepEqual(adviseRemoval(footprint({ tasks: 5 })).collateral, []);
});

test("the total counts every kind of attachment", () => {
  assert.equal(footprintTotal(NO_FOOTPRINT), 0);
  assert.equal(footprintTotal(footprint({ tasks: 2, comments: 3 })), 5);
});

// ---------------------------------------------------------------------------
// What each removal promises
// ---------------------------------------------------------------------------

test("both removals are described, and only one of them keeps anything", () => {
  for (const removal of REMOVALS) {
    assert.ok(REMOVAL_LABELS[removal], removal);
    assert.ok(REMOVAL_EFFECTS[removal].destroys.length > 0, removal);
  }
  assert.ok(REMOVAL_EFFECTS.retire.keeps.length > 0);
  assert.deepEqual(REMOVAL_EFFECTS.erase.keeps, []);
});

test("the full delete is described as destroying everything the retirement does", () => {
  // A reader comparing the two must not conclude that erasing keeps something.
  assert.ok(
    REMOVAL_EFFECTS.erase.destroys.some((line) => /retirement would remove/i.test(line)),
  );
});

// ---------------------------------------------------------------------------
// The retired address
// ---------------------------------------------------------------------------

test("a retired account gets an address that can never be delivered to", () => {
  // .invalid is reserved by RFC 2606 precisely so it cannot resolve. An address that
  // could deliver - or that somebody could later register - is not a retired account.
  const email = retiredEmail("abc123");
  assert.match(email, /\.invalid$/);
  assert.ok(isRetiredEmail(email));
});

test("two retired accounts never collide", () => {
  // users.email is unique, so a shared placeholder would make the second retirement fail.
  assert.notEqual(retiredEmail("one"), retiredEmail("two"));
});

test("an ordinary address is not mistaken for a retired one", () => {
  for (const email of ["a@x.test", "someone@invalid.example", "x@removed.invalid.co"]) {
    assert.equal(isRetiredEmail(email), false, email);
  }
});

// ---------------------------------------------------------------------------
// The confirmation
// ---------------------------------------------------------------------------

test("the confirmation is the person's own name, not a fixed word", () => {
  // "DELETE" can be typed without reading. The point is to make somebody look at which
  // person they have selected.
  assert.equal(removalConfirmation("Ama Boateng"), "Ama Boateng");
});

test("case and spacing are forgiven; a different name is not", () => {
  assert.equal(confirmationMatches("  ama   boateng ", "Ama Boateng"), true);
  assert.equal(confirmationMatches("AMA BOATENG", "Ama Boateng"), true);
  assert.equal(confirmationMatches("Ama", "Ama Boateng"), false);
  assert.equal(confirmationMatches("", "Ama Boateng"), false);
  assert.equal(confirmationMatches("Kwame Boateng", "Ama Boateng"), false);
});
