import type { Env } from "../env";
import { requireRole } from "../auth";
import {
  assertExists,
  buildUpdate,
  newId,
  nextRef,
  nowIso,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalNumber,
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, json, notFound, readJson } from "../http";
import { requireArea } from "./settings";
import {
  ENGAGEMENT_STATUSES,
  MIN_SUPERVISOR_ROLE,
  SERVICE_LINES,
  type ServiceLine,
} from "../../shared/workflow";

export function registerEngagementRoutes(router: Router<Env>): void {
  router.get("/api/engagements", async ({ request, env, url }) => {
    await requireArea(env, request, "engagements");

    const filters: string[] = [];
    const binds: unknown[] = [];

    const clientId = url.searchParams.get("client_id");
    if (clientId) {
      filters.push(`e.client_id = ?`);
      binds.push(clientId);
    }
    const status = url.searchParams.get("status");
    if (status) {
      filters.push(`e.status = ?`);
      binds.push(requireEnum(status, "status", ENGAGEMENT_STATUSES));
    }
    const serviceLine = url.searchParams.get("service_line");
    if (serviceLine) {
      // Matches an engagement that covers this line at all, not only one filed under it
      // as its primary. Filtering on the column instead would hide a subscription
      // engagement from the payroll filter because it happens to be filed under tax.
      filters.push(
        `EXISTS (SELECT 1 FROM engagement_service_lines esl
                  WHERE esl.engagement_id = e.id AND esl.service_line = ?)`,
      );
      binds.push(requireEnum(serviceLine, "service_line", SERVICE_LINES));
    }
    const q = url.searchParams.get("q")?.trim();
    if (q) {
      filters.push(`(e.name LIKE ? OR e.code LIKE ? OR c.name LIKE ?)`);
      const like = `%${q}%`;
      binds.push(like, like, like);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { results } = await env.DB.prepare(
      `SELECT e.*,
              c.name AS client_name,
              c.code AS client_code,
              up.full_name AS partner_name,
              um.full_name AS manager_name,
              (SELECT COUNT(*) FROM tasks t WHERE t.engagement_id = e.id) AS total_tasks,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.engagement_id = e.id
                  AND t.status NOT IN ('closed','cancelled')) AS open_tasks,
              (SELECT COALESCE(SUM(te.hours), 0)
                 FROM time_entries te
                 JOIN tasks t ON t.id = te.task_id
                WHERE t.engagement_id = e.id) AS logged_hours
         FROM engagements e
         JOIN clients c ON c.id = e.client_id
         LEFT JOIN users up ON up.id = e.partner_id
         LEFT JOIN users um ON um.id = e.manager_id
         ${where}
         ORDER BY c.name, e.period_end DESC, e.name`,
    )
      .bind(...binds)
      .all<{ id: string; service_line: string }>();

    return json({ engagements: await attachServiceLines(env, results) });
  });

  router.post("/api/engagements", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<Record<string, unknown>>(request);

    const clientId = requireString(body.client_id, "client_id", { max: 64 });
    await assertExists(env, "clients", clientId, "The selected client");

    const name = requireString(body.name, "name", { max: 200 });
    const serviceLines = readServiceLines(body);
    if (!serviceLines) {
      throw badRequest("Choose at least one service line for this engagement.");
    }
    const serviceLine = serviceLines[0];
    const fields = await readEngagementFields(env, body);
    assertPeriodOrder(fields.period_start, fields.period_end);

    const code = await nextRef(env, "engagement", "ENG", 4);
    const id = newId();
    const timestamp = nowIso();

    await env.DB.prepare(
      `INSERT INTO engagements (id, client_id, code, name, service_line, period_label,
                                period_start, period_end, fee_amount, currency, budget_hours,
                                status, partner_id, manager_id, engagement_letter_ref, notes,
                                created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        clientId,
        code,
        name,
        serviceLine,
        fields.period_label,
        fields.period_start,
        fields.period_end,
        fields.fee_amount,
        fields.currency ?? "GHS",
        fields.budget_hours,
        fields.status ?? "planned",
        fields.partner_id,
        fields.manager_id,
        fields.engagement_letter_ref,
        fields.notes,
        actor.id,
        timestamp,
        timestamp,
      )
      .run();

    await env.DB.batch(writeServiceLines(env, id, serviceLines));

    return json({ engagement: await loadEngagement(env, id) }, 201);
  });

  router.patch("/api/engagements/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const existing = await env.DB.prepare(
      `SELECT id, period_start, period_end FROM engagements WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; period_start: string | null; period_end: string | null }>();
    if (!existing) throw notFound("That engagement does not exist.");

    const body = await readJson<Record<string, unknown>>(request);
    const fields = await readEngagementFields(env, body);

    assertPeriodOrder(
      body.period_start === undefined ? existing.period_start : fields.period_start,
      body.period_end === undefined ? existing.period_end : fields.period_end,
    );

    const serviceLines = readServiceLines(body);
    const changes: Record<string, unknown> = {
      name:
        body.name === undefined
          ? undefined
          : requireString(body.name, "name", { max: 200 }),
      // The primary follows the list, so the column and the join table cannot disagree.
      service_line: serviceLines?.[0],
    };
    for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
      if (body[key] !== undefined) changes[key] = fields[key];
    }

    const update = buildUpdate("engagements", changes, { id: params.id });
    if (!update && !serviceLines) throw badRequest("No changes supplied.");

    // One batch, so an engagement can never be left filed under a primary line that its
    // own list of lines does not contain.
    await env.DB.batch([
      ...(update ? [env.DB.prepare(update.sql).bind(...update.binds)] : []),
      ...(serviceLines ? writeServiceLines(env, params.id, serviceLines) : []),
    ]);

    return json({ engagement: await loadEngagement(env, params.id) });
  });
}

