/**
 * Job templates and bulk generation.
 *
 * A template holds the standard procedures and the statutory deadline rule for
 * a recurring compliance job. Generation applies it across a set of clients and
 * one or more consecutive periods, which is how a practice lays out a filing
 * calendar at the start of a year.
 */

import type { Env } from "../env";
import { requireRole, requireUser } from "../auth";
import {
  assertExists,
  buildUpdate,
  eventStatement,
  newId,
  nextRef,
  notifyMany,
  nowIso,
  optionalId,
  optionalNumber,
  optionalString,
  requireDate,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, json, notFound, readJson } from "../http";
import {
  MIN_SUPERVISOR_ROLE,
  PRIORITIES,
  RECURRENCES,
  SERVICE_LINES,
  type Priority,
  type Recurrence,
  type ServiceLine,
} from "../../shared/workflow";
import {
  RECURRENCE_MONTHS,
  addDays,
  addMonths,
  parseDueDateRule,
  periodLabel,
  statutoryDueDate,
} from "../dates";
import { assertReviewerGrade, parseTemplateChecklist } from "./tasks";

interface TemplateRow {
  id: string;
  name: string;
  service_line: ServiceLine;
  task_type: string | null;
  description: string | null;
  default_priority: Priority;
  default_recurrence: Recurrence;
  budget_hours: number | null;
  checklist: string;
  due_date_rule: string | null;
  internal_lead_days: number;
  active: 0 | 1;
}

/** Upper bound on one generation call, to keep a mistyped form from flooding. */
const MAX_GENERATED = 400;

