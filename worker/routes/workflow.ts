/**
 * The single write path for deliverable status changes.
 *
 * Every transition is authorised by `shared/workflow.can()` - the same function
 * the UI uses to decide which buttons to render - and then applied together
 * with its audit event and notifications in one D1 batch.
 */

import type { Env } from "../env";
import { requireUser, type AuthenticatedUser } from "../auth";
import {
  eventStatement,
  newId,
  nextRef,
  notifyMany,
  nowIso,
  optionalString,
  requireEnum,
} from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import {
  STATUS_LABELS,
  WORKFLOW_ACTIONS,
  can,
  findTransition,
  type GateContext,
  type TaskStatus,
  type WorkflowAction,
} from "../../shared/workflow";
import {
  RECURRENCE_MONTHS,
  addMonths,
  advancePeriodLabel,
  periodLabel,
} from "../dates";
import { loadTaskSummary } from "./tasks";

interface WorkflowRow {
  id: string;
  ref: string;
  title: string;
  client_id: string;
  status: TaskStatus;
  assignee_id: string | null;
  reviewer_id: string | null;
  review_round: number;
  recurrence: keyof typeof RECURRENCE_MONTHS;
  template_id: string | null;
  engagement_id: string | null;
  service_line: string;
  task_type: string | null;
  priority: string;
  budget_hours: number | null;
  period_label: string | null;
  period_end: string | null;
  planned_start_date: string | null;
  internal_due_date: string | null;
  statutory_due_date: string | null;
  description: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
}

