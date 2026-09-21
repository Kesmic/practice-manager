/**
 * The wall between a client login and a staff login.
 *
 * This is the first time anybody outside the firm has had an account in the portal, and
 * the failure that matters is a client reading something that is not theirs. The tests
 * here are about that wall and nothing else: the schema that holds it up, and the shape
 * of the two session tables that makes a client session unable to satisfy a staff check.
 *
 * They are measured against the real migrations with foreign keys on, because the claims
 * are all claims about what the database will and will not allow.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { CLIENT_SESSION_COOKIE, INVITATION_TTL_DAYS } from "../worker/client-auth";
import { CLIENT_TIERS } from "../shared/allocations";
import { SESSION_COOKIE } from "../worker/auth";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const NOW = "2026-09-21T10:00:00.000Z";
const LATER = "2026-12-21T10:00:00.000Z";

function seed(db: DatabaseSync): void {
  db.exec(`INSERT INTO users
             (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
           VALUES ('staff1','md@kesmic.org','Michael Kesseh','partner','active','x',0,'${NOW}','${NOW}')`);
  db.exec(`INSERT INTO clients (id,code,name,entity_type,risk_rating,status,created_at,updated_at)
           VALUES ('c1','ADM-014','Adom Foods Ltd','company','medium','active','${NOW}','${NOW}')`);
  db.exec(`INSERT INTO clients (id,code,name,entity_type,risk_rating,status,created_at,updated_at)
           VALUES ('c2','KTA-009','Keta Logistics','company','medium','active','${NOW}','${NOW}')`);
  db.exec(`INSERT INTO client_users
             (id,client_id,email,full_name,password_hash,status,created_at,updated_at)
           VALUES ('cu1','c1','kofi@adomfoods.test','Kofi Adom','hash','active','${NOW}','${NOW}')`);
  db.exec(`INSERT INTO client_sessions
             (id,client_user_id,created_at,expires_at,last_seen_at)
           VALUES ('digest-of-client-token','cu1','${NOW}','${LATER}','${NOW}')`);
}

// ---------------------------------------------------------------------------
// The wall
// ---------------------------------------------------------------------------

test("the two session cookies have different names", () => {
  // One name for both would mean a browser holding a client session presenting it to a
  // staff endpoint, and the only thing standing between that and a staff page would be
  // the lookup failing. Two names means it is never even offered.
  assert.notEqual(CLIENT_SESSION_COOKIE, SESSION_COOKIE);
  assert.equal(CLIENT_SESSION_COOKIE, "kpm_client");
});

test("a client is not a user, so no staff check can ever find one", () => {
  // The whole design in one assertion. requireUser resolves a token through `sessions`
  // JOIN `users`; a client's session is in `client_sessions` and their identity in
  // `client_users`. Even handed a client's session id, the staff query returns nothing.
  const db = freshDb();
  seed(db);

  const asStaffWouldLookItUp = db
    .prepare(
      `SELECT u.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get("digest-of-client-token");
  assert.equal(asStaffWouldLookItUp, undefined);

  // And there is genuinely no row for them in the staff tables.
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM users WHERE email = ?").get("kofi@adomfoods.test") as { n: number }).n,
    0,
  );
  assert.equal((db.prepare("SELECT COUNT(*) n FROM sessions").get() as { n: number }).n, 0);
  db.close();
});

test("the staff role enum still admits only the five staff grades", () => {
  // The alternative design this codebase deliberately did not take. If a later change
  // adds 'client' here, every requireRole in the Worker changes meaning at once.
  const db = freshDb();
  let refused = false;
  try {
    db.exec(`INSERT INTO users
               (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
             VALUES ('x','x@y.test','X','client','active','h',0,'${NOW}','${NOW}')`);
  } catch (err) {
    refused = /CHECK/.test(String(err));
  }
  assert.ok(refused, "'client' must not be a role on the staff users table");
  db.close();
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test("a client login belongs to exactly one client", () => {
  const db = freshDb();
  seed(db);
  const row = db.prepare("SELECT client_id FROM client_users WHERE id='cu1'").get() as {
    client_id: string;
  };
  assert.equal(row.client_id, "c1");
  // There is no second client_id column and no join table: a login cannot span two.
  const cols = db
    .prepare("PRAGMA table_info(client_users)")
    .all()
    .map((c) => String((c as { name: unknown }).name));
  assert.equal(cols.filter((c) => c === "client_id").length, 1);
  db.close();
});

test("one email address gets one login across the whole firm", () => {
  // Two clients naming the same accountant would otherwise give one address two
  // sign-ins, and no way for the sign-in form to know which was meant.
  const db = freshDb();
  seed(db);
  let refused = false;
  try {
    db.exec(`INSERT INTO client_users
               (id,client_id,email,full_name,status,created_at,updated_at)
             VALUES ('cu2','c2','KOFI@adomfoods.test','Kofi Adom','invited','${NOW}','${NOW}')`);
  } catch (err) {
    refused = /UNIQUE/.test(String(err));
  }
  assert.ok(refused, "and the match is case-insensitive");
  db.close();
});

test("deleting a client takes its logins and their sessions with it", () => {
  const db = freshDb();
  seed(db);
  db.exec(`DELETE FROM clients WHERE id='c1'`);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM client_users").get() as { n: number }).n, 0);
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM client_sessions").get() as { n: number }).n,
    0,
    "a session outliving its account would be a live credential for a deleted client",
  );
  db.close();
});

test("a password is not set until the client sets one", () => {
  // The firm never knows a client's password: nobody types a temporary one for them.
  const db = freshDb();
  seed(db);
  db.exec(`INSERT INTO client_users (id,client_id,email,full_name,status,created_at,updated_at)
           VALUES ('cu3','c2','ama@keta.test','Ama Keta','invited','${NOW}','${NOW}')`);
  const row = db.prepare("SELECT password_hash, status FROM client_users WHERE id='cu3'").get() as {
    password_hash: string | null;
    status: string;
  };
  assert.equal(row.password_hash, null);
  assert.equal(row.status, "invited");
  db.close();
});

test("an invitation stores a digest, never the token", () => {
  // A copy of this table must open nothing.
  const db = freshDb();
  seed(db);
  db.exec(`INSERT INTO client_invitations (id,client_user_id,expires_at,created_at)
           VALUES ('sha256-of-the-token','cu1','${LATER}','${NOW}')`);
  const cols = db
    .prepare("PRAGMA table_info(client_invitations)")
    .all()
    .map((c) => String((c as { name: unknown }).name));
  assert.ok(!cols.includes("token"));
  assert.ok(cols.includes("expires_at"), "and it expires");
  assert.ok(cols.includes("used_at"), "and it is one-time");
  assert.ok(INVITATION_TTL_DAYS > 0 && INVITATION_TTL_DAYS <= 30);
  db.close();
});

// ---------------------------------------------------------------------------
// The subscription itself
// ---------------------------------------------------------------------------

test("a client has at most one subscription", () => {
  const db = freshDb();
  seed(db);
  db.exec(`INSERT INTO client_subscriptions (client_id,tier,started_on,created_at,updated_at)
           VALUES ('c1','growth','2026-03-12','${NOW}','${NOW}')`);
  let refused = false;
  try {
    db.exec(`INSERT INTO client_subscriptions (client_id,tier,started_on,created_at,updated_at)
             VALUES ('c1','starter','2026-04-01','${NOW}','${NOW}')`);
  } catch (err) {
    refused = /UNIQUE|PRIMARY/.test(String(err));
  }
  assert.ok(refused);
  db.close();
});

test("a client cannot be put on a package that does not exist", () => {
  /*
   * The tier columns used to spell the packages into CHECK constraints, which meant
   * adding the fourth one rebuilt four tables. They are foreign keys onto
   * `subscription_tiers` now, so the catalogue is the single list - but the refusal has
   * to survive that change, or a typo would put a client on a package with no price.
   */
  const db = freshDb();
  seed(db);
  let refused = false;
  try {
    db.exec(`INSERT INTO client_subscriptions (client_id,tier,started_on,created_at,updated_at)
             VALUES ('c1','platinum','2026-03-12','${NOW}','${NOW}')`);
  } catch (err) {
    refused = /FOREIGN KEY/i.test(String(err));
  }
  assert.ok(refused);

  // And every package the code knows about is one the catalogue holds.
  const stored = new Set(
    db.prepare("SELECT tier FROM subscription_tiers").all().map((r) => String((r as { tier: unknown }).tier)),
  );
  for (const tier of CLIENT_TIERS) assert.ok(stored.has(tier), tier);
  assert.equal(stored.size, CLIENT_TIERS.length);
  db.close();
});

