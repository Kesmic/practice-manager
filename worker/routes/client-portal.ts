/**
 * Everything a client can reach. The only part of the portal an outsider touches with an
 * account, so the rules here are tighter than anywhere else.
 *
 * **Scope is never taken from the request.** Every query below filters on
 * `actor.client_id`, read off the session row. There is no endpoint on which a client
 * names the client whose data they want, so there is nothing to tamper with.
 *
 * **A client sees their own subscription and nothing else about the firm.** Not other
 * clients, not staff, not what anybody else pays. The one staff fact they see is the
 * name against a figure somebody recorded for them, which is a courtesy they are owed.
 *
 * **Sign-in is as expensive to guess at as a Partner's.** The same PBKDF2 hashing, the
 * same password policy, and the same per-account and per-source attempt limits. A client
 * account is not a cheaper door into the same building - though, being a separate table
 * with a separate cookie, it is not a door into that building at all.
 *
 * **The invitation is the only way a password is first set,** it works once, and it
 * expires. The firm never knows it.
 */

import type { Env } from "../env";
import {
  assertPasswordPolicy,
  decoyHash,
  hashPassword,
  tokenDigest,
  verifyPassword,
} from "../auth";
import {
  CLIENT_SESSION_COOKIE,
  clearedClientCookie,
  createClientSession,
  destroyClientSession,
  requireClientUser,
} from "../client-auth";
import {
  attemptKeys,
  assertLoginAllowed,
  clearAccountFailures,
  recordFailure,
} from "../throttle";
import { newId, nowIso, requireEnum, requireString } from "../db";
import { Router, badRequest, json, noContent, notFound, readJson, unauthorized } from "../http";
import {
  SERVICE_STATES,
  assess,
  clientMayMove,
  type ServiceState,
} from "../../shared/subscriptions";
import { feeFor, readCatalogue } from "./subscriptions";
import { serveDocument } from "./invoices";
import { standingOf, type InvoiceState, type PaymentLike } from "../../shared/invoices";

/**
 * What a client is told when a sign-in fails, whatever the reason.
 *
 * One sentence for a wrong password, an unknown address, an account that has not
 * accepted its invitation and one that is suspended. Distinguishing them would tell a
 * stranger which addresses the firm holds, and who its clients are - which the intake
 * page already goes to some trouble never to reveal.
 */
const SIGN_IN_REFUSAL = "That email address and password do not match an account.";

