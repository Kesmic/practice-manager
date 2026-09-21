/**
 * What a growth partner earns, and what holding a prospect means.
 *
 * Every number here is money somebody outside the firm is owed, so the cases with the
 * most attention are the ones that would quietly pay too much or too little: a paused
 * client draining an entitlement they are not being billed for, an annual assignment
 * earning every year, and a subscription client's additional work earning twice.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMMISSION_MONTHS,
  COMMISSION_RATE,
  HOLD_DAYS,
  commissionFor,
  commissionOn,
  describeEntitlement,
  describeHold,
  holdDaysLeft,
  holdIsLive,
  mayMoveProspect,
  prospectKey,
  signatureNameMatches,
  whyNotAProspect,
  type CommissionHistory,
} from "../shared/growth-partners";

const TODAY = "2026-09-21";

function history(over: Partial<CommissionHistory> = {}): CommissionHistory {
  return {
    subscription_months: 0,
    periods: [],
    assignments: [],
    ever_subscribed: true,
    won_on: "2026-04-01",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The terms
// ---------------------------------------------------------------------------

test("the arrangement is a quarter of the fee for six billed months", () => {
  assert.equal(COMMISSION_RATE, 25);
  assert.equal(COMMISSION_MONTHS, 6);
  assert.equal(HOLD_DAYS, 90);
  assert.equal(commissionOn(4500), 1125);
  // Rounded to the pesewa, because it is paid to the pesewa.
  assert.equal(commissionOn(3508.1), 877.03);
  assert.equal(commissionOn(0), 0);
});

// ---------------------------------------------------------------------------
// Subscription months
// ---------------------------------------------------------------------------

test("a subscription month earns a quarter of the fee, and says which month it is", () => {
  const [line] = commissionFor(
    { subscription: 4500, one_off: [], period: "2026-09", issued_on: TODAY },
    history({ subscription_months: 2 }),
  );
  assert.equal(line.kind, "subscription");
  assert.equal(line.basis, 4500);
  assert.equal(line.amount, 1125);
  assert.equal(line.month_index, 3);
  assert.equal(line.reference, "2026-09");
  assert.match(line.why, /Month 3 of 6/);
});

test("the seventh billed month earns nothing", () => {
  const lines = commissionFor(
    { subscription: 4500, one_off: [], period: "2026-12", issued_on: TODAY },
    history({ subscription_months: 6 }),
  );
  assert.deepEqual(lines, []);
});

test("a paused month is not one of the six, because it is never billed", () => {
  /*
   * The whole reason the count is of accrued months rather than of calendar months. A
   * client who pauses for three months raises no invoice, so nothing is accrued and
   * nothing is spent - the partner's entitlement waits with the client rather than
   * draining while nobody is paying.
   */
  let months = 0;
  const periods: string[] = [];
  const billed = ["2026-04", "2026-05", /* paused June, July, August */ "2026-09"];
  for (const period of billed) {
    const lines = commissionFor(
      { subscription: 4500, one_off: [], period, issued_on: TODAY },
      history({ subscription_months: months, periods: [...periods] }),
    );
    months += lines.length;
    if (lines.length) periods.push(period);
  }
  assert.equal(months, 3, "three invoices, three months earned");
  const next = commissionFor(
    { subscription: 4500, one_off: [], period: "2026-10", issued_on: TODAY },
    history({ subscription_months: months, periods }),
  );
  assert.equal(next[0].month_index, 4, "the fourth billed month, not the seventh calendar one");
});

test("a month already earned never earns again, whatever happens to the invoice", () => {
  /*
   * The case this closes: an invoice is issued, its commission is paid, and the invoice
   * is then cancelled and raised again for the same month. Counting months alone would
   * earn a second time - the client billed once for March, the partner paid twice.
   *
   * A cancelled commission is not in the history at all, so a month cancelled with its
   * invoice is free to be earned on the invoice that replaces it. That is the difference
   * between the two, and it is the whole of the rule.
   */
  const again = commissionFor(
    { subscription: 4500, one_off: [], period: "2027-03", issued_on: TODAY },
    history({ subscription_months: 1, periods: ["2027-03"] }),
  );
  assert.deepEqual(again, []);

  const different = commissionFor(
    { subscription: 4500, one_off: [], period: "2027-04", issued_on: TODAY },
    history({ subscription_months: 1, periods: ["2027-03"] }),
  );
  assert.equal(different[0].month_index, 2);
});

