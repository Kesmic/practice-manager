/**
 * Sidebar badges: what gets counted, and how it is written.
 *
 * The bug pinned here is the one the badge exposed rather than caused. `requiredAction`
 * answers "what response is this document set up to want", which is true of a draft as
 * much as a published document - so the handbook, counting from that flag alone, told an
 * HR administrator that eleven documents needed their response when five did, and marked
 * unpublished drafts "Action needed" beside the Publish button that had not been pressed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { BADGE_CAP, NO_ATTENTION, badgeLabel, badgeText } from "../shared/attention";
import { awaitsResponse, requiredAction } from "../shared/hr";

const doc = (over: Partial<Parameters<typeof awaitsResponse>[0]> = {}) => ({
  status: "published" as const,
  requires_signature: 1 as const,
  requires_acknowledgement: 0 as const,
  my_action: null,
  ...over,
});

// ---------------------------------------------------------------------------
// What counts as waiting on somebody
// ---------------------------------------------------------------------------

test("a published document wanting a signature is waiting", () => {
  assert.equal(awaitsResponse(doc()), true);
});

test("a draft is never waiting, however it is configured", () => {
  // The bug: a draft still carries requires_signature, so anything counting from that
  // flag alone counts documents nobody can respond to.
  assert.equal(awaitsResponse(doc({ status: "draft" })), false);
  assert.equal(
    awaitsResponse(doc({ status: "draft", requires_acknowledgement: 1 })),
    false,
  );
  // And the older function still reports what the document wants, which is why it
  // cannot be the thing that counts.
  assert.equal(requiredAction(doc({ status: "draft" })), "signed");
});

test("an archived document is not waiting either", () => {
  assert.equal(awaitsResponse(doc({ status: "archived" })), false);
});

test("a document already responded to is not waiting", () => {
  assert.equal(awaitsResponse(doc({ my_action: "signed" })), false);
  assert.equal(
    awaitsResponse(doc({ requires_acknowledgement: 1, my_action: "acknowledged" })),
    false,
  );
});

test("a reference document, wanting no response, is never waiting", () => {
  assert.equal(
    awaitsResponse(doc({ requires_signature: 0, requires_acknowledgement: 0 })),
    false,
  );
});

// ---------------------------------------------------------------------------
// How a count is written
// ---------------------------------------------------------------------------

test("a badge shows the number until it stops being a number", () => {
  assert.equal(badgeText(1), "1");
  assert.equal(badgeText(6), "6");
  assert.equal(badgeText(BADGE_CAP), "99");
  // Three digits in a circle is a smear, and 100 versus 140 changes nobody's next move.
  assert.equal(badgeText(BADGE_CAP + 1), "99+");
  assert.equal(badgeText(4821), "99+");
});

test("the badge reads as a sentence to a screen reader, not a stray digit", () => {
  // "Employee handbook 6" would be heard as a heading number.
  assert.equal(badgeLabel(6, "document"), "6 documents needing your attention");
  assert.equal(badgeLabel(1, "document"), "1 document needing your attention");
  assert.equal(badgeLabel(1, "step"), "1 step needing your attention");
  assert.equal(badgeLabel(3, "client request"), "3 client requests needing your attention");
});

test("a fresh session starts with nothing waiting", () => {
  // The provider falls back to this when the session read fails, so a dropped request
  // must never invent a badge.
  assert.deepEqual(Object.values(NO_ATTENTION), [0, 0, 0, 0]);
});