export function registerClientPortalRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // Getting in
  // -------------------------------------------------------------------------

  router.post("/api/client/login", async ({ request, env }) => {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = (body.email ?? "").trim().toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";

    const keys = await attemptKeys(request, email || "@client");
    await assertLoginAllowed(env, keys);

    const row = await env.DB.prepare(
      `SELECT cu.id, cu.password_hash, cu.status, c.status AS client_status
         FROM client_users cu
         JOIN clients c ON c.id = cu.client_id
        WHERE cu.email = ? COLLATE NOCASE`,
    )
      .bind(email)
      .first<{
        id: string;
        password_hash: string | null;
        status: string;
        client_status: string;
      }>();

    /*
     * A decoy hash is verified when there is no account, so that an address the firm
     * holds and one it does not take the same time to refuse. Without it the endpoint
     * answers "is this person a client of yours" to anyone with a stopwatch.
     */
    const hash = row?.password_hash ?? decoyHash(env);
    const ok = await verifyPassword(env, password, hash);

    if (!row || !row.password_hash || !ok || row.status !== "active" || row.client_status === "exited") {
      await recordFailure(env, keys);
      throw unauthorized(SIGN_IN_REFUSAL);
    }

    await clearAccountFailures(env, keys);
    const { cookie } = await createClientSession(
      env,
      row.id,
      request.headers.get("User-Agent"),
    );
    await env.DB.prepare(`UPDATE client_users SET last_login_at = ? WHERE id = ?`)
      .bind(nowIso(), row.id)
      .run();

    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  });

  router.post("/api/client/logout", async ({ request, env }) => {
    await destroyClientSession(env, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearedClientCookie });
  });

  router.get("/api/client/session", async ({ request, env }) => {
    const actor = await requireClientUser(env, request);
    return json({
      user: {
        id: actor.id,
        email: actor.email,
        full_name: actor.full_name,
        client_name: actor.client_name,
        client_code: actor.client_code,
      },
    });
  });

  /**
   * Whether an invitation link is still good, so the page can say why not.
   *
   * Deliberately says nothing about who it belongs to until it has been accepted -
   * somebody holding a stale link should not learn the name of the person it was for.
   */
  router.get("/api/client/invitation/:token", async ({ request, env, params }) => {
    const invitation = await env.DB.prepare(
      `SELECT i.id, i.expires_at, i.used_at, cu.full_name, cu.email, c.name AS client_name
         FROM client_invitations i
         JOIN client_users cu ON cu.id = i.client_user_id
         JOIN clients c ON c.id = cu.client_id
        WHERE i.id = ?`,
    )
      .bind(await tokenDigest(decodeURIComponent(params.token)))
      .first<{
        id: string;
        expires_at: string;
        used_at: string | null;
        full_name: string;
        email: string;
        client_name: string;
      }>();

    if (!invitation || invitation.used_at) {
      throw notFound("This link is not valid. Please ask us for a new one.");
    }
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      throw notFound("This link has expired. Please ask us for a new one.");
    }
    void request;
    return json({
      full_name: invitation.full_name,
      email: invitation.email,
      client_name: invitation.client_name,
    });
  });

  /** Accepts the invitation by setting a password, and signs them straight in. */
  router.post("/api/client/invitation/:token", async ({ request, env, params }) => {
    const body = await readJson<{ password?: string }>(request);
    const password = requireString(body.password, "password", { max: 200 });

    const digest = await tokenDigest(decodeURIComponent(params.token));
    const keys = await attemptKeys(request, `@invitation:${digest.slice(0, 16)}`);
    await assertLoginAllowed(env, keys);

    const invitation = await env.DB.prepare(
      `SELECT id, client_user_id, expires_at, used_at FROM client_invitations WHERE id = ?`,
    )
      .bind(digest)
      .first<{
        id: string;
        client_user_id: string;
        expires_at: string;
        used_at: string | null;
      }>();

    if (!invitation || invitation.used_at) {
      await recordFailure(env, keys);
      throw notFound("This link is not valid. Please ask us for a new one.");
    }
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      throw notFound("This link has expired. Please ask us for a new one.");
    }

    // The same policy staff are held to. A client account is a way into the firm's
    // records about that client, and deserves no weaker a password.
    assertPasswordPolicy(password);

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE client_users
            SET password_hash = ?, status = 'active', accepted_at = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(await hashPassword(env, password), timestamp, timestamp, invitation.client_user_id),
      // Marked used in the same transaction, so the link cannot be replayed.
      env.DB.prepare(`UPDATE client_invitations SET used_at = ? WHERE id = ?`).bind(
        timestamp,
        invitation.id,
      ),
      // Any other outstanding invitation for this person stops working too.
      env.DB.prepare(
        `DELETE FROM client_invitations WHERE client_user_id = ? AND used_at IS NULL`,
      ).bind(invitation.client_user_id),
    ]);

    await clearAccountFailures(env, keys);
    const { cookie } = await createClientSession(
      env,
      invitation.client_user_id,
      request.headers.get("User-Agent"),
    );
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  });

  /** Changing a password from inside, which needs the old one. */
  router.post("/api/client/password", async ({ request, env }) => {
    const actor = await requireClientUser(env, request);
    const body = await readJson<{ current?: string; password?: string }>(request);
    const current = typeof body.current === "string" ? body.current : "";
    const next = requireString(body.password, "password", { max: 200 });

    const keys = await attemptKeys(request, actor.email);
    await assertLoginAllowed(env, keys);

    const row = await env.DB.prepare(
      `SELECT password_hash FROM client_users WHERE id = ?`,
    )
      .bind(actor.id)
      .first<{ password_hash: string | null }>();
    if (!row?.password_hash || !(await verifyPassword(env, current, row.password_hash))) {
      await recordFailure(env, keys);
      throw badRequest("That is not your current password.");
    }

    assertPasswordPolicy(next);
    await clearAccountFailures(env, keys);

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE client_users SET password_hash = ?, updated_at = ? WHERE id = ?`,
      ).bind(await hashPassword(env, next), timestamp, actor.id),
      /*
       * Every other session of theirs ends, this one excepted. Changing a password is
       * what somebody does when they think a device is compromised, and a change that
       * left that device signed in would be doing nothing.
       */
      env.DB.prepare(
        `DELETE FROM client_sessions WHERE client_user_id = ? AND id <> ?`,
      ).bind(actor.id, actor.session_id),
    ]);

    return noContent();
  });

  // -------------------------------------------------------------------------
  // What they came to see
  // -------------------------------------------------------------------------

  /**
   * Their subscription: the tier, what it covers, where their figures sit against it,
   * and what the tier above would mean.
   *
   * The assessment is the same function the firm's own screens use, so an amber meter
   * here and an amber pill on a Partner's list are one calculation rather than two that
   * agree today.
   */
  router.get("/api/client/subscription", async ({ request, env }) => {
    const actor = await requireClientUser(env, request);
    const catalogue = await readCatalogue(env);

    const subscription = await env.DB.prepare(
      `SELECT client_id, tier, monthly_fee, currency, started_on, status
         FROM client_subscriptions WHERE client_id = ?`,
    )
      .bind(actor.client_id)
      .first<{
        client_id: string;
        tier: "starter" | "growth" | "enterprise";
        monthly_fee: number | null;
        currency: string;
        started_on: string;
        status: string;
      }>();

    const { results: figures } = await env.DB.prepare(
      `SELECT f.criterion_id, f.value, f.as_of, f.recorded_at,
              u.full_name AS recorded_by_name
         FROM client_figures f
         LEFT JOIN users u ON u.id = f.recorded_by
        WHERE f.client_id = ?1
          AND f.as_of = (
            SELECT MAX(f2.as_of) FROM client_figures f2
             WHERE f2.client_id = ?1 AND f2.criterion_id = f.criterion_id
          )`,
    )
      .bind(actor.client_id)
      .all();

    const { results: services } = await env.DB.prepare(
      `SELECT id, name, status, quoted_fee, currency, note,
              requested_at, quoted_at, decided_at, delivered_at
         FROM client_services WHERE client_id = ? ORDER BY created_at DESC`,
    )
      .bind(actor.client_id)
      .all();

    return json({
      client: { name: actor.client_name, code: actor.client_code },
      criteria: catalogue.criteria,
      tiers: catalogue.tiers,
      ceilings: catalogue.ceilings,
      /*
       * Only what the firm is currently offering. A retired service is not something to
       * put in front of a client, and the ones they have already asked for come back on
       * their own rows below regardless.
       */
      available: catalogue.services.filter(
        (s) => (s as { active: number }).active === 1,
      ),
      subscription: subscription
        ? { ...subscription, ...feeFor(subscription, catalogue.tiers) }
        : null,
      figures,
      assessment: subscription
        ? assess(
            subscription.tier,
            catalogue.criteria,
            catalogue.ceilings,
            figures as never,
          )
        : null,
      services,
    });
  });

  /** Asks the firm for a piece of additional work. */
  router.post("/api/client/services", async ({ request, env }) => {
    const actor = await requireClientUser(env, request);
    const body = await readJson<{ service_id?: string; note?: string }>(request);

    const service = await env.DB.prepare(
      `SELECT id, name FROM additional_services WHERE id = ? AND active = 1`,
    )
      .bind(requireString(body.service_id, "service_id", { max: 64 }))
      .first<{ id: string; name: string }>();
    if (!service) throw notFound("That service is not available.");

    /*
     * Asking twice for the same thing is refused rather than silently duplicated - a
     * client clicking again because nothing visibly happened should be told it is
     * already with us, not given a second row for somebody to quote twice.
     */
    const outstanding = await env.DB.prepare(
      `SELECT id FROM client_services
        WHERE client_id = ? AND service_id = ?
          AND status IN ('requested', 'quoted', 'agreed')`,
    )
      .bind(actor.client_id, service.id)
      .first();
    if (outstanding) {
      throw badRequest(`You have already asked us about ${service.name}. It is with us.`);
    }

    const id = newId();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO client_services
         (id, client_id, service_id, name, status, note, requested_by, requested_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        actor.client_id,
        service.id,
        service.name,
        body.note?.trim()?.slice(0, 500) || null,
        actor.id,
        timestamp,
        timestamp,
        timestamp,
      )
      .run();

    return json({ id }, 201);
  });

  /**
   * Accepts or refuses a quote. The only change a client may make to a request.
   *
   * `clientMayMove` is the whole rule: from quoted, to agreed or declined. Quoting
   * themselves a fee and marking work delivered are both refused here and could not be
   * reached anyway, because the fee is not read from the request.
   */
  router.patch("/api/client/services/:id", async ({ request, env, params }) => {
    const actor = await requireClientUser(env, request);
    const body = await readJson<{ status?: unknown }>(request);
    const status = requireEnum(body.status, "status", SERVICE_STATES) as ServiceState;

    const existing = await env.DB.prepare(
      `SELECT id, status FROM client_services WHERE id = ? AND client_id = ?`,
    )
      .bind(params.id, actor.client_id)
      .first<{ id: string; status: ServiceState }>();
    // Scoped to their own client, so another client's request is simply not found.
    if (!existing) throw notFound("There is no such request on your account.");

    if (!clientMayMove(existing.status, status)) {
      throw badRequest(
        existing.status === "quoted"
          ? "You can accept or decline this quote."
          : "There is nothing for you to do on this one - it is with us.",
      );
    }

    const timestamp = nowIso();
    await env.DB.prepare(
      `UPDATE client_services SET status = ?, decided_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(status, timestamp, timestamp, params.id)
      .run();

    return noContent();
  });

  // -------------------------------------------------------------------------
  // Their invoices
  // -------------------------------------------------------------------------

  /**
   * Every invoice on their account, with what is outstanding on each.
   *
   * Drafts are excluded. A draft is the firm thinking about what to charge, and showing
   * a client a figure nobody has decided to ask them for would be worse than showing
   * them nothing.
   *
   * Outstanding and overdue are worked out by the same function the firm's list uses, so
   * a client cannot be told one figure while a Partner chases them for another.
   */
  router.get("/api/client/invoices", async ({ request, env }) => {
    const actor = await requireClientUser(env, request);

    const [invoices, payments] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, number, state, issued_on, due_on, currency, net, tax_total, gross,
                balance_due, withholding_amount, period_label
           FROM invoices
          WHERE client_id = ? AND state <> 'draft'
          ORDER BY issued_on DESC, number DESC`,
      ).bind(actor.client_id),
      env.DB.prepare(
        `SELECT p.invoice_id, p.amount, p.withheld, p.certificate_received, p.paid_on
           FROM invoice_payments p
           JOIN invoices i ON i.id = p.invoice_id
          WHERE i.client_id = ?`,
      ).bind(actor.client_id),
    ]);

    const byInvoice = new Map<string, PaymentLike[]>();
    for (const row of payments.results as unknown as Array<PaymentLike & { invoice_id: string }>) {
      const list = byInvoice.get(row.invoice_id) ?? [];
      list.push(row);
      byInvoice.set(row.invoice_id, list);
    }

    const now = new Date().toISOString().slice(0, 10);
    const rows = (invoices.results as unknown as Array<{
      id: string;
      state: InvoiceState;
      gross: number;
      due_on: string;
    }>).map((invoice) => ({
      ...invoice,
      standing: standingOf(invoice, byInvoice.get(invoice.id) ?? [], now),
    }));

    /*
     * The statement figure. Summed from the same standings the rows show, so the total
     * at the top of the page and the column beneath it cannot disagree.
     */
    const outstanding = rows.reduce((sum, r) => sum + r.standing.outstanding, 0);
    const overdue = rows
      .filter((r) => r.standing.overdue)
      .reduce((sum, r) => sum + r.standing.outstanding, 0);

    return json({
      invoices: rows,
      statement: {
        outstanding: Math.round(outstanding * 100) / 100,
        overdue: Math.round(overdue * 100) / 100,
        count: rows.length,
      },
    });
  });

  /** One invoice of theirs, in full. Scoped to their own client, so another's is absent. */
  router.get("/api/client/invoices/:id", async ({ request, env, params }) => {
    const actor = await requireClientUser(env, request);

    const invoice = await env.DB.prepare(
      `SELECT id, number, state, issued_on, due_on, currency, net, tax_total, gross,
              balance_due, withholding_amount, period_label, note
         FROM invoices
        WHERE id = ? AND client_id = ? AND state <> 'draft'`,
    )
      .bind(params.id, actor.client_id)
      .first<{ id: string; state: InvoiceState; gross: number; due_on: string }>();
    if (!invoice) throw notFound("There is no such invoice on your account.");

    const [lines, taxes, payments] = await env.DB.batch([
      env.DB.prepare(
        `SELECT description, quantity, unit_amount, amount FROM invoice_lines
          WHERE invoice_id = ? ORDER BY position`,
      ).bind(params.id),
      env.DB.prepare(
        `SELECT name, rate, amount FROM invoice_taxes WHERE invoice_id = ? ORDER BY position`,
      ).bind(params.id),
      /*
       * What they paid and when. The firm's own note against a payment is not included -
       * it is the firm's working, and may say things about chasing them.
       */
      env.DB.prepare(
        `SELECT amount, withheld, paid_on, method, reference, certificate_received
           FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_on`,
      ).bind(params.id),
    ]);

    return json({
      invoice,
      lines: lines.results,
      taxes: taxes.results,
      payments: payments.results,
      standing: standingOf(
        invoice,
        payments.results as unknown as PaymentLike[],
        new Date().toISOString().slice(0, 10),
      ),
    });
  });
  /** Their own invoice as a printable document. Scoped, so another's is simply absent. */
  router.get("/api/client/invoices/:id/document", async ({ request, env, params }) => {
    const actor = await requireClientUser(env, request);
    const mine = await env.DB.prepare(
      `SELECT id FROM invoices WHERE id = ? AND client_id = ? AND state <> 'draft'`,
    )
      .bind(params.id, actor.client_id)
      .first();
    if (!mine) throw notFound("There is no such invoice on your account.");
    return await serveDocument(env, params.id);
  });
}


/** Referenced so the cookie's name is exported from exactly one place. */
export { CLIENT_SESSION_COOKIE };
