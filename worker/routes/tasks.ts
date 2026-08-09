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
  optionalDate,
  optionalEnum,
  optionalId,
  optionalNumber,
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import {
  MIN_REVIEWER_ROLE,
  MIN_SUPERVISOR_ROLE,
  PRIORITIES,
  RECURRENCES,
  ROLE_LABELS,
  ROLE_RANK,
  SERVICE_LINES,
  TASK_STATUSES,
  atLeast,
  type Role,
} from "../../shared/workflow";
import { OVERDUE_PREDICATE, TASK_ORDER, TASK_SELECT } from "./task-sql";

/** Grade required to create a deliverable at all. */
const MIN_TASK_AUTHOR: Role = "senior_associate";

export function registerTaskRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------

  router.get("/api/tasks", async ({ request, env, url }) => {
    const actor = await requireUser(env, request);
    const p = url.searchParams;

    const filters: string[] = [];
    const binds: unknown[] = [];

    const addIn = (column: string, raw: string | null, allowed: readonly string[]) => {
      if (!raw) return;
      const values = raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (!values.length) return;
      for (const value of values) requireEnum(value, column, allowed);
      filters.push(`${column} IN (${values.map(() => "?").join(", ")})`);
      binds.push(...values);
    };

    addIn("t.status", p.get("status"), TASK_STATUSES);
    addIn("t.priority", p.get("priority"), PRIORITIES);
    addIn("t.service_line", p.get("service_line"), SERVICE_LINES);

    for (const [param, column] of [
      ["client_id", "t.client_id"],
      ["engagement_id", "t.engagement_id"],
      ["assignee_id", "t.assignee_id"],
      ["reviewer_id", "t.reviewer_id"],
    ] as const) {
      const value = p.get(param);
      if (value) {
        filters.push(`${column} = ?`);
        binds.push(value);
      }
    }

    // Convenience scopes used by the sidebar counters and dashboard links.
    switch (p.get("scope")) {
      case "mine":
        filters.push(`t.assignee_id = ? AND t.status NOT IN ('closed','cancelled')`);
        binds.push(actor.id);
        break;
      case "my_reviews":
        filters.push(`t.reviewer_id = ? AND t.status IN ('submitted','under_review')`);
        binds.push(actor.id);
        break;
      case "open":
        filters.push(`t.status NOT IN ('closed','cancelled')`);
        break;
      case "overdue":
        filters.push(`(${OVERDUE_PREDICATE})`);
        break;
      case "unassigned":
        filters.push(`t.assignee_id IS NULL AND t.status NOT IN ('closed','cancelled')`);
        break;
      default:
        break;
    }

    const dueBefore = optionalDate(p.get("due_before"), "due_before");
    if (dueBefore) {
      filters.push(
        `COALESCE(t.internal_due_date, t.statutory_due_date) IS NOT NULL
         AND date(COALESCE(t.internal_due_date, t.statutory_due_date)) <= date(?)`,
      );
      binds.push(dueBefore);
    }

    const q = p.get("q")?.trim();
    if (q) {
      filters.push(`(t.title LIKE ? OR t.ref LIKE ? OR c.name LIKE ? OR c.code LIKE ?)`);
      const like = `%${q}%`;
      binds.push(like, like, like, like);
    }

    const limit = Math.min(
      Math.max(Number.parseInt(p.get("limit") ?? "200", 10) || 200, 1),
      500,
    );

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { results } = await env.DB.prepare(
      `${TASK_SELECT} ${where} ${TASK_ORDER} LIMIT ?`,
    )
      .bind(...binds, limit)
      .all();

    return json({ tasks: results });
  });

  // -------------------------------------------------------------------------
  // Detail
  // -------------------------------------------------------------------------

  router.get("/api/tasks/:id", async ({ request, env, params }) => {
    await requireUser(env, request);
    const task = await loadTaskSummary(env, params.id);

    const [checklist, reviews, points, comments, attachments, time, events] =
      await env.DB.batch([
        env.DB.prepare(
          `SELECT ci.*, u.full_name AS done_by_name
             FROM task_checklist_items ci
             LEFT JOIN users u ON u.id = ci.done_by
            WHERE ci.task_id = ?
            ORDER BY ci.position, ci.rowid`,
        ).bind(params.id),
        env.DB.prepare(
          `SELECT r.*, ur.full_name AS reviewer_name, us.full_name AS submitted_by_name
             FROM task_reviews r
             LEFT JOIN users ur ON ur.id = r.reviewer_id
             LEFT JOIN users us ON us.id = r.submitted_by
            WHERE r.task_id = ?
            ORDER BY r.round DESC`,
        ).bind(params.id),
        env.DB.prepare(
          `SELECT rp.*,
                  urb.full_name AS raised_by_name,
                  urs.full_name AS responded_by_name,
                  ucb.full_name AS closed_by_name
             FROM review_points rp
             LEFT JOIN users urb ON urb.id = rp.raised_by
             LEFT JOIN users urs ON urs.id = rp.responded_by
             LEFT JOIN users ucb ON ucb.id = rp.closed_by
            WHERE rp.task_id = ?
            ORDER BY rp.round DESC, rp.seq`,
        ).bind(params.id),
        env.DB.prepare(
          `SELECT tc.*, u.full_name AS author_name
             FROM task_comments tc
             LEFT JOIN users u ON u.id = tc.author_id
            WHERE tc.task_id = ?
            ORDER BY tc.created_at`,
        ).bind(params.id),
        env.DB.prepare(
          `SELECT a.*, u.full_name AS added_by_name
             FROM task_attachments a
             LEFT JOIN users u ON u.id = a.added_by
            WHERE a.task_id = ?
            ORDER BY a.added_at DESC`,
        ).bind(params.id),
        env.DB.prepare(
          `SELECT te.*, u.full_name AS user_name
             FROM time_entries te
             LEFT JOIN users u ON u.id = te.user_id
            WHERE te.task_id = ?
            ORDER BY te.work_date DESC, te.created_at DESC`,
        ).bind(params.id),
        env.DB.prepare(
          `SELECT ev.*, u.full_name AS actor_name
             FROM task_events ev
             LEFT JOIN users u ON u.id = ev.actor_id
            WHERE ev.task_id = ?
            ORDER BY ev.created_at DESC, ev.rowid DESC
            LIMIT 200`,
        ).bind(params.id),
      ]);

    return json({
      task,
      checklist: checklist.results,
      reviews: reviews.results,
      review_points: points.results,
      comments: comments.results,
      attachments: attachments.results,
      time_entries: time.results,
      events: events.results,
    });
  });

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  router.post("/api/tasks", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_TASK_AUTHOR);
    const body = await readJson<Record<string, unknown>>(request);

    const clientId = requireString(body.client_id, "client_id", { max: 64 });
    await assertExists(env, "clients", clientId, "The selected client");

    const title = requireString(body.title, "title", { max: 200 });
    const serviceLine = requireEnum(body.service_line, "service_line", SERVICE_LINES);
    const fields = await readTaskFields(env, body);
    await assertEngagementBelongsToClient(env, fields.engagement_id, clientId);

    // Only manager grade and above may release work directly; everyone else
    // creates a draft that a supervisor then releases.
    const isSupervisor = atLeast(actor.role, MIN_SUPERVISOR_ROLE);
    const requestedStatus = optionalEnum(body.status, "status", [
      "draft",
      "not_started",
    ] as const);
    const status = isSupervisor ? (requestedStatus ?? "not_started") : "draft";

    const id = newId();
    const ref = await nextRef(env, "task", "TSK", 6);
    const timestamp = nowIso();

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO tasks (id, ref, client_id, engagement_id, title, description, service_line,
                            task_type, priority, status, review_round, assignee_id, reviewer_id,
                            period_label, period_end, planned_start_date, internal_due_date,
                            statutory_due_date, budget_hours, recurrence, template_id, created_by,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        ref,
        clientId,
        fields.engagement_id,
        title,
        fields.description,
        serviceLine,
        fields.task_type,
        fields.priority ?? "normal",
        status,
        fields.assignee_id,
        fields.reviewer_id,
        fields.period_label,
        fields.period_end,
        fields.planned_start_date,
        fields.internal_due_date,
        fields.statutory_due_date,
        fields.budget_hours,
        fields.recurrence ?? "none",
        fields.template_id,
        actor.id,
        timestamp,
        timestamp,
      ),
      eventStatement(env, {
        taskId: id,
        actorId: actor.id,
        kind: "created",
        toStatus: status,
        detail: `${ref} — ${title}`,
      }),
    ];

    // Optional inline checklist, either supplied directly or from a template.
    const checklist = await resolveChecklist(env, body, fields.template_id);
    checklist.forEach((item, index) => {
      statements.push(
        env.DB.prepare(
          `INSERT INTO task_checklist_items (id, task_id, position, label, mandatory, is_done)
           VALUES (?, ?, ?, ?, ?, 0)`,
        ).bind(newId(), id, index, item.label, item.mandatory ? 1 : 0),
      );
    });

    if (status !== "draft") {
      statements.push(
        ...notifyMany(env, [fields.assignee_id, fields.reviewer_id], actor.id, {
          taskId: id,
          kind: "assigned",
          title: `${ref} assigned to you`,
          body: title,
        }),
      );
    }

    await env.DB.batch(statements);
    return json({ task: await loadTaskSummary(env, id) }, 201);
  });

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  router.patch("/api/tasks/:id", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const existing = await env.DB.prepare(
      `SELECT id, ref, client_id, status, assignee_id, reviewer_id FROM tasks WHERE id = ?`,
    )
      .bind(params.id)
      .first<{
        id: string;
        ref: string;
        client_id: string;
        status: string;
        assignee_id: string | null;
        reviewer_id: string | null;
      }>();
    if (!existing) throw notFound("That deliverable does not exist.");
    if (existing.status === "closed" || existing.status === "cancelled") {
      throw badRequest(
        "This deliverable is closed. Reopen it before making further changes.",
      );
    }

    const body = await readJson<Record<string, unknown>>(request);
    const fields = await readTaskFields(env, body);

    if (body.engagement_id !== undefined) {
      await assertEngagementBelongsToClient(
        env,
        fields.engagement_id,
        existing.client_id,
      );
    }

    // Segregation of duties has to hold after the edit, not just at creation.
    const nextAssignee =
      body.assignee_id === undefined ? existing.assignee_id : fields.assignee_id;
    const nextReviewer =
      body.reviewer_id === undefined ? existing.reviewer_id : fields.reviewer_id;
    if (nextAssignee && nextReviewer && nextAssignee === nextReviewer) {
      throw badRequest(
        "The reviewer must be a different person from the assigned associate.",
      );
    }

    const changes: Record<string, unknown> = {
      title:
        body.title === undefined
          ? undefined
          : requireString(body.title, "title", { max: 200 }),
      service_line:
        body.service_line === undefined
          ? undefined
          : requireEnum(body.service_line, "service_line", SERVICE_LINES),
    };
    for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
      if (body[key] !== undefined) changes[key] = fields[key];
    }

    const update = buildUpdate("tasks", changes, { id: params.id });
    if (!update) throw badRequest("No changes supplied.");

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(update.sql).bind(...update.binds),
      eventStatement(env, {
        taskId: params.id,
        actorId: actor.id,
        kind: "updated",
        detail: describeChanges(changes),
      }),
    ];

    // Tell people when they are newly put on a deliverable.
    const newlyInvolved: Array<string | null> = [];
    if (body.assignee_id !== undefined && fields.assignee_id !== existing.assignee_id) {
      newlyInvolved.push(fields.assignee_id);
    }
    if (body.reviewer_id !== undefined && fields.reviewer_id !== existing.reviewer_id) {
      newlyInvolved.push(fields.reviewer_id);
    }
    if (newlyInvolved.length) {
      statements.push(
        ...notifyMany(env, newlyInvolved, actor.id, {
          taskId: params.id,
          kind: "assigned",
          title: `${existing.ref} assigned to you`,
          body: null,
        }),
      );
    }

    await env.DB.batch(statements);
    return json({ task: await loadTaskSummary(env, params.id) });
  });
}

