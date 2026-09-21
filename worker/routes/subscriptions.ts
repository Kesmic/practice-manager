/**
 * The firm's side of client subscriptions: the catalogue, what each client is on, and
 * who at that client may sign in to look.
 *
 * shared/subscriptions.ts holds the arithmetic and argues for the shape. This is where
 * it meets the database, and four things it is careful about.
 *
 * **Who may do what.** Reading a subscription is Manager business, the same line the
 * client record already draws. Changing a fee, moving a tier, and creating a client
 * login are Partner business: the first two are money and the third hands somebody
 * outside the firm a way in.
 *
 * **Nothing moves a client automatically.** `assess` says which tier the figures point
 * at and every screen shows it, but only a Partner's explicit request changes the row,
 * and the change is recorded with the fee before and after. A portal that quietly
 * re-tiered a client would be a portal that quietly re-invoiced them.
 *
 * **The fee is copied onto the subscription, not joined to the tier.** A client on a
 * negotiated rate keeps it when the tier's list price moves. Null means "whatever the
 * tier says", which is the ordinary case, and the two are resolved in one place below.
 *
 * **Inviting a client is not the same as making a user.** The firm types no password.
 * A one-time token goes out by email, its digest is stored, and the client sets their
 * own; until they do, the account cannot sign in at all.
 */

import type { Env } from "../env";
import { newToken, requireRole, tokenDigest } from "../auth";
import { newId, nowIso } from "../db";
import {
  Router,
  badRequest,
  readJson,
  conflict,
  json,
  noContent,
  notFound,
} from "../http";
import { requireEnum, requireString } from "../db";
import { readSettings } from "./settings";
import { MIN_SUPERVISOR_ROLE } from "../../shared/workflow";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { INVITATION_TTL_DAYS } from "../client-auth";
import {
  CLIENT_TIERS,
  CRITERION_UNITS,
  FEE_BASES,
  SERVICE_STATES,
  TIER_LABELS,
  assess,
  nextStates,
  whyNotACriterionName,
  type Ceiling,
  type ClientTier,
  type Criterion,
  type Figure,
  type ServiceState,
} from "../../shared/subscriptions";
import { sendToPerson } from "../email";

// ---------------------------------------------------------------------------
// Reading the catalogue
// ---------------------------------------------------------------------------

interface TierRow {
  tier: ClientTier;
  monthly_fee: number | null;
  currency: string;
  summary: string | null;
}

