/**
 * Which tier a client belongs on, and when they have outgrown the one they are on.
 *
 * This is the arithmetic a Partner will act on - moving somebody to Enterprise is a
 * conversation about money with a client - so the cases that get the most attention here
 * are the ones where being wrong is expensive or embarrassing: a client flagged as
 * outgrown when they are not, and a client quietly left on Starter when they are not.
 *
 * The rule under test: the tier that fits is the cheapest one whose ceilings all still
 * cover the recorded figures, and a criterion with no figure is never treated as fine.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CLOSE_AT,
  TIER_ORDER,
  assess,
  breaches,
  ceilingsFor,
  clientMayMove,
  describeFee,
  fractionOfCeiling,
  nextStates,
  standingOf,
  suggestTier,
  tierAbove,
  tierBelow,
  tierCovers,
  tierRank,
  whyNotACeiling,
  whyNotAFee,
  whyNotAFigure,
  worstStanding,
  type Ceiling,
  type Criterion,
  type Figure,
} from "../shared/subscriptions";
import { CLIENT_TIERS } from "../shared/allocations";

// The firm's three criteria, as the seeded catalogue has them.
const CRITERIA: Criterion[] = [
  { id: "txn", name: "Transactions a month", unit: "count", how_measured: null, position: 0 },
  { id: "staff", name: "Staff on payroll", unit: "count", how_measured: null, position: 1 },
  { id: "turnover", name: "Annual turnover", unit: "money", how_measured: null, position: 2 },
];

// Ceilings matching the tier descriptions already in shared/allocations.ts.
const CEILINGS: Ceiling[] = [
  { tier: "starter", criterion_id: "txn", ceiling: 100 },
  { tier: "starter", criterion_id: "staff", ceiling: 5 },
  { tier: "starter", criterion_id: "turnover", ceiling: 500_000 },
  { tier: "growth", criterion_id: "txn", ceiling: 500 },
  { tier: "growth", criterion_id: "staff", ceiling: 25 },
  { tier: "growth", criterion_id: "turnover", ceiling: 5_000_000 },
  { tier: "enterprise", criterion_id: "txn", ceiling: null },
  { tier: "enterprise", criterion_id: "staff", ceiling: null },
  { tier: "enterprise", criterion_id: "turnover", ceiling: null },
];

function figures(txn: number, staff: number, turnover: number): Figure[] {
  return [
    { criterion_id: "txn", value: txn, as_of: "2026-08-31" },
    { criterion_id: "staff", value: staff, as_of: "2026-08-31" },
    { criterion_id: "turnover", value: turnover, as_of: "2026-08-31" },
  ];
}

// ---------------------------------------------------------------------------
// The ladder is the contract's ladder
// ---------------------------------------------------------------------------

test("the tiers are the three the agreement names, cheapest first", () => {
  // Not a list this module may extend: client_allocations has a CHECK constraint on
  // these three, and Schedule 2 prices associates by them.
  assert.deepEqual([...TIER_ORDER].sort(), [...CLIENT_TIERS].sort());
  assert.deepEqual(TIER_ORDER, ["starter", "growth", "enterprise"]);
});

test("the ladder goes both ways and stops at the ends", () => {
  assert.equal(tierAbove("starter"), "growth");
  assert.equal(tierAbove("growth"), "enterprise");
  assert.equal(tierAbove("enterprise"), null);
  assert.equal(tierBelow("enterprise"), "growth");
  assert.equal(tierBelow("starter"), null);
  assert.ok(tierRank("starter") < tierRank("growth"));
});

// ---------------------------------------------------------------------------
// Which tier fits
// ---------------------------------------------------------------------------

test("a small business lands on Starter", () => {
  assert.equal(suggestTier(CEILINGS, figures(64, 3, 310_000)), "starter");
});

test("one figure over Starter is enough to need Growth", () => {
  // Nine staff against a ceiling of five. Transactions and turnover are irrelevant:
  // the rule is that every ceiling has to cover, not most of them.
  assert.equal(suggestTier(CEILINGS, figures(64, 9, 310_000)), "growth");
});

test("a figure exactly on the ceiling is still covered", () => {
  // The ceiling is "up to", not "under". A client at precisely 500 transactions is
  // paying for a tier that says 500, and telling them they have outgrown it would be
  // both wrong and an awkward conversation.
  assert.equal(suggestTier(CEILINGS, figures(500, 25, 5_000_000)), "growth");
  assert.equal(standingOf(500, 500), "close");
});

test("one past the ceiling moves them", () => {
  assert.equal(suggestTier(CEILINGS, figures(501, 25, 5_000_000)), "enterprise");
});

test("the top tier catches everything, because it has no ceilings", () => {
  assert.equal(suggestTier(CEILINGS, figures(90_000, 4_000, 800_000_000)), "enterprise");
  assert.equal(tierCovers("enterprise", CEILINGS, figures(90_000, 4_000, 8e8)), true);
});

test("no figures means no suggestion, not a cheap one", () => {
  // The dangerous failure: an empty record silently reading as "Starter fits" would
  // park every unmeasured client on the lowest fee.
  assert.equal(suggestTier(CEILINGS, []), null);
});

test("a criterion with no figure never blocks a tier", () => {
  // Turnover has not been recorded. The other two fit Starter, so Starter it is - the
  // suggestion is made on what is known, and the missing figure shows up separately as
  // "no figures recorded" rather than silently forcing somebody upwards.
  const partial: Figure[] = [
    { criterion_id: "txn", value: 40, as_of: "2026-08-31" },
    { criterion_id: "staff", value: 2, as_of: "2026-08-31" },
  ];
  assert.equal(suggestTier(CEILINGS, partial), "starter");
});

test("a figure for a criterion no tier has a ceiling on is ignored", () => {
  // A criterion added to the catalogue but not yet given ceilings must not quietly
  // promote everybody to Enterprise.
  const withNew = [...figures(64, 3, 310_000), { criterion_id: "branches", value: 9, as_of: "2026-08-31" }];
  assert.equal(suggestTier(CEILINGS, withNew), "starter");
});

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

test("close is ninety per cent of the ceiling, and not a whisker under", () => {
  assert.equal(standingOf(450, 500), "close", "exactly 90%");
  assert.equal(standingOf(449, 500), "within", "just under 90%");
  assert.equal(CLOSE_AT, 0.9);
});

test("no ceiling is never close and never outgrown", () => {
  assert.equal(standingOf(90_000, null), "within");
  assert.equal(fractionOfCeiling(90_000, null), null);
});

test("a missing figure is unknown, which is not the same as fine", () => {
  assert.equal(standingOf(null, 500), "unknown");
  assert.equal(standingOf(undefined, 500), "unknown");
  assert.equal(fractionOfCeiling(null, 500), null);
});

test("a meter never runs past its end", () => {
  assert.equal(fractionOfCeiling(470, 500), 0.94);
  assert.equal(fractionOfCeiling(640, 500), 1, "over the ceiling still fills exactly once");
  assert.equal(fractionOfCeiling(10, 0), null, "a ceiling of zero would divide by it");
});

test("the worst standing is the one a person is shown", () => {
  assert.equal(worstStanding(["within", "close", "outgrown"]), "outgrown");
  assert.equal(worstStanding(["within", "close", "unknown"]), "close");
  assert.equal(worstStanding(["within", "unknown"]), "unknown");
  assert.equal(worstStanding(["within", "within"]), "within");
  assert.equal(worstStanding([]), "unknown", "nothing measured is not a pass");
});

// ---------------------------------------------------------------------------
// The whole assessment
// ---------------------------------------------------------------------------

test("a client close to the ceiling is flagged but not moved", () => {
  const a = assess("growth", CRITERIA, CEILINGS, figures(470, 18, 4_100_000));
  assert.equal(a.standing, "close");
  assert.equal(a.suggested, "growth");
  assert.equal(a.should_move, false, "close is a warning, not a move");
  assert.deepEqual(a.breaches, []);
  assert.equal(a.lines.length, 3);
  assert.equal(a.lines[0].fraction, 0.94);
});

test("a client past a ceiling is flagged, and it names which one", () => {
  // Cape Coast Hotels: staff at 31 against 25, everything else comfortable. A Partner
  // opening this needs the sentence "staff, 31 against 25", not just a red pill.
  const a = assess("growth", CRITERIA, CEILINGS, figures(455, 31, 3_900_000));
  assert.equal(a.standing, "outgrown");
  assert.equal(a.suggested, "enterprise");
  assert.equal(a.should_move, true);
  assert.deepEqual(a.breaches, [{ criterion_id: "staff", value: 31, ceiling: 25 }]);
});

test("several breaches are all reported, not just the first", () => {
  const a = assess("starter", CRITERIA, CEILINGS, figures(310, 9, 1_400_000));
  assert.equal(a.breaches.length, 3);
  assert.equal(a.suggested, "growth");
});

test("a client on a tier above what they need is not told to move", () => {
  // Overpaying is the firm's business to raise, not something the portal nags about -
  // and should_move must never come out true for a downgrade, or the flag on the
  // Partner's list would mean two opposite things.
  const a = assess("enterprise", CRITERIA, CEILINGS, figures(64, 3, 310_000));
  assert.equal(a.suggested, "starter");
  assert.equal(a.should_move, false);
  assert.equal(a.standing, "within", "no ceilings at the top, so nothing is breached");
});

test("a client with nothing recorded reads as unknown throughout", () => {
  const a = assess("growth", CRITERIA, CEILINGS, []);
  assert.equal(a.standing, "unknown");
  assert.equal(a.suggested, null);
  assert.equal(a.should_move, false, "never move somebody on no evidence");
  assert.deepEqual(a.breaches, []);
  assert.ok(a.lines.every((l) => l.value === null));
});

test("ceilings are read per tier and never bleed between them", () => {
  const starter = ceilingsFor(CEILINGS, "starter");
  assert.equal(starter.get("txn"), 100);
  assert.equal(ceilingsFor(CEILINGS, "growth").get("txn"), 500);
  assert.equal(ceilingsFor(CEILINGS, "enterprise").get("txn"), null);
});

test("breaches against a tier with no ceilings is empty", () => {
  assert.deepEqual(breaches("enterprise", CEILINGS, figures(9e5, 4e3, 8e8)), []);
});

// ---------------------------------------------------------------------------
// Additional services
// ---------------------------------------------------------------------------

const money = (n: number) => `GHS ${n.toLocaleString("en-GB")}`;

test("a fee reads the way it was quoted", () => {
  assert.equal(describeFee(4500, "fixed", money), "GHS 4,500");
  assert.equal(describeFee(2500, "daily", money), "GHS 2,500 a day");
  assert.equal(describeFee(12000, "from", money), "from GHS 12,000");
  assert.equal(describeFee(null, "from", money), "Quoted on request");
});

test("a request moves forward, never backwards", () => {
  assert.deepEqual(nextStates("requested"), ["quoted", "declined"]);
  assert.deepEqual(nextStates("quoted"), ["agreed", "declined"]);
  assert.deepEqual(nextStates("agreed"), ["delivered", "declined"]);
  assert.deepEqual(nextStates("delivered"), [], "delivered is the end");
  assert.deepEqual(nextStates("declined"), []);
});

test("a client may accept or refuse a quote, and nothing else", () => {
  assert.equal(clientMayMove("quoted", "agreed"), true);
  assert.equal(clientMayMove("quoted", "declined"), true);
  // The two that would matter: quoting themselves a fee, and marking work done.
  assert.equal(clientMayMove("requested", "quoted"), false);
  assert.equal(clientMayMove("agreed", "delivered"), false);
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("a ceiling may be empty, meaning none, but not nonsense", () => {
  assert.equal(whyNotACeiling(""), null);
  assert.equal(whyNotACeiling("  "), null);
  assert.equal(whyNotACeiling("500"), null);
  assert.ok(whyNotACeiling("lots"));
  assert.ok(whyNotACeiling("-1"));
});

test("a fee may be empty, meaning quoted", () => {
  assert.equal(whyNotAFee(""), null);
  assert.equal(whyNotAFee("4500"), null);
  assert.ok(whyNotAFee("-5"));
  assert.ok(whyNotAFee("free"));
  assert.ok(whyNotAFee("999999999999"));
});

test("a count has to be whole; an amount need not be", () => {
  assert.equal(whyNotAFigure("470", "count"), null);
  assert.ok(whyNotAFigure("470.5", "count"), "half a transaction is a typo");
  assert.equal(whyNotAFigure("4100000.50", "money"), null);
  assert.ok(whyNotAFigure("", "count"), "blank is not zero");
  assert.ok(whyNotAFigure("-3", "count"));
});
