/**
 * Discounts: what comes off, what it comes off, and when it stops.
 *
 * A discount is the one figure on an invoice a client checks twice, so the cases with
 * the most attention here are the ones that would produce a plausible wrong answer
 * rather than a crash: a discount meant for the subscription eating into an audit fee,
 * a one-off that survives the invoice it was meant for, a date-limited one that stops a
 * day early, and a fixed amount larger than the bill turning an invoice negative.
 *
 * The last block is measured against the real migrations with foreign keys on, because
 * "one active discount per client" is a claim about what the database will refuse, not
 * about what a route remembers to check.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
  type Discount,
  describeDiscount,
  describeDiscountTerm,
  discountAmount,
  discountApplies,
  discountLabel,
  discountableBase,
  finishedState,
  invoicesLeft,
  spentAfterUse,
  whyNotADiscount,
} from "../shared/discounts";
import { computeTotals, round2, withholdingOn, type TaxLine } from "../shared/invoices";

const TODAY = "2026-09-21";

/** A live discount, with only the fields a case cares about overridden. */
function discount(over: Partial<Discount> = {}): Discount {
  return {
    id: "d1",
    kind: "percentage",
    value: 20,
    applies_to: "subscription",
    runs: "once",
    invoice_count: null,
    until_on: null,
    used_count: 0,
    reason: null,
    status: "active",
    ...over,
  };
}

/** A month's invoice: the subscription, and a piece of work outside it. */
const LINES = [
  { amount: 4500, source: "subscription" },
  { amount: 2000, source: "service" },
  { amount: 150, source: "manual" },
];

// ---------------------------------------------------------------------------
// What it bites on
// ---------------------------------------------------------------------------

test("a discount on the subscription leaves the other lines alone", () => {
  // The failure this prevents is quiet and expensive: 20% off a subscription taken
  // against the whole invoice gives 1,330 instead of 900, and nobody notices until the
  // year is reconciled.
  const base = discountableBase(LINES, "subscription");
  assert.equal(base, 4500);
  assert.equal(discountAmount(discount({ value: 20 }), base), 900);
});

test("a discount on additional services takes neither the subscription nor a manual line", () => {
  assert.equal(discountableBase(LINES, "services"), 2000);
});

test("a discount on everything takes the manual lines too", () => {
  // Everything means everything invoiced. A manual line is still something the client
  // is being charged, and excluding it would make "off everything" a lie on the one
  // invoice where somebody typed a fee in by hand.
  assert.equal(discountableBase(LINES, "everything"), 6650);
});

test("a scope with nothing on the invoice discounts nothing rather than failing", () => {
  const base = discountableBase([{ amount: 4500, source: "subscription" }], "services");
  assert.equal(base, 0);
  assert.equal(discountAmount(discount({ kind: "amount", value: 500 }), base), 0);
});

// ---------------------------------------------------------------------------
// How much comes off
// ---------------------------------------------------------------------------

test("a fixed discount larger than the bill takes it to nothing, never below", () => {
  // A negative invoice is a credit note, which is a different document and a different
  // conversation. Letting this through would produce an invoice asking the client to
  // pay minus four hundred cedis.
  assert.equal(discountAmount(discount({ kind: "amount", value: 1000 }), 600), 600);
});

test("a percentage discount rounds to the pesewa", () => {
  // 12.5% of 3,508.10 is 438.5125. The invoice prints two decimal places, so a total
  // worked out from an unrounded discount would not equal its own column.
  assert.equal(discountAmount(discount({ value: 12.5 }), 3508.1), 438.51);
});

test("a hundred per cent discount is allowed and clears the base exactly", () => {
  // A waived month is a real thing a Partner does, and it must not come out as 4,499.99.
  assert.equal(discountAmount(discount({ value: 100 }), 4500), 4500);
});

