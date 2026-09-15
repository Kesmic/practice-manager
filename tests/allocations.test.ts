/**
 * Allocating a client, and the right to decline it.
 *
 * This module exists for one sentence in the Associate Consultant Agreement:
 *
 *   The Associate may decline the allocation of a further client where acceptance
 *   would, in the Associate's reasonable professional judgement, prejudice the proper
 *   performance of the Services in respect of an existing Assigned Client. A refusal on
 *   that ground shall not constitute a breach of this Agreement.
 *
 * Two properties have to hold for that to mean anything in a system, and both are
 * pinned below.
 *
 * **Accepting and declining belong to the person the client was offered to.** Nobody
 * else, at any grade. A right somebody else can exercise on your behalf is not a right,
 * and the clause gives it to the Associate rather than to the firm.
 *
 * **The record must distinguish the grounds.** The operative half of the clause is the
 * second sentence. A refusal stored as a bare "declined", in a system that cannot tell
 * the grounds apart, is evidence against somebody for exercising a right their
 * agreement gave them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALLOCATION_STATUSES,
  ALLOCATION_STATUS_LABELS,
  CLIENT_TIERS,
  DECLINE_GROUNDS,
  GROUND_SPECS,
  TIER_FEE_TOKEN,
  TIER_HINTS,
  TIER_LABELS,
  availableAllocationActions,
  describeAllocationProblem,
  describeDecline,
  isHeld,
  isLive,
  isProtectedGround,
  type AllocationStatus,
} from "../shared/allocations";
import { CONTRACT_FIELDS } from "../shared/contract-fields";

const SUBJECT = { isSubject: true, canAllocate: false };
const FIRM = { isSubject: false, canAllocate: true };
const BOTH = { isSubject: true, canAllocate: true };
const NEITHER = { isSubject: false, canAllocate: false };

// ---------------------------------------------------------------------------
// Whose decision it is
// ---------------------------------------------------------------------------

test("only the person a client was offered to may accept or decline it", () => {
  assert.deepEqual(availableAllocationActions("offered", SUBJECT), [
    "accept",
    "decline",
  ]);
  // A manager sees the offer and may take it back. They may not answer it.
  assert.deepEqual(availableAllocationActions("offered", FIRM), ["withdraw"]);
});

test("no grade lets somebody answer on another person's behalf", () => {
  // The check that makes clause 8.2 exercisable. A partner accepting a client for an
  // Associate would put the judgement the clause protects in the firm's hands.
  for (const options of [FIRM, NEITHER]) {
    const actions = availableAllocationActions("offered", options);
    assert.ok(!actions.includes("accept"));
    assert.ok(!actions.includes("decline"));
  }
});

test("the person can answer their own offer without being allowed to allocate", () => {
  // An Associate is not a manager, so gating accept on the allocation permission would
  // leave nobody able to answer at all.
  assert.ok(availableAllocationActions("offered", SUBJECT).includes("accept"));
  assert.ok(availableAllocationActions("offered", BOTH).includes("accept"));
});

test("an answered offer can no longer be answered", () => {
  for (const status of ["accepted", "declined", "withdrawn", "ended"] as const) {
    const actions = availableAllocationActions(status, BOTH);
    assert.ok(!actions.includes("accept"), status);
    assert.ok(!actions.includes("decline"), status);
  }
});

test("only a held client can be reallocated away, and only an open offer withdrawn", () => {
  assert.ok(availableAllocationActions("accepted", FIRM).includes("end"));
  assert.ok(!availableAllocationActions("offered", FIRM).includes("end"));
  assert.ok(availableAllocationActions("offered", FIRM).includes("withdraw"));
  assert.ok(!availableAllocationActions("accepted", FIRM).includes("withdraw"));
});

test("a finished allocation can be offered again, a live one cannot", () => {
  for (const status of ["declined", "withdrawn", "ended"] as const) {
    assert.ok(availableAllocationActions(status, FIRM).includes("reoffer"), status);
  }
  for (const status of ["offered", "accepted"] as const) {
    assert.ok(!availableAllocationActions(status, FIRM).includes("reoffer"), status);
  }
});

test("somebody with no stake in an allocation can do nothing to it", () => {
  for (const status of ALLOCATION_STATUSES) {
    assert.deepEqual(availableAllocationActions(status, NEITHER), [], status);
  }
});

test("declining an offer already answered is refused with a sentence", () => {
  // Shown to whoever hit the rule, so "409" would tell them nothing.
  assert.match(describeAllocationProblem("accepted", "decline")!, /already accepted/);
  assert.match(describeAllocationProblem("withdrawn", "accept")!, /withdrawn/);
  assert.equal(describeAllocationProblem("offered", "accept"), null);
  assert.equal(describeAllocationProblem("offered", "decline"), null);
});

test("every action the rules offer is one the rules also permit", () => {
  // A button that appears must be one the server accepts, or the screen is lying.
  for (const status of ALLOCATION_STATUSES) {
    for (const options of [SUBJECT, FIRM, BOTH]) {
      for (const action of availableAllocationActions(status, options)) {
        assert.equal(
          describeAllocationProblem(status, action),
          null,
          `${status} / ${action}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The grounds
// ---------------------------------------------------------------------------

test("declining because it would prejudice an existing client is not a breach", () => {
  // The operative half of clause 8.2. If this ever returns true the clause has been
  // quietly reversed.
  assert.equal(isProtectedGround("capacity"), true);
  assert.equal(GROUND_SPECS.capacity.breach, false);
  assert.equal(GROUND_SPECS.capacity.clause, "8.2");
});

test("a conflict of interest is protected too", () => {
  // An accountant who takes work they cannot independently perform has a larger
  // problem than a contractual one.
  assert.equal(isProtectedGround("conflict"), true);
});

test("any other reason is not one of the protected grounds", () => {
  assert.equal(isProtectedGround("other"), false);
});

test("the clause is cited by number to somebody it applies to", () => {
  assert.match(describeDecline("capacity", true), /clause 8\.2/);
  assert.match(describeDecline("capacity", true), /not a breach/);
});

test("an employee is told the same thing without a clause number", () => {
  // Their protection comes from the firm's own position, not from that clause, so
  // citing it at them would be wrong.
  const said = describeDecline("capacity", false);
  assert.ok(!said.includes("8.2"));
  assert.match(said, /does not count against them/);
});

test("an unprotected decline is not described as protected", () => {
  const said = describeDecline("other", true);
  assert.ok(!said.includes("not a breach"));
  assert.match(said, /not one of the protected grounds/);
});

test("every ground has a label, a detail and a stated consequence", () => {
  for (const ground of DECLINE_GROUNDS) {
    const spec = GROUND_SPECS[ground];
    assert.ok(spec.label, ground);
    assert.ok(spec.detail, ground);
    assert.equal(typeof spec.breach, "boolean", ground);
  }
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

test("live means offered or accepted; held means accepted", () => {
  assert.equal(isLive("offered"), true);
  assert.equal(isLive("accepted"), true);
  assert.equal(isHeld("offered"), false);
  assert.equal(isHeld("accepted"), true);
  for (const status of ["declined", "withdrawn", "ended"] as AllocationStatus[]) {
    assert.equal(isLive(status), false, status);
    assert.equal(isHeld(status), false, status);
  }
});

test("every status has a label", () => {
  for (const status of ALLOCATION_STATUSES) assert.ok(ALLOCATION_STATUS_LABELS[status]);
});

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

test("every tier is priced by a placeholder the contract actually contains", () => {
  // The tier decides the fee under Schedule 2. A tier whose fee token no contract field
  // fills would price a client against a placeholder nobody can set.
  const tokens = new Set(CONTRACT_FIELDS.map((f) => f.token));
  for (const tier of CLIENT_TIERS) {
    assert.ok(tokens.has(TIER_FEE_TOKEN[tier]), `${tier} has no fee field`);
  }
});

test("every tier has a label and a hint", () => {
  for (const tier of CLIENT_TIERS) {
    assert.ok(TIER_LABELS[tier], tier);
    assert.ok(TIER_HINTS[tier], tier);
  }
});
