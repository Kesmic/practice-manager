/**
 * Review points ("review notes") - the itemised findings a reviewer raises
 * against a submitted deliverable, and the preparer's responses to them.
 *
 * A point moves: open → addressed (preparer responds) → resolved or waived
 * (reviewer disposes of it). The approval gate in `shared/workflow` refuses to
 * let a deliverable be signed off while any must-fix point is undisposed.
 */

import type { Env } from "../env";
import { requireUser, type AuthenticatedUser } from "../auth";
import {
  eventStatement,
  newId,
  notifyMany,
  nowIso,
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import {
  MIN_REVIEWER_ROLE,
  MIN_SUPERVISOR_ROLE,
  REVIEW_SEVERITIES,
  SEVERITY_LABELS,
  atLeast,
  type ReviewPointStatus,
  type ReviewSeverity,
  type TaskStatus,
} from "../../shared/workflow";

interface TaskContext {
  id: string;
  ref: string;
  status: TaskStatus;
  assignee_id: string | null;
  reviewer_id: string | null;
  review_round: number;
}

interface PointRow {
  id: string;
  task_id: string;
  round: number;
  seq: number;
  severity: ReviewSeverity;
  status: ReviewPointStatus;
  raised_by: string;
  body: string;
}

export function registerReviewRoutes(router: Router<Env>): void {
  /** Raise a review point. Only while the deliverable is actually under review. */
  router.post("/api/tasks/:id/review-points", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const task = await loadTask(env, params.id);
    assertReviewerCapacity(task, actor);

    if (task.status !== "under_review") {
      throw badRequest(
        `Review points can only be raised while the deliverable is under review. ` +
          `It is currently "${task.status}".`,
      );
    }

    const body = await readJson<Record<string, unknown>>(request);
    const text = requireString(body.body, "body", { max: 4000 });
    const severity = body.severity
      ? requireEnum(body.severity, "severity", REVIEW_SEVERITIES)
      : "must_fix";
    const reference = optionalString(body.reference, "reference", 200);

    const review = await env.DB.prepare(
      `SELECT id FROM task_reviews WHERE task_id = ? AND round = ?`,
    )
      .bind(task.id, task.review_round)
      .first<{ id: string }>();

    const next = await env.DB.prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM review_points
        WHERE task_id = ? AND round = ?`,
    )
      .bind(task.id, task.review_round)
      .first<{ seq: number }>();
    const seq = next?.seq ?? 1;

    const id = newId();
    const timestamp = nowIso();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO review_points (id, task_id, review_id, round, seq, severity, body,
                                    reference, status, raised_by, raised_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      ).bind(
        id,
        task.id,
        review?.id ?? null,
        task.review_round,
        seq,
        severity,
        text,
        reference,
        actor.id,
        timestamp,
      ),
      eventStatement(env, {
        taskId: task.id,
        actorId: actor.id,
        kind: "review_point:raised",
        detail: `R${task.review_round}.${seq} (${SEVERITY_LABELS[severity]}) ${text.slice(0, 200)}`,
      }),
    ]);

    return json({ review_point: await loadPointView(env, id) }, 201);
  });

  /**
   * Act on a review point. `respond` belongs to the preparer; `resolve`,
   * `waive` and `reopen` belong to the reviewer.
   */
  router.patch("/api/review-points/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const point = await env.DB.prepare(`SELECT * FROM review_points WHERE id = ?`)
      .bind(params.id)
      .first<PointRow>();
    if (!point) throw notFound("That review point does not exist.");

    const task = await loadTask(env, point.task_id);
    const body = await readJson<Record<string, unknown>>(request);
    const action = requireEnum(body.action, "action", [
      "respond",
      "resolve",
      "waive",
      "reopen",
      "edit",
    ] as const);

    const timestamp = nowIso();
    const statements: D1PreparedStatement[] = [];
    const recipients: Array<string | null> = [];
    let detail = "";

    switch (action) {
      case "respond": {
        // The preparer explains what they did about the point.
        const isPreparer = task.assignee_id === actor.id;
        if (!isPreparer && !atLeast(actor.role, MIN_SUPERVISOR_ROLE)) {
          throw forbidden(
            "Only the assigned associate may respond to review points.",
          );
        }
        if (point.status === "resolved" || point.status === "waived") {
          throw badRequest("That review point has already been closed out.");
        }
        const response = requireString(body.response, "response", { max: 4000 });
        statements.push(
          env.DB.prepare(
            `UPDATE review_points
                SET response = ?, responded_by = ?, responded_at = ?, status = 'addressed'
              WHERE id = ?`,
          ).bind(response, actor.id, timestamp, point.id),
        );
        recipients.push(task.reviewer_id, point.raised_by);
        detail = `R${point.round}.${point.seq} answered`;
        break;
      }

      case "resolve":
      case "waive": {
        assertReviewerCapacity(task, actor);
        if (point.status === "resolved" || point.status === "waived") {
          throw badRequest("That review point has already been closed out.");
        }
        if (action === "waive" && !body.response && !body.note) {
          throw badRequest("Waiving a review point requires a reason.");
        }
        const closingNote = optionalString(body.note, "note", 2000);
        statements.push(
          env.DB.prepare(
            `UPDATE review_points
                SET status = ?, closed_by = ?, closed_at = ?,
                    response = COALESCE(?, response)
              WHERE id = ?`,
          ).bind(
            action === "resolve" ? "resolved" : "waived",
            actor.id,
            timestamp,
            closingNote,
            point.id,
          ),
        );
        recipients.push(task.assignee_id);
        detail = `R${point.round}.${point.seq} ${action === "resolve" ? "resolved" : "waived"}`;
        break;
      }

      case "reopen": {
        assertReviewerCapacity(task, actor);
        if (point.status === "open") {
          throw badRequest("That review point is already open.");
        }
        statements.push(
          env.DB.prepare(
            `UPDATE review_points
                SET status = 'open', closed_by = NULL, closed_at = NULL
              WHERE id = ?`,
          ).bind(point.id),
        );
        recipients.push(task.assignee_id);
        detail = `R${point.round}.${point.seq} reopened`;
        break;
      }

      case "edit": {
        // Only the person who raised it, and only before it is answered.
        if (point.raised_by !== actor.id) {
          throw forbidden("Only the reviewer who raised a point may edit it.");
        }
        if (point.status !== "open") {
          throw badRequest(
            "This point has already been responded to, so it can no longer be edited.",
          );
        }
        const text = requireString(body.body, "body", { max: 4000 });
        const severity = body.severity
          ? requireEnum(body.severity, "severity", REVIEW_SEVERITIES)
          : point.severity;
        statements.push(
          env.DB.prepare(
            `UPDATE review_points SET body = ?, severity = ?, reference = ? WHERE id = ?`,
          ).bind(
            text,
            severity,
            optionalString(body.reference, "reference", 200),
            point.id,
          ),
        );
        detail = `R${point.round}.${point.seq} amended`;
        break;
      }
    }

    statements.push(
      eventStatement(env, {
        taskId: task.id,
        actorId: actor.id,
        kind: `review_point:${action}`,
        detail,
      }),
      ...notifyMany(env, recipients, actor.id, {
        taskId: task.id,
        kind: `review_point:${action}`,
        title: `${task.ref} - ${detail}`,
        body: null,
      }),
    );

    await env.DB.batch(statements);
    return json({ review_point: await loadPointView(env, point.id) });
  });

  /** Withdraw a point raised in error, before the preparer has answered it. */
  router.delete("/api/review-points/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const point = await env.DB.prepare(
      `SELECT id, task_id, round, seq, status, raised_by FROM review_points WHERE id = ?`,
    )
      .bind(params.id)
      .first<PointRow>();
    if (!point) throw notFound("That review point does not exist.");
    if (point.raised_by !== actor.id) {
      throw forbidden("Only the reviewer who raised a point may withdraw it.");
    }
    if (point.status !== "open") {
      throw badRequest(
        "This point has already been responded to, so it must be resolved or waived rather than withdrawn.",
      );
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM review_points WHERE id = ?`).bind(point.id),
      eventStatement(env, {
        taskId: point.task_id,
        actorId: actor.id,
        kind: "review_point:withdrawn",
        detail: `R${point.round}.${point.seq} withdrawn`,
      }),
    ]);

    return json({ ok: true });
  });
}