test("the discount comes off before tax, so the firm is not taxed on money it never took", () => {
  /*
   * The whole reason the order is fixed. 4,500 less 900 is 3,600; the Ghanaian stack on
   * 3,600 is 788.40 against 985.50 on the undiscounted fee. Applying the discount after
   * tax would leave the firm remitting 197.10 of VAT and levies out of its own pocket,
   * every month, on a discount it had chosen to give.
   */
  const ghana: TaxLine[] = [
    { id: "nhil", name: "NHIL", rate: 2.5, basis: "net", position: 0 },
    { id: "getfund", name: "GETFund", rate: 2.5, basis: "net", position: 1 },
    { id: "covid", name: "COVID-19 levy", rate: 1, basis: "net", position: 2 },
    { id: "vat", name: "VAT", rate: 15, basis: "net_plus_preceding", position: 3 },
  ];

  const off = discountAmount(discount({ value: 20 }), discountableBase(LINES.slice(0, 1), "subscription"));
  const before = computeTotals(4500, ghana);
  const after = computeTotals(round2(4500 - off), ghana);

  assert.equal(off, 900);
  assert.equal(after.net, 3600);
  assert.equal(before.tax_total, 985.5);
  assert.equal(after.tax_total, 788.4);
  assert.equal(round2(before.tax_total - after.tax_total), 197.1);
  assert.equal(after.gross, round2(3600 + after.tax_total));
});

test("withholding is worked out on the discounted amount", () => {
  // Withholding is a percentage of what is actually billed. Taking it on the full fee
  // would deduct tax the client is not going to remit, and the invoice would be short.
  assert.equal(withholdingOn(3600, 7.5), 270);
});

// ---------------------------------------------------------------------------
// How long it lasts
// ---------------------------------------------------------------------------

test("a one-off applies to one invoice and then stops", () => {
  const fresh = discount({ runs: "once" });
  assert.equal(discountApplies(fresh, TODAY), true);
  assert.equal(invoicesLeft(fresh), 1);
  assert.equal(spentAfterUse(fresh), true);

  const used = discount({ runs: "once", used_count: 1 });
  assert.equal(discountApplies(used, TODAY), false);
  assert.equal(invoicesLeft(used), 0);
});

test("a discount for three invoices runs out after the third", () => {
  const three = (used: number) =>
    discount({ runs: "count", invoice_count: 3, used_count: used });
  assert.deepEqual(
    [0, 1, 2, 3].map((n) => discountApplies(three(n), TODAY)),
    [true, true, true, false],
  );
  assert.deepEqual([0, 1, 2, 3].map((n) => invoicesLeft(three(n))), [3, 2, 1, 0]);
  // Only the third use spends it, which is what decides when the row is retired.
  assert.deepEqual([0, 1, 2].map((n) => spentAfterUse(three(n))), [false, false, true]);
});

test("a date-limited discount includes its last day and stops the morning after", () => {
  // "Until 30 September" has to mean September is discounted. Excluding the last day
  // would cost the client the month they were promised, on the invoice they were
  // watching for.
  const until = discount({ runs: "until", until_on: "2026-09-30" });
  assert.equal(discountApplies(until, "2026-09-30"), true);
  assert.equal(discountApplies(until, "2026-10-01"), false);
});

test("a date-limited discount is not used up by invoices", () => {
  // Twelve invoices inside the window are twelve discounted invoices. Counting uses
  // against a date-limited discount would quietly stop it early.
  const until = discount({ runs: "until", until_on: "2026-12-31", used_count: 12 });
  assert.equal(discountApplies(until, TODAY), true);
  assert.equal(invoicesLeft(until), null);
  assert.equal(spentAfterUse(until), false);
});

test("a discount that is not active never applies, whatever its dates say", () => {
  const ended = discount({ runs: "until", until_on: "2026-12-31", status: "ended" });
  assert.equal(discountApplies(ended, TODAY), false);
});

// ---------------------------------------------------------------------------
// Retiring one
// ---------------------------------------------------------------------------

