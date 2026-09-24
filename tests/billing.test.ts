/**
 * The days on which the month's invoices are raised on their own.
 *
 * Getting this wrong sends bills nobody asked for, or none at all. The cases: the
 * billing day, the catch-up days after it, the day before, the day the window shuts,
 * and a billing day that does not exist in February.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { BILLING_CATCH_UP_DAYS, billingDue, normaliseBillingDay, ordinal } from "../shared/billing";

test("the month is billed on the billing day and for a few days after, not before or later", () => {
  assert.equal(billingDue("2026-10-01", 1).due, true);
  assert.equal(billingDue("2026-10-01", 1).period, "2026-10");
  assert.equal(billingDue(`2026-10-0${1 + BILLING_CATCH_UP_DAYS}`, 1).due, true);
  assert.equal(billingDue(`2026-10-0${2 + BILLING_CATCH_UP_DAYS}`, 1).due, false);
  assert.equal(billingDue("2026-09-30", 1).due, false);
  assert.match(billingDue("2026-10-03", 15).why, /Billing day is the 15th/);
  assert.match(billingDue("2026-10-20", 1).why, /closed on the 6th/);
});

test("a billing day later in the month waits for it", () => {
  assert.equal(billingDue("2026-10-14", 15).due, false);
  assert.equal(billingDue("2026-10-15", 15).due, true);
  assert.equal(billingDue("2026-10-20", 15).due, true);
  assert.equal(billingDue("2026-10-21", 15).due, false);
});

test("a billing day is between the 1st and the 28th, whatever is typed", () => {
  assert.equal(normaliseBillingDay("31"), 28);
  assert.equal(normaliseBillingDay("0"), 1);
  assert.equal(normaliseBillingDay("abc"), 1);
  assert.equal(normaliseBillingDay(""), 1);
  assert.equal(normaliseBillingDay(15), 15);
});

test("ordinals read the way a person writes them", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal), [
    "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "28th",
  ]);
});
