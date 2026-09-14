/**
 * The staff directory: firm-wide, but limited by grade.
 *
 * The list is open to everybody, because a practice needs a phone list and asking
 * around for a colleague's job title is how a new joiner spends their first fortnight.
 * What differs by grade is not who appears but what is said about them.
 *
 * The test that matters is the last group: that a reader below Manager grade cannot
 * receive the employment fields. Written against the real query rather than by reading
 * it, because "the SELECT does not mention it" is exactly the kind of thing that stops
 * being true when somebody adds a column.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  DETAIL_ONLY_FIELDS,
  MIN_DIRECTORY_DETAIL,
  byDepartment,
  seesEmploymentDetail,
  sharedWorkLabel,
  type DirectoryEntry,
} from "../shared/directory";
import { ROLES, ROLE_RANK } from "../shared/workflow";

const person = (over: Partial<DirectoryEntry> = {}): DirectoryEntry => ({
  id: "x",
  full_name: "Ama Boateng",
  role: "associate",
  title: null,
  department: null,
  email: "ama@x.test",
  work_location: null,
  line_manager_name: null,
  active: true,
  shared_deliverables: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// Who sees what
// ---------------------------------------------------------------------------

test("employment facts start at Manager grade", () => {
  for (const role of ROLES) {
    assert.equal(
      seesEmploymentDetail(role),
      ROLE_RANK[role] >= ROLE_RANK[MIN_DIRECTORY_DETAIL],
      role,
    );
  }
  assert.equal(seesEmploymentDetail("associate"), false);
  assert.equal(seesEmploymentDetail("senior_associate"), false);
  assert.equal(seesEmploymentDetail("manager"), true);
});

test("employment status is among the fields staff never receive", () => {
  // The one people forget: "probation" on a directory card tells the whole firm
  // something that is between a colleague and their manager.
  assert.ok(DETAIL_ONLY_FIELDS.includes("employment_status"));
  assert.ok(DETAIL_ONLY_FIELDS.includes("staff_no"));
  assert.ok(DETAIL_ONLY_FIELDS.includes("start_date"));
});

// ---------------------------------------------------------------------------
// Grouping and wording
// ---------------------------------------------------------------------------

test("departments are listed alphabetically with the unassigned last", () => {
  const groups = byDepartment([
    person({ id: "1", department: "Tax" }),
    person({ id: "2", department: null }),
    person({ id: "3", department: "Audit" }),
    person({ id: "4", department: "Tax" }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.department),
    ["Audit", "Tax", "Elsewhere in the firm"],
  );
  assert.equal(groups[1].people.length, 2);
});

test("grouping loses nobody", () => {
  const people = Array.from({ length: 9 }, (_, i) =>
    person({ id: String(i), department: i % 3 === 0 ? null : `Team ${i % 3}` }),
  );
  const total = byDepartment(people).reduce((n, g) => n + g.people.length, 0);
  assert.equal(total, people.length);
});

test("a department that is only whitespace counts as unassigned", () => {
  const groups = byDepartment([person({ department: "   " })]);
  assert.deepEqual(
    groups.map((g) => g.department),
    ["Elsewhere in the firm"],
  );
});

test("an empty directory produces no groups at all", () => {
  assert.deepEqual(byDepartment([]), []);
});

test("the shared-work line is absent rather than saying zero", () => {
  assert.equal(sharedWorkLabel(0), null);
  assert.equal(sharedWorkLabel(-1), null);
  assert.equal(sharedWorkLabel(1), "You share a deliverable with them");
  assert.equal(sharedWorkLabel(4), "You share 4 deliverables with them");
});

// ---------------------------------------------------------------------------
// The query itself
// ---------------------------------------------------------------------------

/**
 * The directory query as the route builds it, with the one conditional fragment that
 * decides what a reader receives.
 */
function directorySql(detail: boolean): string {
  return `SELECT u.id, u.full_name, u.email, u.role,
                 u.status AS account_status,
                 p.job_title, p.department, p.work_location,
                 ${detail ? "p.employment_status, p.staff_no, p.start_date," : ""}
                 m.full_name AS line_manager_name,
                 (SELECT COUNT(*) FROM tasks t
                   WHERE t.status NOT IN ('closed','cancelled')
                     AND (t.assignee_id = u.id OR t.reviewer_id = u.id)
                     AND (t.assignee_id = ?1 OR t.reviewer_id = ?1)
                     AND u.id != ?1) AS shared_deliverables
            FROM users u
            LEFT JOIN employee_profiles p ON p.user_id = u.id
            LEFT JOIN users m ON m.id = p.line_manager_id
           ORDER BY u.full_name`;
}

