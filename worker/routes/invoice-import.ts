/**
 * Bringing a client's past invoices, and what they paid against them, into the portal.
 *
 * The screen reads the QuickBooks reports in the Partner's browser
 * (shared/quickbooks-import.ts), shows what it found, lets them leave any invoice out,
 * and sends the rest here. Everything is checked again on arrival - the browser is
 * not trusted to have done it - and written in one batch, so an import either lands
 * whole or not at all.
 *
 * An imported invoice is a record of a bill the client already has, not a bill the
 * portal is raising:
 *
 *  - it keeps its own number, date, lines and item names, and its withholding exactly
 *    as printed, rather than being recomputed from today's settings;
 *  - nothing is emailed, no discount is used up, no growth partner earns commission,
 *    and the reminder schedule leaves it alone (chasing one is a person's decision);
 *  - its History says where it came from and who brought it in.
 *
 * A number already in the portal refuses the whole import, naming it: two invoices
 * with one number would be two documents a client could hold up against each other.
 */

import type { Env } from "../env";
import { requireRole } from "../auth";
import { newId, nowIso } from "../db";
import { Router, badRequest, conflict, json, notFound, readJson } from "../http";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { isCurrency } from "../../shared/money";
import { readSettings } from "./settings";

const MAX_INVOICES = 300;
const MAX_LINES = 60;
const MAX_PAYMENTS = 600;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function money(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) >= 1e10) {
    throw badRequest(`${what} is not an amount.`);
  }
  return round2(value);
}

function words(value: unknown, what: string, max: number, required = true): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (required && !s) throw badRequest(`${what} is missing.`);
  if (s.length > max) throw badRequest(`${what} is longer than ${max} characters.`);
  return s;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Body {
  source?: unknown;
  currency?: unknown;
  invoices?: unknown;
  payments?: unknown;
}

