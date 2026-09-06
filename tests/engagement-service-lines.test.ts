/**
 * Reading an engagement's service lines from a request.
 *
 * An engagement covering several service lines is the normal case for a subscription
 * client, so the parsing has to be forgiving about the shapes it is given and strict
 * about the one thing that matters: which line ends up first, because that becomes the
 * engagement's primary and is what the list is filed and sorted under.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { readServiceLines } from "../worker/routes/engagements";
import { SERVICE_LINES } from "../shared/workflow";
import { HttpError } from "../worker/http";

const rejects = (body: Record<string, unknown>) =>
  assert.throws(() => readServiceLines(body), HttpError);

test("a list is returned in the order it was given", () => {
  assert.deepEqual(
    readServiceLines({ service_lines: ["payroll", "bookkeeping", "tax_compliance"] }),
    ["payroll", "bookkeeping", "tax_compliance"],
  );
});

test("the first entry is the primary, and order is never re-sorted", () => {
  // If this ever sorted, an engagement would silently change which line it is filed
  // under between the form and the database.
  const lines = readServiceLines({ service_lines: ["tax_advisory", "audit_assurance"] });
  assert.equal(lines?.[0], "tax_advisory");
});

test("the older single-value shape still works", () => {
  assert.deepEqual(readServiceLines({ service_line: "payroll" }), ["payroll"]);
});

test("saying nothing about service lines is not the same as saying none", () => {
  // A PATCH that only changes the fee must leave the lines alone.
  assert.equal(readServiceLines({ name: "Something else" }), null);
});

test("duplicates are collapsed rather than refused", () => {
  assert.deepEqual(
    readServiceLines({ service_lines: ["payroll", "payroll", "bookkeeping", "payroll"] }),
    ["payroll", "bookkeeping"],
  );
});

test("an empty list is refused", () => {
  rejects({ service_lines: [] });
});

test("an unknown or malformed line is refused", () => {
  rejects({ service_lines: ["not_a_service_line"] });
  rejects({ service_lines: ["payroll", 42] });
  rejects({ service_lines: "payroll" });
  rejects({ service_line: "not_a_service_line" });
});

test("more entries than the firm has service lines is refused", () => {
  rejects({ service_lines: [...SERVICE_LINES, ...SERVICE_LINES] });
});

test("every declared service line is accepted", () => {
  assert.deepEqual(readServiceLines({ service_lines: [...SERVICE_LINES] }), [
    ...SERVICE_LINES,
  ]);
});
