/**
 * Invoice arithmetic: the tax stack, what is outstanding, and when to chase.
 *
 * These are the numbers a client reads, a Partner chases from, and a reminder quotes. A
 * mistake here is not a crash - it is a total nobody can reconcile - so the cases with
 * the most attention are the ones that produce a plausible wrong answer: VAT charged on
 * the wrong base, a withheld deduction read as a shortfall, and an invoice chased after
 * it has been paid.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_REMINDER_DAYS,
  computeTotals,
  daysBetween,
  lineTotal,
  netOf,
  reminderDue,
  reminderTone,
  round2,
  standingOf,
  stateAfterPayments,
  whyNotAPayment,
  whyNotARate,
  type TaxLine,
} from "../shared/invoices";

/** The Ghanaian stack a VAT-registered practice actually issues. */
const GHANA: TaxLine[] = [
  { id: "nhil", name: "NHIL", rate: 2.5, basis: "net", position: 0 },
  { id: "getfund", name: "GETFund", rate: 2.5, basis: "net", position: 1 },
  { id: "covid", name: "COVID-19 levy", rate: 1, basis: "net", position: 2 },
  { id: "vat", name: "VAT", rate: 15, basis: "net_plus_preceding", position: 3 },
];

// ---------------------------------------------------------------------------
// The tax stack
// ---------------------------------------------------------------------------

test("levies sit on the fee and VAT sits on top of them", () => {
  // The whole reason tax is configured rather than a constant. 4,500 + 5% levies is
  // 4,770; VAT is 15% of that, not of 4,500. The wrong base gives 675 and an invoice
  // that is short by 40.50 every month.
  const t = computeTotals(4500, GHANA);
  assert.equal(t.net, 4500);
  assert.deepEqual(
    t.taxes.map((x) => [x.name, x.amount]),
    [["NHIL", 112.5], ["GETFund", 112.5], ["COVID-19 levy", 45], ["VAT", 715.5]],
  );
  assert.equal(t.tax_total, 985.5);
  assert.equal(t.gross, 5485.5);
});

test("the printed total equals the sum of the printed lines", () => {
  // Rounding each line and then summing, rather than summing and rounding once. An
  // invoice whose total does not equal its own column is the one thing it must not do.
  const t = computeTotals(1234.56, GHANA);
  const summed = round2(t.taxes.reduce((s, x) => s + x.amount, 0));
  assert.equal(t.tax_total, summed);
  assert.equal(t.gross, round2(t.net + t.tax_total));
});

test("one VAT line alone is the same mechanism", () => {
  // The flat-rate or VAT-only arrangement needs no separate code path.
  const t = computeTotals(4500, [
    { id: "vat", name: "VAT", rate: 15, basis: "net", position: 0 },
  ]);
  assert.equal(t.gross, 5175);
  assert.equal(t.taxes.length, 1);
});

test("a firm that charges no tax gets an invoice with no tax", () => {
  const t = computeTotals(4500, []);
  assert.equal(t.tax_total, 0);
  assert.equal(t.gross, 4500);
  assert.deepEqual(t.taxes, []);
});

test("order is load-bearing, and position decides it", () => {
  // VAT above the levies would charge VAT on nothing. Given out of order, the function
  // must still apply them in position order.
  const shuffled = [GHANA[3], GHANA[1], GHANA[0], GHANA[2]];
  assert.equal(computeTotals(4500, shuffled).gross, 5485.5);
});

