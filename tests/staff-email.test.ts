/**
 * Working out a work email address, and the rules around handing it over.
 *
 * The portal does not create mailboxes, so there is no API to get wrong. What is left
 * is arithmetic on names and a small number of rules that matter a great deal if they
 * are wrong: an address two people share is two people reading each other's post, and
 * a password sent to the mailbox it opens is a password nobody receives.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADDRESS_PATTERNS,
  DEFAULT_STAFF_EMAIL,
  EMAIL_HOSTS,
  EMAIL_HOST_SPECS,
  hostAdminUrl,
  hostLabel,
  isConfigured,
  isOnFirmDomain,
  readStaffEmail,
  slug,
  suggestAddress,
  whyNotAnAddress,
  writeStaffEmail,
  type StaffEmailPolicy,
} from "../shared/staff-email";

const policy = (over: Partial<StaffEmailPolicy> = {}): StaffEmailPolicy => ({
  ...DEFAULT_STAFF_EMAIL,
  enabled: true,
  domain: "kesmic.org",
  ...over,
});

// ---------------------------------------------------------------------------
// Names into addresses
// ---------------------------------------------------------------------------

test("the patterns produce the addresses they advertise", () => {
  assert.equal(suggestAddress("Ama Mensah", policy()), "ama.mensah@kesmic.org");
  assert.equal(
    suggestAddress("Ama Mensah", policy({ pattern: "f.last" })),
    "a.mensah@kesmic.org",
  );
  assert.equal(
    suggestAddress("Ama Mensah", policy({ pattern: "first" })),
    "ama@kesmic.org",
  );
});

test("set by hand means the portal suggests nothing", () => {
  assert.equal(suggestAddress("Ama Mensah", policy({ pattern: "manual" })), "");
});

test("a middle name is ignored, not jammed into the address", () => {
  assert.equal(
    suggestAddress("Ama Serwaa Mensah", policy()),
    "ama.mensah@kesmic.org",
  );
});

test("a double-barrelled surname keeps its hyphen", () => {
  assert.equal(
    suggestAddress("Ekua Mensah-Appiah", policy()),
    "ekua.mensah-appiah@kesmic.org",
  );
});

test("accents are folded rather than dropped", () => {
  // Dropping them would turn Zoë into zo, which is somebody else's address.
  assert.equal(slug("Zoë"), "zoe");
  assert.equal(slug("Bâ"), "ba");
  assert.equal(suggestAddress("Zoë Bâ", policy()), "zoe.ba@kesmic.org");
});

test("an apostrophe disappears rather than becoming a separator", () => {
  assert.equal(slug("O'Brien"), "obrien");
  assert.equal(suggestAddress("Sean O'Brien", policy()), "sean.obrien@kesmic.org");
});

test("one name gives one word, whatever the pattern asks for", () => {
  // f.last with no last name would otherwise produce ".mensah" or "a.".
  for (const pattern of ADDRESS_PATTERNS) {
    if (pattern === "manual") continue;
    const address = suggestAddress("Kwame", policy({ pattern }));
    assert.equal(address, "kwame@kesmic.org", pattern);
  }
});

test("no domain means no suggestion, never an address ending in @", () => {
  assert.equal(suggestAddress("Ama Mensah", policy({ domain: "" })), "");
});

test("a domain typed with its @ still works", () => {
  assert.equal(
    suggestAddress("Ama Mensah", policy({ domain: "@kesmic.org" })),
    "ama.mensah@kesmic.org",
  );
});

test("a name that is only punctuation yields nothing rather than junk", () => {
  assert.equal(suggestAddress("...", policy()), "");
  assert.equal(suggestAddress("   ", policy()), "");
});

// ---------------------------------------------------------------------------
// What is a usable address
// ---------------------------------------------------------------------------

test("ordinary addresses are accepted", () => {
  for (const a of [
    "ama.mensah@kesmic.org",
    "a.mensah@kesmic.org",
    "ama+payroll@kesmic.org",
    "ama_mensah@sub.kesmic.org",
  ]) {
    assert.equal(whyNotAnAddress(a), null, a);
  }
});

test("addresses nobody could use are refused, with a reason", () => {
  for (const a of [
    "",
    "ama.mensah",
    "@kesmic.org",
    "ama@",
    "ama@@kesmic.org",
    "ama@kesmic",
    ".ama@kesmic.org",
    "ama.@kesmic.org",
    "ama..mensah@kesmic.org",
    "ama mensah@kesmic.org",
  ]) {
    assert.ok(whyNotAnAddress(a), `${JSON.stringify(a)} was accepted`);
  }
});

test("the firm's own domain is recognised, whatever the casing", () => {
  // This is the test that stops a mailbox password being sent to the mailbox.
  assert.ok(isOnFirmDomain("ama.mensah@kesmic.org", policy()));
  assert.ok(isOnFirmDomain("AMA.MENSAH@KESMIC.ORG", policy()));
  assert.equal(isOnFirmDomain("ama.mensah@gmail.com", policy()), false);
});

test("a lookalike domain is not the firm's domain", () => {
  // notkesmic.org ends with the same letters; it is not the same domain.
  assert.equal(isOnFirmDomain("ama@notkesmic.org", policy()), false);
});

// ---------------------------------------------------------------------------
// The setting
// ---------------------------------------------------------------------------

test("every host has a label, and every host but Other has somewhere to go", () => {
  for (const host of EMAIL_HOSTS) {
    const spec = EMAIL_HOST_SPECS[host];
    if (host === "other") continue;
    assert.ok(spec.label, host);
    assert.ok(spec.adminUrl.startsWith("https://"), host);
    assert.ok(spec.signInAt.startsWith("https://"), host);
  }
});

test("a host the firm names itself is used in place of a blank label", () => {
  const p = policy({ host: "other", host_name: "Fastmail" });
  assert.equal(hostLabel(p), "Fastmail");
  assert.equal(hostAdminUrl(p), "");
  // Named but empty falls back to something readable rather than printing nothing.
  assert.ok(hostLabel(policy({ host: "other", host_name: "  " })).length > 0);
});

test("switched on but half-filled does not count as set up", () => {
  assert.equal(isConfigured(policy({ enabled: false })), false);
  assert.equal(isConfigured(policy({ domain: "" })), false);
  assert.equal(isConfigured(policy({ host: "other", host_name: "" })), false);
  assert.ok(isConfigured(policy()));
  assert.ok(isConfigured(policy({ host: "other", host_name: "Fastmail" })));
});

test("the setting round-trips", () => {
  const p = policy({ host: "other", host_name: "Fastmail", pattern: "f.last" });
  assert.deepEqual(readStaffEmail(writeStaffEmail(p)), p);
});

test("a nonsense setting falls back to off rather than to something invented", () => {
  for (const raw of ["", "null", "[]", "not json", '{"host":"carrier-pigeon"}']) {
    const p = readStaffEmail(raw);
    assert.equal(p.enabled, false, raw);
    assert.ok(EMAIL_HOSTS.includes(p.host), raw);
    assert.ok(ADDRESS_PATTERNS.includes(p.pattern), raw);
  }
});

test("a host name is only kept for the host that uses it", () => {
  // Otherwise a firm that tried Other and went back to Microsoft would carry a stale
  // name around, ready to reappear if they switched again.
  const stored = writeStaffEmail(
    policy({ host: "microsoft365", host_name: "Fastmail" }),
  );
  assert.equal(readStaffEmail(stored).host_name, "");
});

test("the domain is normalised on the way in", () => {
  const p = readStaffEmail(writeStaffEmail(policy({ domain: "  @KESMIC.ORG " })));
  assert.equal(p.domain, "kesmic.org");
});

test("nothing is on by default", () => {
  // A portal nobody has configured must not start suggesting addresses at a domain
  // it invented.
  assert.equal(DEFAULT_STAFF_EMAIL.enabled, false);
  assert.equal(isConfigured(DEFAULT_STAFF_EMAIL), false);
});