function firm(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  const n = new Date().toISOString();
  db.exec(`
    INSERT INTO users (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
      VALUES ('kofi','k@x.test','Kofi','associate','active','x',0,'${n}','${n}'),
             ('ama','a@x.test','Ama','associate','active','x',0,'${n}','${n}'),
             ('zoe','z@x.test','Zoe','manager','active','x',0,'${n}','${n}');
    INSERT INTO employee_profiles (user_id,job_title,department,employment_status,staff_no,start_date,created_at,updated_at)
      VALUES ('kofi','Tax Associate','Tax','probation','S-001','2026-01-05','${n}','${n}'),
             ('ama','Audit Associate','Audit','active','S-002','2025-03-01','${n}','${n}');
    INSERT INTO clients (id,code,name,created_at,updated_at)
      VALUES ('c1','C1','Client One','${n}','${n}');
    INSERT INTO tasks (id,ref,client_id,title,service_line,status,assignee_id,reviewer_id,created_at,updated_at)
      VALUES ('t1','TSK-1','c1','Shared','tax_compliance','in_progress','kofi','zoe','${n}','${n}'),
             ('t2','TSK-2','c1','Not shared','tax_compliance','in_progress','ama',NULL,'${n}','${n}'),
             ('t3','TSK-3','c1','Closed','tax_compliance','closed','kofi','zoe','${n}','${n}');
  `);
  return db;
}

test("a reader below Manager grade cannot receive the employment fields", () => {
  // The whole point. Left out of the SELECT rather than deleted from the rows
  // afterwards, because filtering after the fact works until somebody adds a column.
  const db = firm();
  const rows = db.prepare(directorySql(false)).all("kofi") as Array<
    Record<string, unknown>
  >;
  assert.ok(rows.length > 0);
  for (const row of rows) {
    for (const field of DETAIL_ONLY_FIELDS) {
      assert.ok(!(field in row), `${field} reached a reader below Manager grade`);
    }
  }
  db.close();
});

test("a Manager receives them", () => {
  const db = firm();
  const rows = db.prepare(directorySql(true)).all("zoe") as Array<
    Record<string, unknown>
  >;
  for (const field of DETAIL_ONLY_FIELDS) {
    assert.ok(field in rows[0], field);
  }
  // And "probation" really is in there, which is why it is withheld from everybody else.
  assert.equal(
    rows.find((r) => r.id === "kofi")?.employment_status,
    "probation",
  );
  db.close();
});

test("everybody appears in the directory whoever is reading it", () => {
  // Firm-wide is the point: the grade limits what is said, not who is listed.
  const db = firm();
  const rows = db.prepare(directorySql(false)).all("kofi") as Array<{ id: string }>;
  assert.deepEqual(rows.map((r) => r.id).sort(), ["ama", "kofi", "zoe"]);
  db.close();
});

test("shared deliverables count live work with the reader, and not the reader", () => {
  const db = firm();
  const rows = db.prepare(directorySql(false)).all("kofi") as Array<{
    id: string;
    shared_deliverables: number;
  }>;
  const by = Object.fromEntries(rows.map((r) => [r.id, r.shared_deliverables]));

  // Kofi prepares TSK-1, which Zoe reviews.
  assert.equal(by.zoe, 1);
  // Ama's TSK-2 is nothing to do with him.
  assert.equal(by.ama, 0);
  // He does not share deliverables with himself.
  assert.equal(by.kofi, 0);
  db.close();
});

test("a closed deliverable is not shared work", () => {
  // TSK-3 is also Kofi and Zoe, and is closed. If it counted, the figure would say two
  // and send somebody to talk about a job that finished.
  const db = firm();
  const rows = db.prepare(directorySql(false)).all("kofi") as Array<{
    id: string;
    shared_deliverables: number;
  }>;
  assert.equal(rows.find((r) => r.id === "zoe")?.shared_deliverables, 1);
  db.close();
});

test("a retired account is not in the directory", () => {
  /*
   * They are kept so the client work still shows who prepared and who reviewed each
   * job, but a person who has left is not somebody a colleague should be emailing -
   * and "Former colleague" at a placeholder address is an entry nobody can act on.
   */
  const db = firm();
  db.exec(
    "UPDATE users SET full_name = 'Former colleague', email = 'retired-ama@removed.invalid' WHERE id = 'ama'",
  );
  const sql = directorySql(false).replace(
    "LEFT JOIN users m ON m.id = p.line_manager_id",
    "LEFT JOIN users m ON m.id = p.line_manager_id WHERE u.email NOT LIKE '%@removed.invalid'",
  );
  const rows = db.prepare(sql).all("kofi") as Array<{ id: string }>;
  assert.deepEqual(rows.map((r) => r.id).sort(), ["kofi", "zoe"]);
  db.close();
});

test("a suspended colleague stays in the directory", () => {
  // Somebody on leave is still a colleague, and still worth being able to find.
  const db = firm();
  db.exec("UPDATE users SET status = 'suspended' WHERE id = 'ama'");
  const rows = db.prepare(directorySql(false)).all("kofi") as Array<{
    id: string;
    account_status: string;
  }>;
  const ama = rows.find((r) => r.id === "ama");
  assert.ok(ama);
  assert.equal(ama.account_status, "suspended");
  db.close();
});
