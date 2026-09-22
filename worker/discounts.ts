/**
 * The half of a discount that lives in the database.
 *
 * shared/discounts.ts decides what a discount is worth and whether it still applies.
 * This decides when a row moves: retired once it has stopped applying, counted when an
 * invoice is issued, and given back when one is cancelled.
 *
 * It sits outside `routes/` because both the subscription screen, which grants and ends
 * discounts, and the invoice routes, which spend them, need the same answers. Put in
 * either route module, the other would have to import it and the two would refer to
 * each other.
 */

import type { Env } from "./env";
import { nowIso } from "./db";
import { finishedState, type Discount } from "../shared/discounts";

/** Today as the portal reckons it, matching routes/invoices.ts. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The discount a client is currently on, or null.
 *
 * Retires one that has stopped applying on the way past. Nothing runs at midnight to do
 * it, and a discount that ran until March left sitting as active would stop the client
 * being given a new one in April: the index holding "one active discount per client"
 * would refuse it, over a discount no invoice would have picked up anyway.
 */
export async function activeDiscount(
  env: Env,
  clientId: string,
): Promise<(Discount & { client_id: string }) | null> {
  const row = await env.DB.prepare(
    `SELECT id, client_id, kind, value, applies_to, runs, invoice_count, until_on,
            used_count, reason, status
       FROM client_discounts WHERE client_id = ? AND status = 'active'`,
  )
    .bind(clientId)
    .first<Discount & { client_id: string }>();
  if (!row) return null;

  const finished = finishedState(row, today());
  if (!finished) return row;

  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE client_discounts
        SET status = ?, ended_at = ?, ended_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'active'`,
  )
    .bind(
      finished,
      timestamp,
      finished === "spent"
        ? "Used on every invoice it covered."
        : "The date it ran until has passed.",
      timestamp,
      row.id,
    )
    .run();
  return null;
}

/**
 * Counts one use against the discount an issued invoice carried.
 *
 * Called when the invoice is sent rather than when it is drafted, so a draft that is
 * cancelled or corrected does not burn a one-off discount the client was promised.
 *
 * The retirement itself is left to `activeDiscount`, which is the one place that decides
 * a discount has finished - two places deciding it would eventually disagree.
 */
export async function consumeDiscount(
  env: Env,
  invoice: { client_id: string; discount_id?: string | null; discount_amount?: number },
): Promise<void> {
  if (!invoice.discount_id || !(invoice.discount_amount ?? 0)) return;
  await env.DB.prepare(
    `UPDATE client_discounts SET used_count = used_count + 1, updated_at = ?
      WHERE id = ? AND status = 'active'`,
  )
    .bind(nowIso(), invoice.discount_id)
    .run();
  await activeDiscount(env, invoice.client_id);
}

/**
 * Gives back the use a cancelled invoice took.
 *
 * A cancelled invoice never reached the client, so it cannot have spent their discount.
 * A spent discount comes back to life unless the client has since been given another
 * one - reviving it then would put two live discounts on one client, which the index
 * refuses and the invoice could not explain. In that case the count is corrected and the
 * row stays retired, which is the honest reading: the new discount is the live one.
 */
export async function releaseDiscount(
  env: Env,
  invoice: { client_id: string; discount_id?: string | null; discount_amount?: number },
): Promise<void> {
  if (!invoice.discount_id || !(invoice.discount_amount ?? 0)) return;

  const timestamp = nowIso();
  await env.DB.prepare(
    `UPDATE client_discounts SET used_count = MAX(used_count - 1, 0), updated_at = ?
      WHERE id = ?`,
  )
    .bind(timestamp, invoice.discount_id)
    .run();

  const live = await env.DB.prepare(
    `SELECT id FROM client_discounts WHERE client_id = ? AND status = 'active'`,
  )
    .bind(invoice.client_id)
    .first<{ id: string }>();
  if (live) return;

  await env.DB.prepare(
    `UPDATE client_discounts
        SET status = 'active', ended_at = NULL, ended_by = NULL, ended_reason = NULL,
            updated_at = ?
      WHERE id = ? AND status = 'spent'`,
  )
    .bind(timestamp, invoice.discount_id)
    .run();
}