async function loadTask(env: Env, id: string): Promise<TaskContext> {
  const task = await env.DB.prepare(
    `SELECT id, ref, status, assignee_id, reviewer_id, review_round
       FROM tasks WHERE id = ?`,
  )
    .bind(id)
    .first<TaskContext>();
  if (!task) throw notFound("That deliverable does not exist.");
  return task;
}

/**
 * A reviewer action requires reviewing grade and must not be performed by the
 * person who prepared the work.
 */
function assertReviewerCapacity(task: TaskContext, actor: AuthenticatedUser): void {
  if (!atLeast(actor.role, MIN_REVIEWER_ROLE)) {
    throw forbidden(
      "Only Senior Associate grade and above may act on review points as reviewer.",
    );
  }
  if (task.assignee_id && task.assignee_id === actor.id) {
    throw forbidden(
      "You prepared this deliverable, so you cannot act as its reviewer.",
    );
  }
  // A named reviewer holds the file; other reviewers of grade may still step in
  // when the named reviewer is unavailable, which the audit trail records.
}

async function loadPointView(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT rp.*,
            urb.full_name AS raised_by_name,
            urs.full_name AS responded_by_name,
            ucb.full_name AS closed_by_name
       FROM review_points rp
       LEFT JOIN users urb ON urb.id = rp.raised_by
       LEFT JOIN users urs ON urs.id = rp.responded_by
       LEFT JOIN users ucb ON ucb.id = rp.closed_by
      WHERE rp.id = ?`,
  )
    .bind(id)
    .first();
}