test("an active discount that has stopped applying is retired when it is next read", () => {
  /*
   * Nothing runs at midnight to retire these. If a discount that ran until March were
   * left sitting as active, the index holding "one active discount per client" would
   * refuse the client a new one in April - over a discount that had stopped applying
   * weeks earlier and that no invoice would pick up.
   */
  assert.equal(finishedState(discount({ runs: "until", until_on: "2026-09-30" }), TODAY), null);
  assert.equal(
    finishedState(discount({ runs: "until", until_on: "2026-08-31" }), TODAY),
    "ended",
  );
  assert.equal(finishedState(discount({ runs: "once", used_count: 1 }), TODAY), "spent");
  assert.equal(finishedState(discount({ runs: "once", used_count: 0 }), TODAY), null);
  // Already retired: there is nothing further to do to it.
  assert.equal(finishedState(discount({ status: "spent", used_count: 1 }), TODAY), null);
});

// ---------------------------------------------------------------------------
// What it reads as
// ---------------------------------------------------------------------------

test("a discount describes itself in one sentence a Partner can check", () => {
  const money = (n: number) => `GHS ${n.toLocaleString("en-GB")}`;
  assert.equal(
    describeDiscount(discount({ value: 20, runs: "once" }), money),
    "20% off the subscription, on the next invoice",
  );
  assert.equal(
    describeDiscount(
      discount({ kind: "amount", value: 500, applies_to: "everything", runs: "count", invoice_count: 3 }),
      money,
    ),
    "GHS 500 off everything, for 3 invoices",
  );
  assert.equal(
    describeDiscount(
      discount({ applies_to: "services", runs: "until", until_on: "2026-12-31" }),
      money,
    ),
    "20% off additional services, until 2026-12-31",
  );
});

test("one invoice reads as a single invoice, not one invoices", () => {
  const money = (n: number) => `GHS ${n}`;
  assert.match(
    describeDiscount(discount({ runs: "count", invoice_count: 1 }), money),
    /for 1 invoice$/,
  );
});

test("the invoice line says what it is without naming a percentage that is not one", () => {
  // The client reads this. A fixed discount labelled "500 off" would be read as 500%
  // by somebody scanning, so a fixed amount is simply "Discount" and the column shows
  // the figure.
  assert.equal(discountLabel(discount({ value: 20 })), "20% off the subscription");
  assert.equal(
    discountLabel(discount({ kind: "amount", value: 500, applies_to: "everything" })),
    "Discount",
  );
});

// ---------------------------------------------------------------------------
// What is refused
// ---------------------------------------------------------------------------

test("a discount has to be worth something and cannot be more than the bill", () => {
  assert.match(whyNotADiscount({ kind: "percentage", value: 0, runs: "once" }) ?? "", /amount/);
  assert.match(
    whyNotADiscount({ kind: "percentage", value: 120, runs: "once" }) ?? "",
    /more than 100%/,
  );
  assert.equal(whyNotADiscount({ kind: "percentage", value: 100, runs: "once" }), null);
});

