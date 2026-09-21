/**
 * What an issued invoice earns the growth partner who sold the client.
 *
 * shared/growth-partners.ts holds the arrangement and decides what is due. This is where
 * it meets the database, and four things it is careful about.
 *
 * **It runs when the invoice is issued, not when it is drafted.** A draft is not a bill,
 * and a cancelled draft that had already earned somebody a commission would have to be
 * unpicked by hand.
 *
 * **It cannot pay twice.** A partial unique index on the invoice, the kind and the
 * reference is what actually holds that - not a check here - so a retry, a second press
 * of the button, or a run that failed half way through is safe to repeat.
 *
 * **The basis is what the client is actually charged.** A discounted subscription earns
 * the partner a quarter of what the firm banked, not a quarter of the list price. Where
 * a discount covered the whole invoice it is shared across the lines in proportion, and
 * where it named the subscription or the services it comes off that part alone.
 *
 * **Nothing is ever paid from here.** An accrual is a row saying what is owed. A Partner
 * approves it and records paying it, which are two further decisions by a human.
 */

import type { Env } from "./env";
import { newId, nowIso } from "./db";
import { round2 } from "../shared/invoices";
import { commissionFor, type CommissionHistory } from "../shared/growth-partners";

/** How a one-off line is identified, so an annual repeat earns once and not each year. */
function assignmentKey(line: {
  id: string;
  description: string;
  client_service_id: string | null;
}): string {
  /*
   * The piece of work where there is one, because that is the thing being sold and it
   * survives the wording changing. A line typed in by hand has no such handle, so it
   * falls back to what it says with the case, the punctuation and any year taken out -
   * "Annual audit 2027" and "Annual audit 2028" are the same assignment recurring, and
   * the arrangement pays for it once.
   */
  if (line.client_service_id) return `service:${line.client_service_id}`;
  const squashed = line.description
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `manual:${squashed}`;
}

/**
 * Accrues whatever this invoice earns, if anything.
 *
 * Silent where there is nothing to do, which is the ordinary case: most clients have no
 * growth partner, and a client who has one earns nothing from their seventh billed month
 * on.
 */
export async function accrueCommission(env: Env, invoiceId: string): Promise<void> {
  const invoice = await env.DB.prepare(
    `SELECT i.id, i.client_id, i.currency, i.issued_on, i.period_label,
            i.net, i.discount_amount, i.discount_id,
            c.growth_partner_id, c.partner_won_on
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
      WHERE i.id = ?`,
  )
    .bind(invoiceId)
    .first<{
      id: string;
      client_id: string;
      currency: string;
      issued_on: string | null;
      period_label: string | null;
      net: number;
      discount_amount: number;
      discount_id: string | null;
      growth_partner_id: string | null;
      partner_won_on: string | null;
    }>();

  if (!invoice?.growth_partner_id) return;

  const partner = await env.DB.prepare(
    `SELECT id, commission_rate, commission_months, status FROM growth_partners WHERE id = ?`,
  )
    .bind(invoice.growth_partner_id)
    .first<{
      id: string;
      commission_rate: number;
      commission_months: number;
      status: string;
    }>();
  /*
   * A partner the firm has ended earns nothing further. A suspended one still earns:
   * suspension stops them selling, and taking away what they have already sold would be
   * a penalty nobody agreed to.
   */
  if (!partner || partner.status === "ended") return;

  const { results: lineRows } = await env.DB.prepare(
    `SELECT id, description, amount, source, client_service_id
       FROM invoice_lines WHERE invoice_id = ?`,
  )
    .bind(invoiceId)
    .all<{
      id: string;
      description: string;
      amount: number;
      source: string;
      client_service_id: string | null;
    }>();

  const subscriptionGross = round2(
    lineRows.filter((l) => l.source === "subscription").reduce((sum, l) => sum + l.amount, 0),
  );
  const otherGross = round2(
    lineRows.filter((l) => l.source !== "subscription").reduce((sum, l) => sum + l.amount, 0),
  );

  /*
   * How much of a discount came off which part. The discount row says what it covered;
   * where that row has since gone, the discount is shared in proportion, which is the
   * answer that cannot systematically favour either side.
   */
  let scope: string | null = null;
  if (invoice.discount_amount > 0 && invoice.discount_id) {
    const row = await env.DB.prepare(
      `SELECT applies_to FROM client_discounts WHERE id = ?`,
    )
      .bind(invoice.discount_id)
      .first<{ applies_to: string }>();
    scope = row?.applies_to ?? null;
  }

  const subtotal = round2(subscriptionGross + otherGross);
  const share = subtotal > 0 ? subscriptionGross / subtotal : 0;
  const discountOnSubscription =
    invoice.discount_amount <= 0
      ? 0
      : scope === "subscription"
        ? Math.min(invoice.discount_amount, subscriptionGross)
        : scope === "services"
          ? 0
          : round2(invoice.discount_amount * share);

  const subscription = round2(Math.max(subscriptionGross - discountOnSubscription, 0));
  const discountOnOther = round2(invoice.discount_amount - discountOnSubscription);
  const otherShare = otherGross > 0 ? discountOnOther / otherGross : 0;

  const history = await readHistory(env, invoice.client_id, invoice.partner_won_on);

  const due = commissionFor(
    {
      subscription,
      one_off: lineRows
        .filter((l) => l.source !== "subscription" && l.amount > 0)
        .map((l) => ({
          id: l.id,
          amount: round2(l.amount * (1 - otherShare)),
          assignment_key: assignmentKey(l),
        })),
      period: invoice.period_label,
      issued_on: invoice.issued_on ?? nowIso().slice(0, 10),
    },
    history,
    { rate: partner.commission_rate, months: partner.commission_months },
  );

  if (!due.length) return;

  const prospect = await env.DB.prepare(
    `SELECT id FROM partner_prospects WHERE client_id = ? AND partner_id = ?`,
  )
    .bind(invoice.client_id, partner.id)
    .first<{ id: string }>();

  const timestamp = nowIso();
  for (const line of due) {
    try {
      await env.DB.prepare(
        `INSERT INTO partner_commissions
           (id, partner_id, client_id, prospect_id, invoice_id, kind, month_index,
            reference, basis, rate, currency, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accrued', ?, ?)`,
      )
        .bind(
          newId(),
          partner.id,
          invoice.client_id,
          prospect?.id ?? null,
          invoiceId,
          line.kind,
          line.month_index,
          line.reference,
          line.basis,
          partner.commission_rate,
          invoice.currency,
          line.amount,
          timestamp,
          timestamp,
        )
        .run();
    } catch (err) {
      /*
       * The index has already paid this one. Swallowed rather than thrown, because this
       * is called from issuing an invoice: a second press of the button must not fail
       * the issue over a commission that is already recorded.
       */
      if (!/UNIQUE/i.test(String(err))) throw err;
    }
  }
}

