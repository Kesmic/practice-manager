/**
 * Remembering a device: how long for, and what a device is called.
 *
 * The policy reading matters because it is the one setting in this system whose absent
 * value means "on". That is deliberate and argued in the module, but it is exactly the
 * kind of decision that gets quietly reversed by a later edit, so it is pinned here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TRUST_DAYS,
  DEVICE_TRUST_OFF,
  MAX_TRUST_DAYS,
  MIN_TRUST_DAYS,
  clampTrustDays,
  describeDevice,
  mayRememberDevice,
  readDeviceTrustPolicy,
  writeDeviceTrustPolicy,
  type SecondFactorRoute,
} from "../shared/device-trust";

test("an unset policy offers to remember a device for thirty days", () => {
  assert.deepEqual(readDeviceTrustPolicy(undefined), {
    enabled: true,
    days: DEFAULT_TRUST_DAYS,
  });
  assert.deepEqual(readDeviceTrustPolicy(""), { enabled: true, days: DEFAULT_TRUST_DAYS });
});

test("a firm can switch it off entirely", () => {
  assert.deepEqual(readDeviceTrustPolicy(DEVICE_TRUST_OFF), { enabled: false });
});

test("a stored number is honoured, and an unreadable one falls back rather than failing", () => {
  assert.deepEqual(readDeviceTrustPolicy("7"), { enabled: true, days: 7 });
  assert.deepEqual(readDeviceTrustPolicy("nonsense"), {
    enabled: true,
    days: DEFAULT_TRUST_DAYS,
  });
});

test("a period beyond the maximum is clamped rather than accepted", () => {
  // A year-long trust is not a second factor with a long fuse, it is no second factor.
  assert.deepEqual(readDeviceTrustPolicy("365"), { enabled: true, days: MAX_TRUST_DAYS });
  assert.deepEqual(readDeviceTrustPolicy("0"), { enabled: true, days: MIN_TRUST_DAYS });
  assert.equal(clampTrustDays(-5), MIN_TRUST_DAYS);
  assert.equal(clampTrustDays(10_000), MAX_TRUST_DAYS);
});

test("a policy survives a round trip through storage", () => {
  for (const policy of [
    { enabled: true as const, days: 30 },
    { enabled: true as const, days: 7 },
    { enabled: false as const },
  ]) {
    assert.deepEqual(readDeviceTrustPolicy(writeDeviceTrustPolicy(policy)), policy);
  }
});

test("only the app path may remember a device", () => {
  /*
    The rule that makes security questions tolerable at all. A recovery route mints no
    remembered device: a recovery code is a single-use secret spent getting back in, and
    a security answer is a researchable fact that stays true, so letting either buy
    thirty days of skipping the second step would make the weakest factor decide how
    often the strongest is asked for.
  */
  assert.equal(mayRememberDevice("totp"), true);
  assert.equal(mayRememberDevice("questions"), false);
  assert.equal(mayRememberDevice("recovery"), false);
});

test("exactly one route may remember a device", () => {
  // Guards against a fourth route being added later and quietly defaulting to allowed.
  const routes: SecondFactorRoute[] = ["totp", "questions", "recovery"];
  assert.deepEqual(routes.filter(mayRememberDevice), ["totp"]);
});

test("a device gets a name somebody can recognise their own machine by", () => {
  const chrome =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  assert.equal(describeDevice(chrome), "Chrome on Mac");

  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  assert.equal(describeDevice(iphone), "Safari on iPhone");
});

test("browsers that impersonate Chrome are named as themselves", () => {
  // Edge and Opera both carry "Chrome/" in their user agent, and Chrome carries
  // "Safari/". Checked in the order that makes each one come out right.
  const edge =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
  assert.equal(describeDevice(edge), "Edge on Windows");

  const firefox =
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";
  assert.equal(describeDevice(firefox), "Firefox on Linux");
});

test("a missing user agent still produces a label rather than an empty row", () => {
  assert.equal(describeDevice(null), "Unknown device");
  assert.equal(describeDevice(""), "Unknown device");
  assert.equal(describeDevice("   "), "Unknown device");
});
