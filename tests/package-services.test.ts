/**
 * Services, what packages include, and what a client gets on top.
 *
 * The cases are the ones a Partner will point at: a sub-service given as an extra
 * shows under its own heading even when the package lacks the heading; an extra is
 * named for the cheapest package that has it; and nothing already included can be
 * given twice.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cheapestPackageWith,
  describeSource,
  dropAt,
  extraCandidates,
  moveWithin,
  includedIn,
  includedTree,
  serviceTree,
  whyNotAnExtra,
  type PackageService,
  type ServiceInclusion,
} from "../shared/package-services";

const SERVICES: PackageService[] = [
  { id: "book", name: "Bookkeeping", parent_id: null, position: 0, active: 1 },
  { id: "tax", name: "Tax services", parent_id: null, position: 1, active: 1 },
  { id: "vat", name: "VAT & levies", parent_id: "tax", position: 0, active: 1 },
  { id: "pit", name: "Directors' PIT compliance", parent_id: "tax", position: 1, active: 1 },
  { id: "corp", name: "Corporate tax compliance", parent_id: "tax", position: 2, active: 1 },
  { id: "orc", name: "Annual filings with the ORC", parent_id: null, position: 2, active: 1 },
  { id: "old", name: "Retired thing", parent_id: null, position: 9, active: 0 },
];

const INCLUSIONS: ServiceInclusion[] = [
  { tier: "starter", service_id: "book" },
  { tier: "starter", service_id: "vat", note: "quarterly" },
  { tier: "growth", service_id: "book" },
  { tier: "growth", service_id: "vat" },
  { tier: "growth", service_id: "pit", note: "monthly" },
  { tier: "growth", service_id: "corp" },
  { tier: "growth", service_id: "orc" },
  { tier: "firm", service_id: "orc" },
];

test("the tree is live services with their sub-services in order", () => {
  const tree = serviceTree(SERVICES);
  assert.deepEqual(tree.map((t) => t.name), ["Bookkeeping", "Tax services", "Annual filings with the ORC"]);
  assert.deepEqual(tree[1].children.map((c) => c.name), ["VAT & levies", "Directors' PIT compliance", "Corporate tax compliance"]);
});

test("including a sub-service brings its heading with it", () => {
  const starter = includedIn("starter", INCLUSIONS, SERVICES);
  assert.deepEqual([...starter].sort(), ["book", "tax", "vat"]);
});

test("an extra is named for the cheapest package that has it", () => {
  assert.equal(cheapestPackageWith("pit", INCLUSIONS), "growth");
  assert.equal(cheapestPackageWith("orc", INCLUSIONS), "growth");
  assert.equal(cheapestPackageWith("book", INCLUSIONS), "starter");
  assert.equal(cheapestPackageWith("nothing", INCLUSIONS), null);
  assert.equal(describeSource("growth"), "From Growth");
  assert.equal(describeSource(null), "Not in any package");
});

test("a client's tree is their package plus extras, marked and slotted in", () => {
  const tree = includedTree({
    tier: "starter",
    services: SERVICES,
    inclusions: INCLUSIONS,
    extras: [{ service_id: "pit" }, { service_id: "orc" }],
  });
  assert.deepEqual(
    tree.map((b) => [b.name, b.extra, b.from, b.children.map((c) => [c.name, c.extra, c.from])]),
    [
      ["Bookkeeping", false, null, []],
      ["Tax services", false, null, [["VAT & levies", false, null], ["Directors' PIT compliance", true, "growth"]]],
      ["Annual filings with the ORC", true, "growth", []],
    ],
  );
});

test("an extra sub-service shows under a heading the package does not have", () => {
  const tree = includedTree({
    tier: "firm",
    services: SERVICES,
    inclusions: INCLUSIONS,
    extras: [{ service_id: "vat" }],
  });
  const tax = tree.find((b) => b.name === "Tax services");
  assert.ok(tax);
  assert.equal(tax.extra, false); // only a heading
  assert.deepEqual(tax.children.map((c) => [c.name, c.extra]), [["VAT & levies", true]]);
});

test("candidates are what the package lacks, less what they already have", () => {
  const candidates = extraCandidates({
    tier: "starter",
    services: SERVICES,
    inclusions: INCLUSIONS,
    extras: [{ service_id: "pit" }],
  });
  assert.deepEqual(candidates.map((c) => c.id), ["corp", "orc"]);
  assert.equal(candidates[0].label, "Tax services · Corporate tax compliance");
  assert.equal(candidates[0].from, "growth");
});

test("nothing already included, retired, or already given can be an extra", () => {
  const base = { tier: "starter" as const, services: SERVICES, inclusions: INCLUSIONS, extras: [{ service_id: "pit" }] };
  assert.match(whyNotAnExtra({ ...base, serviceId: "vat" }) ?? "", /already part of Starter/);
  assert.match(whyNotAnExtra({ ...base, serviceId: "tax" }) ?? "", /already part of Starter/);
  assert.match(whyNotAnExtra({ ...base, serviceId: "pit" }) ?? "", /already an extra/);
  assert.match(whyNotAnExtra({ ...base, serviceId: "old" }) ?? "", /retired/);
  assert.match(whyNotAnExtra({ ...base, serviceId: "nope" }) ?? "", /no such service/);
  assert.equal(whyNotAnExtra({ ...base, serviceId: "corp" }), null);
});

test("a note travels with the inclusion: the package's own, or the extra's source", () => {
  const tree = includedTree({
    tier: "starter",
    services: SERVICES,
    inclusions: INCLUSIONS,
    extras: [{ service_id: "pit" }],
  });
  const tax = tree.find((b) => b.name === "Tax services");
  assert.ok(tax);
  assert.deepEqual(
    tax.children.map((c) => [c.name, c.note]),
    [["VAT & levies", "quarterly"], ["Directors' PIT compliance", "monthly"]],
  );
  assert.equal(tree.find((b) => b.name === "Bookkeeping")?.note, null);
});

test("a line moves one place among its siblings, and stays put at the ends", () => {
  assert.deepEqual(moveWithin(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moveWithin(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveWithin(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveWithin(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
  assert.deepEqual(moveWithin(["a", "b", "c"], "zzz", 1), ["a", "b", "c"]);
});

test("a dropped line takes the place of the one it landed on", () => {
  assert.deepEqual(dropAt(["a", "b", "c", "d"], "a", "c"), ["b", "c", "a", "d"]);
  assert.deepEqual(dropAt(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(dropAt(["a", "b", "c", "d"], "b", "b"), ["a", "b", "c", "d"]);
});