export function registerWorkflowRoutes(router: Router<Env>): void {
  router.post("/api/tasks/:id/transition", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const body = await readJson<{ action?: string; note?: string }>(request);
    const action = requireEnum(body.action, "action", WORKFLOW_ACTIONS);
    const note = optionalString(body.note, "note", 4000);

    const task = await env.DB.prepare(
      `SELECT id, ref, title, client_id, status, assignee_id, reviewer_id, review_round,
              recurrence, template_id, engagement_id, service_line, task_type, priority,
              budget_hours, period_label, planned_start_date, internal_due_date,
              statutory_due_date, description, submitted_by, submitted_at, period_end
         FROM tasks WHERE id = ?`,
    )
      .bind(params.id)
      .first<WorkflowRow>();
    if (!task) throw notFound("That deliverable does not exist.");

    const gates = await loadGates(env, task.id);
    const decision = can(action, task, actor, gates);
    if (!decision.allowed) throw forbidden(decision.reason);

    const rule = findTransition(action, task.status);
    // `can` already proved a rule exists for this status; this keeps TS happy.
    if (!rule) throw badRequest("That action is not available.");

    if (rule.requiresNote && !note) {
      throw badRequest(`A note explaining this step is required.`);
    }

    const timestamp = nowIso();
    const statements: D1PreparedStatement[] = [];
    const recipients: Array<string | null> = [];
    let notificationTitle = `${task.ref} - ${rule.label.toLowerCase()}`;

    // Columns updated in addition to status/updated_at, per action.
    const extra: Record<string, unknown> = {};

    switch (action) {
      case "activate":
        recipients.push(task.assignee_id, task.reviewer_id);
        notificationTitle = `${task.ref} released to you`;
        break;

      case "submit":
      case "resubmit": {
        extra.submitted_at = timestamp;
        extra.submitted_by = actor.id;
        extra.review_round = task.review_round + 1;
        // With no named reviewer the submission sits in the open review queue,
        // so the client's manager and partner are told instead.
        const fallback = task.reviewer_id
          ? [task.reviewer_id]
          : await clientSupervisors(env, task.client_id);
        recipients.push(...fallback);
        notificationTitle =
          action === "resubmit"
            ? `${task.ref} resubmitted for your review`
            : `${task.ref} submitted for your review`;
        break;
      }

      case "recall":
        recipients.push(task.reviewer_id);
        notificationTitle = `${task.ref} submission withdrawn`;
        break;

      case "begin_review": {
        // Open the review round record and adopt the reviewer if none was named.
        if (!task.reviewer_id) extra.reviewer_id = actor.id;
        statements.push(
          env.DB.prepare(
            `INSERT INTO task_reviews (id, task_id, round, reviewer_id, submitted_by,
                                       submitted_at, started_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (task_id, round) DO UPDATE
               SET reviewer_id = excluded.reviewer_id,
                   started_at  = excluded.started_at,
                   decision    = NULL,
                   decided_at  = NULL`,
          ).bind(
            newId(),
            task.id,
            task.review_round,
            actor.id,
            task.submitted_by,
            task.submitted_at,
            timestamp,
          ),
        );
        recipients.push(task.assignee_id);
        notificationTitle = `${task.ref} review started`;
        break;
      }

      case "request_rework": {
        // A rework instruction without review points gives the preparer nothing
        // to act on, so at least one point in this round is required.
        const raised = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM review_points WHERE task_id = ? AND round = ?`,
        )
          .bind(task.id, task.review_round)
          .first<{ n: number }>();
        if ((raised?.n ?? 0) === 0) {
          throw badRequest(
            "Raise at least one review point before returning this deliverable for rework.",
          );
        }
        statements.push(closeRound(env, task, "rework", note, timestamp));
        recipients.push(task.assignee_id);
        notificationTitle = `${task.ref} returned for rework`;
        break;
      }

      case "approve":
        extra.approved_at = timestamp;
        statements.push(closeRound(env, task, "approved", note, timestamp));
        recipients.push(task.assignee_id, ...(await clientSupervisors(env, task.client_id)));
        notificationTitle = `${task.ref} approved`;
        break;

      case "close":
        extra.closed_at = timestamp;
        recipients.push(task.assignee_id, task.reviewer_id);
        notificationTitle = `${task.ref} closed`;
        break;

      case "reopen":
        extra.approved_at = null;
        extra.closed_at = null;
        recipients.push(task.assignee_id, task.reviewer_id);
        notificationTitle = `${task.ref} reopened`;
        break;

      case "cancel":
        recipients.push(task.assignee_id, task.reviewer_id);
        notificationTitle = `${task.ref} cancelled`;
        break;

      case "start":
      case "await_client":
      case "hold":
      case "resume":
        recipients.push(task.reviewer_id);
        break;
    }

    // Build the task UPDATE from the fixed set of columns this module owns.
    const columns = ["status = ?", "updated_at = ?"];
    const binds: unknown[] = [rule.to, timestamp];
    for (const [column, value] of Object.entries(extra)) {
      columns.push(`${column} = ?`);
      binds.push(value);
    }
    binds.push(task.id);

    statements.unshift(
      env.DB.prepare(`UPDATE tasks SET ${columns.join(", ")} WHERE id = ?`).bind(
        ...binds,
      ),
    );

    statements.push(
      eventStatement(env, {
        taskId: task.id,
        actorId: actor.id,
        kind: `workflow:${action}`,
        fromStatus: task.status,
        toStatus: rule.to,
        detail: note,
      }),
      ...notifyMany(env, recipients, actor.id, {
        taskId: task.id,
        kind: `workflow:${action}`,
        title: notificationTitle,
        body: note ?? task.title,
      }),
    );

    await env.DB.batch(statements);

    // Closing a recurring job rolls the next period forward automatically.
    let nextOccurrence: string | null = null;
    if (action === "close" && RECURRENCE_MONTHS[task.recurrence] > 0) {
      nextOccurrence = await createNextOccurrence(env, task, actor);
    }

    return json({
      task: await loadTaskSummary(env, task.id),
      next_occurrence_id: nextOccurrence,
    });
  });
}

/** Counts that feed the checklist and review-point gates in `can()`. */
export async function loadGates(env: Env, taskId: string): Promise<GateContext> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM task_checklist_items
         WHERE task_id = ? AND mandatory = 1 AND is_done = 0) AS mandatory_outstanding,
       (SELECT COUNT(*) FROM review_points
         WHERE task_id = ? AND severity = 'must_fix' AND status = 'open') AS unanswered,
       (SELECT COUNT(*) FROM review_points
         WHERE task_id = ? AND severity = 'must_fix'
           AND status NOT IN ('resolved','waived')) AS unresolved`,
  )
    .bind(taskId, taskId, taskId)
    .first<{
      mandatory_outstanding: number;
      unanswered: number;
      unresolved: number;
    }>();

  return {
    checklist: { mandatoryOutstanding: row?.mandatory_outstanding ?? 0 },
    review: {
      unansweredMustFix: row?.unanswered ?? 0,
      unresolvedMustFix: row?.unresolved ?? 0,
    },
  };
}

function closeRound(
  env: Env,
  task: WorkflowRow,
  decision: "approved" | "rework",
  summary: string | null,
  timestamp: string,
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE task_reviews
        SET decision = ?, decided_at = ?, summary = ?
      WHERE task_id = ? AND round = ?`,
  ).bind(decision, timestamp, summary, task.id, task.review_round);
}

/** The client's manager and engagement partner, used as a review fallback. */
async function clientSupervisors(env: Env, clientId: string): Promise<string[]> {
  const row = await env.DB.prepare(
    `SELECT partner_id, manager_id FROM clients WHERE id = ?`,
  )
    .bind(clientId)
    .first<{ partner_id: string | null; manager_id: string | null }>();
  return [row?.manager_id, row?.partner_id].filter((id): id is string => !!id);
}

/**
 * Creates the next period of a recurring deliverable when the current one
 * closes, rolling every date forward by the recurrence interval and copying the
 * checklist so the standard procedures are already in place.
 */
async function createNextOccurrence(
  env: Env,
  task: WorkflowRow,
  actor: AuthenticatedUser,
): Promise<string | null> {
  const months = RECURRENCE_MONTHS[task.recurrence];
  if (!months) return null;

  const roll = (date: string | null) => (date ? addMonths(date, months) : null);
  const nextStatutory = roll(task.statutory_due_date);
  const nextInternal = roll(task.internal_due_date);
  const nextPeriodEnd = roll(task.period_end);
  if (!nextStatutory && !nextInternal) {
    // Without any date to roll forward there is nothing meaningful to schedule.
    return null;
  }

  /*
   * The label names the period being reported on, which is not the same as the
   * filing deadline - a March VAT return is filed in April. So prefer the stored
   * period end, fall back to advancing the existing label, and only as a last
   * resort derive it from the rolled deadline.
   */
  const label =
    (nextPeriodEnd && periodLabel(nextPeriodEnd, task.recurrence)) ||
    (task.period_label && advancePeriodLabel(task.period_label, task.recurrence)) ||
    periodLabel(nextStatutory ?? nextInternal!, task.recurrence);

  // Never create the same period twice - closing and reopening must be safe.
  const clash = await env.DB.prepare(
    `SELECT id FROM tasks
      WHERE client_id = ? AND title = ? AND period_label = ? AND recurrence = ?`,
  )
    .bind(task.client_id, task.title, label, task.recurrence)
    .first<{ id: string }>();
  if (clash) return clash.id;

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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_started', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      ref,
      task.client_id,
      task.engagement_id,
      task.title,
      task.description,
      task.service_line,
      task.task_type,
      task.priority,
      task.assignee_id,
      task.reviewer_id,
      label,
      nextPeriodEnd,
      roll(task.planned_start_date),
      nextInternal,
      nextStatutory,
      task.budget_hours,
      task.recurrence,
      task.template_id,
      actor.id,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO task_checklist_items (id, task_id, position, label, mandatory, is_done)
       SELECT lower(hex(randomblob(16))), ?, position, label, mandatory, 0
         FROM task_checklist_items WHERE task_id = ?`,
    ).bind(id, task.id),
    eventStatement(env, {
      taskId: id,
      actorId: actor.id,
      kind: "created:recurring",
      toStatus: "not_started",
      detail: `Generated automatically on closure of ${task.ref} (${label})`,
    }),
    eventStatement(env, {
      taskId: task.id,
      actorId: actor.id,
      kind: "recurrence:generated",
      detail: `Next period created as ${ref} (${label})`,
    }),
    ...notifyMany(env, [task.assignee_id], actor.id, {
      taskId: id,
      kind: "assigned",
      title: `${ref} - ${label} is now open`,
      body: task.title,
    }),
  ];

  await env.DB.batch(statements);
  return id;
}

/** Exposed for the UI so it can explain a blocked action consistently. */
export function statusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status];
}

export type { WorkflowAction };
