/**
 * What may be attached to a personal record, and how an attachment is recorded.
 *
 * The rules live in a shared module so the form and the Worker cannot disagree about
 * them; these pin the parts where disagreeing would matter. The reference scheme gets
 * the most attention, because it is written into a column that used to hold - and for
 * some people still holds - an ordinary link, and anything that confuses the two either
 * loses somebody's link or hands back the wrong file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  ACCEPTED_TYPES,
  ACCEPT_ATTRIBUTE,
  ATTACHMENT_SCHEME,
  MAX_BYTES,
  STAFF_FILE_FIELDS,
  STAFF_FILE_KINDS,
  attachmentId,
  attachmentRef,
  describeSize,
  isAcceptedType,
  isAttachment,
  objectKey,
  userPrefix,
  whyNotAcceptable,
} from "../shared/staff-files";
import { REQUIRED_PROFILE_FIELDS } from "../shared/hr";

// ---------------------------------------------------------------------------
// An attachment is never mistaken for a link, nor a link for an attachment
// ---------------------------------------------------------------------------

test("a reference round-trips to the file it names", () => {
  const ref = attachmentRef("abc123");
  assert.ok(isAttachment(ref));
  assert.equal(attachmentId(ref), "abc123");
});

test("an ordinary link is never read as an attachment", () => {
  // The column held these before attachments existed and still does for some people.
  for (const link of [
    "https://kesmic.sharepoint.com/sites/HR/passport.pdf",
    "https://drive.google.com/file/d/xyz/view",
    "http://example.test/a.png",
    "",
  ]) {
    assert.equal(isAttachment(link), false, link);
    assert.equal(attachmentId(link), null, link);
  }
});

test("nothing missing is read as an attachment either", () => {
  for (const value of [null, undefined]) {
    assert.equal(isAttachment(value), false);
    assert.equal(attachmentId(value), null);
  }
});

test("the scheme cannot collide with a URL somebody could paste", () => {
  // A scheme with no dots and no slashes is not something a browser would produce.
  assert.ok(!ATTACHMENT_SCHEME.includes("//"));
  assert.ok(ATTACHMENT_SCHEME.endsWith(":"));
});

// ---------------------------------------------------------------------------
// What is accepted
// ---------------------------------------------------------------------------

test("an empty file is refused before anything else", () => {
  assert.equal(whyNotAcceptable({ type: "application/pdf", size: 0 }), "That file is empty.");
});

test("a file over the limit is refused, and told its own size", () => {
  const refusal = whyNotAcceptable({ type: "image/jpeg", size: MAX_BYTES + 1 });
  assert.ok(refusal?.includes(describeSize(MAX_BYTES + 1)), refusal ?? "no refusal");
  assert.ok(refusal?.includes(describeSize(MAX_BYTES)), refusal ?? "no refusal");
});

test("a file exactly at the limit is accepted", () => {
  // Off-by-one here would refuse a file the message says is allowed.
  assert.equal(whyNotAcceptable({ type: "image/jpeg", size: MAX_BYTES }), null);
});

test("the types a phone and a scanner produce are accepted", () => {
  for (const type of ["application/pdf", "image/jpeg", "image/png", "image/heic"]) {
    assert.equal(whyNotAcceptable({ type, size: 1024 }), null, type);
  }
});

test("anything that could run is refused", () => {
  for (const type of ["text/html", "image/svg+xml", "application/javascript", ""]) {
    assert.ok(whyNotAcceptable({ type, size: 1024 }), `${type} was accepted`);
  }
});

test("a content type carrying parameters is still recognised", () => {
  // Browsers send `application/pdf; charset=binary` often enough to matter.
  assert.ok(isAcceptedType("application/pdf; charset=binary"));
  assert.ok(isAcceptedType("IMAGE/JPEG"));
});

test("the file chooser offers exactly what the rules accept", () => {
  for (const type of Object.keys(ACCEPTED_TYPES)) {
    assert.ok(ACCEPT_ATTRIBUTE.includes(type), `${type} missing from accept`);
  }
});

// ---------------------------------------------------------------------------
// Where the bytes go
// ---------------------------------------------------------------------------

test("everything belonging to one person shares a prefix", () => {
  // This is what lets deleting an account delete their documents rather than
  // leaving a passport scan in the bucket.
  const key = objectKey("user-1", "file-1");
  assert.ok(key.startsWith(userPrefix("user-1")));
  assert.ok(!key.startsWith(userPrefix("user-2")));
});

// ---------------------------------------------------------------------------
// The columns these fill in
// ---------------------------------------------------------------------------

test("every kind fills in a field the first run actually requires", () => {
  // If these drifted apart, attaching a document would leave the person's first run
  // incomplete with no field on screen left to fill.
  for (const kind of STAFF_FILE_KINDS) {
    const field = STAFF_FILE_FIELDS[kind];
    assert.ok(
      (REQUIRED_PROFILE_FIELDS as readonly string[]).includes(field),
      `${kind} fills ${field}, which the first run does not ask for`,
    );
  }
});

test("the columns exist on the table the Worker writes to", () => {
  // Measured against the real migrations: the update is built from STAFF_FILE_FIELDS,
  // so a renamed column would fail at runtime rather than at build time.
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  const columns = db
    .prepare(`PRAGMA table_info(employee_profiles)`)
    .all()
    .map((c) => String((c as { name: unknown }).name));
  for (const kind of STAFF_FILE_KINDS) {
    assert.ok(columns.includes(STAFF_FILE_FIELDS[kind]), `${STAFF_FILE_FIELDS[kind]} missing`);
  }
  db.close();
});

test("one current attachment per person per kind", () => {
  // The schema enforces it, so a replace cannot quietly become a second row that the
  // profile column does not point at.
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  const now = new Date().toISOString();
  db.exec(`INSERT INTO users (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
           VALUES ('u1','u1@x.test','A','associate','active','x',0,'${now}','${now}')`);

  const add = (id: string, kind: string) =>
    db
      .prepare(
        `INSERT INTO staff_files (id,user_id,kind,object_key,filename,content_type,size_bytes,uploaded_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(id, "u1", kind, `staff/u1/${id}`, "a.pdf", "application/pdf", 10, now);

  add("f1", "identification");
  add("f2", "qualification");
  assert.throws(() => add("f3", "identification"), /UNIQUE/);
  db.close();
});

test("the kinds the table accepts are exactly the kinds the code knows", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  const now = new Date().toISOString();
  db.exec(`INSERT INTO users (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
           VALUES ('u1','u1@x.test','A','associate','active','x',0,'${now}','${now}')`);

  const add = (id: string, kind: string) =>
    db
      .prepare(
        `INSERT INTO staff_files (id,user_id,kind,object_key,filename,content_type,size_bytes,uploaded_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(id, "u1", kind, `staff/u1/${id}`, "a.pdf", "application/pdf", 10, now);

  for (const kind of STAFF_FILE_KINDS) add(`ok-${kind}`, kind);
  assert.throws(() => add("bad", "payslip"), /CHECK/);
  db.close();
});