test("recording the same month twice corrects it rather than duplicating it", () => {
  // Two rows for August would make "the newest figure" depend on insertion order.
  const db = freshDb();
  seed(db);
  const insert = `INSERT INTO client_figures
      (id,client_id,criterion_id,value,as_of,recorded_by,recorded_at)
    VALUES (?,'c1','crit_staff',?, '2026-08-31','staff1','${NOW}')`;
  db.prepare(insert).run("f1", 18);
  let refused = false;
  try {
    db.prepare(insert).run("f2", 19);
  } catch (err) {
    refused = /UNIQUE/.test(String(err));
  }
  assert.ok(refused, "the same criterion on the same date is one figure");

  // A different month is a different figure, which is what makes a trend readable.
  db.prepare(
    `INSERT INTO client_figures (id,client_id,criterion_id,value,as_of,recorded_by,recorded_at)
     VALUES ('f3','c1','crit_staff',19,'2026-09-30','staff1','${NOW}')`,
  ).run();
  assert.equal((db.prepare("SELECT COUNT(*) n FROM client_figures").get() as { n: number }).n, 2);
  db.close();
});

test("removing a staff member leaves the figures they recorded", () => {
  // The figure is a fact about the client, not about the person who typed it.
  const db = freshDb();
  seed(db);
  db.exec(`INSERT INTO client_figures (id,client_id,criterion_id,value,as_of,recorded_by,recorded_at)
           VALUES ('f1','c1','crit_staff',18,'2026-08-31','staff1','${NOW}')`);
  db.exec(`DELETE FROM users WHERE id='staff1'`);
  const row = db.prepare("SELECT value, recorded_by FROM client_figures WHERE id='f1'").get() as {
    value: number;
    recorded_by: string | null;
  };
  assert.equal(row.value, 18);
  assert.equal(row.recorded_by, null);
  db.close();
});