// ---------------------------------------------------------------------------
// Helpers shared with the workflow and review routes
// ---------------------------------------------------------------------------

export async function loadTaskSummary(env: Env, id: string) {
  const task = await env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`)
    .bind(id)
    .first();
  if (!task) throw notFound("That deliverable does not exist.");
  return task;
}

async function readTaskFields(env: Env, body: Record<string, unknown>) {
  const assignee_id = optionalId(body.assignee_id, "assignee_id");
  const reviewer_id = optionalId(body.reviewer_id, "reviewer_id");
  const engagement_id = optionalId(body.engagement_id, "engagement_id");
  const template_id = optionalId(body.template_id, "template_id");

  await assertExists(env, "users", assignee_id, "The selected assignee");
  await assertExists(env, "engagements", engagement_id, "The selected engagement");
  await assertExists(env, "task_templates", template_id, "The selected template");

  if (assignee_id && reviewer_id && assignee_id === reviewer_id) {
    throw badRequest(
      "The reviewer must be a different person from the assigned associate.",
    );
  }
  if (reviewer_id) await assertReviewerGrade(env, reviewer_id);

  const internal_due_date = optionalDate(body.internal_due_date, "internal_due_date");
  const statutory_due_date = optionalDate(body.statutory_due_date, "statutory_due_date");
  if (internal_due_date && statutory_due_date && internal_due_date > statutory_due_date) {
    throw badRequest(
      "The internal target date should fall on or before the statutory deadline.",
    );
  }

  return {
    engagement_id,
    description: optionalString(body.description, "description", 8000),
    task_type: optionalString(body.task_type, "task_type", 60),
    priority: optionalEnum(body.priority, "priority", PRIORITIES),
    assignee_id,
    reviewer_id,
    period_label: optionalString(body.period_label, "period_label", 40),
    period_end: optionalDate(body.period_end, "period_end"),
    planned_start_date: optionalDate(body.planned_start_date, "planned_start_date"),
    internal_due_date,
    statutory_due_date,
    budget_hours: optionalNumber(body.budget_hours, "budget_hours", { max: 100_000 }),
    recurrence: optionalEnum(body.recurrence, "recurrence", RECURRENCES),
    template_id,
  };
}

/** A reviewer must actually hold reviewing grade. */
export async function assertReviewerGrade(env: Env, userId: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT full_name, role, status FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{ full_name: string; role: Role; status: string }>();
  if (!row) throw badRequest("The selected reviewer does not exist.");
  if (row.status !== "active") {
    throw badRequest(`${row.full_name} is not an active user.`);
  }
  if (ROLE_RANK[row.role] < ROLE_RANK[MIN_REVIEWER_ROLE]) {
    throw badRequest(
      `${row.full_name} is a ${ROLE_LABELS[row.role]} and cannot be named as reviewer. ` +
        `Reviewers must be ${ROLE_LABELS[MIN_REVIEWER_ROLE]} grade or above.`,
    );
  }
}

async function assertEngagementBelongsToClient(
  env: Env,
  engagementId: string | null,
  clientId: string,
): Promise<void> {
  if (!engagementId) return;
  const row = await env.DB.prepare(`SELECT client_id FROM engagements WHERE id = ?`)
    .bind(engagementId)
    .first<{ client_id: string }>();
  if (!row) throw badRequest("The selected engagement does not exist.");
  if (row.client_id !== clientId) {
    throw forbidden("That engagement belongs to a different client.");
  }
}

interface ChecklistSeed {
  label: string;
  mandatory: boolean;
}

/**
 * Resolves the checklist for a new deliverable: an explicit list in the request
 * wins, otherwise the linked template's standard procedures are copied in.
 */
async function resolveChecklist(
  env: Env,
  body: Record<string, unknown>,
  templateId: string | null,
): Promise<ChecklistSeed[]> {
  if (Array.isArray(body.checklist)) {
    return body.checklist.slice(0, 100).map((raw, index) => {
      const item = raw as Record<string, unknown>;
      return {
        label: requireString(item.label, `checklist[${index}].label`, { max: 300 }),
        mandatory: item.mandatory === true,
      };
    });
  }

  if (!templateId) return [];
  const template = await env.DB.prepare(
    `SELECT checklist FROM task_templates WHERE id = ?`,
  )
    .bind(templateId)
    .first<{ checklist: string }>();
  if (!template) return [];
  return parseTemplateChecklist(template.checklist);
}

export function parseTemplateChecklist(raw: string | null): ChecklistSeed[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.label === "string")
      .slice(0, 100)
      .map((item) => ({
        label: String(item.label).slice(0, 300),
        mandatory: item.mandatory === true,
      }));
  } catch {
    // A malformed template should not block deliverable creation.
    return [];
  }
}

function describeChanges(changes: Record<string, unknown>): string {
  const touched = Object.keys(changes).filter((key) => changes[key] !== undefined);
  return touched.length ? `Changed: ${touched.join(", ")}` : "No field changes";
}