test("half a pesewa rounds the way an accountant expects", () => {
  // 1.005 is held as 1.00499999..., so a naive Math.round gives 1.00.
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(2.675), 2.68);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test("lines add up the way a column does", () => {
  assert.equal(lineTotal({ quantity: 3, unit_amount: 1500 }), 4500);
  assert.equal(netOf([{ quantity: 1, unit_amount: 4500 }, { quantity: 2, unit_amount: 250 }]), 5000);
  assert.equal(netOf([]), 0);
});

// ---------------------------------------------------------------------------
// Withholding is not a shortfall
// ---------------------------------------------------------------------------

const INVOICE = { state: "sent" as const, gross: 5485.5, due_on: "2026-10-14" };

test("an invoice settled with tax withheld is paid in full", () => {
  // The case the firm meets every month. The client kept 7.5% and remitted it to the
  // GRA; the firm has been paid everything it is owed. Reading the deduction as a
  // shortfall would leave a permanent tail of invoices that look unpaid and would chase
  // clients who owe nothing.
  const payments = [{ amount: 5074.09, withheld: 411.41 }];
  const s = standingOf(INVOICE, payments, "2026-10-20");
  assert.equal(s.outstanding, 0);
  assert.equal(s.overdue, false, "and it is not overdue, though the date has passed");
  assert.equal(stateAfterPayments("sent", INVOICE.gross, payments), "paid");
});

test("what is withheld is owed as a certificate until one arrives", () => {
  const s = standingOf(INVOICE, [{ amount: 5074.09, withheld: 411.41 }], "2026-10-20");
  assert.equal(s.awaiting_certificate, 411.41);

  const evidenced = standingOf(
    INVOICE,
    [{ amount: 5074.09, withheld: 411.41, certificate_received: 1 }],
    "2026-10-20",
  );
  assert.equal(evidenced.awaiting_certificate, 0);
});

test("a genuine part payment is still outstanding", () => {
  const payments = [{ amount: 2000, withheld: 0 }];
  const s = standingOf(INVOICE, payments, "2026-10-10");
  assert.equal(s.outstanding, 3485.5);
  assert.equal(stateAfterPayments("sent", INVOICE.gross, payments), "part_paid");
});

test("a pesewa short counts as paid", () => {
  // A client rounding to the cedi should not leave an invoice open forever, with the
  // portal emailing about one pesewa.
  const payments = [{ amount: 5485.49, withheld: 0 }];
  assert.equal(stateAfterPayments("sent", INVOICE.gross, payments), "paid");
  assert.equal(standingOf(INVOICE, payments, "2026-11-01").overdue, false);
});

test("cancelling and drafting are decisions, not arithmetic", () => {
  // A payment landing against a cancelled invoice must not quietly un-cancel it.
  assert.equal(stateAfterPayments("void", 5485.5, [{ amount: 5485.5, withheld: 0 }]), "void");
  assert.equal(stateAfterPayments("draft", 5485.5, []), "draft");
});

// ---------------------------------------------------------------------------
// Overdue, which is asked and never stored
// ---------------------------------------------------------------------------

test("overdue is the due date and the balance, together", () => {
  assert.equal(standingOf(INVOICE, [], "2026-10-13").overdue, false, "the day before");
  assert.equal(standingOf(INVOICE, [], "2026-10-14").overdue, false, "on the day it is due");
  assert.equal(standingOf(INVOICE, [], "2026-10-15").overdue, true, "the day after");
});

test("a paid invoice is never overdue, however old", () => {
  const paid = { ...INVOICE, state: "paid" as const };
  assert.equal(standingOf(paid, [{ amount: 5485.5, withheld: 0 }], "2027-06-01").overdue, false);
});

test("a draft is never overdue, because nobody has been asked yet", () => {
  const draft = { ...INVOICE, state: "draft" as const };
  assert.equal(standingOf(draft, [], "2027-06-01").overdue, false);
});

test("a cancelled invoice is never chased", () => {
  const voided = { ...INVOICE, state: "void" as const };
  assert.equal(standingOf(voided, [], "2027-06-01").overdue, false);
});

test("days to due goes negative once it is late", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-14"), 13);
  assert.equal(daysBetween("2026-10-20", "2026-10-14"), -6);
  assert.equal(daysBetween("2026-10-14", "2026-10-14"), 0);
});

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

test("nothing is chased before it is late", () => {
  assert.equal(reminderDue(INVOICE, [], 0, "2026-10-14").due, false);
});

test("the first reminder waits for the schedule", () => {
  assert.equal(reminderDue(INVOICE, [], 0, "2026-10-16").due, false, "two days late");
  const due = reminderDue(INVOICE, [], 0, "2026-10-17");
  assert.equal(due.due, true, "three days late");
  assert.equal(due.step, 1);
  assert.equal(due.days_late, 3);
});

