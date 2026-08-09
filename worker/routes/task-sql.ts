/**
 * Shared SQL fragments for reading deliverables.
 *
 * Keeping these in one place means the list, board, dashboard and client views
 * all report identical derived figures — particularly "overdue", which several
 * screens surface and which must mean exactly one thing across the system.
 */

/**
 * A deliverable is overdue when the earlier of its internal target and its
 * statutory deadline has passed and the work is not yet signed off. Approved
 * and closed items are excluded: the work is done, so it is no longer chasing.
 */
export const OVERDUE_PREDICATE = `
  t.status NOT IN ('approved','closed','cancelled')
  AND COALESCE(t.internal_due_date, t.statutory_due_date) IS NOT NULL
  AND date(COALESCE(t.internal_due_date, t.statutory_due_date)) < date('now')
`;

/** Selects a full TaskSummary row. Callers append their own WHERE/ORDER BY. */
export const TASK_SELECT = `
  SELECT t.*,
         c.name AS client_name,
         c.code AS client_code,
         e.name AS engagement_name,
         ua.full_name AS assignee_name,
         ur.full_name AS reviewer_name,
         (SELECT COUNT(*) FROM review_points rp
           WHERE rp.task_id = t.id AND rp.status IN ('open','addressed')) AS open_review_points,
         (SELECT COUNT(*) FROM task_checklist_items ci
           WHERE ci.task_id = t.id) AS checklist_total,
         (SELECT COUNT(*) FROM task_checklist_items ci
           WHERE ci.task_id = t.id AND ci.is_done = 1) AS checklist_done,
         (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te
           WHERE te.task_id = t.id) AS logged_hours
    FROM tasks t
    JOIN clients c ON c.id = t.client_id
    LEFT JOIN engagements e ON e.id = t.engagement_id
    LEFT JOIN users ua ON ua.id = t.assignee_id
    LEFT JOIN users ur ON ur.id = t.reviewer_id
`;

/**
 * Default ordering for work queues: live work first, then by the date it is
 * needed, with undated items last.
 */
export const TASK_ORDER = `
  ORDER BY
    CASE WHEN t.status IN ('closed','cancelled') THEN 1 ELSE 0 END,
    CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    COALESCE(t.internal_due_date, t.statutory_due_date) IS NULL,
    COALESCE(t.internal_due_date, t.statutory_due_date)
`;
