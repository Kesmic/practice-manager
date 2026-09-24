/**
 * Raising invoices, recording what comes in, and chasing what does not.
 *
 * shared/invoices.ts holds the arithmetic and argues for the shape. This is where it
 * meets the database, and five things it is careful about.
 *
 * **An invoice is a document, not a view.** Its net, its tax lines and its total are
 * written onto it when it is issued and never recomputed. A client holding a PDF and a
 * portal showing a different figure because a rate changed in between is the worst
 * outcome this feature has available to it.
 *
 * **Issued invoices are not edited.** Before it is sent, an invoice is a draft and may
 * be changed freely. Once sent it can only be paid or cancelled, and a cancellation
 * keeps the number and says why. Correcting a sent invoice in place would mean the copy
 * the client has and the copy the firm has are different documents with the same name.
 *
 * **Money is recorded, never collected.** No card details, no payment provider. This is
 * the firm writing down what arrived, which is what makes a status true and a reminder
 * safe to send.
 *
 * **The reminder run is idempotent.** It records which step it has reached on each
 * invoice, so a run that fails half way can be repeated without double-chasing anybody,
 * and a day the run does not happen at all is caught up the next day rather than lost.
 *
 * **The run authenticates as a machine, not a person.** It is reached with a shared
 * secret because the thing calling it is a scheduled job with no session. That secret is
 * checked in constant time and the endpoint does nothing at all without it.
 */

import type { Env } from "../env";
import { requireRole } from "../auth";
import { newId, notifyMany, nowIso, requireEnum, requireString } from "../db";
import {
  Router,
  badRequest,
  conflict,
  forbidden,
  json,
  noContent,
  notFound,
  readJson,
} from "../http";
import { MIN_SUPERVISOR_ROLE } from "../../shared/workflow";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { readSettings } from "./settings";
import { sendToPerson } from "../email";
import { feeFor, readCatalogue } from "./subscriptions";
import {
  describeTerms,
  invoiceFilename,
  renderInvoice,
  type InvoiceDocument,
} from "../../shared/invoice-document";
import {
  discountAmount,
  discountApplies,
  discountLabel,
  discountableBase,
} from "../../shared/discounts";
import { activeDiscount, consumeDiscount, releaseDiscount } from "../discounts";
import { accrueCommission, cancelCommission } from "../commissions";
import { currencyOf } from "../../shared/money";
import { billingDue, normaliseBillingDay } from "../../shared/billing";
import {
  balanceDue,
  withholdingOn,
  DEFAULT_REMINDER_DAYS,

  TAX_BASES,
  computeTotals,
  netOf,
  reminderDue,
  reminderTone,
  round2,
  standingOf,
  stateAfterPayments,
  whyNotAPayment,
  type InvoiceState,
  type PaymentLike,
  type TaxLine,
} from "../../shared/invoices";

/**
 * What the client was asked to pay.
 *
 * The balance due when the invoice shows a withholding deduction, otherwise the total.
 * One function so no caller reaches for `gross` and leaves an invoice looking short by
 * exactly the tax the client remitted on the firm's behalf.
 */
function askedFor(invoice: { gross: number; balance_due?: number | null }): number {
  // Zero means unset, for the reason standingOf gives.
  return invoice.balance_due && invoice.balance_due > 0 ? invoice.balance_due : invoice.gross;
}

/** Today as the portal reckons it. One place, so tests and routes agree. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The next invoice number.
 *
 * Year-prefixed and zero-padded so a year's invoices sort and read together. The counter
 * itself is continuous across years: a gap is a question somebody can answer, whereas
 * restarting at one every January would give two documents the same name.
 */
