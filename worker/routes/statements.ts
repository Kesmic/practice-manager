/**
 * Statements of account: drawn up from a client's invoices and payments, downloaded as
 * a PDF, and emailed - the three kinds QuickBooks Online offers (shared/statements.ts).
 *
 * Nothing about a statement is stored except the fact of sending one: it is worked out
 * afresh each time from the account as it stands, so the screen, the PDF and the email
 * cannot disagree.
 *
 * Staff at Manager grade and above can draw one up and send it, as they can chase an
 * invoice; changing the firm's standard wording for them is a Partner's decision. A
 * client can download their own balance-forward statement from the portal.
 */

import type { Env } from "../env";
import { requireRole } from "../auth";
import { requireClientUser } from "../client-auth";
import { newId, nowIso } from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import { MIN_SUPERVISOR_ROLE, atLeast } from "../../shared/workflow";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { isCurrency, type Currency } from "../../shared/money";
import {
  STATEMENT_TYPES,
  buildStatement,
  type Statement,
  type StatementInvoice,
  type StatementPayment,
  type StatementType,
} from "../../shared/statements";
import { renderStatementPdf, statementFilename } from "../../shared/statement-pdf";
import {
  INVOICE_EMAIL_LIMITS,
  STANDARD_STATEMENT_EMAIL,
  STATEMENT_EMAIL_SETTINGS,
  composeStatementEmail,
  statementWording,
} from "../../shared/invoice-email-wording";
import { readSettings, writeSetting } from "./settings";
import {
  askedFor,
  bankOnPaper,
  billingContacts,
  firmCopies,
  firmOnPaper,
  formatMoney,
  readComposed,
  type ComposedBody,
} from "./invoices";
import { letterDate, base64Bytes } from "../invoice-email";
import { deliver, emailConfigured } from "../email";

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

interface Asked {
  type: StatementType;
  date: string;
  start: string;
  end: string;
  currency: Currency | null;
}

/**
 * What statement is being asked for, from the query or a body: the kind, the statement
 * date (today unless said), and the period - by default the year to date, ending on
 * the statement date.
 */
function readAsked(get: (key: string) => string | null): Asked {
  const rawType = get("type") ?? "balance_forward";
  if (!STATEMENT_TYPES.includes(rawType as StatementType)) throw badRequest("There is no such kind of statement.");
  const date = get("date") || todayIso();
  if (!isDate(date)) throw badRequest("The statement date is not a date.");
  if (date > todayIso()) throw badRequest("A statement cannot be dated in the future.");
  const end = get("end") || date;
  const start = get("start") || `${date.slice(0, 4)}-01-01`;
  if (!isDate(start) || !isDate(end)) throw badRequest("The period is not a pair of dates.");
  if (start > end) throw badRequest("The period starts after it ends.");
  if (end > date) throw badRequest("The period cannot end after the statement date.");
  const currency = get("currency");
  if (currency && !isCurrency(currency)) throw badRequest("There is no such currency.");
  return { type: rawType as StatementType, date, start, end, currency: (currency as Currency) || null };
}

/** The client's account in one currency: every issued invoice and what was paid on it. */
async function account(env: Env, clientId: string, currency: Currency) {
  const { results: invoices } = await env.DB.prepare(
    `SELECT id, number, issued_on, due_on, gross, balance_due FROM invoices
      WHERE client_id = ? AND currency = ? AND state IN ('sent', 'part_paid', 'paid')
        AND issued_on IS NOT NULL`,
  )
    .bind(clientId, currency)
    .all<{ id: string; number: string; issued_on: string; due_on: string; gross: number; balance_due: number | null }>();
  const { results: payments } = await env.DB.prepare(
    `SELECT p.invoice_id, p.paid_on, p.amount + p.withheld AS amount, p.method
       FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE i.client_id = ? AND i.currency = ? AND i.state IN ('sent', 'part_paid', 'paid')`,
  )
    .bind(clientId, currency)
    .all<StatementPayment>();
  return {
    invoices: invoices.map<StatementInvoice>((i) => ({
      id: i.id,
      number: i.number,
      issued_on: i.issued_on,
      due_on: i.due_on,
      amount: askedFor(i),
    })),
    payments,
  };
}

