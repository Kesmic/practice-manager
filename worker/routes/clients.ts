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
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, conflict, json, notFound, readJson } from "../http";
import {
  CLIENT_STATUSES,
  ENTITY_TYPES,
  MIN_SUPERVISOR_ROLE,
  RISK_RATINGS,
} from "../../shared/workflow";
import { OVERDUE_PREDICATE, TASK_SELECT } from "./task-sql";

export function registerClientRoutes(router: Router<Env>): void {
  router.get("/api/clients", async ({ request, env, url }) => {
    await requireUser(env, request);

    const filters: string[] = [];
    const binds: unknown[] = [];

    const q = url.searchParams.get("q")?.trim();
    if (q) {
      filters.push(`(c.name LIKE ? OR c.code LIKE ? OR c.tax_id LIKE ?)`);
      const like = `%${q}%`;
      binds.push(like, like, like);
    }
    const status = url.searchParams.get("status");
    if (status) {
      filters.push(`c.status = ?`);
      binds.push(requireEnum(status, "status", CLIENT_STATUSES));
    }
    const partnerId = url.searchParams.get("partner_id");
    if (partnerId) {
      filters.push(`c.partner_id = ?`);
      binds.push(partnerId);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { results } = await env.DB.prepare(
      `SELECT c.*,
              up.full_name AS partner_name,
              um.full_name AS manager_name,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.client_id = c.id
                  AND t.status NOT IN ('closed','cancelled')) AS open_tasks,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.client_id = c.id AND ${OVERDUE_PREDICATE}) AS overdue_tasks,
              (SELECT COUNT(*) FROM engagements e WHERE e.client_id = c.id) AS engagements
         FROM clients c
         LEFT JOIN users up ON up.id = c.partner_id
         LEFT JOIN users um ON um.id = c.manager_id
         ${where}
         ORDER BY c.name`,
    )
      .bind(...binds)
      .all();

    return json({ clients: results });
  });

  router.get("/api/clients/:id", async ({ request, env, params }) => {
    await requireUser(env, request);

    const client = await env.DB.prepare(
      `SELECT c.*, up.full_name AS partner_name, um.full_name AS manager_name
         FROM clients c
         LEFT JOIN users up ON up.id = c.partner_id
         LEFT JOIN users um ON um.id = c.manager_id
        WHERE c.id = ?`,
    )
      .bind(params.id)
      .first();
    if (!client) throw notFound("That client does not exist.");

    const engagements = await env.DB.prepare(
      `SELECT e.*,
              up.full_name AS partner_name,
              um.full_name AS manager_name,
              (SELECT COUNT(*) FROM tasks t WHERE t.engagement_id = e.id) AS total_tasks,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.engagement_id = e.id
                  AND t.status NOT IN ('closed','cancelled')) AS open_tasks
         FROM engagements e
         LEFT JOIN users up ON up.id = e.partner_id
         LEFT JOIN users um ON um.id = e.manager_id
        WHERE e.client_id = ?
        ORDER BY e.period_end DESC, e.name`,
    )
      .bind(params.id)
      .all();

    const tasks = await env.DB.prepare(
      `${TASK_SELECT}
        WHERE t.client_id = ?
        ORDER BY
          CASE WHEN t.status IN ('closed','cancelled') THEN 1 ELSE 0 END,
          COALESCE(t.internal_due_date, t.statutory_due_date) IS NULL,
          COALESCE(t.internal_due_date, t.statutory_due_date)
        LIMIT 200`,
    )
      .bind(params.id)
      .all();

    return json({
      client,
      engagements: engagements.results,
      tasks: tasks.results,
    });
  });

  router.post("/api/clients", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<Record<string, unknown>>(request);

    const name = requireString(body.name, "name", { max: 200 });
    const fields = await readClientFields(env, body);

    // An explicit code is honoured if supplied and free; otherwise generated.
    let code: string;
    if (body.code) {
      code = requireString(body.code, "code", { max: 24 }).toUpperCase();
      const clash = await env.DB.prepare(`SELECT id FROM clients WHERE code = ?`)
        .bind(code)
        .first<{ id: string }>();
      if (clash) throw conflict(`Client code "${code}" is already in use.`);
    } else {
      code = await nextRef(env, "client", "CLI", 4);
    }

    const id = newId();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO clients (id, code, name, entity_type, tax_id, registration_no, industry,
                            fiscal_year_end, contact_name, contact_email, contact_phone,
                            address, risk_rating, status, partner_id, manager_id,
                            onboarded_on, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        code,
        name,
        fields.entity_type ?? "company",
        fields.tax_id,
        fields.registration_no,
        fields.industry,
        fields.fiscal_year_end,
        fields.contact_name,
        fields.contact_email,
        fields.contact_phone,
        fields.address,
        fields.risk_rating ?? "medium",
        fields.status ?? "active",
        fields.partner_id,
        fields.manager_id,
        fields.onboarded_on,
        fields.notes,
        actor.id,
        timestamp,
        timestamp,
      )
      .run();

    const client = await env.DB.prepare(`SELECT * FROM clients WHERE id = ?`)
      .bind(id)
      .first();
    return json({ client }, 201);
  });

  router.patch("/api/clients/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const existing = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!existing) throw notFound("That client does not exist.");

    const body = await readJson<Record<string, unknown>>(request);
    const fields = await readClientFields(env, body);

    const update = buildUpdate(
      "clients",
      {
        name:
          body.name === undefined
            ? undefined
            : requireString(body.name, "name", { max: 200 }),
        ...passthrough(body, fields),
      },
      { id: params.id },
    );
    if (!update) throw badRequest("No changes supplied.");

    await env.DB.prepare(update.sql)
      .bind(...update.binds)
      .run();

    const client = await env.DB.prepare(`SELECT * FROM clients WHERE id = ?`)
      .bind(params.id)
      .first();
    return json({ client });
  });
}