test("retiring a service from the catalogue does not erase what was sold", () => {
  const db = freshDb();
  seed(db);
  db.exec(`INSERT INTO additional_services (id,name,fee,fee_basis,created_at)
           VALUES ('svc1','Tax health check',4500,'fixed','${NOW}')`);
  db.exec(`INSERT INTO client_services
             (id,client_id,service_id,name,status,quoted_fee,created_at,updated_at)
           VALUES ('cs1','c1','svc1','Tax health check','delivered',4500,'${NOW}','${NOW}')`);
  db.exec(`DELETE FROM additional_services WHERE id='svc1'`);
  const row = db.prepare("SELECT name, quoted_fee, service_id FROM client_services WHERE id='cs1'").get() as {
    name: string;
    quoted_fee: number;
    service_id: string | null;
  };
  assert.equal(row.name, "Tax health check", "the name was copied at the time, not joined");
  assert.equal(row.quoted_fee, 4500);
  assert.equal(row.service_id, null);
  db.close();
});

test("a request records which client person asked, and survives them leaving", () => {
  const db = freshDb();
  seed(db);
  db.exec(`INSERT INTO client_services
             (id,client_id,name,status,requested_by,requested_at,created_at,updated_at)
           VALUES ('cs1','c1','Tax health check','requested','cu1','${NOW}','${NOW}','${NOW}')`);
  db.exec(`DELETE FROM client_users WHERE id='cu1'`);
  const row = db.prepare("SELECT status, requested_by FROM client_services WHERE id='cs1'").get() as {
    status: string;
    requested_by: string | null;
  };
  assert.equal(row.status, "requested");
  assert.equal(row.requested_by, null);
  db.close();
});

test("the ceilings say what the package descriptions say", () => {
  /*
   * shared/allocations.ts says Starter is up to 8,000 a month and Growth between 8,000
   * and 15,000, because the firm's pricing proposal says so. If those ever disagree
   * with the seeded ceilings, one of them is lying to somebody.
   *
   * Firm and Enterprise carry no ceiling deliberately: nothing in the proposal separates
   * them by a number.
   */
  const db = freshDb();
  const band = Object.fromEntries(
    db
      .prepare("SELECT tier, ceiling FROM tier_ceilings WHERE criterion_id='crit_monthly_turnover'")
      .all()
      .map((r) => [String((r as { tier: unknown }).tier), (r as { ceiling: number | null }).ceiling]),
  );
  assert.equal(band.starter, 8000);
  assert.equal(band.growth, 15000);
  assert.equal(band.firm, null);
  assert.equal(band.enterprise, null, "the top package has no ceiling, so everybody fits it");
  db.close();
});