async function nextInvoiceNumber(
  env: Env,
  clientCode: string,
  period: string | null,
): Promise<string> {
  const row = await env.DB.prepare(
    `UPDATE counters SET value = value + 1 WHERE name = 'invoice' RETURNING value`,
  ).first<{ value: number }>();
  if (!row) throw new Error("The invoice counter is missing.");

  const settings = await readSettings(env);
  const when = period ? `${period}-01` : today();
  const format = settings.invoice_number_format || "INV-{YYYY}-{SEQ}";

  /*
   * The firm's own invoices read CPL202608 - client code and month, no sequence. That
   * format is unique per client per month, which is exactly what a subscription invoice
   * is, but it collides the moment a client is billed twice in one month. So a format
   * with no {SEQ} gets the sequence appended when the number it produces is taken,
   * rather than failing on the unique index and losing the draft.
   */
  const base = format
    .replace(/\{CLIENT\}/g, clientCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
    .replace(/\{YYYY\}/g, when.slice(0, 4))
    .replace(/\{MM\}/g, when.slice(5, 7))
    .replace(/\{SEQ\}/g, String(row.value).padStart(4, "0"));

  if (format.includes("{SEQ}")) return base;

  const taken = await env.DB.prepare(`SELECT id FROM invoices WHERE number = ?`)
    .bind(base)
    .first();
  return taken ? `${base}-${String(row.value).padStart(3, "0")}` : base;
}

async function activeTaxLines(env: Env): Promise<TaxLine[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, rate, basis, position FROM tax_lines
      WHERE active = 1 ORDER BY position, name`,
  ).all();
  return results as unknown as TaxLine[];
}

interface InvoiceRow {
  id: string;
  number: string;
  client_id: string;
  state: InvoiceState;
  issued_on: string | null;
  due_on: string;
  currency: string;
  net: number;
  tax_total: number;
  gross: number;
  period_label: string | null;
  note: string | null;
  reminders_sent: number;
  last_reminder_at: string | null;
  /** Nulled if the discount row ever goes; the figures below stay. */
  discount_id?: string | null;
  discount_label?: string | null;
  discount_amount?: number;
}

async function paymentsFor(env: Env, invoiceId: string): Promise<PaymentLike[]> {
  const { results } = await env.DB.prepare(
    `SELECT amount, withheld, certificate_received FROM invoice_payments WHERE invoice_id = ?`,
  )
    .bind(invoiceId)
    .all();
  return results as unknown as PaymentLike[];
}

/**
 * Rewrites an invoice's stored totals from its lines, the client's discount and the
 * firm's current tax.
 *
 * Only ever called on a draft. The moment an invoice is sent its figures are the
 * document, and this must not touch them.
 *
 * The order is load-bearing: lines, then the discount, then tax on what is left, then
 * withholding on that. Tax is charged on what the firm actually bills, so a discount
 * applied after it would have the firm remitting VAT on money it never received.
 */
async function recomputeDraft(env: Env, invoiceId: string): Promise<void> {
  const invoice = await env.DB.prepare(
    `SELECT client_id, withholding_rate FROM invoices WHERE id = ?`,
  )
    .bind(invoiceId)
    .first<{ client_id: string; withholding_rate: number | null }>();
  if (!invoice) throw notFound("There is no such invoice.");

  const [lines, taxes, discount] = await Promise.all([
    env.DB.prepare(
      `SELECT quantity, unit_amount, amount, source FROM invoice_lines WHERE invoice_id = ?`,
    )
      .bind(invoiceId)
      .all(),
    activeTaxLines(env),
    activeDiscount(env, invoice.client_id),
  ]);

  const rows = lines.results as unknown as Array<{
    quantity: number;
    unit_amount: number;
    amount: number;
    source: string;
  }>;
  const subtotal = netOf(rows);

  /*
   * Worked out against the lines the discount's scope actually covers, so a discount on
   * the subscription does not quietly come off an audit fee that happens to be on the
   * same invoice. Applied at draft time and frozen onto the row; the count against the
   * discount itself is not touched until the invoice is issued, so a cancelled draft
   * does not burn a one-off.
   */
  const taken =
    discount && discountApplies(discount, today())
      ? discountAmount(discount, discountableBase(rows, discount.applies_to))
      : 0;
  const net = round2(subtotal - taken);
  const totals = computeTotals(net, taxes);

  /*
   * Withholding is charged on the amount before tax, which is how it works on services
   * here and what the firm's own invoices do. On the discounted amount, because it is a
   * percentage of what is actually billed - taking it on the full fee would deduct tax
   * the client is not going to remit, and leave the invoice short. It is held on the
   * invoice rather than read from the setting at print time, for the reason the tax
   * lines are frozen: a rate change must not alter a document already in a client's
   * hands.
   */
  const withheld = withholdingOn(totals.net, invoice.withholding_rate ?? 0);

  const statements = [
    env.DB.prepare(`DELETE FROM invoice_taxes WHERE invoice_id = ?`).bind(invoiceId),
    env.DB.prepare(
      `UPDATE invoices
          SET net = ?, tax_total = ?, gross = ?, withholding_amount = ?, balance_due = ?,
              discount_id = ?, discount_label = ?, discount_amount = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(
      totals.net,
      totals.tax_total,
      totals.gross,
      withheld,
      balanceDue(totals.gross, withheld),
      taken > 0 && discount ? discount.id : null,
      taken > 0 && discount ? discountLabel(discount) : null,
      taken,
      nowIso(),
      invoiceId,
    ),
  ];
  totals.taxes.forEach((tax, index) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO invoice_taxes (id, invoice_id, name, rate, basis, amount, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(newId(), invoiceId, tax.name, tax.rate, tax.basis, tax.amount, index),
    );
  });

  await env.DB.batch(statements);
}

/** An invoice with everything a screen needs hung off it. */
async function fullInvoice(env: Env, id: string) {
  const invoice = await env.DB.prepare(
    `SELECT i.*, c.name AS client_name, c.code AS client_code
       FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`,
  )
    .bind(id)
    .first<InvoiceRow & { client_name: string; client_code: string }>();
  if (!invoice) throw notFound("There is no such invoice.");

  const [lines, taxes, payments, reminders] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, description, quantity, unit_amount, amount, source, subscription_period
         FROM invoice_lines WHERE invoice_id = ? ORDER BY position`,
    ).bind(id),
    env.DB.prepare(
      `SELECT name, rate, basis, amount FROM invoice_taxes WHERE invoice_id = ? ORDER BY position`,
    ).bind(id),
    env.DB.prepare(
      `SELECT p.id, p.amount, p.withheld, p.paid_on, p.method, p.reference, p.note,
              p.certificate_received, p.certificate_ref, u.full_name AS recorded_by_name
         FROM invoice_payments p
         LEFT JOIN users u ON u.id = p.recorded_by
        WHERE p.invoice_id = ? ORDER BY p.paid_on`,
    ).bind(id),
    env.DB.prepare(
      `SELECT step, days_late, sent_to, automatic, sent_at
         FROM invoice_reminders WHERE invoice_id = ? ORDER BY sent_at DESC`,
    ).bind(id),
  ]);

  return {
    invoice,
    lines: lines.results,
    taxes: taxes.results,
    payments: payments.results,
    reminders: reminders.results,
    standing: standingOf(
      invoice,
      payments.results as unknown as PaymentLike[],
      today(),
    ),
  };
}

/** Who at the client an invoice or a reminder goes to. */
async function billingContacts(
  env: Env,
  clientId: string,
): Promise<Array<{ email: string; full_name: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT email, full_name FROM client_users
      WHERE client_id = ? AND status = 'active' ORDER BY full_name`,
  )
    .bind(clientId)
    .all<{ email: string; full_name: string }>();
  if (results.length) return results;

  // Nobody has a login yet, so fall back to the contact on the client record.
  const client = await env.DB.prepare(
    `SELECT contact_email, contact_name FROM clients WHERE id = ?`,
  )
    .bind(clientId)
    .first<{ contact_email: string | null; contact_name: string | null }>();
  return client?.contact_email
    ? [{ email: client.contact_email, full_name: client.contact_name ?? "" }]
    : [];
}

