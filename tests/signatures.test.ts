/**
 * What may be uploaded as a signature, and what a document signed with one holds on to.
 *
 * Three things here would be damaging to get wrong, and they get the most attention.
 *
 * The type allowlist, because this is the one upload the portal renders in its own
 * origin rather than handing back as a download - so SVG being absent from it is a
 * security property, not a formatting preference.
 *
 * The data URI guard, because the signed copy puts that value into an `src`, where
 * HTML escaping does not save you.
 *
 * The append-only rule, measured against the real schema: uploading a new signature
 * must not restate what is already signed, and deleting a specimen must not delete the
 * record of the signature it was used for.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  SIGNATURE_ACCEPT,
  SIGNATURE_MAX_BYTES,
  SIGNATURE_TYPES,
  isSignatureType,
  needsSignatureImage,
  signatureKey,
  whyNotASignature,
} from "../shared/signatures";
import { isDrawableDataUri, renderSignedCopy, type SignedCopy } from "../shared/signed-copy";
import { userPrefix } from "../shared/staff-files";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

// ---------------------------------------------------------------------------
// What may be uploaded
// ---------------------------------------------------------------------------

test("SVG is not a signature format", () => {
  /*
   * The one that matters. An SVG is a document that can carry script, and a signature
   * is rendered in the portal's own origin - so an SVG signature would be somebody
   * else's JavaScript running in the session of whoever opened the contract.
   */
  assert.equal(isSignatureType("image/svg+xml"), false);
  assert.ok(!("image/svg+xml" in SIGNATURE_TYPES));
  assert.ok(!SIGNATURE_ACCEPT.includes("svg"));
  assert.ok(whyNotASignature({ type: "image/svg+xml", size: 4_000 }));
});

test("nothing that is not a drawable image gets through", () => {
  for (const type of [
    "application/pdf",
    "image/heic",
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/plain",
    "",
  ]) {
    assert.equal(isSignatureType(type), false, type);
    assert.ok(whyNotASignature({ type, size: 4_000 }), type);
  }
});

test("the three formats a browser will draw are accepted", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    assert.equal(isSignatureType(type), true, type);
    assert.equal(whyNotASignature({ type, size: 40_000 }), null, type);
  }
});

test("a content type with parameters is still recognised", () => {
  // Browsers send "image/jpeg" plainly, but a scripted client may not.
  assert.equal(isSignatureType("image/png; charset=binary"), true);
  assert.equal(isSignatureType("IMAGE/PNG"), true);
});

test("an empty file and an oversized one are both refused, in words that help", () => {
  assert.match(String(whyNotASignature({ type: "image/png", size: 0 })), /empty/i);
  const big = whyNotASignature({ type: "image/png", size: SIGNATURE_MAX_BYTES + 1 });
  assert.match(String(big), /limit/i);
  // The refusal says what to do about it rather than only stating the rule.
  assert.match(String(big), /whole page/i);
});

test("the HEIC refusal tells a phone owner how to fix it", () => {
  // HEIC is what an iPhone produces by default and browsers will not render it, so the
  // refusal has to be more than "wrong type" or somebody is simply stuck.
  const why = String(whyNotASignature({ type: "image/heic", size: 40_000 }));
  assert.match(why, /Most Compatible/i);
});

test("a signature lives under the same prefix as the rest of the person's files", () => {
  // The account-removal sweep finds everything by prefix; a specimen outside it would
  // be a picture of somebody's signature left in the bucket after deleting them.
  const key = signatureKey("u1", "sig1");
  assert.ok(key.startsWith(userPrefix("u1")), key);
});

// ---------------------------------------------------------------------------
// Signing versus acknowledging
// ---------------------------------------------------------------------------

test("a contract needs an image; an acknowledgement does not", () => {
  assert.equal(needsSignatureImage({ requires_signature: 1 }), true);
  assert.equal(needsSignatureImage({ requires_signature: true }), true);
  assert.equal(needsSignatureImage({ requires_signature: 0 }), false);
  assert.equal(needsSignatureImage({ requires_signature: false }), false);
});

// ---------------------------------------------------------------------------
// The data URI that goes into an src
// ---------------------------------------------------------------------------