/** The catalogue as every screen wants it: criteria, tiers, ceilings, services. */
export async function readCatalogue(env: Env) {
  const [criteria, tiers, ceilings, services] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, name, unit, how_measured, position
         FROM subscription_criteria ORDER BY position, name`,
    ),
    env.DB.prepare(
      `SELECT tier, monthly_fee, currency, summary FROM subscription_tiers`,
    ),
    env.DB.prepare(`SELECT tier, criterion_id, ceiling FROM tier_ceilings`),
    env.DB.prepare(
      `SELECT id, name, summary, fee, fee_basis, currency, service_line, active, position
         FROM additional_services ORDER BY position, name`,
    ),
  ]);

  return {
    criteria: criteria.results as unknown as Criterion[],
    tiers: tiers.results as unknown as TierRow[],
    ceilings: ceilings.results as unknown as Ceiling[],
    services: services.results,
  };
}

/**
 * What a client actually pays.
 *
 * The subscription's own fee when one is set, otherwise the tier's. One function so the
 * firm's list, the client's page and the invoice list cannot each resolve it slightly
 * differently.
 */
export function feeFor(
  subscription: { monthly_fee: number | null; currency: string; tier: ClientTier },
  tiers: TierRow[],
): { fee: number | null; currency: string; negotiated: boolean } {
  if (subscription.monthly_fee !== null && subscription.monthly_fee !== undefined) {
    return { fee: subscription.monthly_fee, currency: subscription.currency, negotiated: true };
  }
  const tier = tiers.find((t) => t.tier === subscription.tier);
  return {
    fee: tier?.monthly_fee ?? null,
    currency: tier?.currency ?? subscription.currency,
    negotiated: false,
  };
}

/** The newest figure for each criterion, which is what an assessment reads. */
async function latestFigures(env: Env, clientId: string): Promise<Figure[]> {
  const { results } = await env.DB.prepare(
    `SELECT f.criterion_id, f.value, f.as_of, f.recorded_at, u.full_name AS recorded_by_name
       FROM client_figures f
       LEFT JOIN users u ON u.id = f.recorded_by
      WHERE f.client_id = ?1
        AND f.as_of = (
          SELECT MAX(f2.as_of) FROM client_figures f2
           WHERE f2.client_id = ?1 AND f2.criterion_id = f.criterion_id
        )
      ORDER BY f.criterion_id`,
  )
    .bind(clientId)
    .all();
  return results as unknown as Figure[];
}

async function loadSubscription(env: Env, clientId: string) {
  return await env.DB.prepare(
    `SELECT client_id, tier, monthly_fee, currency, started_on, status, ended_on, note
       FROM client_subscriptions WHERE client_id = ?`,
  )
    .bind(clientId)
    .first<{
      client_id: string;
      tier: ClientTier;
      monthly_fee: number | null;
      currency: string;
      started_on: string;
      status: string;
      ended_on: string | null;
      note: string | null;
    }>();
}

function eventStatement(
  env: Env,
  row: {
    clientId: string;
    kind: string;
    fromTier?: ClientTier | null;
    toTier?: ClientTier | null;
    fromFee?: number | null;
    toFee?: number | null;
    detail?: string | null;
    actorId: string;
  },
) {
  return env.DB.prepare(
    `INSERT INTO subscription_events
       (id, client_id, kind, from_tier, to_tier, from_fee, to_fee, detail, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId(),
    row.clientId,
    row.kind,
    row.fromTier ?? null,
    row.toTier ?? null,
    row.fromFee ?? null,
    row.toFee ?? null,
    row.detail ?? null,
    row.actorId,
    nowIso(),
  );
}

/** A number that may legitimately be absent, refused when it is present and wrong. */
function optionalAmount(raw: unknown, field: string): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw badRequest(`${field} has to be a number that is not negative, or left empty.`);
  }
  if (value > 1_000_000_000) throw badRequest(`${field} is implausibly large.`);
  return value;
}

