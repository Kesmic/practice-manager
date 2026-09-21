/**
 * The two currencies, and the rule that nothing converts between them.
 *
 * The failure this guards against is not a crash. It is a client quoted USD 1,250 being
 * shown GHS 1,250, or a statement adding a dollar invoice to a cedi one and printing a
 * total that is neither.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  CURRENCIES,
  CURRENCY_LABELS,
  DEFAULT_CURRENCY,
  currencyOf,
  formatAmount,
  isCurrency,
  singleCurrency,
} from "../shared/money";

test("cedis is the default, and dollars the other one", () => {
  assert.equal(DEFAULT_CURRENCY, "GHS");
  assert.deepEqual([...CURRENCIES], ["GHS", "USD"]);
  for (const c of CURRENCIES) assert.ok(CURRENCY_LABELS[c]);
});

test("an amount is never shown without its currency", () => {
  // "4,500" on a screen that can show both is a figure somebody reads as whichever one
  // they were expecting.
  assert.equal(formatAmount(4500, "GHS"), "GHS 4,500.00");
  assert.equal(formatAmount(1250, "USD"), "USD 1,250.00");
  assert.equal(formatAmount(1250, "USD", { decimals: false }), "USD 1,250");
});

test("a row with no currency is in cedis rather than a crash", () => {
  // Rows written before the column existed, and anything that comes back undefined.
  assert.equal(currencyOf(undefined), "GHS");
  assert.equal(currencyOf("EUR"), "GHS");
  assert.equal(currencyOf("USD"), "USD");
  assert.equal(isCurrency("USD"), true);
  assert.equal(isCurrency("eur"), false);
});

test("a total is refused where two currencies are mixed", () => {
  assert.equal(singleCurrency([{ currency: "GHS" }, { currency: "GHS" }]), "GHS");
  assert.equal(singleCurrency([{ currency: "GHS" }, { currency: "USD" }]), null);
  // An empty list has no currency to state, so there is nothing to total either.
  assert.equal(singleCurrency([]), null);
});

test("nothing anywhere converts between the two", () => {
  /*
   * Structural, and deliberately so. A rate would have to come from somewhere, be right
   * on the day, and still be right when somebody reads the invoice six months later -
   * and the moment a figure is converted the portal is quoting a number the firm never
   * agreed to. This fails the day somebody adds one.
   */
  const source = readFileSync("shared/money.ts", "utf8");
  assert.ok(!/\brate\b\s*[:=]/i.test(source), "shared/money.ts has grown a rate");

  const suspicious = readdirSync("shared")
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => /exchange_rate|exchangeRate|fx_rate|convertCurrency/.test(
      readFileSync(`shared/${name}`, "utf8"),
    ));
  assert.deepEqual(suspicious, []);
});