test("a run needs the thing it runs against", () => {
  assert.match(
    whyNotADiscount({ kind: "percentage", value: 10, runs: "count" }) ?? "",
    /how many invoices/,
  );
  assert.match(
    whyNotADiscount({ kind: "percentage", value: 10, runs: "until" }) ?? "",
    /date it runs until/,
  );
  assert.match(
    whyNotADiscount({
      kind: "percentage",
      value: 10,
      runs: "until",
      until_on: "2026-08-01",
      today: TODAY,
    }) ?? "",
    /has passed/,
  );
  assert.equal(
    whyNotADiscount({
      kind: "percentage",
      value: 10,
      runs: "until",
      until_on: TODAY,
      today: TODAY,
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// What the database holds up on its own
// ---------------------------------------------------------------------------

const NOW = "2026-09-21T10:00:00.000Z";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`INSERT INTO clients (id,code,name,entity_type,risk_rating,status,created_at,updated_at)
           VALUES ('c1','ADM-014','Adom Foods Ltd','company','medium','active','${NOW}','${NOW}')`);
  return db;
}

function grant(db: DatabaseSync, id: string, over: Partial<Discount> = {}): void {
  const d = discount(over);
  db.prepare(
    `INSERT INTO client_discounts
       (id, client_id, kind, value, applies_to, runs, invoice_count, until_on,
        used_count, reason, status, created_at, updated_at)
     VALUES (?, 'c1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    d.kind,
    d.value,
    d.applies_to,
    d.runs,
    d.invoice_count,
    d.until_on,
    d.used_count,
    d.reason,
    d.status,
    NOW,
    NOW,
  );
}

test("a client cannot have two active discounts, whoever presses the button", () => {
  // Held by the index rather than by a check in a route, which two people pressing the
  // same button at the same moment could both pass.
  const db = freshDb();
  grant(db, "d1");
  assert.throws(() => grant(db, "d2"), /UNIQUE/i);
});

test("a spent discount does not stop the next one", () => {
  const db = freshDb();
  grant(db, "d1", { status: "spent", used_count: 1 });
  grant(db, "d2", { status: "ended" });
  grant(db, "d3");
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM client_discounts WHERE client_id = 'c1'`)
      .get()!.n,
    3,
  );
});

test("the database refuses a run with nothing to run against", () => {
  const db = freshDb();
  assert.throws(() => grant(db, "d1", { runs: "count" }), /CHECK/i);
  assert.throws(() => grant(db, "d2", { runs: "until" }), /CHECK/i);
  assert.throws(() => grant(db, "d3", { value: 0 }), /CHECK/i);
});

test("what came off an invoice survives the discount being ended", () => {
  /*
   * A Partner ending a discount must not change an invoice already in a client's hands.
   * The reference is nulled, the figures stay.
   */
  const db = freshDb();
  grant(db, "d1");
  db.exec(`INSERT INTO counters (name, value) VALUES ('t', 0)`);
  db.prepare(
    `INSERT INTO invoices (id, number, client_id, state, due_on, currency, net, tax_total,
                           gross, discount_id, discount_label, discount_amount,
                           balance_due, created_at, updated_at)
     VALUES ('i1','INV-2026-0001','c1','sent','2026-10-06','GHS',3600,620.28,4220.28,
             'd1','20% off the subscription',900,4220.28,?,?)`,
  ).run(NOW, NOW);

  db.exec(`DELETE FROM client_discounts WHERE id = 'd1'`);

  const invoice = db
    .prepare(`SELECT discount_id, discount_label, discount_amount FROM invoices WHERE id = 'i1'`)
    .get() as { discount_id: string | null; discount_label: string; discount_amount: number };
  assert.equal(invoice.discount_id, null);
  assert.equal(invoice.discount_label, "20% off the subscription");
  assert.equal(invoice.discount_amount, 900);
});

test("a client's discounts go when the client does", () => {
  const db = freshDb();
  grant(db, "d1");
  db.exec(`DELETE FROM clients WHERE id = 'c1'`);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM client_discounts`).get()!.n,
    0,
  );
});

test("a client is told what is left of a discount, not what was granted", () => {
  const date = (iso: string) => `[${iso}]`;
  assert.equal(
    describeDiscountTerm({ runs: "once", invoice_count: null, until_on: null, used_count: 0 }, date),
    "on your next invoice",
  );
  assert.equal(
    describeDiscountTerm({ runs: "count", invoice_count: 3, until_on: null, used_count: 1 }, date),
    "2 of 3 invoices left",
  );
  assert.equal(
    describeDiscountTerm({ runs: "count", invoice_count: 1, until_on: null, used_count: 0 }, date),
    "1 of 1 invoice left",
  );
  assert.equal(
    describeDiscountTerm({ runs: "until", invoice_count: null, until_on: "2026-12-31", used_count: 4 }, date),
    "until [2026-12-31]",
  );
});