export function registerInvoiceImportRoutes(router: Router<Env>): void {
  router.post("/api/clients/:id/import-invoices", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!client) throw notFound("There is no such client.");

    const body = await readJson<Body>(request, { maxBytes: 2_000_000 });
    const source = words(body.source, "Where the invoices came from", 40);
    if (!isCurrency(body.currency)) throw badRequest("Choose the currency these invoices were in.");
    const currency = body.currency;
    const today = new Date().toISOString().slice(0, 10);

    // ------------------------------------------------------------ the invoices
    if (!Array.isArray(body.invoices) || !body.invoices.length) {
      throw badRequest("There are no invoices to bring in.");
    }
    if (body.invoices.length > MAX_INVOICES) {
      throw badRequest(`Bring in at most ${MAX_INVOICES} invoices at a time.`);
    }
    const invoices = body.invoices.map((raw, i) => {
      const inv = (raw ?? {}) as Record<string, unknown>;
      const number = words(inv.number, `Invoice ${i + 1}'s number`, 40);
      if (!/^[\p{L}\p{N}_\-/.# ]+$/u.test(number)) throw badRequest(`"${number}" is not an invoice number.`);
      if (!isDate(inv.issued_on) || inv.issued_on > today) {
        throw badRequest(`${number} has no date, or one in the future.`);
      }
      if (!Array.isArray(inv.lines) || !inv.lines.length || inv.lines.length > MAX_LINES) {
        throw badRequest(`${number} needs between 1 and ${MAX_LINES} lines.`);
      }
      const lines = inv.lines.map((rawLine) => {
        const l = (rawLine ?? {}) as Record<string, unknown>;
        return {
          activity: words(l.activity, `An item name on ${number}`, 120, false),
          description: words(l.description, `A description on ${number}`, 500),
          quantity: money(l.quantity, `A quantity on ${number}`),
          unit_amount: money(l.unit_amount, `A price on ${number}`),
          amount: money(l.amount, `An amount on ${number}`),
          taxable: l.taxable === 0 ? 0 : 1,
        };
      });
      const withheld = money(inv.withheld ?? 0, `${number}'s withholding`);
      const net = round2(lines.reduce((sum, l) => sum + l.amount, 0));
      const feeNet = round2(lines.filter((l) => l.taxable).reduce((sum, l) => sum + l.amount, 0));
      if (withheld < 0 || withheld > Math.max(feeNet, 0)) {
        throw badRequest(`${number}'s withholding is more than its fees.`);
      }
      const balance = round2(net - withheld);
      if (balance <= 0) throw badRequest(`${number} comes to nothing, so there is nothing to bring in.`);
      return { number, issued_on: inv.issued_on, lines, withheld, net, feeNet, balance };
    });

    const numbers = invoices.map((i) => i.number);
    const twice = numbers.find((n, i) => numbers.indexOf(n) !== i);
    if (twice) throw badRequest(`${twice} appears twice.`);
    const existing = await env.DB.prepare(
      `SELECT number FROM invoices WHERE number IN (${numbers.map(() => "?").join(",")})`,
    )
      .bind(...numbers)
      .all<{ number: string }>();
    if (existing.results.length) {
      const names = existing.results.map((r) => r.number);
      throw conflict(
        `${names.join(", ")} ${names.length === 1 ? "is" : "are"} already in the portal. Leave ${names.length === 1 ? "it" : "them"} out and bring in the rest.`,
      );
    }

    // ------------------------------------------------------------ the payments
    const payments = Array.isArray(body.payments) ? body.payments : [];
    if (payments.length > MAX_PAYMENTS) throw badRequest("That is more payments than one import takes.");
    const paidAgainst = new Map<string, number>();
    const checkedPayments = payments.map((raw) => {
      const p = (raw ?? {}) as Record<string, unknown>;
      const invoice = invoices.find((i) => i.number === p.invoice);
      if (!invoice) throw badRequest("A payment is matched to an invoice that is not being brought in.");
      if (!isDate(p.paid_on) || p.paid_on > today) throw badRequest(`A payment on ${invoice.number} has no date.`);
      const amount = money(p.amount, `A payment on ${invoice.number}`);
      if (amount <= 0) throw badRequest(`A payment on ${invoice.number} is not a payment.`);
      const total = round2((paidAgainst.get(invoice.number) ?? 0) + amount);
      if (total > invoice.balance + 0.005) throw badRequest(`More is paid against ${invoice.number} than it asked for.`);
      paidAgainst.set(invoice.number, total);
      return {
        invoice,
        paid_on: p.paid_on,
        amount,
        account: words(p.account, "The account a payment went into", 80, false),
      };
    });

    // ------------------------------------------------------------ write it all
    const settings = await readSettings(env);
    const terms = Number(settings.invoice_terms_days) || 15;
    const now = nowIso();
    const ids = new Map(invoices.map((i) => [i.number, newId()]));
    const statements: D1PreparedStatement[] = [];

    for (const inv of invoices) {
      const id = ids.get(inv.number)!;
      const paid = paidAgainst.get(inv.number) ?? 0;
      const state = paid >= inv.balance - 0.005 ? "paid" : paid > 0 ? "part_paid" : "sent";
      // The rate is shown for reference; the amount is what the client's copy says.
      const rate = inv.feeNet > 0 && inv.withheld > 0 ? round2((inv.withheld / inv.feeNet) * 100) : 0;
      statements.push(
        env.DB.prepare(
          `INSERT INTO invoices
             (id, number, client_id, state, issued_on, due_on, currency, net, tax_total, gross,
              withholding_rate, withholding_amount, balance_due, discount_amount, sent_at,
              imported_from, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          inv.number,
          client.id,
          state,
          inv.issued_on,
          addDays(inv.issued_on, terms),
          currency,
          inv.net,
          inv.net,
          rate,
          inv.withheld,
          inv.balance,
          `${inv.issued_on}T00:00:00.000Z`,
          source,
          actor.id,
          now,
          now,
        ),
      );
      inv.lines.forEach((line, position) =>
        statements.push(
          env.DB.prepare(
            `INSERT INTO invoice_lines
               (id, invoice_id, client_id, description, quantity, unit_amount, amount, source,
                position, taxable, activity)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)`,
          ).bind(
            newId(),
            id,
            client.id,
            line.description,
            line.quantity,
            line.unit_amount,
            line.amount,
            position,
            line.taxable,
            line.activity || null,
          ),
        ),
      );
    }
    for (const p of checkedPayments) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO invoice_payments
             (id, invoice_id, amount, withheld, paid_on, method, reference, note, recorded_by, recorded_at)
           VALUES (?, ?, ?, 0, ?, 'Bank deposit', ?, ?, ?, ?)`,
        ).bind(
          newId(),
          ids.get(p.invoice.number)!,
          p.amount,
          p.paid_on,
          p.account || null,
          `Imported from ${source}`,
          actor.id,
          now,
        ),
      );
    }
    await env.DB.batch(statements);

    const outstanding = round2(
      invoices.reduce((sum, i) => sum + i.balance - (paidAgainst.get(i.number) ?? 0), 0),
    );
    return json({
      created: invoices.length,
      paid: invoices.filter((i) => (paidAgainst.get(i.number) ?? 0) >= i.balance - 0.005).length,
      payments: checkedPayments.length,
      outstanding,
    });
  });
}