type ClientFields = Awaited<ReturnType<typeof readClientFields>>;

/** Parses and validates the optional client fields present in `body`. */
async function readClientFields(env: Env, body: Record<string, unknown>) {
  const partner_id = optionalId(body.partner_id, "partner_id");
  const manager_id = optionalId(body.manager_id, "manager_id");
  await assertExists(env, "users", partner_id, "The selected engagement partner");
  await assertExists(env, "users", manager_id, "The selected manager");

  return {
    entity_type: optionalEnum(body.entity_type, "entity_type", ENTITY_TYPES),
    tax_id: optionalString(body.tax_id, "tax_id", 64),
    registration_no: optionalString(body.registration_no, "registration_no", 64),
    industry: optionalString(body.industry, "industry", 120),
    fiscal_year_end: readFiscalYearEnd(body.fiscal_year_end),
    contact_name: optionalString(body.contact_name, "contact_name", 120),
    contact_email: optionalString(body.contact_email, "contact_email", 254),
    contact_phone: optionalString(body.contact_phone, "contact_phone", 40),
    address: optionalString(body.address, "address", 500),
    risk_rating: optionalEnum(body.risk_rating, "risk_rating", RISK_RATINGS),
    status: optionalEnum(body.status, "status", CLIENT_STATUSES),
    partner_id,
    manager_id,
    onboarded_on: optionalDate(body.onboarded_on, "onboarded_on"),
    notes: optionalString(body.notes, "notes", 4000),
  };
}

/**
 * Only forwards parsed fields the caller actually sent, so a PATCH never blanks
 * a column the client omitted.
 */
function passthrough(
  body: Record<string, unknown>,
  fields: ClientFields,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields) as Array<keyof ClientFields>) {
    if (body[key] !== undefined) out[key] = fields[key];
  }
  return out;
}

/** Fiscal year end is stored as MM-DD because the year varies by period. */
function readFiscalYearEnd(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{2}-\d{2}$/.test(text)) {
    throw badRequest(`"fiscal_year_end" must be in MM-DD format, for example 12-31.`);
  }
  const [month, day] = text.split("-").map((part) => Number.parseInt(part, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw badRequest(`"fiscal_year_end" is not a valid month and day.`);
  }
  return text;
}