export function registerSubscriptionRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // The catalogue
  // -------------------------------------------------------------------------

  router.get("/api/subscription-catalogue", async ({ request, env }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    return json(await readCatalogue(env));
  });

  router.post("/api/subscription-criteria", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      name?: string;
      unit?: unknown;
      how_measured?: string;
    }>(request);

    const name = requireString(body.name, "name", { max: 80 });
    const refusal = whyNotACriterionName(name);
    if (refusal) throw badRequest(refusal);
    const unit = requireEnum(body.unit, "unit", CRITERION_UNITS);

    const clash = await env.DB.prepare(
      `SELECT id FROM subscription_criteria WHERE name = ? COLLATE NOCASE`,
    )
      .bind(name)
      .first();
    if (clash) throw conflict(`${name} is already one of the criteria.`);

    const id = newId();
    const timestamp = nowIso();
    const position = await env.DB.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM subscription_criteria`,
    ).first<{ n: number }>();

    await env.DB.prepare(
      `INSERT INTO subscription_criteria
         (id, name, unit, how_measured, position, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        name,
        unit,
        body.how_measured?.trim() ? body.how_measured.trim().slice(0, 300) : null,
        position?.n ?? 0,
        timestamp,
        actor.id,
      )
      .run();

    return json({ id }, 201);
  });

  router.patch("/api/subscription-criteria/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ name?: string; how_measured?: string }>(request);
    const name = requireString(body.name, "name", { max: 80 });
    const refusal = whyNotACriterionName(name);
    if (refusal) throw badRequest(refusal);

    const clash = await env.DB.prepare(
      `SELECT id FROM subscription_criteria WHERE name = ? COLLATE NOCASE AND id <> ?`,
    )
      .bind(name, params.id)
      .first();
    if (clash) throw conflict(`${name} is already one of the criteria.`);

    const result = await env.DB.prepare(
      `UPDATE subscription_criteria SET name = ?, how_measured = ? WHERE id = ?`,
    )
      .bind(
        name,
        body.how_measured?.trim() ? body.how_measured.trim().slice(0, 300) : null,
        params.id,
      )
      .run();
    if (!result.meta.changes) throw notFound("There is no such criterion.");
    return noContent();
  });

  /**
   * Removes a criterion, and with it every ceiling and every figure recorded against it.
   *
   * Said plainly in the refusal rather than done quietly: a criterion the firm has been
   * measuring for a year is a year of figures, and somebody tidying a settings screen
   * should know that before they click.
   */
  router.delete("/api/subscription-criteria/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const figures = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM client_figures WHERE criterion_id = ?`,
    )
      .bind(params.id)
      .first<{ n: number }>();

    const url = new URL(request.url);
    if ((figures?.n ?? 0) > 0 && url.searchParams.get("confirm") !== "yes") {
      throw conflict(
        `${figures?.n} recorded figures would go with this criterion. Confirm to remove it anyway.`,
      );
    }

    const result = await env.DB.prepare(
      `DELETE FROM subscription_criteria WHERE id = ?`,
    )
      .bind(params.id)
      .run();
    if (!result.meta.changes) throw notFound("There is no such criterion.");
    return noContent();
  });

  /** A tier's fee, its summary, and its ceilings. The tier itself is not creatable. */
  router.patch("/api/subscription-tiers/:tier", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const tier = requireEnum(params.tier, "tier", CLIENT_TIERS) as ClientTier;
    const body = await readJson<{
      monthly_fee?: unknown;
      summary?: string;
      ceilings?: Record<string, unknown>;
    }>(request);

    const fee = optionalAmount(body.monthly_fee, "The fee");
    const timestamp = nowIso();
    const statements = [
      env.DB.prepare(
        `UPDATE subscription_tiers
            SET monthly_fee = ?, summary = ?, updated_at = ?, updated_by = ?
          WHERE tier = ?`,
      ).bind(
        fee,
        body.summary?.trim() ? body.summary.trim().slice(0, 400) : null,
        timestamp,
        actor.id,
        tier,
      ),
    ];

    for (const [criterionId, raw] of Object.entries(body.ceilings ?? {})) {
      const ceiling = optionalAmount(raw, "A ceiling");
      statements.push(
        env.DB.prepare(
          `INSERT INTO tier_ceilings (tier, criterion_id, ceiling)
           VALUES (?, ?, ?)
           ON CONFLICT (tier, criterion_id) DO UPDATE SET ceiling = excluded.ceiling`,
        ).bind(tier, criterionId, ceiling),
      );
    }

    await env.DB.batch(statements);
    return noContent();
  });

  // -------------------------------------------------------------------------
  // Additional services
  // -------------------------------------------------------------------------

  router.post("/api/additional-services", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      name?: string;
      summary?: string;
      fee?: unknown;
      fee_basis?: unknown;
      service_line?: string;
    }>(request);

    const name = requireString(body.name, "name", { max: 120 });
    const basis = requireEnum(body.fee_basis ?? "fixed", "fee_basis", FEE_BASES);
    const fee = optionalAmount(body.fee, "The fee");

    const clash = await env.DB.prepare(
      `SELECT id FROM additional_services WHERE name = ? COLLATE NOCASE`,
    )
      .bind(name)
      .first();
    if (clash) throw conflict(`${name} is already on the list of services.`);

    const id = newId();
    const position = await env.DB.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM additional_services`,
    ).first<{ n: number }>();

    await env.DB.prepare(
      `INSERT INTO additional_services
         (id, name, summary, fee, fee_basis, service_line, position, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        name,
        body.summary?.trim() ? body.summary.trim().slice(0, 400) : null,
        fee,
        basis,
        body.service_line?.trim() || null,
        position?.n ?? 0,
        nowIso(),
        actor.id,
      )
      .run();

    return json({ id }, 201);
  });

  router.patch("/api/additional-services/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      name?: string;
      summary?: string;
      fee?: unknown;
      fee_basis?: unknown;
      service_line?: string;
      active?: unknown;
    }>(request);

    const name = requireString(body.name, "name", { max: 120 });
    const basis = requireEnum(body.fee_basis ?? "fixed", "fee_basis", FEE_BASES);
    const fee = optionalAmount(body.fee, "The fee");

    const clash = await env.DB.prepare(
      `SELECT id FROM additional_services WHERE name = ? COLLATE NOCASE AND id <> ?`,
    )
      .bind(name, params.id)
      .first();
    if (clash) throw conflict(`${name} is already on the list of services.`);

    const result = await env.DB.prepare(
      `UPDATE additional_services
          SET name = ?, summary = ?, fee = ?, fee_basis = ?, service_line = ?, active = ?
        WHERE id = ?`,
    )
      .bind(
        name,
        body.summary?.trim() ? body.summary.trim().slice(0, 400) : null,
        fee,
        basis,
        body.service_line?.trim() || null,
        body.active === false || body.active === 0 ? 0 : 1,
        params.id,
      )
      .run();
    if (!result.meta.changes) throw notFound("There is no such service.");
    return noContent();
  });

  // -------------------------------------------------------------------------
  // Every subscription, which is the screen that earns the feature
  // -------------------------------------------------------------------------

  /**
   * Every client on a tier, with where each one stands.
   *
   * Assessed here rather than in the browser so that the firm's list, a client's own
   * page and anything that later emails about this are the same judgement. The figures
   * are fetched for every client in one query rather than per client, because this list
   * is the whole client base.
   */
  router.get("/api/subscriptions", async ({ request, env }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const catalogue = await readCatalogue(env);

    const [subs, figures] = await env.DB.batch([
      env.DB.prepare(
        `SELECT s.client_id, s.tier, s.monthly_fee, s.currency, s.started_on, s.status,
                c.name AS client_name, c.code AS client_code,
                p.full_name AS partner_name
           FROM client_subscriptions s
           JOIN clients c ON c.id = s.client_id
           LEFT JOIN users p ON p.id = c.partner_id
          WHERE s.status <> 'ended'
          ORDER BY c.name`,
      ),
      env.DB.prepare(
        `SELECT f.client_id, f.criterion_id, f.value, f.as_of
           FROM client_figures f
          WHERE f.as_of = (
            SELECT MAX(f2.as_of) FROM client_figures f2
             WHERE f2.client_id = f.client_id AND f2.criterion_id = f.criterion_id
          )`,
      ),
    ]);

    const byClient = new Map<string, Figure[]>();
    for (const row of figures.results as unknown as Array<Figure & { client_id: string }>) {
      const list = byClient.get(row.client_id) ?? [];
      list.push(row);
      byClient.set(row.client_id, list);
    }

    const rows = (subs.results as unknown as Array<{
      client_id: string;
      tier: ClientTier;
      monthly_fee: number | null;
      currency: string;
      started_on: string;
      status: string;
      client_name: string;
      client_code: string;
      partner_name: string | null;
    }>).map((sub) => {
      const mine = byClient.get(sub.client_id) ?? [];
      const assessment = assess(sub.tier, catalogue.criteria, catalogue.ceilings, mine);
      return {
        ...sub,
        ...feeFor(sub, catalogue.tiers),
        figures: mine,
        assessment,
      };
    });

    return json({ ...catalogue, subscriptions: rows });
  });

  // -------------------------------------------------------------------------
  // One client
  // -------------------------------------------------------------------------

  router.get("/api/clients/:id/subscription", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const catalogue = await readCatalogue(env);
    const subscription = await loadSubscription(env, params.id);
    const figures = await latestFigures(env, params.id);

    const [history, services, logins, allFigures] = await env.DB.batch([
      env.DB.prepare(
        `SELECT e.id, e.kind, e.from_tier, e.to_tier, e.from_fee, e.to_fee, e.detail,
                e.created_at, u.full_name AS actor_name
           FROM subscription_events e
           LEFT JOIN users u ON u.id = e.actor_id
          WHERE e.client_id = ?
          ORDER BY e.created_at DESC
          LIMIT 50`,
      ).bind(params.id),
      env.DB.prepare(
        `SELECT cs.id, cs.name, cs.status, cs.quoted_fee, cs.currency, cs.note,
                cs.requested_at, cs.quoted_at, cs.decided_at, cs.delivered_at,
                cu.full_name AS requested_by_name
           FROM client_services cs
           LEFT JOIN client_users cu ON cu.id = cs.requested_by
          WHERE cs.client_id = ?
          ORDER BY cs.created_at DESC`,
      ).bind(params.id),
      env.DB.prepare(
        `SELECT id, email, full_name, status, invited_at, accepted_at, last_login_at
           FROM client_users WHERE client_id = ? ORDER BY full_name`,
      ).bind(params.id),
      env.DB.prepare(
        `SELECT f.criterion_id, f.value, f.as_of, f.recorded_at,
                u.full_name AS recorded_by_name
           FROM client_figures f
           LEFT JOIN users u ON u.id = f.recorded_by
          WHERE f.client_id = ?
          ORDER BY f.as_of DESC
          LIMIT 60`,
      ).bind(params.id),
    ]);

    return json({
      ...catalogue,
      subscription: subscription
        ? { ...subscription, ...feeFor(subscription, catalogue.tiers) }
        : null,
      figures,
      figure_history: allFigures.results,
      assessment: subscription
        ? assess(subscription.tier, catalogue.criteria, catalogue.ceilings, figures)
        : null,
      history: history.results,
      /*
       * Named apart from the catalogue's `services`, which this response also carries.
       * Spreading the catalogue and then adding `services` clobbered the menu, so the
       * screen offering "add a service to this client" had nothing to offer.
       */
      client_services: services.results,
      logins: logins.results,
    });
  });

  /**
   * Puts a client on a tier, or moves them to another one.
   *
   * Partner business, because it is the fee. The event row is written in the same batch
   * as the change, so there is no state in which a client is on a new tier and nothing
   * records what they were on before.
   */
  router.put("/api/clients/:id/subscription", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      tier?: unknown;
      monthly_fee?: unknown;
      started_on?: string;
      note?: string;
      status?: unknown;
    }>(request);

    const client = await env.DB.prepare(`SELECT id, name FROM clients WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string; name: string }>();
    if (!client) throw notFound("There is no such client.");

    const tier = requireEnum(body.tier, "tier", CLIENT_TIERS) as ClientTier;
    const fee = optionalAmount(body.monthly_fee, "The fee");
    const status = body.status
      ? requireEnum(body.status, "status", ["active", "paused", "ended"] as const)
      : "active";
    const timestamp = nowIso();
    const existing = await loadSubscription(env, params.id);

    const catalogue = await readCatalogue(env);
    const before = existing ? feeFor(existing, catalogue.tiers).fee : null;
    const after = feeFor({ tier, monthly_fee: fee, currency: "GHS" }, catalogue.tiers).fee;

    const statements = [];
    if (existing) {
      statements.push(
        env.DB.prepare(
          `UPDATE client_subscriptions
              SET tier = ?, monthly_fee = ?, status = ?, note = ?, updated_at = ?,
                  updated_by = ?, ended_on = ?
            WHERE client_id = ?`,
        ).bind(
          tier,
          fee,
          status,
          body.note?.trim()?.slice(0, 500) || null,
          timestamp,
          actor.id,
          status === "ended" ? timestamp.slice(0, 10) : null,
          params.id,
        ),
      );

      /*
       * One event per thing that actually changed. A Partner correcting a typo in the
       * note should not leave a "moved tier" entry in a record somebody may later read
       * as the history of what this client was charged.
       */
      if (existing.tier !== tier) {
        statements.push(
          eventStatement(env, {
            clientId: params.id,
            kind: "moved",
            fromTier: existing.tier,
            toTier: tier,
            fromFee: before,
            toFee: after,
            detail: `${TIER_LABELS[existing.tier]} to ${TIER_LABELS[tier]}`,
            actorId: actor.id,
          }),
        );
      } else if (before !== after) {
        statements.push(
          eventStatement(env, {
            clientId: params.id,
            kind: "fee_changed",
            fromTier: tier,
            toTier: tier,
            fromFee: before,
            toFee: after,
            actorId: actor.id,
          }),
        );
      }
      if (existing.status !== status && (status === "paused" || status === "ended")) {
        statements.push(
          eventStatement(env, {
            clientId: params.id,
            kind: status === "paused" ? "paused" : "ended",
            actorId: actor.id,
          }),
        );
      } else if (existing.status !== status && status === "active") {
        statements.push(
          eventStatement(env, { clientId: params.id, kind: "resumed", actorId: actor.id }),
        );
      }
    } else {
      statements.push(
        env.DB.prepare(
          `INSERT INTO client_subscriptions
             (client_id, tier, monthly_fee, currency, started_on, status, note,
              created_at, updated_at, updated_by)
           VALUES (?, ?, ?, 'GHS', ?, ?, ?, ?, ?, ?)`,
        ).bind(
          params.id,
          tier,
          fee,
          body.started_on?.trim() || timestamp.slice(0, 10),
          status,
          body.note?.trim()?.slice(0, 500) || null,
          timestamp,
          timestamp,
          actor.id,
        ),
        eventStatement(env, {
          clientId: params.id,
          kind: "subscribed",
          toTier: tier,
          toFee: after,
          detail: TIER_LABELS[tier],
          actorId: actor.id,
        }),
      );
    }

    await env.DB.batch(statements);
    return json({ ok: true });
  });

  /** Records this period's figures. Manager business: it is measurement, not money. */
  router.post("/api/clients/:id/figures", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<{
      as_of?: string;
      values?: Record<string, unknown>;
      note?: string;
    }>(request);

    const asOf = requireString(body.as_of, "as_of", { max: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      throw badRequest("Give the date the figures describe, as YYYY-MM-DD.");
    }

    const entries = Object.entries(body.values ?? {}).filter(
      ([, raw]) => raw !== null && raw !== undefined && raw !== "",
    );
    if (!entries.length) throw badRequest("Enter at least one figure.");

    const timestamp = nowIso();
    const statements = entries.map(([criterionId, raw]) => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        throw badRequest("A figure has to be a number that is not negative.");
      }
      /*
       * Upsert on (client, criterion, date). Recording August twice corrects it rather
       * than leaving two rows and letting "the newest" depend on insertion order.
       */
      return env.DB.prepare(
        `INSERT INTO client_figures
           (id, client_id, criterion_id, value, as_of, note, recorded_by, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (client_id, criterion_id, as_of)
         DO UPDATE SET value = excluded.value, note = excluded.note,
                       recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at`,
      ).bind(
        newId(),
        params.id,
        criterionId,
        value,
        asOf,
        body.note?.trim()?.slice(0, 300) || null,
        actor.id,
        timestamp,
      );
    });

    await env.DB.batch(statements);
    return json({ recorded: statements.length });
  });

  // -------------------------------------------------------------------------
  // Additional work on a client
  // -------------------------------------------------------------------------

  router.post("/api/clients/:id/services", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<{
      service_id?: string;
      name?: string;
      quoted_fee?: unknown;
      status?: unknown;
      note?: string;
    }>(request);

    let name = body.name?.trim() ?? "";
    let serviceId: string | null = null;
    if (body.service_id) {
      const service = await env.DB.prepare(
        `SELECT id, name FROM additional_services WHERE id = ?`,
      )
        .bind(body.service_id)
        .first<{ id: string; name: string }>();
      if (!service) throw notFound("There is no such service.");
      serviceId = service.id;
      // Copied, so the record survives the catalogue being reorganised.
      name = service.name;
    }
    if (!name) throw badRequest("Say which service this is.");

    const status = body.status
      ? requireEnum(body.status, "status", SERVICE_STATES)
      : "agreed";
    const timestamp = nowIso();
    const id = newId();

    await env.DB.prepare(
      `INSERT INTO client_services
         (id, client_id, service_id, name, status, quoted_fee, note,
          quoted_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        params.id,
        serviceId,
        name.slice(0, 120),
        status,
        optionalAmount(body.quoted_fee, "The fee"),
        body.note?.trim()?.slice(0, 500) || null,
        timestamp,
        actor.id,
        timestamp,
        timestamp,
      )
      .run();

    return json({ id }, 201);
  });

  /** Quotes, agrees, delivers or declines a piece of additional work. */
  router.patch("/api/client-services/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<{ status?: unknown; quoted_fee?: unknown; note?: string }>(
      request,
    );

    const existing = await env.DB.prepare(
      `SELECT id, client_id, status FROM client_services WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; client_id: string; status: ServiceState }>();
    if (!existing) throw notFound("There is no such request.");

    const status = requireEnum(body.status, "status", SERVICE_STATES);
    if (status !== existing.status && !nextStates(existing.status).includes(status)) {
      throw badRequest(
        `A request that is already ${existing.status} cannot go back to ${status}.`,
      );
    }

    const timestamp = nowIso();
    await env.DB.prepare(
      `UPDATE client_services
          SET status = ?, quoted_fee = COALESCE(?, quoted_fee), note = COALESCE(?, note),
              quoted_at = CASE WHEN ? = 'quoted' THEN ? ELSE quoted_at END,
              decided_at = CASE WHEN ? IN ('agreed','declined') THEN ? ELSE decided_at END,
              delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END,
              updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        status,
        optionalAmount(body.quoted_fee, "The fee"),
        body.note?.trim()?.slice(0, 500) || null,
        status,
        timestamp,
        status,
        timestamp,
        status,
        timestamp,
        timestamp,
        params.id,
      )
      .run();

    return noContent();
  });

  // -------------------------------------------------------------------------
  // Client logins
  // -------------------------------------------------------------------------

  /**
   * Invites somebody at a client to sign in.
   *
   * Partner business, because it hands somebody outside the firm a way in. No password
   * is set: a one-time token goes out by email, only its digest is kept, and the account
   * cannot sign in until they have used it.
   */
  router.post("/api/clients/:id/logins", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ email?: string; full_name?: string }>(request);

    const client = await env.DB.prepare(
      `SELECT id, name, status FROM clients WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; name: string; status: string }>();
    if (!client) throw notFound("There is no such client.");
    if (client.status === "exited") {
      throw badRequest("That client has exited. A login would have nothing to show.");
    }

    const email = requireString(body.email, "email", { max: 200 }).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      throw badRequest("That does not look like an email address.");
    }
    const fullName = requireString(body.full_name, "full_name", { max: 120 });

    const clash = await env.DB.prepare(
      `SELECT cu.id, c.name AS client_name FROM client_users cu
         JOIN clients c ON c.id = cu.client_id
        WHERE cu.email = ? COLLATE NOCASE`,
    )
      .bind(email)
      .first<{ id: string; client_name: string }>();
    if (clash) {
      throw conflict(
        clash.client_name === client.name
          ? `${email} already has a login for ${client.name}.`
          : `${email} already has a login, for another client.`,
      );
    }

    const id = newId();
    const timestamp = nowIso();
    const token = newToken();
    const expires = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO client_users
           (id, client_id, email, full_name, status, invited_by, invited_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, 'invited', ?, ?, ?, ?)`,
      ).bind(id, params.id, email, fullName, actor.id, timestamp, timestamp, timestamp),
      env.DB.prepare(
        `INSERT INTO client_invitations (id, client_user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(await tokenDigest(token), id, expires, timestamp),
    ]);

    const settings = await readSettings(env);
    const link = `${new URL(request.url).origin}/client/invitation/${encodeURIComponent(token)}`;
    await sendToPerson(env, {
      to: { email, full_name: fullName },
      subject: `Your ${settings.firm_name} account`,
      headline:
        `You can now sign in to see what ${client.name} subscribes to with ` +
        `${settings.firm_name}, and ask us for additional work.`,
      detail:
        `The link below works once and expires in ${INVITATION_TTL_DAYS} days. ` +
        `It will ask you to choose your own password - nobody here will ever know it.`,
      link,
      linkLabel: "Set my password",
      firmName: settings.firm_name,
      reason: `${settings.firm_name} has given you access to the ${client.name} account`,
    });

    /*
     * The link goes back to the caller as well as by email so a Partner sitting with a
     * client can hand it over there and then. It is shown once and never stored: only
     * its digest is in the database.
     */
    return json({ id, invitation_url: link }, 201);
  });

  router.post("/api/client-logins/:id/reinvite", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const row = await env.DB.prepare(
      `SELECT cu.id, cu.email, cu.full_name, c.name AS client_name
         FROM client_users cu JOIN clients c ON c.id = cu.client_id
        WHERE cu.id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; email: string; full_name: string; client_name: string }>();
    if (!row) throw notFound("There is no such login.");

    const token = newToken();
    const timestamp = nowIso();
    const expires = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();

    await env.DB.batch([
      // Any earlier invitation stops working. Two live links would be two ways in.
      env.DB.prepare(
        `DELETE FROM client_invitations WHERE client_user_id = ? AND used_at IS NULL`,
      ).bind(row.id),
      env.DB.prepare(
        `INSERT INTO client_invitations (id, client_user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(await tokenDigest(token), row.id, expires, timestamp),
    ]);

    const settings = await readSettings(env);
    const link = `${new URL(request.url).origin}/client/invitation/${encodeURIComponent(token)}`;
    await sendToPerson(env, {
      to: { email: row.email, full_name: row.full_name },
      subject: `Your ${settings.firm_name} account`,
      headline: `Here is a fresh link for the ${row.client_name} account.`,
      detail:
        `Any earlier link has stopped working. This one works once and expires in ` +
        `${INVITATION_TTL_DAYS} days.`,
      link,
      linkLabel: "Set my password",
      firmName: settings.firm_name,
      reason: `you asked ${settings.firm_name} for a new link to the ${row.client_name} account`,
    });

    return json({ invitation_url: link });
  });

  /** Suspends or restores a client login without deleting what they asked for. */
  router.patch("/api/client-logins/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ status?: unknown }>(request);
    const status = requireEnum(body.status, "status", ["active", "suspended"] as const);

    const result = await env.DB.prepare(
      `UPDATE client_users SET status = ?, updated_at = ? WHERE id = ? AND status <> 'invited'`,
    )
      .bind(status, nowIso(), params.id)
      .run();
    if (!result.meta.changes) {
      throw badRequest("That login has not been used yet, so there is nothing to suspend.");
    }

    // Suspending ends their sessions now rather than whenever they next sign in.
    if (status === "suspended") {
      await env.DB.prepare(`DELETE FROM client_sessions WHERE client_user_id = ?`)
        .bind(params.id)
        .run();
    }
    return noContent();
  });

  router.delete("/api/client-logins/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const result = await env.DB.prepare(`DELETE FROM client_users WHERE id = ?`)
      .bind(params.id)
      .run();
    if (!result.meta.changes) throw notFound("There is no such login.");
    return noContent();
  });
}
