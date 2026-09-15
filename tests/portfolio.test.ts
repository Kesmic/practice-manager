/**
 * How much of the firm's client work one person can see.
 *
 * The bug: every signed-in person could read every deliverable in the practice, every
 * client, and every engagement. An Associate engaged the week before opened Deliverables
 * and saw six jobs, none of them theirs, each naming a client, a service line, a
 * deadline and a colleague. `GET /api/tasks` applied no scoping at all, and
 * `GET /api/tasks/:id` called requireUser and threw the result away - so any deliverable
 * could be opened by anybody holding its id, and the id is in the URL of every link
 * anybody was ever sent.
 *
 * In a practice that files other people's tax returns that is not an untidy default: the
 * client list alone says who banks with whom.
 *
 * The SQL is tested against the real schema rather than by inspection, because a
 * predicate that is merely present proves nothing - the question is whether the rows
 * come back, and whether the ones that should not are actually absent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  MIN_FULL_PORTFOLIO,
  NOT_YOURS,
  emptyPortfolioMessage,
  reachesClient,
  seesWholePractice,
} from "../shared/portfolio";
import { ROLES, ROLE_RANK, MIN_SUPERVISOR_ROLE, type Role } from "../shared/workflow";
import {
  ownClientPredicate,
  ownEngagementPredicate,
  ownTaskPredicate,
} from "../worker/routes/task-sql";

// ---------------------------------------------------------------------------
// Where the line falls
// ---------------------------------------------------------------------------

test("the line is the grade that already assigns and supervises work", () => {
  // Two different answers to "who runs the practice" would be one too many, and the one
  // people learn is whichever bit them last.
  assert.equal(MIN_FULL_PORTFOLIO, MIN_SUPERVISOR_ROLE);
});

test("staff below that grade see their own work; everybody above sees the practice", () => {
  for (const role of ROLES) {
    assert.equal(
      seesWholePractice(role),
      ROLE_RANK[role] >= ROLE_RANK[MIN_FULL_PORTFOLIO],
      role,
    );
  }
  assert.equal(seesWholePractice("associate"), false);
  assert.equal(seesWholePractice("senior_associate"), false);
  assert.equal(seesWholePractice("manager"), true);
  assert.equal(seesWholePractice("partner"), true);
  assert.equal(seesWholePractice("admin"), true);
});

test("not-found and not-yours are the same sentence", () => {
  // Separating them turns a detail endpoint into a way of asking whether an id exists,
  // which over enough guesses is a map of the firm's client work.
  for (const message of Object.values(NOT_YOURS)) {
    assert.match(message, /does not exist, or is not one of yours/);
  }
});

test("an empty list tells staff why it is empty, not that nothing matched", () => {
  assert.match(emptyPortfolioMessage("associate", "deliverable"), /assigns you one/);
  assert.match(emptyPortfolioMessage("partner", "deliverable"), /match what you are/);
});

test("a client is reached by holding it, being responsible for it, or working on it", () => {
  assert.equal(reachesClient({ allocated: true, responsible: false, working: false }), true);
  assert.equal(reachesClient({ allocated: false, responsible: true, working: false }), true);
  assert.equal(reachesClient({ allocated: false, responsible: false, working: true }), true);
  assert.equal(
    reachesClient({ allocated: false, responsible: false, working: false }),
    false,
  );
});

// ---------------------------------------------------------------------------
// The predicates, against the real schema
// ---------------------------------------------------------------------------

/**
 * A practice with two clients and two people.
 *
 *   Kofi  - prepares TSK-1 for Acme; allocated Bluecrest.
 *   Ama   - prepares TSK-2 for Zenith, which Kofi has nothing to do with.
 */
function practice(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");

  const n = new Date().toISOString();
  db.exec(`
    INSERT INTO users (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
      VALUES ('kofi','k@x.test','Kofi','associate','active','x',0,'${n}','${n}'),
             ('ama','a@x.test','Ama','associate','active','x',0,'${n}','${n}'),
             ('pat','p@x.test','Pat','partner','active','x',0,'${n}','${n}');
    INSERT INTO clients (id,code,name,partner_id,created_at,updated_at)
      VALUES ('acme','ACME','Acme Trading',NULL,'${n}','${n}'),
             ('blue','BLUE','Bluecrest Foods',NULL,'${n}','${n}'),
             ('zen','ZEN','Zenith Holdings',NULL,'${n}','${n}'),
             ('pats','PATS','Pat''s client','pat','${n}','${n}');
    INSERT INTO tasks (id,ref,client_id,title,service_line,status,assignee_id,reviewer_id,created_at,updated_at)
      VALUES ('t1','TSK-1','acme','Acme VAT','tax_compliance','in_progress','kofi',NULL,'${n}','${n}'),
             ('t2','TSK-2','zen','Zenith VAT','tax_compliance','in_progress','ama',NULL,'${n}','${n}'),
             ('t3','TSK-3','zen','Zenith review','tax_compliance','under_review','ama','kofi','${n}','${n}');
    INSERT INTO client_allocations (id,client_id,user_id,status,offered_at)
      VALUES ('al1','blue','kofi','accepted','${n}'),
             ('al2','pats','kofi','declined','${n}');
    INSERT INTO engagements (id,client_id,code,name,service_line,status,created_at,updated_at)
      VALUES ('e1','acme','ENG-1','Acme 2026','tax_compliance','active','${n}','${n}'),
             ('e2','zen','ENG-2','Zenith 2026','tax_compliance','active','${n}','${n}'),
             ('e3','pats','ENG-3','Pat 2026','tax_compliance','active','${n}','${n}');
  `);
  return db;
}

