/**
 * Where somebody stands on a certification, and when it runs out.
 *
 * The list of tools and courses is the firm's to maintain, so there is nothing to test
 * about it. What is worth testing is the arithmetic, because "certified" is not a fact
 * that stays true - Xero Advisor and the QuickBooks ProAdvisor certification both lapse
 * after a year - and a portal that reports somebody as certified when their certificate
 * expired in March is worse than one that says nothing, because the firm will believe
 * it and send them to a client.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CERT_STATES,
  CERT_STATE_LABELS,
  EXPIRY_WARNING_DAYS,
  certDetail,
  certState,
  daysBetween,
  describeValidity,
  expiryDate,
  needsAttention,
  whyNotALink,
  whyNotAName,
  whyNotValidity,
  type CertRecord,
} from "../shared/certifications";

const TODAY = "2026-09-20";
const rec = (over: Partial<CertRecord> = {}): CertRecord => ({
  progress: "assigned",
  ...over,
});

// ---------------------------------------------------------------------------
// Expiry dates
// ---------------------------------------------------------------------------

test("a year's validity lands on the same day next year", () => {
  assert.equal(expiryDate("2026-08-04", 12), "2027-08-04");
});

test("a certification that does not expire has no expiry date", () => {
  for (const months of [null, undefined, 0]) {
    assert.equal(expiryDate("2026-08-04", months), null, String(months));
  }
});

test("the end of a long month clamps rather than rolling into the next", () => {
  // 31 January plus one month is 28 February, not 3 March. Rolling over would
  // quietly extend every renewal that happened to land at a month end.
  assert.equal(expiryDate("2026-01-31", 1), "2026-02-28");
  assert.equal(expiryDate("2026-03-31", 1), "2026-04-30");
});

test("a leap year is respected", () => {
  assert.equal(expiryDate("2028-01-31", 1), "2028-02-29");
  assert.equal(expiryDate("2027-02-28", 12), "2028-02-28");
});

test("two years crosses the year boundary correctly", () => {
  assert.equal(expiryDate("2026-11-15", 24), "2028-11-15");
  assert.equal(expiryDate("2026-12-01", 13), "2028-01-01");
});

test("a malformed completion date yields nothing rather than a wrong date", () => {
  assert.equal(expiryDate("", 12), null);
  assert.equal(expiryDate("not-a-date", 12), null);
});

// ---------------------------------------------------------------------------
// Where somebody stands
// ---------------------------------------------------------------------------

test("nothing started, no date set", () => {
  assert.equal(certState(rec(), TODAY), "not_started");
});

test("started is distinct from not started", () => {
  assert.equal(certState(rec({ progress: "in_progress" }), TODAY), "in_progress");
});

test("a date that has passed makes it overdue, started or not", () => {
  assert.equal(certState(rec({ due_on: "2026-09-19" }), TODAY), "overdue");
  assert.equal(
    certState(rec({ progress: "in_progress", due_on: "2026-09-19" }), TODAY),
    "overdue",
  );
});

test("a date that falls today is not yet overdue", () => {
  // They have the day. Marking it overdue at midnight would be a day early.
  assert.equal(certState(rec({ due_on: TODAY }), TODAY), "not_started");
});

test("certified with no expiry stays certified", () => {
  assert.equal(certState(rec({ progress: "certified" }), TODAY), "certified");
});

test("expiry beats completion", () => {
  // The failure this guards: reporting somebody as certified when their certificate
  // lapsed, which is how an uncertified person is sent to a client.
  assert.equal(
    certState(rec({ progress: "certified", expires_on: "2026-03-01" }), TODAY),
    "expired",
  );
});

test("the warning window opens exactly where it says", () => {
  const onTheEdge = "2026-11-19"; // 60 days from TODAY
  const justOutside = "2026-11-20"; // 61 days
  assert.equal(daysBetween(TODAY, onTheEdge), EXPIRY_WARNING_DAYS);
  assert.equal(
    certState(rec({ progress: "certified", expires_on: onTheEdge }), TODAY),
    "expiring",
  );
  assert.equal(
    certState(rec({ progress: "certified", expires_on: justOutside }), TODAY),
    "certified",
  );
});

test("expiring today is expiring, not expired", () => {
  assert.equal(
    certState(rec({ progress: "certified", expires_on: TODAY }), TODAY),
    "expiring",
  );
});

test("finishing late is finished, not still overdue", () => {
  // The lateness is a fact about when they did it, not work still outstanding. A
  // portal that kept calling this overdue would be asking for a course already passed.
  const late = rec({
    progress: "certified",
    due_on: "2026-01-01",
    completed_on: "2026-06-01",
    expires_on: "2027-06-01",
  });
  assert.equal(certState(late, TODAY), "certified");
});

// ---------------------------------------------------------------------------
// What the screen says
// ---------------------------------------------------------------------------

test("the detail line counts days rather than saying 'soon'", () => {
  assert.equal(
    certDetail(rec({ progress: "certified", expires_on: "2026-09-23" }), TODAY),
    "Expires in 3 days",
  );
  assert.equal(
    certDetail(rec({ progress: "certified", expires_on: TODAY }), TODAY),
    "Expires today",
  );
  assert.equal(
    certDetail(rec({ progress: "certified", expires_on: "2026-09-19" }), TODAY),
    "Expired 1 day ago",
  );
  assert.equal(
    certDetail(rec({ due_on: "2026-09-13" }), TODAY),
    "Was due 7 days ago",
  );
});

test("singular and plural are both handled", () => {
  assert.ok(certDetail(rec({ progress: "certified", expires_on: "2026-09-21" }), TODAY)?.endsWith("1 day"));
  assert.ok(certDetail(rec({ progress: "certified", expires_on: "2026-09-22" }), TODAY)?.endsWith("2 days"));
});

test("every state has a label", () => {
  for (const state of CERT_STATES) {
    assert.ok(CERT_STATE_LABELS[state], state);
  }
});

test("only the states the firm must act on need attention", () => {
  assert.ok(needsAttention("overdue"));
  assert.ok(needsAttention("expiring"));
  assert.ok(needsAttention("expired"));
  assert.equal(needsAttention("certified"), false);
  assert.equal(needsAttention("not_started"), false);
  assert.equal(needsAttention("in_progress"), false);
});

// ---------------------------------------------------------------------------
// What the firm may type
// ---------------------------------------------------------------------------

test("validity reads as a person would say it", () => {
  assert.equal(describeValidity(null), "Does not expire");
  assert.equal(describeValidity(0), "Does not expire");
  assert.equal(describeValidity(12), "12 months");
  assert.equal(describeValidity(24), "2 years");
  assert.equal(describeValidity(18), "18 months");
});

test("a name is required and bounded", () => {
  assert.ok(whyNotAName("", "tool"));
  assert.ok(whyNotAName("   ", "tool"));
  assert.ok(whyNotAName("x".repeat(121), "tool"));
  assert.equal(whyNotAName("Xero", "tool"), null);
});

test("a link that could run is refused", () => {
  // These are clicked by everybody in the firm.
  assert.ok(whyNotALink("javascript:alert(1)"));
  assert.ok(whyNotALink("data:text/html,<script>"));
  assert.ok(whyNotALink("central.xero.com"));
  assert.equal(whyNotALink("https://central.xero.com/s/learning"), null);
  assert.equal(whyNotALink(""), null, "no link at all is fine");
});

test("validity must be a sensible number of months, or nothing", () => {
  assert.equal(whyNotValidity(null), null);
  assert.equal(whyNotValidity(12), null);
  assert.ok(whyNotValidity(0));
  assert.ok(whyNotValidity(-1));
  assert.ok(whyNotValidity(1.5));
  assert.ok(whyNotValidity(9999));
});