test("a reminder already sent is not sent again the next day", () => {
  // The step is recorded, so a run that fails half way is safe to repeat - the check is
  // "have we sent step two", not "did anything go out today".
  assert.equal(reminderDue(INVOICE, [], 1, "2026-10-18").due, false);
  assert.equal(reminderDue(INVOICE, [], 1, "2026-10-28").due, true, "step two at 14 days");
  assert.equal(reminderDue(INVOICE, [], 2, "2026-11-13").due, true, "step three at 30 days");
});

test("chasing stops after the schedule runs out", () => {
  // By the fourth reminder the problem is not that the client forgot. It is that
  // somebody needs to telephone them, and a portal that emails forever gets filtered.
  assert.equal(reminderDue(INVOICE, [], 3, "2027-03-01").due, false);
  assert.equal(DEFAULT_REMINDER_DAYS.length, 3);
});

test("paying stops the chase immediately", () => {
  const paid = [{ amount: 5485.5, withheld: 0 }];
  assert.equal(reminderDue(INVOICE, paid, 0, "2027-01-01").due, false);
  // And so does settling it with tax withheld.
  const withheld = [{ amount: 5074.09, withheld: 411.41 }];
  assert.equal(reminderDue(INVOICE, withheld, 0, "2027-01-01").due, false);
});

test("a part payment does not stop the chase", () => {
  assert.equal(reminderDue(INVOICE, [{ amount: 2000, withheld: 0 }], 0, "2026-10-17").due, true);
});

test("the wording hardens as it gets later", () => {
  assert.equal(reminderTone(3), "gentle");
  assert.equal(reminderTone(14), "firm");
  assert.equal(reminderTone(31), "final");
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("overpayment is refused rather than quietly banked", () => {
  // Either a typo or a payment meant for a different invoice. Accepting it leaves a
  // credit nobody can find; refusing makes somebody look.
  assert.ok(whyNotAPayment(6000, 0, 5485.5));
  assert.equal(whyNotAPayment(5485.5, 0, 5485.5), null);
  assert.equal(whyNotAPayment(5074.09, 411.41, 5485.5), null, "cash plus withheld is the whole");
});

test("a payment of nothing is not a payment", () => {
  assert.ok(whyNotAPayment(0, 0, 5485.5));
  assert.ok(whyNotAPayment(-100, 0, 5485.5));
  assert.ok(whyNotAPayment(100, -50, 5485.5));
});

test("a rate above 100% is a typo, not a tax", () => {
  assert.equal(whyNotARate("15"), null);
  assert.equal(whyNotARate("2.5"), null);
  assert.ok(whyNotARate("150"));
  assert.ok(whyNotARate("-1"));
  assert.ok(whyNotARate(""));
});

// ---------------------------------------------------------------------------
// The schema, measured against the real migrations
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  }
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const AT = "2026-09-21T10:00:00.000Z";

function seedInvoice(db: DatabaseSync): void {
  db.exec(`INSERT INTO clients (id,code,name,entity_type,risk_rating,status,created_at,updated_at)
           VALUES ('c1','ADM-014','Adom Foods','company','medium','active','${AT}','${AT}')`);
  db.exec(`INSERT INTO invoices (id,number,client_id,due_on,net,tax_total,gross,created_at,updated_at)
           VALUES ('i1','INV-2026-0001','c1','2026-10-14',4500,985.5,5485.5,'${AT}','${AT}')`);
  db.exec(`INSERT INTO invoice_lines
             (id,invoice_id,client_id,description,unit_amount,amount,source,subscription_period)
           VALUES ('l1','i1','c1','Subscription - Growth, September 2026',4500,4500,'subscription','2026-09')`);
}

test("a client cannot be billed twice for the same subscription month", () => {
  // The expensive failure: two people run September and the client gets two invoices.
  // Enforced by the database rather than by a rule somebody has to remember.
  const db = freshDb();
  seedInvoice(db);
  db.exec(`INSERT INTO invoices (id,number,client_id,due_on,created_at,updated_at)
           VALUES ('i2','INV-2026-0002','c1','2026-11-14','${AT}','${AT}')`);
  let blocked = false;
  try {
    db.exec(`INSERT INTO invoice_lines
               (id,invoice_id,client_id,description,unit_amount,amount,source,subscription_period)
             VALUES ('l2','i2','c1','Subscription - Growth, September 2026',4500,4500,'subscription','2026-09')`);
  } catch (err) {
    blocked = /UNIQUE/.test(String(err));
  }
  assert.ok(blocked);
  db.close();
});

test("cancelling an invoice frees the month to be billed again", () => {
  // Otherwise a mistyped invoice would lock that client's September out forever.
  const db = freshDb();
  seedInvoice(db);
  db.exec(`INSERT INTO invoices (id,number,client_id,due_on,created_at,updated_at)
           VALUES ('i2','INV-2026-0002','c1','2026-11-14','${AT}','${AT}')`);
  db.exec(`UPDATE invoice_lines SET subscription_period = NULL WHERE invoice_id = 'i1'`);
  db.exec(`INSERT INTO invoice_lines
             (id,invoice_id,client_id,description,unit_amount,amount,source,subscription_period)
           VALUES ('l2','i2','c1','Subscription - Growth, September 2026',4500,4500,'subscription','2026-09')`);
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM invoice_lines WHERE subscription_period='2026-09'").get() as { n: number }).n,
    1,
  );
  db.close();
});