/** The currencies the client has been invoiced in, most-used first. */
async function currenciesOf(env: Env, clientId: string): Promise<Currency[]> {
  const { results } = await env.DB.prepare(
    `SELECT currency, COUNT(*) AS n FROM invoices
      WHERE client_id = ? AND state IN ('sent', 'part_paid', 'paid')
      GROUP BY currency ORDER BY n DESC`,
  )
    .bind(clientId)
    .all<{ currency: string }>();
  return results.map((r) => r.currency).filter(isCurrency);
}

async function clientFor(env: Env, clientId: string) {
  const client = await env.DB.prepare(`SELECT id, name, address, tax_id FROM clients WHERE id = ?`)
    .bind(clientId)
    .first<{ id: string; name: string; address: string | null; tax_id: string | null }>();
  if (!client) throw notFound("There is no such client.");
  return client;
}

/** The statement asked for, with the currency settled and the client it is for. */
async function drawUp(env: Env, clientId: string, asked: Asked) {
  const client = await clientFor(env, clientId);
  const currencies = await currenciesOf(env, clientId);
  const currency: Currency = asked.currency ?? currencies[0] ?? "GHS";
  const { invoices, payments } = await account(env, clientId, currency);
  const statement = buildStatement({
    type: asked.type,
    statementDate: asked.date,
    start: asked.start,
    end: asked.end,
    invoices,
    payments,
  });
  return { client, currency, currencies, statement };
}

async function pdfOf(env: Env, client: { name: string; address: string | null; tax_id: string | null }, currency: string, statement: Statement) {
  const settings = await readSettings(env);
  const bytes = await renderStatementPdf({
    firm: await firmOnPaper(settings),
    client: {
      name: client.name,
      address_lines: (client.address || "").split("\n").map((l) => l.trim()).filter(Boolean),
      tax_id: client.tax_id ?? "",
    },
    bank: bankOnPaper(settings),
    currency,
    statement,
  });
  return { bytes, filename: statementFilename(client.name, statement.statement_date) };
}