export function registerTemplateRoutes(router: Router<Env>): void {
  router.get("/api/templates", async ({ request, env, url }) => {
    await requireUser(env, request);
    const includeInactive = url.searchParams.get("include_inactive") === "1";

    const { results } = await env.DB.prepare(
      `SELECT * FROM task_templates
        ${includeInactive ? "" : "WHERE active = 1"}
        ORDER BY service_line, name`,
    ).all<TemplateRow>();

    return json({ templates: results.map(toWire) });
  });

  router.post("/api/templates", async ({ request, env }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<Record<string, unknown>>(request);

    const id = newId();
    const timestamp = nowIso();
    const fields = readTemplateFields(body, true);

    await env.DB.prepare(
      `INSERT INTO task_templates (id, name, service_line, task_type, description,
                                   default_priority, default_recurrence, budget_hours,
                                   checklist, due_date_rule, internal_lead_days, active,
                                   created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        id,
        fields.name,
        fields.service_line,
        fields.task_type,
        fields.description,
        fields.default_priority ?? "normal",
        fields.default_recurrence ?? "none",
        fields.budget_hours,
        fields.checklist ?? "[]",
        // Nullable in the schema, and genuinely optional: an internal job has no
        // statutory filing deadline. Without the coalesce, omitting it binds
        // undefined and D1 rejects the whole insert.
        fields.due_date_rule ?? null,
        fields.internal_lead_days ?? 5,
        timestamp,
        timestamp,
      )
      .run();

    const template = await env.DB.prepare(`SELECT * FROM task_templates WHERE id = ?`)
      .bind(id)
      .first<TemplateRow>();
    return json({ template: template && toWire(template) }, 201);
  });

  router.patch("/api/templates/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const existing = await env.DB.prepare(`SELECT id FROM task_templates WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!existing) throw notFound("That template does not exist.");

    const body = await readJson<Record<string, unknown>>(request);
    const fields = readTemplateFields(body, false);

    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
      if (body[key] !== undefined) changes[key] = fields[key];
    }
    if (body.active !== undefined) changes.active = body.active === true ? 1 : 0;

    const update = buildUpdate("task_templates", changes, { id: params.id });
    if (!update) throw badRequest("No changes supplied.");
    await env.DB.prepare(update.sql)
      .bind(...update.binds)
      .run();

    const template = await env.DB.prepare(`SELECT * FROM task_templates WHERE id = ?`)
      .bind(params.id)
      .first<TemplateRow>();
    return json({ template: template && toWire(template) });
  });

  /**
   * Generates deliverables from a template for the given clients and periods.
   * Idempotent per (client, title, period): re-running will not duplicate a job
   * that already exists, so a partly-failed run can simply be repeated.
   */
  router.post("/api/templates/:id/generate", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const template = await env.DB.prepare(`SELECT * FROM task_templates WHERE id = ?`)
      .bind(params.id)
      .first<TemplateRow>();
    if (!template) throw notFound("That template does not exist.");

    const body = await readJson<Record<string, unknown>>(request);

    const clientIds = Array.isArray(body.client_ids)
      ? [...new Set(body.client_ids.map((v) => String(v)))]
      : [];
    if (!clientIds.length) throw badRequest("Select at least one client.");

    const firstPeriodEnd = requireDate(body.period_end, "period_end");
    const periods = Math.min(
      Math.max(Number.parseInt(String(body.periods ?? 1), 10) || 1, 1),
      24,
    );

    const recurrence =
      (body.recurrence
        ? requireEnum(body.recurrence, "recurrence", RECURRENCES)
        : template.default_recurrence) ?? "none";
    const step = RECURRENCE_MONTHS[recurrence];
    if (periods > 1 && step === 0) {
      throw badRequest(
        "Multiple periods can only be generated for a recurring template. Set a recurrence first.",
      );
    }

    if (clientIds.length * periods > MAX_GENERATED) {
      throw badRequest(
        `That would create ${clientIds.length * periods} deliverables. ` +
          `Please generate at most ${MAX_GENERATED} at a time.`,
      );
    }

    const assigneeId = optionalId(body.assignee_id, "assignee_id");
    const reviewerId = optionalId(body.reviewer_id, "reviewer_id");
    await assertExists(env, "users", assigneeId, "The selected assignee");
    if (reviewerId) await assertReviewerGrade(env, reviewerId);
    if (assigneeId && reviewerId && assigneeId === reviewerId) {
      throw badRequest(
        "The reviewer must be a different person from the assigned associate.",
      );
    }

    // Verify every client up front so we do not half-generate on a bad id.
    const clients = await loadClients(env, clientIds);
    const missing = clientIds.filter((id) => !clients.has(id));
    if (missing.length) {
      throw badRequest(`${missing.length} of the selected clients no longer exist.`);
    }

    const rule = parseDueDateRule(template.due_date_rule);
    const checklist = parseTemplateChecklist(template.checklist);
    const timestamp = nowIso();

    const created: Array<{ id: string; ref: string; client: string; period: string }> = [];
    const skipped: Array<{ client: string; period: string }> = [];

    for (let index = 0; index < periods; index++) {
      const periodEnd = step === 0 ? firstPeriodEnd : addMonths(firstPeriodEnd, step * index);
      const label = periodLabel(periodEnd, recurrence === "none" ? "monthly" : recurrence);
      const statutory = rule ? statutoryDueDate(periodEnd, rule) : null;
      const internal = statutory
        ? addDays(statutory, -Math.abs(template.internal_lead_days))
        : null;

      for (const clientId of clientIds) {
        const clientName = clients.get(clientId)!;

        const clash = await env.DB.prepare(
          `SELECT id FROM tasks
            WHERE client_id = ? AND template_id = ? AND period_label = ?`,
        )
          .bind(clientId, template.id, label)
          .first<{ id: string }>();
        if (clash) {
          skipped.push({ client: clientName, period: label });
          continue;
        }

        const id = newId();
        const ref = await nextRef(env, "task", "TSK", 6);

        const statements: D1PreparedStatement[] = [
          env.DB.prepare(
            `INSERT INTO tasks (id, ref, client_id, title, description, service_line, task_type,
                                priority, status, review_round, assignee_id, reviewer_id,
                                period_label, period_end, internal_due_date, statutory_due_date,
                                budget_hours, recurrence, template_id, created_by, created_at,
                                updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            id,
            ref,
            clientId,
            `${template.name} — ${label}`,
            template.description,
            template.service_line,
            template.task_type,
            template.default_priority,
            assigneeId,
            reviewerId,
            label,
            periodEnd,
            internal,
            statutory,
            template.budget_hours,
            recurrence,
            template.id,
            actor.id,
            timestamp,
            timestamp,
          ),
          eventStatement(env, {
            taskId: id,
            actorId: actor.id,
            kind: "created:generated",
            toStatus: "not_started",
            detail: `Generated from template "${template.name}" for ${label}`,
          }),
        ];

        checklist.forEach((item, position) => {
          statements.push(
            env.DB.prepare(
              `INSERT INTO task_checklist_items (id, task_id, position, label, mandatory, is_done)
               VALUES (?, ?, ?, ?, ?, 0)`,
            ).bind(newId(), id, position, item.label, item.mandatory ? 1 : 0),
          );
        });

        statements.push(
          ...notifyMany(env, [assigneeId, reviewerId], actor.id, {
            taskId: id,
            kind: "assigned",
            title: `${ref} assigned to you`,
            body: `${template.name} — ${clientName} (${label})`,
          }),
        );

        await env.DB.batch(statements);
        created.push({ id, ref, client: clientName, period: label });
      }
    }

    return json({ created, skipped }, created.length ? 201 : 200);
  });
}

async function loadClients(env: Env, ids: string[]): Promise<Map<string, string>> {
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `SELECT id, name FROM clients WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<{ id: string; name: string }>();
  return new Map(results.map((row) => [row.id, row.name]));
}

function readTemplateFields(body: Record<string, unknown>, creating: boolean) {
  return {
    name: creating
      ? requireString(body.name, "name", { max: 160 })
      : body.name === undefined
        ? undefined
        : requireString(body.name, "name", { max: 160 }),
    service_line: creating
      ? requireEnum(body.service_line, "service_line", SERVICE_LINES)
      : body.service_line === undefined
        ? undefined
        : requireEnum(body.service_line, "service_line", SERVICE_LINES),
    task_type: optionalString(body.task_type, "task_type", 60),
    description: optionalString(body.description, "description", 4000),
    default_priority:
      body.default_priority === undefined
        ? undefined
        : requireEnum(body.default_priority, "default_priority", PRIORITIES),
    default_recurrence:
      body.default_recurrence === undefined
        ? undefined
        : requireEnum(body.default_recurrence, "default_recurrence", RECURRENCES),
    budget_hours: optionalNumber(body.budget_hours, "budget_hours", { max: 100_000 }),
    checklist: body.checklist === undefined ? undefined : encodeChecklist(body.checklist),
    due_date_rule:
      body.due_date_rule === undefined ? undefined : encodeDueRule(body.due_date_rule),
    internal_lead_days: optionalNumber(body.internal_lead_days, "internal_lead_days", {
      max: 365,
    }),
  };
}

function encodeChecklist(value: unknown): string {
  if (!Array.isArray(value)) throw badRequest(`"checklist" must be a list of steps.`);
  const items = value.slice(0, 100).map((raw, index) => {
    const item = raw as Record<string, unknown>;
    return {
      label: requireString(item.label, `checklist[${index}].label`, { max: 300 }),
      mandatory: item.mandatory === true,
    };
  });
  return JSON.stringify(items);
}

function encodeDueRule(value: unknown): string | null {
  if (value === null || value === "") return null;
  const rule = value as Record<string, unknown>;
  const monthOffset = Number(rule.month_offset);
  const day = Number(rule.day);
  if (!Number.isInteger(monthOffset) || monthOffset < 0 || monthOffset > 24) {
    throw badRequest(`"due_date_rule.month_offset" must be a whole number from 0 to 24.`);
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw badRequest(`"due_date_rule.day" must be a whole number from 1 to 31.`);
  }
  return JSON.stringify({ month_offset: monthOffset, day });
}

/** Decodes the JSON columns so the client receives real objects. */
function toWire(row: TemplateRow) {
  return {
    ...row,
    checklist: parseTemplateChecklist(row.checklist),
    due_date_rule: parseDueDateRule(row.due_date_rule),
  };
}
