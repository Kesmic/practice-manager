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
  whyNotAStartDate,
  feeFor,
  whyNotABillingCurrency,
} from "../../shared/subscriptions";
import {
  DISCOUNT_KINDS,
  DISCOUNT_RUNS,
  DISCOUNT_SCOPES,
  describeDiscount,
  whyNotADiscount,
  type DiscountKind,
  type DiscountRun,
  type DiscountScope,
} from "../../shared/discounts";
import { activeDiscount } from "../discounts";
import {
  cheapestPackageWith,
  whyNotAServiceName,
  whyNotAnExtra,
  type PackageService,
  type ServiceInclusion,
  coverLines,
  includedTree,
} from "../../shared/package-services";
import { CURRENCIES, DEFAULT_CURRENCY, currencyOf, formatAmount } from "../../shared/money";
import { sendToPerson } from "../email";

// ---------------------------------------------------------------------------
// Reading the catalogue
// ---------------------------------------------------------------------------

/*
 * The same shape shared/types.ts declares for the screens, kept here so the Worker's
 * own callers are typed too. One package, described the same way at both ends.
 */
interface TierRow {
  tier: ClientTier;
  monthly_fee: number | null;
  currency: string;
  summary: string | null;
  ideal_for: string | null;
  position: number;
  active: 0 | 1;
}

interface InclusionRow {
  id: string;
  tier: ClientTier;
  label: string;
  parent_id: string | null;
  position: number;
}

/** The catalogue as every screen wants it: criteria, tiers, ceilings, services. */
export async function readCatalogue(env: Env) {
  const [criteria, tiers, ceilings, services, inclusions, packageServices, serviceInclusions] =
    await env.DB.batch([
    env.DB.prepare(
      `SELECT id, name, unit, how_measured, position, currency
         FROM subscription_criteria ORDER BY position, name`,
    ),
    env.DB.prepare(
      `SELECT tier, monthly_fee, fee_from, fee_note, currency, summary, ideal_for,
              position, active
         FROM subscription_tiers ORDER BY position`,
    ),
    env.DB.prepare(`SELECT tier, criterion_id, ceiling FROM tier_ceilings`),
    env.DB.prepare(
      `SELECT id, name, summary, fee, fee_basis, currency, service_line, active, position
         FROM additional_services ORDER BY position, name`,
    ),
    /*
     * What each package includes, in the shape the package cards and the proposal
     * read: one row per package per service, with the heading of any included
     * sub-service brought along (the UNION), and sub-services ordered under their
     * heading. Derived from the catalogue below, never stored in this shape.
     */
    env.DB.prepare(
      `SELECT s.id, i.tier,
              s.name || CASE WHEN i.note IS NOT NULL AND i.note <> '' THEN ' - ' || i.note ELSE '' END AS label,
              s.parent_id,
              COALESCE(p.position * 1000 + s.position + 1, s.position * 1000) AS position
         FROM package_service_inclusions i
         JOIN package_services s ON s.id = i.service_id
         LEFT JOIN package_services p ON p.id = s.parent_id
        WHERE s.active = 1 AND (p.id IS NULL OR p.active = 1)
       UNION
       SELECT p.id, i.tier, p.name, NULL, p.position * 1000
         FROM package_service_inclusions i
         JOIN package_services s ON s.id = i.service_id
         JOIN package_services p ON p.id = s.parent_id
        WHERE s.active = 1 AND p.active = 1
        ORDER BY 2, 5`,
    ),
    env.DB.prepare(
      `SELECT id, name, parent_id, position, active FROM package_services
        ORDER BY parent_id IS NOT NULL, position, name`,
    ),
    env.DB.prepare(`SELECT tier, service_id, note FROM package_service_inclusions`),
  ]);

  return {
    criteria: criteria.results as unknown as Criterion[],
    tiers: tiers.results as unknown as TierRow[],
    ceilings: ceilings.results as unknown as Ceiling[],
    services: services.results,
    inclusions: inclusions.results as unknown as InclusionRow[],
    package_services: packageServices.results as unknown as PackageService[],
    service_inclusions: serviceInclusions.results as unknown as ServiceInclusion[],
  };
}

/**
 * What a client actually pays.
 *
 * The subscription's own fee when one is set, otherwise the tier's. One function so the
 * firm's list, the client's page and the invoice list cannot each resolve it slightly
 * differently.
 */