test("one invoice per piece of additional work", () => {
  const db = freshDb();
  seedInvoice(db);
  db.exec(`INSERT INTO client_services (id,client_id,name,status,created_at,updated_at)
           VALUES ('cs1','c1','Tax health check','delivered','${AT}','${AT}')`);
  db.exec(`INSERT INTO invoice_lines
             (id,invoice_id,client_id,description,unit_amount,amount,source,client_service_id)
           VALUES ('l9','i1','c1','Tax health check',4500,4500,'service','cs1')`);
  let blocked = false;
  try {
    db.exec(`INSERT INTO invoice_lines
               (id,invoice_id,client_id,description,unit_amount,amount,source,client_service_id)
             VALUES ('l10','i1','c1','Tax health check',4500,4500,'service','cs1')`);
  } catch (err) {
    blocked = /UNIQUE/.test(String(err));
  }
  assert.ok(blocked);
  db.close();
});

test("an invoice number is never shared", () => {
  const db = freshDb();
  seedInvoice(db);
  let blocked = false;
  try {
    db.exec(`INSERT INTO invoices (id,number,client_id,due_on,created_at,updated_at)
             VALUES ('i3','INV-2026-0001','c1','2026-12-14','${AT}','${AT}')`);
  } catch (err) {
    blocked = /UNIQUE/.test(String(err));
  }
  assert.ok(blocked, "two documents with one name is worse than a gap in the sequence");
  db.close();
});

test("there is no overdue state to go stale", () => {
  // Overdue is asked of a due date and a balance. A stored flag would be true when
  // written and wrong the next morning.
  const db = freshDb();
  seedInvoice(db);
  let refused = false;
  try {
    db.exec(`UPDATE invoices SET state = 'overdue' WHERE id = 'i1'`);
  } catch (err) {
    refused = /CHECK/.test(String(err));
  }
  assert.ok(refused);
  db.close();
});

test("the tax on an issued invoice is frozen, not joined", () => {
  // A rate change next year must not alter what an invoice already in a client's hands
  // says. The invoice carries its own copy of the lines.
  const db = freshDb();
  seedInvoice(db);
  db.exec(`INSERT INTO tax_lines (id,name,rate,basis,position,created_at,updated_at)
           VALUES ('vat','VAT',15,'net_plus_preceding',3,'${AT}','${AT}')`);
  db.exec(`INSERT INTO invoice_taxes (id,invoice_id,name,rate,basis,amount,position)
           VALUES ('it1','i1','VAT',15,'net_plus_preceding',715.5,3)`);

  db.exec(`UPDATE tax_lines SET rate = 20 WHERE id = 'vat'`);
  const frozen = db.prepare("SELECT rate, amount FROM invoice_taxes WHERE id='it1'").get() as {
    rate: number;
    amount: number;
  };
  assert.equal(frozen.rate, 15);
  assert.equal(frozen.amount, 715.5);

  // And deleting the tax line entirely leaves the invoice intact.
  db.exec(`DELETE FROM tax_lines WHERE id = 'vat'`);
  assert.equal(
    (db.prepare("SELECT COUNT(*) n FROM invoice_taxes WHERE invoice_id='i1'").get() as { n: number }).n,
    1,
  );
  db.close();
});

