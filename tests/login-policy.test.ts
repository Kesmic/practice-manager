/**
 * The sign-in rate limit.
 *
 * The numbers are a judgement about the trade-off between a guessing attack and a
 * colleague locked out by somebody being a nuisance, so what is worth testing is that
 * the rule reads them the way the comment in `shared/login-policy.ts` says it does -
 * and, above all, that the refusal never says which of the two counters tripped.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FAILURE_WINDOW_MINUTES,
  MAX_ACCOUNT_FAILURES,
  MAX_SOURCE_FAILURES,
  accountAttemptsLeft,
  gateLogin,
} from "../shared/login-policy";

test("attempts below both caps are allowed", () => {
  assert.equal(gateLogin({ account: 0, source: 0 }).allowed, true);
  assert.equal(
    gateLogin({ account: MAX_ACCOUNT_FAILURES - 1, source: MAX_SOURCE_FAILURES - 1 })
      .allowed,
    true,
  );
});

test("the account cap bites on the attempt after the last failure", () => {
  const gate = gateLogin({ account: MAX_ACCOUNT_FAILURES, source: 0 });
  assert.equal(gate.allowed, false);
  assert.equal((gate as { scope: string }).scope, "account");
});

test("the source cap catches an attack the account cap never sees", () => {
  // Credential stuffing: many accounts, none of them tried more than once or twice.
  const gate = gateLogin({ account: 1, source: MAX_SOURCE_FAILURES });
  assert.equal(gate.allowed, false);
  assert.equal((gate as { scope: string }).scope, "source");
});

test("the refusal never says which counter tripped", () => {
  const byAccount = gateLogin({ account: MAX_ACCOUNT_FAILURES, source: 0 });
  const bySource = gateLogin({ account: 0, source: MAX_SOURCE_FAILURES });
  assert.equal(byAccount.allowed, false);
  assert.equal(bySource.allowed, false);
  assert.equal(
    (byAccount as { message: string }).message,
    (bySource as { message: string }).message,
  );
});

test("the message tells the person how long to wait", () => {
  const gate = gateLogin({ account: MAX_ACCOUNT_FAILURES, source: 0 });
  assert.match(
    (gate as { message: string }).message,
    new RegExp(`${FAILURE_WINDOW_MINUTES} minutes`),
  );
});

test("a source cap that a whole office cannot reach by accident", () => {
  // Ten people behind one address, each mistyping twice, must still be able to sign in.
  assert.equal(gateLogin({ account: 2, source: 20 }).allowed, true);
});

test("remaining attempts never goes negative", () => {
  assert.equal(accountAttemptsLeft({ account: 0, source: 0 }), MAX_ACCOUNT_FAILURES);
  assert.equal(accountAttemptsLeft({ account: MAX_ACCOUNT_FAILURES + 5, source: 0 }), 0);
});