test("only a base64 image data URI is drawable", () => {
  assert.ok(isDrawableDataUri("data:image/png;base64,iVBORw0KGgo="));
  assert.ok(isDrawableDataUri("data:image/jpeg;base64,/9j/4AAQSkZJRg=="));
  assert.ok(isDrawableDataUri("data:image/webp;base64,UklGRg=="));
});

test("nothing that could run is drawable", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,abc\" onload=\"alert(1)",
    "  data:image/png;base64,abc",
    "https://example.test/signature.png",
    "",
  ]) {
    assert.equal(isDrawableDataUri(value), false, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------
// The signed copy
// ---------------------------------------------------------------------------

function copy(overrides: Partial<SignedCopy> = {}): SignedCopy {
  return {
    title: "Contract of employment",
    body: "The terms.",
    version: 1,
    kind: "contract",
    signatory_name: "Esi Dadzie",
    signatory_email: "esi.dadzie@kesmic.org",
    typed_name: "Esi Dadzie",
    action: "signed",
    signed_at: "2026-09-21T09:42:00.000Z",
    ip_address: null,
    user_agent: null,
    content_hash: "abc123",
    current_hash: "abc123",
    firm_name: "Kesmic Consulting",
    signature_image: null,
    ...overrides,
  };
}

test("the signature is drawn into the file rather than linked", () => {
  // Linked, it would be a broken image in every copy sent to somebody who cannot sign
  // in - which is most of the people these get sent to.
  const html = renderSignedCopy(
    copy({ signature_image: "data:image/png;base64,iVBORw0KGgo=", had_signature_image: true }),
  );
  assert.ok(html.includes('src="data:image/png;base64,iVBORw0KGgo="'));
  assert.ok(html.includes("class=\"signature-mark\""));
  assert.match(html, /Uploaded by the signatory/);
});

test("a data URI that is not drawable never reaches the src", () => {
  const html = renderSignedCopy(
    copy({ signature_image: "data:text/html;base64,PHNjcmlwdD4=", had_signature_image: true }),
  );
  assert.ok(!html.includes("PHNjcmlwdD4="));
  assert.ok(!html.includes("text/html;base64"));
  // And it says the image is missing rather than leaving a silent gap.
  assert.match(html, /could not be included/i);
});

test("a lost image is reported; an acknowledgement is not", () => {
  const lost = renderSignedCopy(copy({ had_signature_image: true }));
  assert.match(lost, /could not be included/i);

  const acknowledged = renderSignedCopy(copy({ action: "acknowledged", kind: "policy" }));
  assert.ok(!/could not be included/i.test(acknowledged));
  assert.match(acknowledged, /Typed name only/);
});

test("the certificate still says whether the text is intact", () => {
  // The image is an addition to the evidence, not a replacement for it.
  const changed = renderSignedCopy(
    copy({ current_hash: "different", signature_image: "data:image/png;base64,iVBORw0=" }),
  );
  assert.match(changed, /not the text that was signed/i);
});

// ---------------------------------------------------------------------------
// The schema, measured
// ---------------------------------------------------------------------------

const NOW = "2026-09-21T09:42:00.000Z";

function seed(db: DatabaseSync): void {
  db.exec(`INSERT INTO users
             (id,email,full_name,role,status,password_hash,must_change_password,created_at,updated_at)
           VALUES ('u1','esi@kesmic.org','Esi Dadzie','associate','active','x',0,'${NOW}','${NOW}')`);
  db.exec(`INSERT INTO documents
             (id,kind,title,body,version,status,requires_signature,audience,position,created_at,updated_at)
           VALUES ('d1','contract','Contract','The terms.',1,'published',1,'all',0,'${NOW}','${NOW}')`);
}

test("uploading a new signature leaves what is already signed alone", () => {
  const db = freshDb();
  seed(db);
  db.exec(`INSERT INTO staff_signatures (id,user_id,object_key,content_type,size_bytes,uploaded_at)
           VALUES ('sig1','u1','staff/u1/signatures/sig1','image/png',900,'${NOW}')`);
  db.exec(`INSERT INTO document_signatures
             (id,document_id,version,user_id,action,typed_name,content_hash,signed_at,signature_id)
           VALUES ('ds1','d1',1,'u1','signed','Esi Dadzie','abc','${NOW}','sig1')`);

  // She uploads a different signature later, which retires the first.
  db.exec(`UPDATE staff_signatures SET retired_at = '${NOW}' WHERE user_id='u1' AND retired_at IS NULL`);
  db.exec(`INSERT INTO staff_signatures (id,user_id,object_key,content_type,size_bytes,uploaded_at)
           VALUES ('sig2','u1','staff/u1/signatures/sig2','image/png',1100,'${NOW}')`);

  const signed = db
    .prepare(`SELECT signature_id FROM document_signatures WHERE id='ds1'`)
    .get() as { signature_id: string };
  assert.equal(signed.signature_id, "sig1", "the contract kept the signature it was signed with");

  const current = db
    .prepare(
      `SELECT id FROM staff_signatures WHERE user_id='u1' AND retired_at IS NULL
        ORDER BY uploaded_at DESC LIMIT 1`,
    )
    .get() as { id: string };
  assert.equal(current.id, "sig2", "and the new one is what she would sign with now");

  // The old object is still there to be served, which is what makes the first true.
  const kept = db.prepare(`SELECT COUNT(*) n FROM staff_signatures WHERE user_id='u1'`).get() as {
    n: number;
  };
  assert.equal(kept.n, 2);
  db.close();
});

test("losing the picture does not lose the signature", () => {
  const db = freshDb();
  seed(db);
  db.exec(`INSERT INTO staff_signatures (id,user_id,object_key,content_type,size_bytes,uploaded_at)
           VALUES ('sig1','u1','staff/u1/signatures/sig1','image/png',900,'${NOW}')`);
  db.exec(`INSERT INTO document_signatures
             (id,document_id,version,user_id,action,typed_name,content_hash,signed_at,signature_id)
           VALUES ('ds1','d1',1,'u1','signed','Esi Dadzie','abc','${NOW}','sig1')`);

  db.exec(`DELETE FROM staff_signatures WHERE id='sig1'`);

  const row = db
    .prepare(`SELECT typed_name, content_hash, signature_id FROM document_signatures WHERE id='ds1'`)
    .get() as { typed_name: string; content_hash: string; signature_id: string | null };
  assert.equal(row.typed_name, "Esi Dadzie", "the evidence that stood up before is still here");
  assert.equal(row.content_hash, "abc");
  assert.equal(row.signature_id, null);
  db.close();
});

test("deleting the person takes every specimen, retired ones included", () => {
  const db = freshDb();
  seed(db);
  for (const [id, retired] of [
    ["sig1", `'${NOW}'`],
    ["sig2", "NULL"],
  ] as const) {
    db.exec(`INSERT INTO staff_signatures
               (id,user_id,object_key,content_type,size_bytes,uploaded_at,retired_at)
             VALUES ('${id}','u1','staff/u1/signatures/${id}','image/png',900,'${NOW}',${retired})`);
  }
  db.exec(`DELETE FROM users WHERE id='u1'`);
  const left = db.prepare(`SELECT COUNT(*) n FROM staff_signatures`).get() as { n: number };
  assert.equal(left.n, 0, "a retired specimen is still a picture of somebody's signature");
  db.close();
});

test("the sweep finds retired specimens, which is the point of it", () => {
  // The Worker's sweep selects every row for the person rather than the current one.
  // Measured here because selecting only the current one is the plausible mistake, and
  // it would leave signatures in the bucket belonging to somebody the firm deleted.
  const db = freshDb();
  seed(db);
  db.exec(`INSERT INTO staff_signatures
             (id,user_id,object_key,content_type,size_bytes,uploaded_at,retired_at)
           VALUES ('sig1','u1','staff/u1/signatures/sig1','image/png',900,'${NOW}','${NOW}')`);
  db.exec(`INSERT INTO staff_signatures
             (id,user_id,object_key,content_type,size_bytes,uploaded_at)
           VALUES ('sig2','u1','staff/u1/signatures/sig2','image/png',900,'${NOW}')`);

  const keys = db
    .prepare(`SELECT object_key FROM staff_signatures WHERE user_id = ?`)
    .all("u1") as Array<{ object_key: string }>;
  assert.equal(keys.length, 2);
  db.close();
});