test("the fee the client actually pays is what earns, discount and all", () => {
  // The invoice hands over its subscription amount after any discount, so a client on
  // 20% off earns the partner 25% of what the firm banked rather than of the list price.
  const [line] = commissionFor(
    { subscription: 3600, one_off: [], period: "2026-09", issued_on: TODAY },
    history(),
  );
  assert.equal(line.basis, 3600);
  assert.equal(line.amount, 900);
});

// ---------------------------------------------------------------------------
// Where a subscription and one-off work meet
// ---------------------------------------------------------------------------

test("a subscription client's additional work earns nothing", () => {
  // The partner is paid for the client, not for every piece of work the firm ever does
  // for them. This is the case that would otherwise pay twice on one invoice.
  const lines = commissionFor(
    {
      subscription: 4500,
      one_off: [{ id: "l1", amount: 12000, assignment_key: "svc_audit" }],
      period: "2026-09",
      issued_on: TODAY,
    },
    history({ subscription_months: 1 }),
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "subscription");
});

test("a subscription client's one-off work earns nothing even on an invoice with no subscription on it", () => {
  /*
   * A month the client was paused, or a piece of work billed on its own. They are a
   * subscription client throughout, and "subscription first, then one-off" pays on the
   * subscription only.
   */
  const lines = commissionFor(
    {
      subscription: 0,
      one_off: [{ id: "l1", amount: 12000, assignment_key: "svc_audit" }],
      period: null,
      issued_on: TODAY,
    },
    history({ ever_subscribed: true, subscription_months: 2 }),
  );
  assert.deepEqual(lines, []);
});

test("a client who only ever wanted one piece of work still earns the partner their 25%", () => {
  const lines = commissionFor(
    {
      subscription: 0,
      one_off: [{ id: "l1", amount: 12000, assignment_key: "svc_audit" }],
      period: null,
      issued_on: "2026-05-02",
    },
    history({ ever_subscribed: false, won_on: "2026-04-01", subscription_months: 0 }),
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "one_off");
  assert.equal(lines[0].amount, 3000);
  assert.equal(lines[0].reference, "svc_audit");
});

test("an assignment that recurs every year is one commission, not one a year", () => {
  const lines = commissionFor(
    {
      subscription: 0,
      one_off: [{ id: "l9", amount: 12000, assignment_key: "svc_audit" }],
      period: null,
      issued_on: "2026-05-02",
    },
    history({ ever_subscribed: false, assignments: ["svc_audit"] }),
  );
  assert.deepEqual(lines, []);
});

test("two different assignments on one invoice each earn once", () => {
  const lines = commissionFor(
    {
      subscription: 0,
      one_off: [
        { id: "l1", amount: 12000, assignment_key: "svc_audit" },
        { id: "l2", amount: 4000, assignment_key: "svc_tax_health" },
      ],
      period: null,
      issued_on: "2026-05-02",
    },
    history({ ever_subscribed: false }),
  );
  assert.deepEqual(lines.map((l) => [l.reference, l.amount]), [
    ["svc_audit", 3000],
    ["svc_tax_health", 1000],
  ]);
});

test("one-off work invoiced after the six months earns nothing", () => {
  const late = commissionFor(
    {
      subscription: 0,
      one_off: [{ id: "l1", amount: 12000, assignment_key: "svc_new" }],
      period: null,
      issued_on: "2026-10-02",
    },
    history({ ever_subscribed: false, won_on: "2026-04-01" }),
  );
  assert.deepEqual(late, []);

  // The last day inside the window still earns.
  const justInside = commissionFor(
    {
      subscription: 0,
      one_off: [{ id: "l1", amount: 12000, assignment_key: "svc_new" }],
      period: null,
      issued_on: "2026-09-30",
    },
    history({ ever_subscribed: false, won_on: "2026-04-01" }),
  );
  assert.equal(justInside.length, 1);
});