/** One engagement with its service lines, as every write path returns it. */
async function loadEngagement(env: Env, id: string) {
  const row = await env.DB.prepare(`SELECT * FROM engagements WHERE id = ?`)
    .bind(id)
    .first<{ id: string; service_line: string }>();
  if (!row) throw notFound("That engagement does not exist.");
  return (await attachServiceLines(env, [row]))[0];
}

/**
 * The service lines an engagement covers, read from the request.
 *
 * Accepts `service_lines` (the list) and falls back to `service_line` (one value), so a
 * caller written against the older shape keeps working and a client that has not been
 * updated does not start failing validation the moment this deploys.
 *
 * The first entry is the primary: it is what goes in `engagements.service_line`, which
 * is the column the list is ordered and reported on. Duplicates are dropped rather than
 * rejected - picking the same line twice is a slip, not something worth an error - and
 * order is otherwise preserved, because the form gives them back in the order shown.
 *
 * Returns null when the request says nothing about service lines at all, which on a
 * PATCH means "leave them alone".
 */
export function readServiceLines(body: Record<string, unknown>): ServiceLine[] | null {
  const raw = body.service_lines ?? (body.service_line === undefined ? undefined : [body.service_line]);
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) throw badRequest('"service_lines" must be a list.');
  if (raw.length === 0) {
    throw badRequest("Choose at least one service line for this engagement.");
  }
  if (raw.length > SERVICE_LINES.length) {
    throw badRequest("That is more service lines than the firm has.");
  }
  const seen = new Set<ServiceLine>();
  for (const value of raw) {
    seen.add(requireEnum(value, "service_lines", SERVICE_LINES));
  }
  return [...seen];
}

/** Replaces an engagement's service lines. The primary keeps position 0. */
function writeServiceLines(
  env: Env,
  engagementId: string,
  lines: ServiceLine[],
): D1PreparedStatement[] {
  return [
    env.DB.prepare(`DELETE FROM engagement_service_lines WHERE engagement_id = ?`).bind(
      engagementId,
    ),
    ...lines.map((line, index) =>
      env.DB.prepare(
        `INSERT INTO engagement_service_lines (engagement_id, service_line, position)
         VALUES (?, ?, ?)`,
      ).bind(engagementId, line, index),
    ),
  ];
}

/**
 * Attaches the full service-line list to rows that carry only the primary.
 *
 * One query for the whole page rather than one per row: the list view routinely returns
 * every engagement a client has, and a query per row is how a list view becomes slow
 * without anybody noticing until there are enough clients to feel it.
 */
export async function attachServiceLines<T extends { id: string; service_line: string }>(
  env: Env,
  rows: T[],
): Promise<Array<T & { service_lines: string[] }>> {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT engagement_id, service_line
       FROM engagement_service_lines
      WHERE engagement_id IN (${placeholders})
      ORDER BY position`,
  )
    .bind(...rows.map((row) => row.id))
    .all<{ engagement_id: string; service_line: string }>();

  const byEngagement = new Map<string, string[]>();
  for (const row of results) {
    const list = byEngagement.get(row.engagement_id);
    if (list) list.push(row.service_line);
    else byEngagement.set(row.engagement_id, [row.service_line]);
  }

  // An engagement with no rows falls back to its primary. That should not happen after
  // 0013 backfilled every existing row, but a list that silently loses its only service
  // line would be a worse failure than a redundant fallback.
  return rows.map((row) => ({
    ...row,
    service_lines: byEngagement.get(row.id) ?? [row.service_line],
  }));
}

async function readEngagementFields(env: Env, body: Record<string, unknown>) {
  const partner_id = optionalId(body.partner_id, "partner_id");
  const manager_id = optionalId(body.manager_id, "manager_id");
  await assertExists(env, "users", partner_id, "The selected engagement partner");
  await assertExists(env, "users", manager_id, "The selected manager");

  return {
    period_label: optionalString(body.period_label, "period_label", 40),
    period_start: optionalDate(body.period_start, "period_start"),
    period_end: optionalDate(body.period_end, "period_end"),
    fee_amount: optionalNumber(body.fee_amount, "fee_amount", { max: 1_000_000_000 }),
    currency:
      body.currency === undefined
        ? null
        : requireString(body.currency, "currency", { max: 3, min: 3 }).toUpperCase(),
    budget_hours: optionalNumber(body.budget_hours, "budget_hours", { max: 100_000 }),
    status: optionalEnum(body.status, "status", ENGAGEMENT_STATUSES),
    partner_id,
    manager_id,
    engagement_letter_ref: optionalString(
      body.engagement_letter_ref,
      "engagement_letter_ref",
      120,
    ),
    notes: optionalString(body.notes, "notes", 4000),
  };
}

function assertPeriodOrder(start: string | null, end: string | null): void {
  if (start && end && start > end) {
    throw badRequest("The period start date cannot be after the period end date.");
  }
}