function pdfResponse(bytes: Uint8Array<ArrayBuffer>, filename: string): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function registerStatementRoutes(router: Router<Env>): void {
  /** The statement, for the screen to show before it is downloaded or sent. */
  router.get("/api/clients/:id/statement", async ({ request, env, params, url }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const asked = readAsked((k) => url.searchParams.get(k));
    const { client, currency, currencies, statement } = await drawUp(env, params.id, asked);
    return json({ client: { id: client.id, name: client.name }, currency, currencies, statement });
  });

  router.get("/api/clients/:id/statement/pdf", async ({ request, env, params, url }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const asked = readAsked((k) => url.searchParams.get(k));
    const { client, currency, statement } = await drawUp(env, params.id, asked);
    const { bytes, filename } = await pdfOf(env, client, currency, statement);
    return pdfResponse(bytes, filename);
  });

  /** The email a statement would go out with, for the send window to show and edit. */
  router.get("/api/clients/:id/statement/email", async ({ request, env, params, url }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const asked = readAsked((k) => url.searchParams.get(k));
    const { client, currency, statement } = await drawUp(env, params.id, asked);
    const settings = await readSettings(env);
    return json({
      from_name: `${settings.firm_name} Finance`,
      reply_to: (settings.firm_finance_email ?? "").trim() || null,
      email_ready: emailConfigured(env),
      contacts: await billingContacts(env, client.id),
      cc: firmCopies(settings, actor.email),
      wording: statementWording(settings),
      standard: STANDARD_STATEMENT_EMAIL,
      firm_wording: Boolean(
        settings[STATEMENT_EMAIL_SETTINGS.subject]?.trim() || settings[STATEMENT_EMAIL_SETTINGS.message]?.trim(),
      ),
      can_save_wording: atLeast(actor.role, MIN_HR_ADMIN_ROLE),
      facts: {
        firm_name: settings.firm_name,
        statement_date: letterDate(statement.statement_date),
        amount_due: formatMoney(statement.amount_due, currency),
      },
      attachment_name: statementFilename(client.name, statement.statement_date),
      limits: INVOICE_EMAIL_LIMITS,
    });
  });

  /**
   * Sends the statement: one copy to each person, greeted by name, with the PDF
   * attached and the firm copied, as an invoice goes. Every attempt is logged.
   */
  router.post("/api/clients/:id/statement/send", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<ComposedBody & Record<string, unknown>>(request);
    const asked = readAsked((k) => (typeof body[k] === "string" ? (body[k] as string) : null));
    const composed = readComposed(body);
    if (!composed.to.length) throw badRequest("Add somebody to send it to.");
    if (body.save_wording === true) {
      if (!atLeast(actor.role, MIN_HR_ADMIN_ROLE)) {
        throw forbidden("Only a Partner can change the standard wording. Untick it to send this one as written.");
      }
      const { subject, message } = composed.wording;
      await writeSetting(env, STATEMENT_EMAIL_SETTINGS.subject, subject === STANDARD_STATEMENT_EMAIL.subject ? "" : subject, actor.id);
      await writeSetting(env, STATEMENT_EMAIL_SETTINGS.message, message === STANDARD_STATEMENT_EMAIL.message ? "" : message, actor.id);
    }

    const { client, currency, statement } = await drawUp(env, params.id, asked);
    const settings = await readSettings(env);
    const { bytes, filename } = await pdfOf(env, client, currency, statement);
    const contacts = await billingContacts(env, client.id);
    const base = (env.PORTAL_URL ?? "").trim().replace(/\/+$/, "");
    const attachments = composed.attach
      ? [{ filename, content: base64Bytes(bytes), contentType: "application/pdf" }]
      : undefined;

    const sent_to: string[] = [];
    const failed: Array<{ email: string; error: string }> = [];
    for (const email of composed.to) {
      const name = contacts.find((c) => c.email.toLowerCase() === email.toLowerCase())?.full_name ?? "";
      const message = composeStatementEmail(composed.wording, {
        name,
        firmName: settings.firm_name,
        statementDate: letterDate(statement.statement_date),
        amountDue: formatMoney(statement.amount_due, currency),
        link: base ? `${base}/client/invoices` : "",
      });
      let error: string | null = null;
      if (!emailConfigured(env)) {
        error = "Email is not set up on this portal.";
      } else {
        try {
          await deliver(env, email, message.subject, message.text, message.html, composed.cc, {
            attachments,
            replyTo: (settings.firm_finance_email ?? "").trim() || undefined,
            fromName: `${settings.firm_name} Finance`,
          });
        } catch (err) {
          error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        }
      }
      await env.DB.prepare(
        `INSERT INTO statements_sent
           (id, client_id, kind, statement_date, start_on, end_on, currency, amount_due,
            recipient_email, recipient_name, cc, status, error, subject, body, sent_by, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          newId(),
          client.id,
          statement.type,
          statement.statement_date,
          statement.start,
          statement.end,
          currency,
          statement.amount_due,
          email,
          name || null,
          composed.cc.length ? composed.cc.join(", ") : null,
          error ? "failed" : "sent",
          error,
          message.subject,
          message.text,
          actor.id,
          nowIso(),
        )
        .run();
      if (error) failed.push({ email, error });
      else sent_to.push(email);
    }
    return json({ sent_to, failed });
  });

  /** The statements sent to this client, newest first. */
  router.get("/api/clients/:id/statements", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const { results } = await env.DB.prepare(
      `SELECT s.id, s.kind, s.statement_date, s.start_on, s.end_on, s.currency, s.amount_due,
              s.recipient_email, s.recipient_name, s.status, s.error, s.sent_at,
              u.full_name AS sent_by_name
         FROM statements_sent s LEFT JOIN users u ON u.id = s.sent_by
        WHERE s.client_id = ? ORDER BY s.sent_at DESC LIMIT 100`,
    )
      .bind(params.id)
      .all();
    return json({ statements: results });
  });

  /**
   * A client's own statement: balance forward, year to date unless they say otherwise,
   * in the currency they are billed in. Scoped by their session, never the request.
   */
  router.get("/api/client/statement/pdf", async ({ request, env, url }) => {
    const actor = await requireClientUser(env, request);
    const asked = readAsked((k) => (k === "type" ? "balance_forward" : url.searchParams.get(k)));
    const { client, currency, statement } = await drawUp(env, actor.client_id, asked);
    const { bytes, filename } = await pdfOf(env, client, currency, statement);
    return pdfResponse(bytes, filename);
  });
}