test("what is left is said in the partner's own terms", () => {
  assert.match(describeEntitlement({ subscription_months: 2, ever_subscribed: true }), /4 to go/);
  assert.match(describeEntitlement({ subscription_months: 6, ever_subscribed: true }), /All 6/);
  assert.match(
    describeEntitlement({ subscription_months: 0, ever_subscribed: false }),
    /once per assignment/,
  );
});

// ---------------------------------------------------------------------------
// The hold
// ---------------------------------------------------------------------------

test("a hold counts down and then runs out", () => {
  assert.equal(holdDaysLeft("2026-10-01", TODAY), 10);
  assert.equal(holdDaysLeft("2026-09-21", TODAY), 0, "the last day is still a day");
  assert.equal(holdDaysLeft("2026-09-11", TODAY), -10);

  assert.equal(holdIsLive({ stage: "pitching", hold_until: "2026-09-21" }, TODAY), true);
  assert.equal(holdIsLive({ stage: "pitching", hold_until: "2026-09-20" }, TODAY), false);
});

test("a prospect who said no releases the business at once", () => {
  // Somebody told no should not be sitting on a business nobody else may approach for
  // another two months.
  assert.equal(holdIsLive({ stage: "lost", hold_until: "2026-12-01" }, TODAY), false);
});

test("a signed client keeps their hold and is never shown a countdown", () => {
  assert.equal(holdIsLive({ stage: "won", hold_until: "2026-01-01" }, TODAY), true);
  assert.match(describeHold({ stage: "won", hold_until: "2026-01-01" }, TODAY), /spent/);
  assert.match(describeHold({ stage: "pitching", hold_until: "2026-09-25" }, TODAY), /4 days/);
  assert.match(describeHold({ stage: "pitching", hold_until: "2026-09-21" }, TODAY), /today/);
});

test("two registrations of the same business collide however it is spelt", () => {
  const key = prospectKey("Acme Trading Ltd");
  assert.equal(prospectKey("ACME  Trading Limited"), key);
  assert.equal(prospectKey("Acme Trading Ltd."), key);
  assert.notEqual(prospectKey("Acme Logistics"), key);
});

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

test("a partner cannot declare their own client signed", () => {
  // Won means the firm has a signed client. A partner who could declare it would be
  // declaring their own commission.
  assert.equal(mayMoveProspect("contract_sent", "won"), false);
  assert.equal(mayMoveProspect("proposal_sent", "contract_sent"), true);
  assert.equal(mayMoveProspect("registered", "proposal_sent"), false, "no skipping the pitch");
  assert.equal(mayMoveProspect("lost", "pitching"), true, "a no can become a yes later");
});

test("a business with no name in it is refused", () => {
  assert.match(whyNotAProspect({ business_name: " " }) ?? "", /name of the business/);
  assert.match(whyNotAProspect({ business_name: "Ltd" }) ?? "", /nothing in it/);
  assert.match(
    whyNotAProspect({ business_name: "Acme", contact_email: "not-an-address" }) ?? "",
    /email address/,
  );
  assert.equal(whyNotAProspect({ business_name: "Acme Trading Ltd" }), null);
});

// ---------------------------------------------------------------------------
// Signing the engagement
// ---------------------------------------------------------------------------

test("somebody may sign their own name however they space or capitalise it", () => {
  // Refusing over a capital letter teaches people to distrust the box rather than to
  // read what is above it.
  assert.equal(signatureNameMatches("Ama Serwaa", "Ama Serwaa"), true);
  assert.equal(signatureNameMatches("  ama   serwaa ", "Ama Serwaa"), true);
  assert.equal(signatureNameMatches("AMA SERWAA", "Ama Serwaa"), true);
});

test("but not somebody else's, and not initials", () => {
  // The point of the box is that the name recorded is the name the firm holds.
  assert.equal(signatureNameMatches("A. Serwaa", "Ama Serwaa"), false);
  assert.equal(signatureNameMatches("Kwame Owusu", "Ama Serwaa"), false);
  assert.equal(signatureNameMatches("Ama", "Ama Serwaa"), false);
  assert.equal(signatureNameMatches("", "Ama Serwaa"), false);
  assert.equal(signatureNameMatches("   ", "   "), false, "nothing signs nothing");
});