test("no tax line is seeded, because a wrong one is a wrong invoice", () => {
  const db = freshDb();
  assert.equal((db.prepare("SELECT COUNT(*) n FROM tax_lines").get() as { n: number }).n, 0);
  db.close();
});

test("deleting a client takes their invoices, lines and payments", () => {
  const db = freshDb();
  seedInvoice(db);
  db.exec(`INSERT INTO invoice_payments (id,invoice_id,amount,withheld,paid_on,recorded_at)
           VALUES ('p1','i1',5074.09,411.41,'2026-10-14','${AT}')`);
  db.exec(`DELETE FROM clients WHERE id = 'c1'`);
  for (const table of ["invoices", "invoice_lines", "invoice_payments"]) {
    assert.equal(
      (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n,
      0,
      table,
    );
  }
  db.close();
});

// ---------------------------------------------------------------------------
// Withholding on the face of the invoice
// ---------------------------------------------------------------------------

import { balanceDue, withholdingOn } from "../shared/invoices";
import { describeTerms, slashDate } from "../shared/invoice-document";

test("withholding is charged on the amount before tax", () => {
  // The firm's own invoice: a fee of 3,508.10 carries 263.10 at 7.5%, and the balance
  // due is 3,245.00. If this were charged on the tax-inclusive total it would be wrong
  // by the tax, every time.
  assert.equal(withholdingOn(3508.1, 7.5), 263.11);
  assert.equal(withholdingOn(4500, 7.5), 337.5);
  assert.equal(balanceDue(5485.5, 337.5), 5148);
});

test("no rate means no deduction at all", () => {
  // A client who does not withhold must see an invoice with no deduction line, not one
  // showing zero.
  assert.equal(withholdingOn(4500, 0), 0);
  assert.equal(withholdingOn(4500, Number.NaN), 0);
  assert.equal(balanceDue(5485.5, 0), 5485.5);
});

test("an invoice that anticipates withholding is settled by its balance, not its total", () => {
  // The failure this prevents: every invoice permanently short by exactly the tax the
  // client remitted on the firm's behalf, and a reminder chasing them for it.
  const invoice = {
    state: "sent" as const,
    gross: 5485.5,
    balance_due: 5148,
    due_on: "2026-10-14",
  };
  const paid = [{ amount: 5148, withheld: 0 }];
  const s = standingOf(invoice, paid, "2026-10-20");
  assert.equal(s.outstanding, 0);
  assert.equal(s.overdue, false);
  assert.equal(stateAfterPayments("sent", invoice.balance_due, paid), "paid");
});

test("an older invoice with no balance recorded falls back to its total", () => {
  // Invoices raised before withholding could be shown on the face of one.
  const invoice = { state: "sent" as const, gross: 5485.5, due_on: "2026-10-14" };
  assert.equal(standingOf(invoice, [], "2026-10-01").outstanding, 5485.5);
});

test("terms are read off the two dates", () => {
  assert.equal(describeTerms("2026-08-25", "2026-09-09"), "Net 15");
  assert.equal(describeTerms("2026-09-21", "2026-10-06"), "Net 15");
  assert.equal(describeTerms("2026-09-21", "2026-09-21"), "Due on receipt");
});

test("dates read the way the firm writes them", () => {
  assert.equal(slashDate("2026-08-25"), "25/08/2026");
  assert.equal(slashDate(null), "");
});

test("an invoice with no balance recorded is asked for in full", () => {
  // The column is NOT NULL with a default of zero, so a row the backfill missed would
  // otherwise read as "nothing to pay" - an unpaid invoice vanishing from the
  // outstanding figure and never being chased.
  const zeroed = {
    state: "sent" as const,
    gross: 5485.5,
    balance_due: 0,
    due_on: "2026-10-14",
  };
  const s = standingOf(zeroed, [], "2026-10-20");
  assert.equal(s.outstanding, 5485.5);
  assert.equal(s.overdue, true, "and it is still chased");
});
