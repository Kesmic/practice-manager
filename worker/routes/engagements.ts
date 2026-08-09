import type { Env } from "../env";
import { requireRole, requireUser } from "../auth";
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
import {
  ENGAGEMENT_STATUSES,
  MIN_SUPERVISOR_ROLE,
  SERVICE_LINES,
} from "../../shared/workflow";

export function registerEngagementRoutes(router: Router<Env>): void {
  router.get("/api/engagements", async ({ request, env, url }) => {
    await requireUser(env, request);

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
      filters.push(`e.service_line = ?`);
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
      .all();

    return json({ engagements: results });
  });

  router.post("/api/engagements", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<Record<string, unknown>>(request);

    const clientId = requireString(body.client_id, "client_id", { max: 64 });
    await assertExists(env, "clients", clientId, "The selected client");

    const name = requireString(body.name, "name", { max: 200 });
    const serviceLine = requireEnum(body.service_line, "service_line", SERVICE_LINES);
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

    const engagement = await env.DB.prepare(`SELECT * FROM engagements WHERE id = ?`)
      .bind(id)
      .first();
    return json({ engagement }, 201);
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

    const changes: Record<string, unknown> = {
      name:
        body.name === undefined
          ? undefined
          : requireString(body.name, "name", { max: 200 }),
      service_line:
        body.service_line === undefined
          ? undefined
          : requireEnum(body.service_line, "service_line", SERVICE_LINES),
    };
    for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
      if (body[key] !== undefined) changes[key] = fields[key];
    }

    const update = buildUpdate("engagements", changes, { id: params.id });
    if (!update) throw badRequest("No changes supplied.");
    await env.DB.prepare(update.sql)
      .bind(...update.binds)
      .run();

    const engagement = await env.DB.prepare(`SELECT * FROM engagements WHERE id = ?`)
      .bind(params.id)
      .first();
    return json({ engagement });
  });
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