export function registerInvoiceRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // Tax settings
  // -------------------------------------------------------------------------

  router.get("/api/tax-lines", async ({ request, env }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const { results } = await env.DB.prepare(
      `SELECT id, name, rate, basis, position, active FROM tax_lines ORDER BY position, name`,
    ).all();
    // Worked through on a round number so the settings screen can show what the current
    // arrangement actually does, rather than leaving somebody to check the arithmetic.
    return json({
      tax_lines: results,
      example: computeTotals(1000, await activeTaxLines(env)),
    });
  });

  router.post("/api/tax-lines", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ name?: string; rate?: unknown; basis?: unknown }>(request);

    const name = requireString(body.name, "name", { max: 60 });
    const basis = requireEnum(body.basis, "basis", TAX_BASES);
    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw badRequest("A rate has to be a percentage between 0 and 100.");
    }

    const id = newId();
    const timestamp = nowIso();
    const position = await env.DB.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tax_lines`,
    ).first<{ n: number }>();

    await env.DB.prepare(
      `INSERT INTO tax_lines (id, name, rate, basis, position, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, name, rate, basis, position?.n ?? 0, timestamp, timestamp, actor.id)
      .run();

    return json({ id }, 201);
  });

  router.patch("/api/tax-lines/:id", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      name?: string;
      rate?: unknown;
      basis?: unknown;
      position?: unknown;
      active?: unknown;
    }>(request);

    const name = requireString(body.name, "name", { max: 60 });
    const basis = requireEnum(body.basis, "basis", TAX_BASES);
    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw badRequest("A rate has to be a percentage between 0 and 100.");
    }

    const result = await env.DB.prepare(
      `UPDATE tax_lines
          SET name = ?, rate = ?, basis = ?, position = COALESCE(?, position),
              active = ?, updated_at = ?, updated_by = ?
        WHERE id = ?`,
    )
      .bind(
        name,
        rate,
        basis,
        body.position === undefined ? null : Number(body.position),
        body.active === false || body.active === 0 ? 0 : 1,
        nowIso(),
        actor.id,
        params.id,
      )
      .run();
    if (!result.meta.changes) throw notFound("There is no such tax line.");
    return noContent();
  });

  router.delete("/api/tax-lines/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    // Invoices carry their own frozen copy, so removing a line here changes nothing
    // that has already been issued.
    const result = await env.DB.prepare(`DELETE FROM tax_lines WHERE id = ?`)
      .bind(params.id)
      .run();
    if (!result.meta.changes) throw notFound("There is no such tax line.");
    return noContent();
  });

  // -------------------------------------------------------------------------
  // Invoices
  // -------------------------------------------------------------------------

  /** The firm's invoice list, with outstanding and overdue worked out per row. */
  router.get("/api/invoices", async ({ request, env }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const url = new URL(request.url);
    const state = url.searchParams.get("state");

    const [invoices, payments] = await env.DB.batch([
      env.DB.prepare(
        `SELECT i.id, i.number, i.client_id, i.state, i.issued_on, i.due_on, i.currency,
                i.net, i.tax_total, i.gross, i.balance_due, i.withholding_amount,
                i.discount_amount, i.discount_label,
                i.period_label, i.reminders_sent,
                i.last_reminder_at, c.name AS client_name, c.code AS client_code
           FROM invoices i JOIN clients c ON c.id = i.client_id
          WHERE (?1 IS NULL OR i.state = ?1)
          ORDER BY i.due_on DESC, i.number DESC
          LIMIT 300`,
      ).bind(state),
      env.DB.prepare(
        `SELECT invoice_id, amount, withheld, certificate_received FROM invoice_payments`,
      ),
    ]);

    const byInvoice = new Map<string, PaymentLike[]>();
    for (const row of payments.results as unknown as Array<PaymentLike & { invoice_id: string }>) {
      const list = byInvoice.get(row.invoice_id) ?? [];
      list.push(row);
      byInvoice.set(row.invoice_id, list);
    }

    const now = today();
    const rows = (invoices.results as unknown as Array<InvoiceRow & { client_name: string }>).map(
      (invoice) => ({
        ...invoice,
        standing: standingOf(invoice, byInvoice.get(invoice.id) ?? [], now),
      }),
    );

    return json({
      invoices: rows,
      totals: {
        outstanding: round2(rows.reduce((s, r) => s + r.standing.outstanding, 0)),
        overdue: round2(
          rows.filter((r) => r.standing.overdue).reduce((s, r) => s + r.standing.outstanding, 0),
        ),
        awaiting_certificate: round2(
          rows.reduce((s, r) => s + r.standing.awaiting_certificate, 0),
        ),
      },
    });
  });

  router.get("/api/invoices/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    return json(await fullInvoice(env, params.id));
  });

  /**
   * Raises a draft invoice for a client.
   *
   * With `period` it bills that month's subscription; delivered additional work not yet
   * invoiced is picked up too. The one-month-per-client index is what actually stops a
   * double billing, so a second attempt fails on the write rather than on a check that
   * could race.
   */
  router.post("/api/clients/:id/invoices", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      period?: string;
      due_on?: string;
      include_services?: unknown;
      note?: string;
    }>(request);

    const period = body.period?.trim() || null;
    if (period && !/^\d{4}-\d{2}$/.test(period)) {
      throw badRequest("Give the month as YYYY-MM.");
    }
    const raised = await raiseInvoice(env, params.id, {
      period,
      dueOn: body.due_on?.trim() || null,
      includeServices: body.include_services !== false,
      note: body.note?.trim()?.slice(0, 500) || null,
      actorId: actor.id,
    });
    return json(raised, 201);
  });

  /** Issues a draft: freezes the figures, sends it, and starts the clock. */
  router.post("/api/invoices/:id/send", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const settings = await readSettings(env);
    const sent = await issueInvoice(env, params.id, firmCopies(settings, actor.email));
    return json(sent);
  });

  /** Cancels an invoice, keeping its number and freeing anything it billed. */
  router.post("/api/invoices/:id/void", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ reason?: string }>(request);
    const reason = requireString(body.reason, "reason", { max: 300 });

    const payments = await paymentsFor(env, params.id);
    if (payments.length) {
      throw badRequest(
        "Money has been recorded against this invoice. Remove the payments first, or raise a credit against it instead.",
      );
    }

    const cancelled = await env.DB.prepare(
      `SELECT client_id, state, discount_id, discount_amount FROM invoices WHERE id = ?`,
    )
      .bind(params.id)
      .first<{
        client_id: string;
        state: InvoiceState;
        discount_id: string | null;
        discount_amount: number;
      }>();
    if (!cancelled) throw notFound("There is no such invoice.");

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE invoices SET state = 'void', voided_at = ?, void_reason = ?, updated_at = ?
          WHERE id = ? AND state <> 'void'`,
      ).bind(timestamp, reason, timestamp, params.id),
      /*
       * The month and the delivered work go back in the pool. Without this a mistyped
       * invoice would lock that client's September out permanently, and nobody could
       * raise the corrected one.
       */
      env.DB.prepare(
        `UPDATE invoice_lines SET subscription_period = NULL, client_service_id = NULL
          WHERE invoice_id = ?`,
      ).bind(params.id),
    ]);

    /*
     * And so does the discount, but only if this invoice had actually been issued. A
     * draft never counted against it, so giving a use back here would hand the client
     * an extra discounted invoice every time somebody cancelled a draft.
     */
    if (cancelled.state !== "draft") await releaseDiscount(env, cancelled);

    /*
     * And so does the commission it earned. A cancelled invoice was never paid, so it
     * never earned anybody anything - and the billed month goes back into the partner's
     * six, to be earned on the invoice that replaces this one.
     */
    if (cancelled.state !== "draft") {
      await cancelCommission(env, params.id, `Invoice cancelled: ${reason}`);
    }

    return noContent();
  });

  /** Records money in, and moves the invoice to whatever that makes it. */
  router.post("/api/invoices/:id/payments", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      amount?: unknown;
      withheld?: unknown;
      paid_on?: string;
      method?: string;
      reference?: string;
      certificate_received?: unknown;
      certificate_ref?: string;
      note?: string;
    }>(request);

    const { invoice, standing } = await fullInvoice(env, params.id);
    if (invoice.state === "draft") {
      throw badRequest("Issue the invoice before recording payment against it.");
    }
    if (invoice.state === "void") {
      throw badRequest("That invoice was cancelled.");
    }

    const amount = round2(Number(body.amount ?? 0));
    const withheld = round2(Number(body.withheld ?? 0));
    const refusal = whyNotAPayment(amount, withheld, standing.outstanding);
    if (refusal) throw badRequest(refusal);

    const paidOn = body.paid_on?.trim() || today();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO invoice_payments
         (id, invoice_id, amount, withheld, paid_on, method, reference, note,
          certificate_received, certificate_ref, recorded_by, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId(),
        params.id,
        amount,
        withheld,
        paidOn,
        body.method?.trim()?.slice(0, 60) || null,
        body.reference?.trim()?.slice(0, 120) || null,
        body.note?.trim()?.slice(0, 300) || null,
        body.certificate_received === true || body.certificate_received === 1 ? 1 : 0,
        body.certificate_ref?.trim()?.slice(0, 120) || null,
        actor.id,
        timestamp,
      )
      .run();

    const after = await paymentsFor(env, params.id);
    const state = stateAfterPayments(invoice.state, askedFor(invoice), after);
    await env.DB.prepare(`UPDATE invoices SET state = ?, updated_at = ? WHERE id = ?`)
      .bind(state, timestamp, params.id)
      .run();

    return json({ state });
  });

  /** Marks a withholding certificate as received. */
  router.patch("/api/invoice-payments/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ certificate_received?: unknown; certificate_ref?: string }>(
      request,
    );
    const result = await env.DB.prepare(
      `UPDATE invoice_payments SET certificate_received = ?, certificate_ref = ? WHERE id = ?`,
    )
      .bind(
        body.certificate_received === false || body.certificate_received === 0 ? 0 : 1,
        body.certificate_ref?.trim()?.slice(0, 120) || null,
        params.id,
      )
      .run();
    if (!result.meta.changes) throw notFound("There is no such payment.");
    return noContent();
  });

  /** Removes a payment recorded in error, and puts the invoice back where it was. */
  router.delete("/api/invoice-payments/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const payment = await env.DB.prepare(
      `SELECT invoice_id FROM invoice_payments WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ invoice_id: string }>();
    if (!payment) throw notFound("There is no such payment.");

    await env.DB.prepare(`DELETE FROM invoice_payments WHERE id = ?`).bind(params.id).run();

    const invoice = await env.DB.prepare(
      `SELECT state, gross FROM invoices WHERE id = ?`,
    )
      .bind(payment.invoice_id)
      .first<{ state: InvoiceState; gross: number }>();
    if (invoice) {
      const after = await paymentsFor(env, payment.invoice_id);
      await env.DB.prepare(`UPDATE invoices SET state = ?, updated_at = ? WHERE id = ?`)
        .bind(
          stateAfterPayments(invoice.state, askedFor(invoice), after),
          nowIso(),
          payment.invoice_id,
        )
        .run();
    }
    return noContent();
  });

  /** Chases one invoice by hand, outside the schedule. */
  router.post("/api/invoices/:id/remind", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const sent = await chase(env, params.id, false);
    if (!sent.sent) throw badRequest(sent.why ?? "There is nothing to chase.");
    return json(sent);
  });

  /**
   * The invoice as a document: letterhead, lines, deduction, balance due, bank block.
   *
   * Handed back as a file rather than a page, so following the link downloads something
   * the firm can print, attach or file. A Partner may fetch any client's; a client can
   * only ever reach their own, through the client route below.
   */
  router.get("/api/invoices/:id/document", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    return await serveDocument(env, params.id);
  });

  // -------------------------------------------------------------------------
  // The nightly run
  // -------------------------------------------------------------------------

  /**
   * Sends every reminder that is due today.
   *
   * Reached by a scheduled job rather than a person, so it authenticates with a shared
   * secret rather than a session. This is a Cloudflare **Pages** project, which has no
   * cron triggers of its own - see wrangler.toml for why the portal is on Pages at all -
   * so the schedule lives in a GitHub Actions workflow that calls this once a day.
   *
   * Safe to call twice. Each invoice records which reminder step it has reached, so a
   * run that fails half way can simply be repeated, and a day the job does not run at
   * all is caught up the next day rather than lost.
   */
  router.post("/api/invoices/run-reminders", async ({ request, env }) => {
    assertRunner(env, request);

    const { results } = await env.DB.prepare(
      `SELECT id FROM invoices WHERE state IN ('sent', 'part_paid') AND due_on < ?`,
    )
      .bind(today())
      .all<{ id: string }>();

    const sent: string[] = [];
    const skipped: string[] = [];
    for (const row of results) {
      const outcome = await chase(env, row.id, true);
      (outcome.sent ? sent : skipped).push(row.id);
    }

    return json({ considered: results.length, sent: sent.length, skipped: skipped.length });
  });

  /**
   * Raises and sends the month's subscription invoices.
   *
   * Reached by the same scheduled job as the reminders, once a day. Whether today is a
   * day to bill is decided in shared/billing.ts: the firm's billing day and a few days
   * after it, so a missed run is made up and a run outside the window does nothing.
   * Every active subscription that has no invoice yet for the month gets one, built
   * and issued exactly as a Partner would by hand; a client whose invoice cannot be
   * raised - no fee set, work quoted in another currency - is reported, not sent, and
   * the Partners hear about the whole run in their inbox.
   *
   * Safe to call twice: the one-month-per-client index is what stops a second bill.
   */
  router.post("/api/invoices/run-billing", async ({ request, env }) => {
    assertRunner(env, request);
    const settings = await readSettings(env);
    if (settings.auto_billing !== "on") {
      return json({ ran: false, why: "Automatic invoicing is off in Portal settings." });
    }
    const decision = billingDue(today(), normaliseBillingDay(settings.billing_day));
    if (!decision.due) return json({ ran: false, period: decision.period, why: decision.why });
    const { period } = decision;

    const { results: subscriptions } = await env.DB.prepare(
      `SELECT s.client_id, c.name AS client_name,
              (SELECT state FROM invoices i WHERE i.client_id = s.client_id AND i.period_label = ?1) AS existing
         FROM client_subscriptions s JOIN clients c ON c.id = s.client_id
        WHERE s.status = 'active' AND substr(s.started_on, 1, 7) <= ?1
        ORDER BY c.name`,
    )
      .bind(period)
      .all<{ client_id: string; client_name: string; existing: string | null }>();

    const sent: Array<{ client: string; number: string; to: string[] }> = [];
    const skipped: Array<{ client: string; why: string }> = [];
    /*
     * A client already invoiced for the month is the normal case on every day of the
     * window after the first, and is not news. It is reported to the job, so the
     * Actions log is complete, but does not wake the Partners.
     */
    const already: string[] = [];
    for (const row of subscriptions) {
      if (row.existing) {
        already.push(row.client_name);
        continue;
      }
      try {
        const raised = await raiseInvoice(env, row.client_id, {
          period,
          dueOn: null,
          includeServices: true,
          note: null,
          actorId: null,
        });
        const { sent_to } = await issueInvoice(env, raised.id, firmCopies(settings));
        sent.push({ client: row.client_name, number: raised.number, to: sent_to });
      } catch (err) {
        skipped.push({
          client: row.client_name,
          why: err instanceof Error ? err.message : String(err),
        });
      }
    }

    /*
     * The Partners are told what went out and what did not, in their inbox, so a run
     * that skipped somebody is a thing a person sees rather than a line in a log.
     */
    const { results: partners } = await env.DB.prepare(
      `SELECT id FROM users WHERE status = 'active' AND role IN ('partner', 'admin')`,
    ).all<{ id: string }>();
    // Issued, but with nobody at the client to email: it exists, and somebody must chase it by hand.
    const unaddressed = sent.filter((x) => x.to.length === 0);
    const summary =
      `${sent.length} sent` +
      (sent.length ? `: ${sent.map((x) => `${x.client} (${x.number})`).join(", ")}` : "") +
      (unaddressed.length
        ? `. Issued with nobody to email: ${unaddressed.map((x) => x.client).join(", ")} - send these by hand`
        : "") +
      (skipped.length
        ? `. ${skipped.length} not sent: ${skipped.map((x) => `${x.client} - ${x.why}`).join("; ")}`
        : ".");
    if (partners.length && (sent.length || skipped.length)) {
      await env.DB.batch(
        notifyMany(env, partners.map((p) => p.id), "", {
          taskId: null,
          kind: "billing:run",
          title: `Monthly invoices for ${period}: ${sent.length} sent, ${skipped.length} not`,
          body: summary.slice(0, 1500),
        }),
      );
    }

    return json({ ran: true, period, sent, skipped, already_invoiced: already });
  });
}

