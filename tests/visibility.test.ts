/**
 * Who sees which parts of the portal, and what "off" means.
 *
 * This value is enforced by the Worker, not just drawn by the sidebar, so the thing
 * worth testing is not the happy path but the broken one: a hand-edited settings row, a
 * half-written value, a grade below an area's floor. Every one of those has to fail
 * closed, because the failure mode in the other direction is a firm believing it has
 * closed something it has not.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AREAS,
  AREA_SPECS,
  DEFAULT_VISIBILITY,
  OFF,
  canSeeArea,
  canSwitchOff,
  choicesFor,
  isOff,
  opennessChoicesFor,
  readVisibility,
  writeVisibility,
  type Visibility,
} from "../shared/visibility";
import { ROLES, ROLE_RANK, type Role } from "../shared/workflow";

const defaults = (): Visibility => ({ ...DEFAULT_VISIBILITY });

// ---------------------------------------------------------------------------
// The floors hold
// ---------------------------------------------------------------------------

test("no area defaults below its own floor", () => {
  for (const area of AREAS) {
    const spec = AREA_SPECS[area];
    assert.ok(
      ROLE_RANK[spec.defaultMin] >= ROLE_RANK[spec.floor],
      `${area} defaults to ${spec.defaultMin}, below its floor of ${spec.floor}`,
    );
  }
});

test("a stored grade below the floor is refused, not clamped down to it", () => {
  // people has a floor of Manager. A settings row saying "associate" is corrupt, and
  // the closed answer is the default rather than the value asked for.
  const v = readVisibility(JSON.stringify({ people: "associate" }));
  assert.equal(v.people, DEFAULT_VISIBILITY.people);
  assert.equal(canSeeArea(v, "people", "associate"), false);
});

test("nonsense in the settings row leaves every area at its default", () => {
  for (const raw of ["", "null", "[]", "not json", '{"clients": 7}', '{"clients": "boss"}']) {
    assert.deepEqual(readVisibility(raw), DEFAULT_VISIBILITY, `raw was ${raw}`);
  }
});

// ---------------------------------------------------------------------------
// Off
// ---------------------------------------------------------------------------

test("the staff directory can be switched off, and is on by default", () => {
  assert.ok(canSwitchOff("directory"));
  assert.equal(DEFAULT_VISIBILITY.directory, "associate");
  assert.ok(canSeeArea(defaults(), "directory", "associate"));
});

test("off is off for everybody, including an administrator", () => {
  // The whole point of the switch. An area only the people who turned it off can see
  // is not off, and would leave the sidebar link sitting there for them.
  const v: Visibility = { ...defaults(), directory: OFF };
  for (const role of ROLES) {
    assert.equal(canSeeArea(v, "directory", role), false, `${role} could still see it`);
  }
});

test("switching the directory off leaves every other area alone", () => {
  const v = readVisibility(writeVisibility({ ...defaults(), directory: OFF }));
  assert.equal(v.directory, OFF);
  for (const area of AREAS) {
    if (area === "directory") continue;
    assert.equal(v[area], DEFAULT_VISIBILITY[area], `${area} moved`);
  }
});

test("an area that may not be switched off ignores a stored off", () => {
  // Fail closed the other way: "off" on Clients is a corrupted row, and honouring it
  // would close a screen the firm never chose to close.
  for (const area of AREAS) {
    if (canSwitchOff(area)) continue;
    const v = readVisibility(JSON.stringify({ [area]: OFF }));
    assert.equal(v[area], DEFAULT_VISIBILITY[area], `${area} accepted off`);
  }
});

test("off survives a write and read unchanged", () => {
  const v: Visibility = { ...defaults(), directory: OFF };
  assert.equal(readVisibility(writeVisibility(v)).directory, OFF);
});

test("only an area that allows it offers Off among its choices", () => {
  for (const area of AREAS) {
    const choices = opennessChoicesFor(area);
    assert.equal(
      choices.some(isOff),
      canSwitchOff(area),
      `${area} offered the wrong choices`,
    );
    // Off aside, the choices are exactly the grades from the floor upwards.
    assert.deepEqual(choices.filter((c) => !isOff(c)) as Role[], choicesFor(area));
  }
});

// ---------------------------------------------------------------------------
// Reading a grade
// ---------------------------------------------------------------------------

test("everybody at or above the chosen grade sees the area, and nobody below", () => {
  const v: Visibility = { ...defaults(), clients: "manager" };
  for (const role of ROLES) {
    assert.equal(
      canSeeArea(v, "clients", role),
      ROLE_RANK[role] >= ROLE_RANK.manager,
      `${role} was wrong`,
    );
  }
});

test("the defaults round-trip to an empty settings row", () => {
  // Nothing differs from the defaults, so nothing is stored.
  assert.equal(writeVisibility(defaults()), "");
  assert.deepEqual(readVisibility(""), DEFAULT_VISIBILITY);
});

// ---------------------------------------------------------------------------
// A partial save leaves the rest alone
// ---------------------------------------------------------------------------

/*
 * The write endpoint builds its next map from what is already stored, so an area the
 * caller did not mention keeps the firm's choice. It used to build from the defaults,
 * which turned "not mentioned" into "put this back how it shipped" - a browser tab
 * opened before Staff directory existed re-opened the staff directory every time
 * somebody pressed Save on that screen, silently.
 *
 * Modelled here as the route does it, because the route's own merge is three lines and
 * the thing worth pinning is which map it starts from.
 */

function saveAsRouteDoes(
  stored: Visibility,
  body: Partial<Record<string, string>>,
): Visibility {
  const next: Visibility = { ...stored };
  for (const area of AREAS) {
    const value = body[area];
    if (value === undefined) continue;
    if (value === OFF) {
      if (canSwitchOff(area)) next[area] = OFF;
      continue;
    }
    if (!ROLES.includes(value as Role)) continue;
    if (ROLE_RANK[value as Role] < ROLE_RANK[AREA_SPECS[area].floor]) continue;
    next[area] = value as Role;
  }
  return next;
}

test("an area left out of a save keeps what the firm chose", () => {
  const stored: Visibility = { ...defaults(), directory: OFF };
  // An older client that has never heard of the directory, saving the rest.
  const body = { clients: "manager", engagements: "manager" };
  const after = saveAsRouteDoes(stored, body);

  assert.equal(after.directory, OFF, "the directory was silently re-opened");
  assert.equal(after.clients, "manager");
  assert.equal(after.engagements, "manager");
  assert.equal(after.people, stored.people);
});

test("a save that mentions every area still sets every area", () => {
  // Back to the defaults works by sending them all, so this must keep working.
  const stored: Visibility = { ...defaults(), directory: OFF, clients: "partner" };
  const body = Object.fromEntries(
    AREAS.map((a) => [a, DEFAULT_VISIBILITY[a] as string]),
  );
  assert.deepEqual(saveAsRouteDoes(stored, body), DEFAULT_VISIBILITY);
});
