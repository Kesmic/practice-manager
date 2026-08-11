/** Dashboard, practice reports and the notification inbox. */

import type { Env } from "../env";
import { requireUser } from "../auth";
import { nowIso } from "../db";
import { Router, json } from "../http";
import { requireArea } from "./settings";
import { MIN_SUPERVISOR_ROLE, ROLE_RANK } from "../../shared/workflow";
import {
  AWAITING_A_REVIEWER,
  OVERDUE_PREDICATE,
  TASK_ORDER,
  TASK_SELECT,
} from "./task-sql";

export function registerInsightRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // Personal dashboard
  // -------------------------------------------------------------------------

  router.get("/api/dashboard", async ({ request, env }) => {
    const actor = await requireUser(env, request);

    const supervises = ROLE_RANK[actor.role] >= ROLE_RANK[MIN_SUPERVISOR_ROLE];

    const [stats, mine, reviews, unclaimed, overdue] = await env.DB.batch([
      env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM tasks t
             WHERE t.assignee_id = ?1
               AND t.status NOT IN ('closed','cancelled')) AS assigned_open,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.reviewer_id = ?1
               AND t.status IN ('submitted','under_review')) AS awaiting_my_review,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.assignee_id = ?1 AND t.status = 'rework') AS in_rework,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.assignee_id = ?1 AND ${OVERDUE_PREDICATE}) AS overdue,
           (SELECT COUNT(*) FROM tasks t
             WHERE t.assignee_id = ?1
               AND t.status NOT IN ('approved','closed','cancelled')
               AND COALESCE(t.internal_due_date, t.statutory_due_date) IS NOT NULL
               AND date(COALESCE(t.internal_due_date, t.statutory_due_date))
                     BETWEEN date('now') AND date('now', '+7 day')) AS due_this_week,
           (SELECT COUNT(*) FROM notifications n
             WHERE n.user_id = ?1 AND n.read_at IS NULL) AS unread_notifications,
           (SELECT COUNT(*) FROM tasks t
             WHERE ${AWAITING_A_REVIEWER}) AS awaiting_a_reviewer`,
      ).bind(actor.id),

      env.DB.prepare(
        `${TASK_SELECT}
          WHERE t.assignee_id = ? AND t.status NOT IN ('closed','cancelled')
          ${TASK_ORDER} LIMIT 50`,
      ).bind(actor.id),

      env.DB.prepare(
        `${TASK_SELECT}
          WHERE t.reviewer_id = ? AND t.status IN ('submitted','under_review')
          ${TASK_ORDER} LIMIT 50`,
      ).bind(actor.id),

      // Handed in with no reviewer named. Only supervisors can act on it, since
      // naming a reviewer is a supervisor's job, so only they are shown it.
      env.DB.prepare(
        supervises
          ? `${TASK_SELECT} WHERE ${AWAITING_A_REVIEWER} ${TASK_ORDER} LIMIT 50`
          : `${TASK_SELECT} WHERE 1 = 0`,
      ),

      // Supervisors see the whole practice's overdue list; everyone else sees
      // only their own, which is all they can act on.
      env.DB.prepare(
        `${TASK_SELECT}
          WHERE ${OVERDUE_PREDICATE}
            AND (?1 = 1 OR t.assignee_id = ?2 OR t.reviewer_id = ?2)
          ${TASK_ORDER} LIMIT 50`,
      ).bind(
        actor.role === "manager" || actor.role === "partner" || actor.role === "admin"
          ? 1
          : 0,
        actor.id,
      ),
    ]);

    return json({
      stats: {
        ...(stats.results[0] ?? {}),
        // Nobody below supervisor grade is shown the count either, so the tile
        // and the list agree about what is there.
        awaiting_a_reviewer: supervises
          ? ((stats.results[0] as Record<string, unknown> | undefined)
              ?.awaiting_a_reviewer ?? 0)
          : 0,
      },
      my_tasks: mine.results,
      awaiting_my_review: reviews.results,
      awaiting_a_reviewer: unclaimed.results,
      overdue: overdue.results,
    });
  });

  // -------------------------------------------------------------------------
  // Practice reports
  // -------------------------------------------------------------------------

  router.get("/api/reports", async ({ request, env }) => {
    await requireArea(env, request, "reports");

    const [workload, serviceLines, statusCounts, quality] = await env.DB.batch([
      // Per-person workload, budget consumption and overdue exposure.
      env.DB.prepare(
        `SELECT u.id AS user_id, u.full_name, u.role,
                COUNT(CASE WHEN t.status NOT IN ('closed','cancelled')
                           THEN 1 END) AS open_tasks,
                COUNT(CASE WHEN ${OVERDUE_PREDICATE} THEN 1 END) AS overdue_tasks,
                COUNT(CASE WHEN t.status IN ('submitted','under_review')
                           THEN 1 END) AS in_review,
                COALESCE(SUM(CASE WHEN t.status NOT IN ('closed','cancelled')
                                  THEN t.budget_hours END), 0) AS budget_hours,
                COALESCE((SELECT SUM(te.hours) FROM time_entries te
                           WHERE te.user_id = u.id), 0) AS logged_hours
           FROM users u
           LEFT JOIN tasks t ON t.assignee_id = u.id
          WHERE u.status = 'active'
          GROUP BY u.id
          ORDER BY open_tasks DESC, u.full_name`,
      ),

      env.DB.prepare(
        `SELECT t.service_line,
                COUNT(CASE WHEN t.status NOT IN ('closed','cancelled')
                           THEN 1 END) AS open_tasks,
                COUNT(CASE WHEN ${OVERDUE_PREDICATE} THEN 1 END) AS overdue_tasks,
                COUNT(CASE WHEN t.status = 'closed' THEN 1 END) AS closed_tasks,
                COALESCE((SELECT SUM(te.hours) FROM time_entries te
                          JOIN tasks t2 ON t2.id = te.task_id
                         WHERE t2.service_line = t.service_line), 0) AS logged_hours
           FROM tasks t
          GROUP BY t.service_line
          ORDER BY open_tasks DESC`,
      ),

      env.DB.prepare(
        `SELECT status, COUNT(*) AS count FROM tasks GROUP BY status`,
      ),

      /*
       * Review quality per preparer. `submissions` counts review rounds that
       * reached a decision; `first_pass_rate` is the share of deliverables the
       * reviewer approved without ever sending them back. A low rate points at
       * a training need or an unrealistic budget.
       */
      env.DB.prepare(
        `SELECT u.id AS user_id, u.full_name,
                COUNT(r.id) AS submissions,
                COUNT(CASE WHEN r.decision = 'rework' THEN 1 END) AS rework_rounds,
                COALESCE((SELECT COUNT(*) FROM review_points rp
                           WHERE rp.responded_by = u.id
                             AND rp.severity = 'must_fix'), 0) AS must_fix_points,
                CASE WHEN COUNT(DISTINCT r.task_id) = 0 THEN 1.0
                     ELSE 1.0 * (
                       COUNT(DISTINCT r.task_id) - COUNT(DISTINCT CASE
                         WHEN r.decision = 'rework' THEN r.task_id END)
                     ) / COUNT(DISTINCT r.task_id)
                END AS first_pass_rate
           FROM users u
           JOIN task_reviews r ON r.submitted_by = u.id AND r.decision IS NOT NULL
          WHERE u.status = 'active'
          GROUP BY u.id
          ORDER BY submissions DESC`,
      ),
    ]);

    return json({
      workload: workload.results,
      service_lines: serviceLines.results,
      status_counts: statusCounts.results,
      review_quality: quality.results,
    });
  });

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  router.get("/api/notifications", async ({ request, env, url }) => {
    const actor = await requireUser(env, request);
    const unreadOnly = url.searchParams.get("unread") === "1";

    const { results } = await env.DB.prepare(
      `SELECT n.*, t.ref AS task_ref
         FROM notifications n
         LEFT JOIN tasks t ON t.id = n.task_id
        WHERE n.user_id = ? ${unreadOnly ? "AND n.read_at IS NULL" : ""}
        ORDER BY n.created_at DESC
        LIMIT 100`,
    )
      .bind(actor.id)
      .all();

    return json({ notifications: results });
  });

  /** Marks the given notifications read, or all of them when no ids are sent. */
  router.post("/api/notifications/read", async ({ request, env }) => {
    const actor = await requireUser(env, request);

    let ids: string[] = [];
    try {
      const body = (await request.json()) as { ids?: unknown };
      if (Array.isArray(body?.ids)) ids = body.ids.map((v) => String(v)).slice(0, 200);
    } catch {
      // An empty or absent body means "mark everything read".
    }

    const timestamp = nowIso();
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(", ");
      await env.DB.prepare(
        `UPDATE notifications SET read_at = ?
          WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders})`,
      )
        .bind(timestamp, actor.id, ...ids)
        .run();
    } else {
      await env.DB.prepare(
        `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
      )
        .bind(timestamp, actor.id)
        .run();
    }

    const unread = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    )
      .bind(actor.id)
      .first<{ n: number }>();

    return json({ unread_notifications: unread?.n ?? 0 });
  });
}