/** What this partner has already earned on this client. */
export async function readHistory(
  env: Env,
  clientId: string,
  wonOn: string | null,
): Promise<CommissionHistory> {
  const [earned, subscribed] = await env.DB.batch([
    env.DB.prepare(
      `SELECT kind, reference FROM partner_commissions
        WHERE client_id = ? AND status <> 'cancelled'`,
    ).bind(clientId),
    env.DB.prepare(`SELECT tier FROM client_subscriptions WHERE client_id = ?`).bind(
      clientId,
    ),
  ]);

  const rows = earned.results as unknown as Array<{ kind: string; reference: string | null }>;
  return {
    subscription_months: rows.filter((r) => r.kind === "subscription").length,
    periods: rows
      .filter((r) => r.kind === "subscription")
      .map((r) => r.reference ?? "")
      .filter(Boolean),
    assignments: rows
      .filter((r) => r.kind === "one_off")
      .map((r) => r.reference ?? "")
      .filter(Boolean),
    /*
     * Ever, not currently. A client who was on a subscription and has since ended it is
     * a subscription client for this purpose: the arrangement pays on the subscription,
     * and one-off work afterwards is not a second bite.
     */
    ever_subscribed:
      subscribed.results.length > 0 || rows.some((r) => r.kind === "subscription"),
    won_on: wonOn,
  };
}

/**
 * Cancels what a cancelled invoice earned.
 *
 * A cancelled invoice was never paid, so it never earned anybody anything. The rows are
 * marked cancelled rather than deleted, because a partner who saw a commission appear
 * and then vanish deserves to be able to see what happened to it - and because the count
 * of billed months must go back down, which it does: `readHistory` ignores a cancelled
 * row, so the month is free to be earned again on the invoice that replaces it.
 */
export async function cancelCommission(
  env: Env,
  invoiceId: string,
  reason: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE partner_commissions
        SET status = 'cancelled', cancelled_reason = ?, updated_at = ?
      WHERE invoice_id = ? AND status IN ('accrued', 'approved')`,
  )
    .bind(reason.slice(0, 300), nowIso(), invoiceId)
    .run();
}