export { feeFor };

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
      fee_from?: unknown;
      fee_note?: string;
      currency?: unknown;
      summary?: string;
      ideal_for?: string;
      ceilings?: Record<string, unknown>;
    }>(request);

    const fee = optionalAmount(body.monthly_fee, "The fee");
    /*
     * A starting price only makes sense below the list price: "from 1,500 to 1,200"
     * is not a range anybody would print. Refused rather than silently dropped, so the
     * admin who typed it finds out.
     */
    const feeFrom = optionalAmount(body.fee_from, "The starting price");
    if (feeFrom !== null && (fee === null || feeFrom >= fee)) {
      throw badRequest("The starting price must be below the price a month.");
    }
    const feeNote = body.fee_note?.trim() ? body.fee_note.trim().slice(0, 240) : null;
    const currency = body.currency
      ? requireEnum(body.currency, "currency", CURRENCIES)
      : DEFAULT_CURRENCY;
    const timestamp = nowIso();
    const statements = [
      env.DB.prepare(
        `UPDATE subscription_tiers
            SET monthly_fee = ?, fee_from = ?, fee_note = ?, currency = ?, summary = ?,
                ideal_for = ?, updated_at = ?, updated_by = ?
          WHERE tier = ?`,
      ).bind(
        fee,
        feeFrom,
        feeNote,
        currency,
        body.summary?.trim() ? body.summary.trim().slice(0, 400) : null,
        body.ideal_for?.trim() ? body.ideal_for.trim().slice(0, 300) : null,
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
      currency?: unknown;
      service_line?: string;
    }>(request);

    const name = requireString(body.name, "name", { max: 120 });
    const basis = requireEnum(body.fee_basis ?? "fixed", "fee_basis", FEE_BASES);
    const fee = optionalAmount(body.fee, "The fee");
    const currency = body.currency
      ? requireEnum(body.currency, "currency", CURRENCIES)
      : DEFAULT_CURRENCY;

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
         (id, name, summary, fee, fee_basis, currency, service_line, position,
          created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        name,
        body.summary?.trim() ? body.summary.trim().slice(0, 400) : null,
        fee,
        basis,
        currency,
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
      currency?: unknown;
      service_line?: string;
      active?: unknown;
    }>(request);

    const name = requireString(body.name, "name", { max: 120 });
    const basis = requireEnum(body.fee_basis ?? "fixed", "fee_basis", FEE_BASES);
    const fee = optionalAmount(body.fee, "The fee");
    const currency = body.currency
      ? requireEnum(body.currency, "currency", CURRENCIES)
      : DEFAULT_CURRENCY;

    const clash = await env.DB.prepare(
      `SELECT id FROM additional_services WHERE name = ? COLLATE NOCASE AND id <> ?`,
    )
      .bind(name, params.id)
      .first();
    if (clash) throw conflict(`${name} is already on the list of services.`);

    const result = await env.DB.prepare(
      `UPDATE additional_services
          SET name = ?, summary = ?, fee = ?, fee_basis = ?, currency = ?,
              service_line = ?, active = ?
        WHERE id = ?`,
    )
      .bind(
        name,
        body.summary?.trim() ? body.summary.trim().slice(0, 400) : null,
        fee,
        basis,
        currency,
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

  /**
   * What a job for this client can be covered by, for the New deliverable form: the
   * lines of their package (extras included), and the one-off work they have asked
   * for or agreed to. Open to anybody who can raise a job, which is below the grade
   * that sees the client's fees - so no money is in it.
   */
  router.get("/api/clients/:id/work-cover", async ({ request, env, params }) => {
    await requireRole(env, request, "senior_associate");
    const catalogue = await readCatalogue(env);
    const subscription = await loadSubscription(env, params.id);
    const extras = subscription ? await readExtras(env, params.id, catalogue.service_inclusions) : [];
    const included = subscription
      ? coverLines(
          includedTree({
            tier: subscription.tier,
            services: catalogue.package_services,
            inclusions: catalogue.service_inclusions,
            extras: extras.filter((e) => e.ended_at === null),
          }),
        )
      : [];
    const { results: services } = await env.DB.prepare(
      `SELECT id, name, status FROM client_services
        WHERE client_id = ? AND status IN ('requested', 'quoted', 'agreed')
        ORDER BY created_at DESC`,
    )
      .bind(params.id)
      .all<{ id: string; name: string; status: ServiceState }>();
    return json({
      subscription: subscription ? { tier: subscription.tier, label: TIER_LABELS[subscription.tier] } : null,
      included,
      services,
    });
  });

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

    /*
     * Read through `activeDiscount` first, which retires one that has stopped applying.
     * Without that pass the screen would show a discount that ran until March as still
     * live in April, and the button offering a new one would fail on the index.
     */
    await activeDiscount(env, params.id);
    const discounts = await env.DB.prepare(
      `SELECT d.id, d.kind, d.value, d.applies_to, d.runs, d.invoice_count, d.until_on,
              d.used_count, d.reason, d.status, d.created_at, d.ended_at, d.ended_reason,
              g.full_name AS granted_by_name, e.full_name AS ended_by_name
         FROM client_discounts d
         LEFT JOIN users g ON g.id = d.granted_by
         LEFT JOIN users e ON e.id = d.ended_by
        WHERE d.client_id = ?
        ORDER BY d.status = 'active' DESC, d.created_at DESC
        LIMIT 20`,
    )
      .bind(params.id)
      .all();

    const extras = await readExtras(env, params.id, catalogue.service_inclusions);

    return json({
      ...catalogue,
      subscription: subscription
        ? { ...subscription, ...feeFor(subscription, catalogue.tiers) }
        : null,
      figures,
      figure_history: allFigures.results,
      extras,
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
      discounts: discounts.results,
    });
  });

  /**
   * Puts a client on a tier, or moves them to another one.
   *
   * Partner business, because it is the fee. The event row is written in the same batch
   * as the change, so there is no state in which a client is on a new tier and nothing
   * records what they were on before.
   */
  /**
   * Pauses, resumes or ends a subscription - on its own, so that nothing else about the
   * subscription is sent back with it, and so the History says exactly which happened.
   *
   * Paused stops the monthly billing without ending the arrangement; resumed picks it up
   * again (from the month in hand - the months it was paused are not billed); ended
   * closes it on today's date. Resuming an ended subscription reopens it.
   */
  router.post("/api/clients/:id/subscription/status", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ status?: unknown }>(request);
    const status = requireEnum(body.status, "status", ["active", "paused", "ended"] as const);
    const existing = await loadSubscription(env, params.id);
    if (!existing) throw notFound("This client is not on a subscription.");
    if (existing.status === status) return json({ ok: true, status });

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE client_subscriptions
            SET status = ?, ended_on = ?, updated_at = ?, updated_by = ?
          WHERE client_id = ?`,
      ).bind(status, status === "ended" ? timestamp.slice(0, 10) : null, timestamp, actor.id, params.id),
      eventStatement(env, {
        clientId: params.id,
        kind: status === "active" ? "resumed" : status,
        actorId: actor.id,
      }),
    ]);
    return json({ ok: true, status });
  });

  router.put("/api/clients/:id/subscription", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      tier?: unknown;
      monthly_fee?: unknown;
      currency?: unknown;
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
    /*
     * The standing is changed through its own route (below), not here: a form for the
     * tier and fee that also carried the standing sent back whatever it had loaded, so a
     * page left open from before a subscription was resumed could quietly pause it again
     * with the next fee change. Sent here it is still honoured, for a new subscription
     * starting paused; left out, an existing subscription keeps the standing it has.
     */
    const statusSent = body.status
      ? requireEnum(body.status, "status", ["active", "paused", "ended"] as const)
      : null;
    /*
     * Cedis unless somebody says dollars. Nothing converts between the two - see
     * shared/money.ts - so this is the currency the client is actually billed in, and it
     * stays with the subscription rather than being read off the package each time.
     */
    const currency = body.currency
      ? requireEnum(body.currency, "currency", CURRENCIES)
      : DEFAULT_CURRENCY;
    const timestamp = nowIso();
    const existing = await loadSubscription(env, params.id);
    const status = statusSent ?? (existing?.status as "active" | "paused" | "ended" | undefined) ?? "active";

    /*
     * When the package started. Free to be in the past - a client agreed in July is a
     * client whose July can then be billed - and required, so that a subscription never
     * quietly takes today as its start because nobody said otherwise. On an existing
     * subscription the date may be corrected; left out, it stays as it was.
     */
    let startedOn = existing?.started_on ?? timestamp.slice(0, 10);
    if (body.started_on !== undefined || !existing) {
      const raw = typeof body.started_on === "string" ? body.started_on : "";
      const reason = whyNotAStartDate(raw || timestamp.slice(0, 10), timestamp.slice(0, 10));
      if (reason) throw badRequest(reason);
      startedOn = (raw || timestamp.slice(0, 10)).trim();
    }

    const catalogue = await readCatalogue(env);
    const listed = catalogue.tiers.find((t) => t.tier === tier);
    const currencyProblem = whyNotABillingCurrency(fee, currency, listed, TIER_LABELS[tier]);
    if (currencyProblem) throw badRequest(currencyProblem);
    const before = existing ? feeFor(existing, catalogue.tiers).fee : null;
    const after = feeFor({ tier, monthly_fee: fee, currency }, catalogue.tiers).fee;

    const statements = [];
    if (existing) {
      statements.push(
        env.DB.prepare(
          `UPDATE client_subscriptions
              SET tier = ?, monthly_fee = ?, currency = ?, status = ?, note = ?,
                  started_on = ?, updated_at = ?, updated_by = ?, ended_on = ?
            WHERE client_id = ?`,
        ).bind(
          tier,
          fee,
          currency,
          status,
          body.note?.trim()?.slice(0, 500) || null,
          startedOn,
          timestamp,
          actor.id,
          status === "ended" ? (existing.status === "ended" ? existing.ended_on : timestamp.slice(0, 10)) : null,
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
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          params.id,
          tier,
          fee,
          currency,
          startedOn,
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

    /*
     * Every live allocation of this client follows the package. Schedule 2 prices an
     * associate's fee by the client's tier, so a client moved from Growth to Firm is an
     * associate whose fee for that client moves with them - and the alternative, a
     * second control setting the same thing, is what put two different answers on one
     * screen in the first place.
     */
    statements.push(
      env.DB.prepare(
        `UPDATE client_allocations SET tier = ?
          WHERE client_id = ? AND status IN ('offered', 'accepted')`,
      ).bind(tier, params.id),
    );

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

  router.post("/api/clients/:id/services", async ({ request, env, params, waitUntil }) => {
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
    /*
     * What this piece of work is quoted in. The catalogue's currency where it came from
     * the catalogue, otherwise cedis. It stays on the row because an invoice is in one
     * currency and nothing converts: a piece of work quoted in dollars cannot join a
     * cedi invoice, and the invoice route says so rather than adding the figure anyway.
     */
    let quotedIn = DEFAULT_CURRENCY as string;
    if (body.service_id) {
      const service = await env.DB.prepare(
        `SELECT id, name, currency FROM additional_services WHERE id = ?`,
      )
        .bind(body.service_id)
        .first<{ id: string; name: string; currency: string }>();
      if (!service) throw notFound("There is no such service.");
      serviceId = service.id;
      // Copied, so the record survives the catalogue being reorganised.
      name = service.name;
      quotedIn = currencyOf(service.currency);
    }
    if (!name) throw badRequest("Say which service this is.");

    const status = body.status
      ? requireEnum(body.status, "status", SERVICE_STATES)
      : "agreed";
    const quotedFee = optionalAmount(body.quoted_fee, "The fee");
    /*
     * A quote with no number is not a quote: the client would be asked to agree to
     * nothing. Recording work as already agreed may leave the fee for later.
     */
    if (status === "quoted" && quotedFee === null) {
      throw badRequest("Give the fee. The client is being asked to accept it.");
    }
    const timestamp = nowIso();
    const id = newId();

    await env.DB.prepare(
      `INSERT INTO client_services
         (id, client_id, service_id, name, status, quoted_fee, currency, note,
          quoted_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        params.id,
        serviceId,
        name.slice(0, 120),
        status,
        quotedFee,
        quotedIn,
        body.note?.trim()?.slice(0, 500) || null,
        timestamp,
        actor.id,
        timestamp,
        timestamp,
      )
      .run();

    // Proposed to the client rather than recorded: they are told, and asked to decide.
    if (status === "quoted") {
      notifyClientOfQuote(env, waitUntil, params.id, {
        name: name.slice(0, 120),
        fee: quotedFee as number,
        currency: quotedIn,
        note: body.note?.trim()?.slice(0, 500) || null,
        proposed: true,
      });
    }

    return json({ id }, 201);
  });

  /** Quotes, agrees, delivers or declines a piece of additional work. */
  router.patch("/api/client-services/:id", async ({ request, env, params, waitUntil }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<{ status?: unknown; quoted_fee?: unknown; note?: string }>(
      request,
    );

    const existing = await env.DB.prepare(
      `SELECT id, client_id, status, name, quoted_fee, currency, note
         FROM client_services WHERE id = ?`,
    )
      .bind(params.id)
      .first<{
        id: string;
        client_id: string;
        status: ServiceState;
        name: string;
        quoted_fee: number | null;
        currency: string;
        note: string | null;
      }>();
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

    // Quoted: the client is told, and asked to accept or decline in their portal.
    if (status === "quoted" && existing.status !== "quoted") {
      const fee = optionalAmount(body.quoted_fee, "The fee") ?? existing.quoted_fee;
      if (fee === null) throw badRequest("Give the fee. The client is being asked to accept it.");
      notifyClientOfQuote(env, waitUntil, existing.client_id, {
        name: existing.name,
        fee,
        currency: existing.currency,
        note: body.note?.trim()?.slice(0, 500) || existing.note,
        proposed: false,
      });
    }

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
      `SELECT cu.id, cu.email, cu.full_name, cu.status, c.name AS client_name
         FROM client_users cu JOIN clients c ON c.id = cu.client_id
        WHERE cu.id = ?`,
    )
      .bind(params.id)
      .first<{
        id: string;
        email: string;
        full_name: string;
        status: string;
        client_name: string;
      }>();
    if (!row) throw notFound("There is no such login.");
    /*
     * A suspended account gets nothing. Sending a reset link to somebody the firm has
     * deliberately shut out would be handing back the key.
     */
    if (row.status === "suspended") {
      throw badRequest("That login is suspended. Restore it first if they should have access.");
    }

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
    /*
     * The same endpoint serves two occasions - somebody who has never signed in, and
     * somebody who has forgotten their password - and the wording has to match, or one
     * of them is told to set a password they already have.
     */
    const first = row.status === "invited";
    await sendToPerson(env, {
      to: { email: row.email, full_name: row.full_name },
      subject: first
        ? `Your ${settings.firm_name} account`
        : `Setting a new password for your ${settings.firm_name} account`,
      headline: first
        ? `Here is a fresh link for the ${row.client_name} account.`
        : `Here is a link to set a new password for the ${row.client_name} account.`,
      detail:
        (first
          ? "Any earlier link has stopped working. "
          : "Your current password keeps working until you use this. Using it signs you out on every other device. ") +
        `This link works once and expires in ${INVITATION_TTL_DAYS} days.` +
        (first ? "" : " If you did not ask for this, tell us - and do not use the link."),
      link,
      linkLabel: first ? "Set my password" : "Set a new password",
      firmName: settings.firm_name,
      reason: `${settings.firm_name} sent you a link for the ${row.client_name} account`,
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

  // -------------------------------------------------------------------------
  // Discounts
  // -------------------------------------------------------------------------
  //
  // Partner business throughout. A discount is the fee by another name, and the grade
  // that may change a fee is the grade that may take money off one.

  /**
   * Puts a client on a discount.
   *
   * One at a time, and the database is what holds that: a partial unique index on the
   * active row, rather than a check here that two people pressing the button at the same
   * moment could both pass. A Partner who wants different terms ends the current
   * discount and grants another, and both rows stay readable afterwards.
   */
  router.post("/api/clients/:id/discounts", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      kind?: unknown;
      value?: unknown;
      applies_to?: unknown;
      runs?: unknown;
      invoice_count?: unknown;
      until_on?: string;
      reason?: string;
    }>(request);

    const client = await env.DB.prepare(`SELECT id, name FROM clients WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string; name: string }>();
    if (!client) throw notFound("There is no such client.");

    const kind = requireEnum(body.kind, "kind", DISCOUNT_KINDS) as DiscountKind;
    const appliesTo = requireEnum(
      body.applies_to,
      "applies_to",
      DISCOUNT_SCOPES,
    ) as DiscountScope;
    const runs = requireEnum(body.runs, "runs", DISCOUNT_RUNS) as DiscountRun;
    const value = Number(body.value);
    const invoiceCount =
      runs === "count" ? Math.trunc(Number(body.invoice_count)) : null;
    const untilOn = runs === "until" ? body.until_on?.trim() || null : null;
    const now = new Date().toISOString().slice(0, 10);

    const refusal = whyNotADiscount({
      kind,
      value,
      runs,
      invoice_count: invoiceCount,
      until_on: untilOn,
      today: now,
    });
    if (refusal) throw badRequest(refusal);

    /*
     * Retires whatever has stopped applying before asking whether one is live, so a
     * client whose discount ran out last month is not told they already have one.
     */
    const existing = await activeDiscount(env, params.id);
    if (existing) {
      throw conflict(
        `${client.name} is already on a discount - ${describeDiscount(existing, (n) => String(n))}. End that one first.`,
      );
    }

    const id = newId();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO client_discounts
         (id, client_id, kind, value, applies_to, runs, invoice_count, until_on,
          reason, status, granted_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
      .bind(
        id,
        params.id,
        kind,
        value,
        appliesTo,
        runs,
        invoiceCount,
        untilOn,
        body.reason?.trim()?.slice(0, 300) || null,
        actor.id,
        timestamp,
        timestamp,
      )
      .run();

    return json({ id }, 201);
  });

  /**
   * Ends a discount early.
   *
   * The row stays, with who ended it and why. Invoices already issued keep the figures
   * they were issued with: ending a discount is a decision about what happens next, not
   * a correction to documents the client is already holding.
   */
  router.post("/api/discounts/:id/end", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ reason?: string }>(request);
    const reason = requireString(body.reason, "reason", { max: 300 });

    const result = await env.DB.prepare(
      `UPDATE client_discounts
          SET status = 'ended', ended_at = ?, ended_by = ?, ended_reason = ?, updated_at = ?
        WHERE id = ? AND status = 'active'`,
    )
      .bind(nowIso(), actor.id, reason, nowIso(), params.id)
      .run();
    if (!result.meta.changes) {
      throw notFound("There is no discount running under that reference.");
    }
    return noContent();
  });
}

// ---------------------------------------------------------------------------
// Services, what packages include, and what a client gets on top
// ---------------------------------------------------------------------------

/** A client's extras, live first, each named for the cheapest package that includes it. */
export async function readExtras(
  env: Env,
  clientId: string,
  serviceInclusions: ServiceInclusion[],
) {
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.service_id, s.name, p.name AS parent_name, e.note, e.granted_at,
            e.ended_at, e.ended_reason, g.full_name AS granted_by_name
       FROM client_service_extras e
       JOIN package_services s ON s.id = e.service_id
       LEFT JOIN package_services p ON p.id = s.parent_id
       LEFT JOIN users g ON g.id = e.granted_by
      WHERE e.client_id = ?
      ORDER BY e.ended_at IS NOT NULL, e.granted_at DESC
      LIMIT 50`,
  )
    .bind(clientId)
    .all<{
      id: string;
      service_id: string;
      name: string;
      parent_name: string | null;
      note: string | null;
      granted_at: string;
      ended_at: string | null;
      ended_reason: string | null;
      granted_by_name: string | null;
    }>();
  return results.map((row) => ({
    ...row,
    from_tier: cheapestPackageWith(row.service_id, serviceInclusions),
  }));
}

export function registerPackageServiceRoutes(router: Router<Env>): void {
  /** A new service, or a sub-service under one. */
  router.post("/api/package-services", async ({ request, env }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ name?: unknown; parent_id?: unknown }>(request);
    const name = String(body.name ?? "").trim();
    const reason = whyNotAServiceName(name);
    if (reason) throw badRequest(reason);

    const parentId = body.parent_id ? String(body.parent_id) : null;
    if (parentId) {
      const parent = await env.DB.prepare(
        `SELECT id, parent_id FROM package_services WHERE id = ? AND active = 1`,
      )
        .bind(parentId)
        .first<{ id: string; parent_id: string | null }>();
      if (!parent) throw notFound("There is no such service to put that under.");
      // One level only. A sub-sub-service is a sign the catalogue wants a new service.
      if (parent.parent_id) {
        throw badRequest("A sub-service cannot have sub-services of its own.");
      }
    }

    const last = await env.DB.prepare(
      `SELECT COALESCE(MAX(position), -1) AS position FROM package_services
        WHERE parent_id IS ?`,
    )
      .bind(parentId)
      .first<{ position: number }>();
    const id = newId();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO package_services (id, name, parent_id, position, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(id, name, parentId, (last?.position ?? -1) + 1, timestamp, timestamp)
      .run();
    return json({ id }, 201);
  });

  /**
   * The order of the lines under one heading (or of the headings themselves, with no
   * parent), as the admin dragged them. Positions are rewritten 0..n-1 in the order
   * sent; anything under the same parent that was not sent keeps its own position,
   * which only matters for a retired line that is later restored.
   */
  router.put("/api/package-services/order", async ({ request, env }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ parent_id?: unknown; ids?: unknown }>(request);
    const parentId = body.parent_id ? String(body.parent_id) : null;
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
      throw badRequest("Send the ids in the order wanted.");
    }
    const ids = [...new Set(body.ids as string[])];
    if (ids.length === 0) throw badRequest("Nothing to order.");

    const { results } = await env.DB.prepare(
      `SELECT id FROM package_services WHERE parent_id IS ?`,
    )
      .bind(parentId)
      .all<{ id: string }>();
    const siblings = new Set(results.map((r) => r.id));
    if (ids.some((id) => !siblings.has(id))) {
      throw badRequest("Those lines are not all under the same service.");
    }

    const timestamp = nowIso();
    await env.DB.batch(
      ids.map((id, position) =>
        env.DB.prepare(`UPDATE package_services SET position = ?, updated_at = ? WHERE id = ?`)
          .bind(position, timestamp, id),
      ),
    );
    return noContent();
  });

  /** Renames, reorders, or retires one. */
  router.patch("/api/package-services/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ name?: unknown; position?: unknown; active?: unknown }>(
      request,
    );
    const existing = await env.DB.prepare(`SELECT id FROM package_services WHERE id = ?`)
      .bind(params.id)
      .first();
    if (!existing) throw notFound("There is no such service.");

    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      const reason = whyNotAServiceName(name);
      if (reason) throw badRequest(reason);
      sets.push("name = ?");
      values.push(name);
    }
    if (body.position !== undefined) {
      const position = Math.trunc(Number(body.position));
      if (!Number.isInteger(position) || position < 0) {
        throw badRequest("Position must be a whole number.");
      }
      sets.push("position = ?");
      values.push(position);
    }
    if (body.active !== undefined) {
      sets.push("active = ?");
      values.push(body.active ? 1 : 0);
    }
    if (!sets.length) throw badRequest("Nothing to change.");
    values.push(nowIso(), params.id);
    await env.DB.prepare(
      `UPDATE package_services SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`,
    )
      .bind(...values)
      .run();
    return noContent();
  });

  /**
   * Removes a service outright - only while no client has ever been given it, or one
   * of its sub-services, as an extra. After that it is retired instead, so their record
   * keeps saying what they had.
   */
  router.delete("/api/package-services/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const given = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM client_service_extras e
        JOIN package_services s ON s.id = e.service_id
       WHERE s.id = ? OR s.parent_id = ?`,
    )
      .bind(params.id, params.id)
      .first<{ n: number }>();
    if ((given?.n ?? 0) > 0) {
      throw conflict(
        "A client has been given this, so it stays on their record. Retire it instead - it comes off every package and off the list of things to give.",
      );
    }
    const result = await env.DB.prepare(`DELETE FROM package_services WHERE id = ?`)
      .bind(params.id)
      .run();
    if (!result.meta.changes) throw notFound("There is no such service.");
    return noContent();
  });

  /**
   * What a package includes, replaced wholesale: the screen edits the whole matrix and
   * sends each column back.
   */
  router.put("/api/subscription-tiers/:tier/services", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const tier = requireEnum(params.tier, "tier", CLIENT_TIERS);
    const body = await readJson<{ services?: unknown }>(request);
    if (!Array.isArray(body.services)) {
      throw badRequest("Send the services as a list of { id, note }.");
    }
    // Each service once, with a short note or none: "monthly", "weekly", "full IFRS".
    const chosen = new Map<string, string | null>();
    for (const item of body.services as Array<{ id?: unknown; note?: unknown }>) {
      const id = String(item?.id ?? "").trim();
      if (!id) continue;
      const note = String(item?.note ?? "").trim().slice(0, 60) || null;
      chosen.set(id, note);
    }

    const { results } = await env.DB.prepare(
      `SELECT id FROM package_services WHERE active = 1`,
    ).all<{ id: string }>();
    const live = new Set(results.map((r) => r.id));
    if ([...chosen.keys()].some((id) => !live.has(id))) {
      throw badRequest("One of those services does not exist or has been retired.");
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM package_service_inclusions WHERE tier = ?`).bind(tier),
      ...[...chosen].map(([id, note]) =>
        env.DB.prepare(
          `INSERT INTO package_service_inclusions (tier, service_id, note) VALUES (?, ?, ?)`,
        ).bind(tier, id, note),
      ),
    ]);
    return noContent();
  });

  /** Gives a client a service from another package, on top of their own. */
  router.post("/api/clients/:id/extras", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ service_id?: unknown; note?: string }>(request);
    const serviceId = String(body.service_id ?? "").trim();
    if (!serviceId) throw badRequest("Choose the service.");

    const subscription = await loadSubscription(env, params.id);
    if (!subscription) {
      throw badRequest("Put them on a package first. An extra is on top of one.");
    }

    const catalogue = await readCatalogue(env);
    const extras = await readExtras(env, params.id, catalogue.service_inclusions);
    const reason = whyNotAnExtra({
      tier: subscription.tier,
      serviceId,
      services: catalogue.package_services,
      inclusions: catalogue.service_inclusions,
      extras: extras.filter((e) => !e.ended_at),
    });
    if (reason) throw badRequest(reason);

    const id = newId();
    await env.DB.prepare(
      `INSERT INTO client_service_extras (id, client_id, service_id, note, granted_by, granted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        params.id,
        serviceId,
        body.note?.trim()?.slice(0, 300) || null,
        actor.id,
        nowIso(),
      )
      .run();
    return json({ id }, 201);
  });

  /** Takes an extra away. It stays on the record as ended. */
  router.post("/api/extras/:id/end", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ reason?: string }>(request);
    const result = await env.DB.prepare(
      `UPDATE client_service_extras
          SET ended_at = ?, ended_by = ?, ended_reason = ?
        WHERE id = ? AND ended_at IS NULL`,
    )
      .bind(nowIso(), actor.id, body.reason?.trim()?.slice(0, 300) || null, params.id)
      .run();
    if (!result.meta.changes) throw notFound("There is no such live extra.");
    return noContent();
  });
}

/**
 * Tells everyone who signs in for a client that there is a quote waiting for them.
 *
 * Proposed by the firm, or quoted in answer to something they asked for - either way
 * the next move is theirs, and a quote that sits in a portal nobody has opened is not
 * a quote anybody can accept. After the response, never able to fail it, and to every
 * active login on the account rather than one person: a business, not an inbox.
 */
function notifyClientOfQuote(
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
  clientId: string,
  quote: { name: string; fee: number; currency: string; note: string | null; proposed: boolean },
): void {
  waitUntil(
    (async () => {
      const [settings, { results: people }] = await Promise.all([
        readSettings(env),
        env.DB.prepare(
          `SELECT email, full_name FROM client_users WHERE client_id = ? AND status = 'active'`,
        )
          .bind(clientId)
          .all<{ email: string; full_name: string }>(),
      ]);
      const amount = formatAmount(quote.fee, currencyOf(quote.currency));
      const base = (env.PORTAL_URL ?? "").trim().replace(/\/+$/, "");
      for (const person of people) {
        await sendToPerson(env, {
          to: person,
          subject: `${quote.name} - a quote from ${settings.firm_name}`,
          headline: quote.proposed
            ? `${settings.firm_name} has proposed ${quote.name} for ${amount}.`
            : `${settings.firm_name} has quoted ${amount} for ${quote.name}.`,
          detail:
            (quote.note ? `${quote.note}\n\n` : "") +
            "Nothing starts until you say so. Accept it in your portal and we will begin; decline it and nothing is charged.",
          link: `${base}/client`,
          linkLabel: "Review the quote",
          firmName: settings.firm_name,
          reason: `you sign in to ${settings.firm_name}'s portal for your business`,
        });
      }
    })().catch((err) => console.error("Quote email failed:", err)),
  );
}
