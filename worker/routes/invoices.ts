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
import { newId, nowIso, requireEnum, requireString } from "../db";
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
async function nextInvoiceNumber(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    `UPDATE counters SET value = value + 1 WHERE name = 'invoice' RETURNING value`,
  ).first<{ value: number }>();
  if (!row) throw new Error("The invoice counter is missing.");
  return `INV-${new Date().getUTCFullYear()}-${String(row.value).padStart(4, "0")}`;
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
 * Rewrites an invoice's stored totals from its lines and the firm's current tax.
 *
 * Only ever called on a draft. The moment an invoice is sent its figures are the
 * document, and this must not touch them.
 */
async function recomputeDraft(env: Env, invoiceId: string): Promise<void> {
  const [lines, taxes] = await Promise.all([
    env.DB.prepare(
      `SELECT quantity, unit_amount FROM invoice_lines WHERE invoice_id = ?`,
    )
      .bind(invoiceId)
      .all(),
    activeTaxLines(env),
  ]);

  const net = netOf(lines.results as unknown as Array<{ quantity: number; unit_amount: number }>);
  const totals = computeTotals(net, taxes);

  const statements = [
    env.DB.prepare(`DELETE FROM invoice_taxes WHERE invoice_id = ?`).bind(invoiceId),
    env.DB.prepare(
      `UPDATE invoices SET net = ?, tax_total = ?, gross = ?, updated_at = ? WHERE id = ?`,
    ).bind(totals.net, totals.tax_total, totals.gross, nowIso(), invoiceId),
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
                i.net, i.tax_total, i.gross, i.period_label, i.reminders_sent,
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

    const client = await env.DB.prepare(`SELECT id, name FROM clients WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string; name: string }>();
    if (!client) throw notFound("There is no such client.");

    const period = body.period?.trim() || null;
    if (period && !/^\d{4}-\d{2}$/.test(period)) {
      throw badRequest("Give the month as YYYY-MM.");
    }

    const catalogue = await readCatalogue(env);
    const subscription = await env.DB.prepare(
      `SELECT client_id, tier, monthly_fee, currency, status FROM client_subscriptions
        WHERE client_id = ?`,
    )
      .bind(params.id)
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

    if (body.include_services !== false) {
      const { results } = await env.DB.prepare(
        `SELECT cs.id, cs.name, cs.quoted_fee
           FROM client_services cs
          WHERE cs.client_id = ? AND cs.status = 'delivered' AND cs.quoted_fee IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM invoice_lines l WHERE l.client_service_id = cs.id
            )`,
      )
        .bind(params.id)
        .all<{ id: string; name: string; quoted_fee: number }>();
      for (const service of results) {
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
    const number = await nextInvoiceNumber(env);
    const timestamp = nowIso();
    const dueOn = body.due_on?.trim() || addDays(today(), 14);

    try {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO invoices
             (id, number, client_id, state, due_on, currency, period_label, note,
              created_by, created_at, updated_at)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          number,
          params.id,
          dueOn,
          subscription?.currency ?? "GHS",
          period,
          body.note?.trim()?.slice(0, 500) || null,
          actor.id,
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
            params.id,
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
    return json({ id, number }, 201);
  });

  /** Issues a draft: freezes the figures, sends it, and starts the clock. */
  router.post("/api/invoices/:id/send", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const { invoice } = await fullInvoice(env, params.id);
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
      .bind(today(), timestamp, timestamp, params.id)
      .run();

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
      });
    }

    return json({ sent_to: contacts.map((c) => c.email) });
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
    const state = stateAfterPayments(invoice.state, invoice.gross, after);
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
          stateAfterPayments(invoice.state, invoice.gross, after),
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
    `SELECT i.id, i.number, i.state, i.gross, i.due_on, i.currency, i.reminders_sent,
            i.period_label, c.id AS client_id, c.name AS client_name
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