/**
 * Builds and serves one invoice as a printable document.
 *
 * Exported so the client's own route can hand a client their own invoice without
 * duplicating the assembly - two builders would be two invoices that disagree.
 */
export async function serveDocument(env: Env, invoiceId: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT i.*, c.name AS client_name, c.code AS client_code, c.address AS client_address,
            c.tax_id AS client_tax_id
       FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`,
  )
    .bind(invoiceId)
    .first<
      InvoiceRow & {
        client_name: string;
        client_code: string;
        client_address: string | null;
        client_tax_id: string | null;
        discount_label: string | null;
        discount_amount: number;
        withholding_rate: number | null;
        withholding_amount: number;
        balance_due: number;
        note: string | null;
      }
    >();
  if (!row) throw notFound("There is no such invoice.");

  const [lines, taxes, payments] = await env.DB.batch([
    env.DB.prepare(
      `SELECT description, quantity, unit_amount, amount, source, subscription_period
         FROM invoice_lines WHERE invoice_id = ? ORDER BY position`,
    ).bind(invoiceId),
    env.DB.prepare(
      `SELECT name, rate, amount FROM invoice_taxes WHERE invoice_id = ? ORDER BY position`,
    ).bind(invoiceId),
    env.DB.prepare(
      `SELECT amount, withheld FROM invoice_payments WHERE invoice_id = ?`,
    ).bind(invoiceId),
  ]);

  const settings = await readSettings(env);
  const issued = row.issued_on ?? today();

  const doc: InvoiceDocument = {
    firm: {
      name: settings.firm_name,
      address_lines: (settings.firm_address || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
      city: settings.firm_city,
      phone: settings.firm_phone,
      email: settings.firm_finance_email,
      website: (settings.firm_website || "").replace(/^https?:\/\//, ""),
      logo: settings.logo_data_url,
      tax_id: settings.firm_tax_id,
    },
    client: {
      name: row.client_name,
      address_lines: (row.client_address || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
      tax_id: row.client_tax_id ?? "",
    },
    number: row.number,
    issued_on: issued,
    due_on: row.due_on,
    terms: describeTerms(issued, row.due_on),
    currency: row.currency,
    lines: (lines.results as unknown as Array<{
      description: string;
      quantity: number;
      unit_amount: number;
      amount: number;
      source: string;
      subscription_period: string | null;
    }>).map((line) => ({
      date: issued,
      // The firm's own invoices carry a short "activity" beside the description.
      activity:
        line.source === "subscription"
          ? "Consultancy services"
          : line.source === "service"
            ? "Professional services"
            : "Services",
      description: line.description,
      quantity: line.quantity,
      unit_amount: line.unit_amount,
      amount: line.amount,
    })),
    taxes: taxes.results as unknown as Array<{ name: string; rate: number; amount: number }>,
    discount:
      row.discount_amount && row.discount_amount > 0
        ? { label: row.discount_label || "Discount", amount: row.discount_amount }
        : null,
    net: row.net,
    tax_total: row.tax_total,
    gross: row.gross,
    withholding:
      row.withholding_rate && row.withholding_amount > 0
        ? {
            label: settings.withholding_label || "Withholding tax",
            rate: row.withholding_rate,
            amount: row.withholding_amount,
          }
        : null,
    balance_due: row.balance_due || row.gross,
    paid: round2(
      (payments.results as unknown as Array<{ amount: number; withheld: number }>).reduce(
        (sum, p) => sum + p.amount + p.withheld,
        0,
      ),
    ),
    note: row.note,
    bank: {
      account_name: settings.bank_account_name,
      account_number: settings.bank_account_number,
      bank: settings.bank_name,
      branch: settings.bank_branch,
      swift: settings.bank_swift,
    },
  };

  return new Response(renderInvoice(doc), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${invoiceFilename(doc)}"`,
      // Somebody's bill. Nothing should cache it.
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Sends the reminder that is due on one invoice, if one is.
 *
 * The step is written in the same call that sends, so a crash between the two costs at
 * most one duplicate rather than an endless loop of them.
 */
async function chase(
  env: Env,
  invoiceId: string,
  automatic: boolean,
): Promise<{ sent: boolean; step?: number; why?: string }> {
  const invoice = await env.DB.prepare(
    `SELECT i.id, i.number, i.state, i.gross, i.balance_due, i.due_on, i.currency,
            i.reminders_sent, i.period_label, c.id AS client_id, c.name AS client_name
       FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?`,
  )
    .bind(invoiceId)
    .first<InvoiceRow & { client_id: string; client_name: string }>();
  if (!invoice) return { sent: false, why: "There is no such invoice." };

  const payments = await paymentsFor(env, invoiceId);
  const due = reminderDue(
    invoice,
    payments,
    invoice.reminders_sent,
    today(),
    DEFAULT_REMINDER_DAYS,
  );

  if (!due.due) {
    const standing = standingOf(invoice, payments, today());
    return {
      sent: false,
      why: standing.outstanding <= 0
        ? "That invoice is settled."
        : !standing.overdue
          ? "That invoice is not yet due."
          : "Every reminder on the schedule has already been sent. This one needs a telephone call.",
    };
  }

  const contacts = await billingContacts(env, invoice.client_id);
  if (!contacts.length) {
    return { sent: false, why: "There is nobody at that client to send it to." };
  }

  const settings = await readSettings(env);
  const standing = standingOf(invoice, payments, today());
  const tone = reminderTone(due.days_late);
  const headline =
    tone === "gentle"
      ? `Invoice ${invoice.number} became due on ${invoice.due_on} and is still outstanding.`
      : tone === "firm"
        ? `Invoice ${invoice.number} is now ${due.days_late} days overdue.`
        : `Invoice ${invoice.number} is ${due.days_late} days overdue and needs your attention.`;

  const timestamp = nowIso();
  for (const contact of contacts) {
    await sendToPerson(env, {
      to: contact,
      subject: `Invoice ${invoice.number} - ${formatMoney(standing.outstanding, invoice.currency)} outstanding`,
      headline,
      detail:
        `Outstanding: ${formatMoney(standing.outstanding, invoice.currency)}` +
        (standing.outstanding < invoice.gross
          ? `\nInvoiced: ${formatMoney(invoice.gross, invoice.currency)}`
          : "") +
        (tone === "final"
          ? "\n\nIf this has been paid, please let us know and we will match it off."
          : ""),
      link: `${portalBase(env)}/client/invoices/${invoice.id}`,
      linkLabel: "View the invoice",
      firmName: settings.firm_name,
      reason: `you are a billing contact for ${settings.firm_name}`,
      cc: firmCopies(settings),
    });
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE invoices SET reminders_sent = ?, last_reminder_at = ?, updated_at = ? WHERE id = ?`,
    ).bind(due.step, timestamp, timestamp, invoiceId),
    env.DB.prepare(
      `INSERT INTO invoice_reminders
         (id, invoice_id, step, days_late, sent_to, automatic, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newId(),
      invoiceId,
      due.step,
      due.days_late,
      contacts.map((c) => c.email).join(", "),
      automatic ? 1 : 0,
      timestamp,
    ),
  ]);

  return { sent: true, step: due.step };
}