function refs(db: DatabaseSync, userId: string): string[] {
  const own = ownTaskPredicate(userId);
  return (
    db
      .prepare(`SELECT t.ref FROM tasks t WHERE ${own.sql} ORDER BY t.ref`)
      .all(...own.binds) as Array<{ ref: string }>
  ).map((r) => r.ref);
}

function codes(db: DatabaseSync, userId: string): string[] {
  const own = ownClientPredicate(userId);
  return (
    db
      .prepare(`SELECT c.code FROM clients c WHERE ${own.sql} ORDER BY c.code`)
      .all(...own.binds) as Array<{ code: string }>
  ).map((r) => r.code);
}

test("a preparer sees the deliverable they prepare and the one they review, and no other", () => {
  const db = practice();
  assert.deepEqual(refs(db, "kofi"), ["TSK-1", "TSK-3"]);
  // The bug in one line: Ama's Zenith VAT was visible to Kofi and is not his.
  assert.ok(!refs(db, "kofi").includes("TSK-2"));
  db.close();
});

test("somebody with nothing assigned sees nothing at all", () => {
  const db = practice();
  assert.deepEqual(refs(db, "pat"), []);
  db.close();
});

test("a client is reached by an allocation, by responsibility, or by working on it", () => {
  const db = practice();
  // ACME through the deliverable he prepares, BLUE through the allocation he accepted,
  // ZEN through the deliverable he reviews.
  assert.deepEqual(codes(db, "kofi"), ["ACME", "BLUE", "ZEN"]);
  db.close();
});

test("a declined allocation is not a way into a client", () => {
  // Somebody who exercised clause 8.2 to refuse a client should not keep a window
  // into it.
  const db = practice();
  assert.ok(!codes(db, "kofi").includes("PATS"));
  db.close();
});

test("an ended allocation stops being a way in", () => {
  const db = practice();
  assert.ok(codes(db, "kofi").includes("BLUE"));
  db.exec("UPDATE client_allocations SET status = 'ended' WHERE id = 'al1'");
  assert.ok(!codes(db, "kofi").includes("BLUE"));
  db.close();
});

test("the named partner reaches their own client", () => {
  const db = practice();
  assert.deepEqual(codes(db, "pat"), ["PATS"]);
  db.close();
});

test("engagements follow the clients the person reaches", () => {
  const db = practice();
  const own = ownEngagementPredicate("kofi");
  const rows = db
    .prepare(`SELECT e.code FROM engagements e WHERE ${own.sql} ORDER BY e.code`)
    .all(...own.binds) as Array<{ code: string }>;
  // ENG-1 (Acme, he prepares) and ENG-2 (Zenith, he reviews). Not ENG-3: he declined it.
  assert.deepEqual(
    rows.map((r) => r.code),
    ["ENG-1", "ENG-2"],
  );
  db.close();
});

// ---------------------------------------------------------------------------
// The thing that would silently break it
// ---------------------------------------------------------------------------

test("a scoped predicate carries exactly as many binds as it has placeholders", () => {
  // SQLite numbers a bare `?` one higher than the largest assigned so far, in the order
  // the parameters appear in the text. A predicate appended after the caller's own
  // filters, holding a `?1`, would silently read the caller's FIRST filter value as the
  // user id. Keeping the binds with the SQL is what stops that - and this checks they
  // have not drifted apart.
  for (const scoped of [
    ownTaskPredicate("u"),
    ownClientPredicate("u"),
    ownEngagementPredicate("u"),
  ]) {
    const placeholders = (scoped.sql.match(/\?/g) ?? []).length;
    assert.equal(placeholders, scoped.binds.length, scoped.sql);
    // And every bind is the same id, so order cannot matter either.
    assert.ok(scoped.binds.every((b) => b === "u"));
  }
});

test("no scoped predicate uses a numbered placeholder", () => {
  for (const scoped of [
    ownTaskPredicate("u"),
    ownClientPredicate("u"),
    ownEngagementPredicate("u"),
  ]) {
    assert.ok(!/\?\d/.test(scoped.sql), scoped.sql);
  }
});

test("a scoped predicate composes after another filter without shifting it", () => {
  // The real failure mode, reproduced: filter first, scope appended, both bound in
  // order. If the numbering were wrong this returns the wrong rows rather than erroring.
  const db = practice();
  const own = ownTaskPredicate("kofi");
  const rows = db
    .prepare(
      `SELECT t.ref FROM tasks t WHERE t.status = ? AND ${own.sql} ORDER BY t.ref`,
    )
    .all("in_progress", ...own.binds) as Array<{ ref: string }>;
  assert.deepEqual(
    rows.map((r) => r.ref),
    ["TSK-1"],
  );
  db.close();
});
