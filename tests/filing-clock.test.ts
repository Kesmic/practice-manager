/**
 * The countdown on the sign-in page.
 *
 * A wrong deadline here does not break anything - it just tells everyone who signs in
 * that the firm cannot count. The cases are the ones that catch naive date code: a
 * month that ends on a weekend, the moment a deadline passes, and the year end.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  accraHour,
  daysLeft,
  greetingFor,
  lastWorkingDay,
  nextFilings,
  nextPayeDeadline,
  nextVatDeadline,
  timeLeft,
} from "../shared/filing-clock";

const at = (iso: string) => new Date(iso);

test("PAYE is the 15th of this month until it passes, then the 15th of next", () => {
  assert.equal(nextPayeDeadline(at("2026-09-01T09:00:00Z")).toISOString(), "2026-09-15T23:59:59.000Z");
  assert.equal(nextPayeDeadline(at("2026-09-15T23:59:59Z")).toISOString(), "2026-09-15T23:59:59.000Z");
  assert.equal(nextPayeDeadline(at("2026-09-16T00:00:00Z")).toISOString(), "2026-10-15T23:59:59.000Z");
  // December rolls into the new year.
  assert.equal(nextPayeDeadline(at("2026-12-20T00:00:00Z")).toISOString(), "2027-01-15T23:59:59.000Z");
});

test("the last working day steps back over a weekend", () => {
  // May 2026 ends on a Sunday; October on a Saturday; August on a Monday.
  assert.equal(lastWorkingDay(2026, 4).toISOString(), "2026-05-29T23:59:59.000Z");
  assert.equal(lastWorkingDay(2026, 9).toISOString(), "2026-10-30T23:59:59.000Z");
  assert.equal(lastWorkingDay(2026, 7).toISOString(), "2026-08-31T23:59:59.000Z");
});

test("VAT moves to next month once this month's last working day has gone", () => {
  // 30 October 2026 is the last working day; the 31st is a Saturday.
  assert.equal(nextVatDeadline(at("2026-10-30T12:00:00Z")).toISOString(), "2026-10-30T23:59:59.000Z");
  assert.equal(nextVatDeadline(at("2026-10-31T09:00:00Z")).toISOString(), "2026-11-30T23:59:59.000Z");
});

test("whichever of the two comes first is the soonest", () => {
  const early = nextFilings(at("2026-09-02T00:00:00Z"));
  assert.equal(early.soonest.key, "paye");
  const late = nextFilings(at("2026-09-22T00:00:00Z"));
  assert.equal(late.soonest.key, "vat");
  assert.equal(late.vat.at.toISOString(), "2026-09-30T23:59:59.000Z");
  assert.equal(late.paye.at.toISOString(), "2026-10-15T23:59:59.000Z");
});

test("time left is padded so the figure does not jitter, and never negative", () => {
  const left = timeLeft(at("2026-09-15T23:59:59Z"), at("2026-09-03T19:52:26Z"));
  assert.deepEqual(
    { d: left.days, h: left.hours, m: left.minutes, s: left.seconds },
    { d: 12, h: 4, m: 7, s: 33 },
  );
  assert.equal(left.text, "12d 04:07:33");
  assert.equal(timeLeft(at("2026-09-01T00:00:00Z"), at("2026-09-02T00:00:00Z")).text, "0d 00:00:00");
});

test("days left rounds up, so a deadline later today is one day", () => {
  assert.equal(daysLeft(at("2026-09-15T23:59:59Z"), at("2026-09-15T08:00:00Z")), 1);
  assert.equal(daysLeft(at("2026-09-15T23:59:59Z"), at("2026-09-01T08:00:00Z")), 15);
});

test("the greeting follows the hour in Accra, not the browser's", () => {
  assert.equal(accraHour(at("2026-09-22T06:30:00Z")), 6);
  assert.equal(greetingFor(3), "Still up?");
  assert.equal(greetingFor(8), "Good morning.");
  assert.equal(greetingFor(13), "Good afternoon.");
  assert.equal(greetingFor(18), "Good evening.");
  assert.equal(greetingFor(22), "Good night.");
});