test("no ceiling the firm never set survives", () => {
  /*
   * The staff, transaction and annual-turnover ceilings were mine, not the firm's, and
   * a made-up ceiling is worse than none: it tells a Partner a client has outgrown their
   * package on a number nobody ever agreed to.
   */
  const db = freshDb();
  const invented = db
    .prepare(
      `SELECT COUNT(*) n FROM tier_ceilings
        WHERE ceiling IS NOT NULL AND criterion_id <> 'crit_monthly_turnover'`,
    )
    .get() as { n: number };
  assert.equal(invented.n, 0);
  db.close();
});

test("every package is priced, and priced from the firm's own proposal", () => {
  /*
   * The prices were invented when this test was written and are not any more: the firm
   * attached the proposal it sends clients, and these are the four figures on it. A
   * package with no price cannot be quoted or invoiced, so a missing one is a bug.
   */
  const db = freshDb();
  const priced = Object.fromEntries(
    db
      .prepare("SELECT tier, monthly_fee, currency FROM subscription_tiers")
      .all()
      .map((r) => [
        String((r as { tier: unknown }).tier),
        [(r as { monthly_fee: number }).monthly_fee, (r as { currency: string }).currency],
      ]),
  );
  assert.deepEqual(priced.starter, [400, "USD"]);
  assert.deepEqual(priced.growth, [750, "USD"]);
  assert.deepEqual(priced.firm, [1250, "USD"]);
  assert.deepEqual(priced.enterprise, [2800, "USD"]);
  db.close();
});

test("a price a Partner has already set is never overwritten by the migration", () => {
  /*
   * The prices are written by an UPDATE guarded on the fee being unset. A deployment
   * where somebody had already entered GHS 4,500 for Growth must still say GHS 4,500
   * afterwards - a migration that replaced a real price with a figure from a document
   * would change what clients are billed without anybody deciding to.
   */
  const db = new DatabaseSync(":memory:");
  const files = readdirSync("migrations").sort();
  for (const name of files) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
    // Between the package tables existing and the packages migration running.
    if (name.startsWith("0029")) {
      db.exec(
        `UPDATE subscription_tiers SET monthly_fee = 4500, currency = 'GHS' WHERE tier = 'growth'`,
      );
    }
  }
  const growth = db
    .prepare("SELECT monthly_fee, currency FROM subscription_tiers WHERE tier = 'growth'")
    .get() as { monthly_fee: number; currency: string };
  assert.equal(growth.monthly_fee, 4500);
  assert.equal(growth.currency, "GHS");
  db.close();
});

test("every package says who it is for and what is in it", () => {
  // A package with no inclusions is a column of white space on the proposal.
  const db = freshDb();
  for (const tier of CLIENT_TIERS) {
    const row = db
      .prepare("SELECT ideal_for, summary FROM subscription_tiers WHERE tier = ?")
      .get(tier) as { ideal_for: string | null; summary: string | null };
    assert.ok(row.ideal_for, `${tier} has no "ideal for"`);
    assert.ok(row.summary, `${tier} has no summary`);
    const count = db
      .prepare("SELECT COUNT(*) n FROM tier_inclusions WHERE tier = ?")
      .get(tier) as { n: number };
    assert.ok(count.n > 0, `${tier} includes nothing`);
  }
  db.close();
});

test("each package includes everything the one below it does", () => {
  /*
   * The proposal is read as a ladder - "everything in Growth, and..." - and a client
   * comparing two columns is checking exactly that. A package that quietly dropped a
   * line the cheaper one carries would be a downgrade somebody paid more for.
   */
  const db = freshDb();
  const labels = (tier: string) =>
    new Set(
      db
        .prepare("SELECT label FROM tier_inclusions WHERE tier = ?")
        .all(tier)
        .map((r) => String((r as { label: unknown }).label)),
    );
  for (let i = 1; i < CLIENT_TIERS.length; i += 1) {
    const below = labels(CLIENT_TIERS[i - 1]);
    const above = labels(CLIENT_TIERS[i]);
    for (const line of below) {
      assert.ok(above.has(line), `${CLIENT_TIERS[i]} drops "${line}"`);
    }
  }
  db.close();
});