// ---------------------------------------------------------------------------
// Raising and issuing, shared by the routes and the monthly run
// ---------------------------------------------------------------------------

/**
 * Raises one draft invoice for a client. The route and the monthly run both come
 * through here, so an invoice raised on its own is built exactly as one a Partner
 * raised by hand - same lines, same currency rule, same discount, same numbering.
 */
export async function raiseInvoice(
  env: Env,
  clientId: string,
  input: {
    /** The month to bill the subscription for, YYYY-MM, or null for services only. */
    period: string | null;
    dueOn: string | null;
    includeServices: boolean;
    note: string | null;
    /** Null when nobody did it: the monthly run. */
    actorId: string | null;
  },
): Promise<{ id: string; number: string }> {
    const client = await env.DB.prepare(`SELECT id, name, code FROM clients WHERE id = ?`)
      .bind(clientId)
      .first<{ id: string; name: string; code: string }>();
    if (!client) throw notFound("There is no such client.");

    const period = input.period;

    const catalogue = await readCatalogue(env);
    const subscription = await env.DB.prepare(
      `SELECT client_id, tier, monthly_fee, currency, status FROM client_subscriptions
        WHERE client_id = ?`,
    )
      .bind(clientId)
      .first<{
        client_id: string;
        tier: "starter" | "growth" | "enterprise";
        monthly_fee: number | null;
        currency: string;
        status: string;
      }>();

    const lines: Array<{
      description: string;
      quantity: number;
      unit_amount: number;
      source: "subscription" | "service";
      period: string | null;
      serviceId: string | null;
    }> = [];

    /*
     * What this invoice is in, decided once and before any line is added. The client's
     * subscription where they have one, otherwise cedis. Every line has to be in it.
     */
    const invoiceCurrency = currencyOf(subscription?.currency);

    if (period) {
      if (!subscription) {
        throw badRequest("That client has no subscription, so there is no month to bill.");
      }
      if (subscription.status !== "active") {
        throw badRequest(
          `That subscription is ${subscription.status}. Nothing is billed while it is not active.`,
        );
      }
      const { fee } = feeFor(subscription, catalogue.tiers);
      if (fee === null) {
        throw badRequest(
          "No fee is set for that tier. Set it in Portal settings before billing.",
        );
      }
      const tierName =
        catalogue.tiers.find((t) => t.tier === subscription.tier)?.tier ?? subscription.tier;
      lines.push({
        description: `Subscription - ${tierName[0].toUpperCase()}${tierName.slice(1)}, ${period}`,
        quantity: 1,
        unit_amount: fee,
        source: "subscription",
        period,
        serviceId: null,
      });
    }

    if (input.includeServices) {
      const { results } = await env.DB.prepare(
        `SELECT cs.id, cs.name, cs.quoted_fee, cs.currency
           FROM client_services cs
          WHERE cs.client_id = ? AND cs.status = 'delivered' AND cs.quoted_fee IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM invoice_lines l WHERE l.client_service_id = cs.id
            )`,
      )
        .bind(clientId)
        .all<{ id: string; name: string; quoted_fee: number; currency: string }>();
      for (const service of results) {
        /*
         * An invoice is in one currency. A piece of work quoted in dollars cannot be
         * added to a cedi invoice as though the figure meant the same thing - nothing
         * in the portal converts, and putting the number on anyway would bill the
         * client an amount nobody ever quoted. It is refused, with the two currencies
         * named, so somebody decides rather than the portal.
         */
        if (currencyOf(service.currency) !== currencyOf(invoiceCurrency)) {
          throw badRequest(
            `${service.name} is quoted in ${currencyOf(service.currency)} and this invoice is in ${currencyOf(invoiceCurrency)}. Nothing here converts between the two - re-quote that work in ${currencyOf(invoiceCurrency)}, or bill it on its own invoice.`,
          );
        }
        lines.push({
          description: service.name,
          quantity: 1,
          unit_amount: service.quoted_fee,
          source: "service",
          period: null,
          serviceId: service.id,
        });
      }
    }

    if (!lines.length) {
      throw badRequest("There is nothing to bill: no month given and no delivered work.");
    }

    const id = newId();
    const number = await nextInvoiceNumber(env, client.code, period);
    const timestamp = nowIso();
    const settings = await readSettings(env);
    const termDays = Number(settings.invoice_terms_days) || 15;
    const dueOn = input.dueOn || addDays(today(), termDays);
    /*
     * Copied onto the invoice now, not read at print time. The rate the firm expects
     * today is the rate this document says, whatever the setting becomes later.
     */
    const withholdingRate = Number(settings.withholding_rate) || 0;

    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO invoices
             (id, number, client_id, state, due_on, currency, period_label, note,
              withholding_rate, created_by, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          number,
          clientId,
          dueOn,
          invoiceCurrency,
          period,
          input.note,
          withholdingRate || null,
          input.actorId,
          timestamp,
          timestamp,
        ),
        ...lines.map((line, index) =>
          env.DB.prepare(
            `INSERT INTO invoice_lines
               (id, invoice_id, client_id, description, quantity, unit_amount, amount,
                source, subscription_period, client_service_id, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            newId(),
            id,
            clientId,
            line.description,
            line.quantity,
            line.unit_amount,
            round2(line.quantity * line.unit_amount),
            line.source,
            line.period,
            line.serviceId,
            index,
          ),
        ),
      ]);
    } catch (err) {
      if (/UNIQUE/i.test(String(err))) {
        throw conflict(
          period
            ? `${client.name} has already been invoiced for ${period}.`
            : "Some of that work has already been invoiced.",
        );
      }
      throw err;
    }

    await recomputeDraft(env, id);
    return { id, number };
}

/**
 * Who at the firm is copied on an invoice or a chase, visibly.
 *
 * The finance address from Portal settings when there is one, and whoever issued it by
 * hand. Never blind: a client is entitled to see who else read a letter about money,
 * and a member of staff to be able to point at the copy later.
 */
function firmCopies(settings: Record<string, string>, actorEmail?: string | null): string[] {
  const out = new Set<string>();
  const finance = (settings.firm_finance_email ?? "").trim();
  if (finance) out.add(finance);
  if (actorEmail?.trim()) out.add(actorEmail.trim());
  return [...out];
}

/**
 * Issues one draft: freezes the figures, sends it to every billing contact with the
 * firm copied, uses up a discount, and earns the growth partner their commission. The
 * route and the monthly run both come through here.
 */
export async function issueInvoice(
  env: Env,
  invoiceId: string,
  copies: string[],
): Promise<{ sent_to: string[] }> {
    const { invoice } = await fullInvoice(env, invoiceId);
    if (invoice.state !== "draft") {
      throw badRequest("Only a draft can be issued. This one has already been sent.");
    }
    if (invoice.gross <= 0) {
      throw badRequest("An invoice for nothing cannot be issued.");
    }

    const settings = await readSettings(env);
    const contacts = await billingContacts(env, invoice.client_id);
    const timestamp = nowIso();

    await env.DB.prepare(
      `UPDATE invoices SET state = 'sent', issued_on = ?, sent_at = ?, updated_at = ?
        WHERE id = ? AND state = 'draft'`,
    )
      .bind(today(), timestamp, timestamp, invoiceId)
      .run();

    // Now, and not before: what the client is holding is what counts against a
    // discount that only covers so many invoices.
    await consumeDiscount(env, invoice);

    /*
     * And what it earns the growth partner who sold this client, if one did. Also here
     * rather than at draft time: a draft is not a bill, and a cancelled one that had
     * already earned somebody a commission would have to be unpicked by hand.
     */
    await accrueCommission(env, invoiceId);

    for (const contact of contacts) {
      await sendToPerson(env, {
        to: contact,
        subject: `Invoice ${invoice.number} from ${settings.firm_name}`,
        headline: `Invoice ${invoice.number} for ${formatMoney(invoice.gross, invoice.currency)} is due on ${invoice.due_on}.`,
        detail: invoice.period_label
          ? `This covers your subscription for ${invoice.period_label}.`
          : null,
        link: `${portalBase(env)}/client/invoices/${invoice.id}`,
        linkLabel: "View the invoice",
        firmName: settings.firm_name,
        reason: `you are a billing contact for ${settings.firm_name}`,
        cc: copies,
      });
    }

    return { sent_to: contacts.map((c) => c.email) };
}

/**
 * Refuses anything that is not the scheduled job.
 *
 * Compared in constant time, and the endpoint is closed entirely when no secret is
 * configured - an unset secret must mean "nobody may run this", never "anybody may".
 */
function assertRunner(env: Env, request: Request): void {
  const expected = env.REMINDER_SECRET;
  if (!expected) {
    throw forbidden("Automatic reminders are not set up on this portal.");
  }
  const offered = request.headers.get("X-Reminder-Secret") ?? "";
  if (offered.length !== expected.length) throw forbidden("Not permitted.");
  let same = 0;
  for (let i = 0; i < expected.length; i++) {
    same |= offered.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (same !== 0) throw forbidden("Not permitted.");
}

/**
 * Where a link in an invoice email points.
 *
 * The configured address when there is one; otherwise a relative path, which still
 * works for somebody already on the portal and is honest about not knowing rather than
 * inventing a hostname.
 */
function portalBase(env: Env): string {
  return (env.PORTAL_URL ?? "").trim().replace(/\/+$/, "");
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
