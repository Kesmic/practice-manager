/**
 * Shared SQL fragments for reading deliverables.
 *
 * Keeping these in one place means the list, board, dashboard and client views
 * all report identical derived figures - particularly "overdue", which several
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

/** Submitted or under review, and therefore sitting in a reviewer's queue. */
export const WITH_REVIEWER_STATUSES = `('submitted','under_review')`;

/**
 * Work handed in with nobody named to review it.
 *
 * The reviewer is optional when a deliverable is raised, which is right: a
 * partner setting up next quarter's returns does not always know who will review
 * them. But the preparer can still finish and submit, and at that moment the work
 * belongs to no reviewer's queue. Before this predicate existed it appeared on
 * nobody's dashboard at all: the preparer had done their part, the file was
 * waiting, and nothing said so. Every supervisor sees this queue, because the
 * answer to "who reviews it" is exactly what is missing.
 */
export const AWAITING_A_REVIEWER = `
  t.reviewer_id IS NULL
  AND t.status IN ${WITH_REVIEWER_STATUSES}
`;

/** Selects a full TaskSummary row. Callers append their own WHERE/ORDER BY. */
export const TASK_SELECT = `
  SELECT t.*,
         c.name AS client_name,
         c.code AS client_code,
         e.name AS engagement_name,
         ps.name AS package_service_name,
         pp.name AS package_service_parent,
         cs.name AS client_service_name,
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
    LEFT JOIN package_services ps ON ps.id = t.package_service_id
    LEFT JOIN package_services pp ON pp.id = ps.parent_id
    LEFT JOIN client_services cs ON cs.id = t.client_service_id
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

// ---------------------------------------------------------------------------
// Whose work is whose
// ---------------------------------------------------------------------------

/**
 * The predicates that scope client work to one person.
 *
 * Here rather than in each route for the same reason `OVERDUE_PREDICATE` is: the list,
 * the detail, the counts, the dashboard and the search all have to agree. A list that
 * filters beside a count that does not is the system contradicting itself, and a detail
 * endpoint that does not filter is not a permission at all - the id is in the URL of
 * every link the person was ever sent.
 *
 * `shared/portfolio.ts` argues for where the line falls and why.
 *
 * Each returns its binds with its SQL rather than being a bare string, and that is not
 * tidiness. These predicates name the same id several times, and the queries they are
 * dropped into already carry bare `?` placeholders from the caller's own filters.
 * SQLite numbers a bare `?` one higher than the largest number assigned so far, in the
 * order the parameters appear in the text - so a `?1` written inside a predicate that
 * is appended last would silently refer to the caller's FIRST filter value instead of
 * to the user id. Keeping the binds attached to the SQL that needs them is the only
 * version of this that cannot come apart.
 */
export interface ScopedSql {
  sql: string;
  binds: string[];
}

/** A deliverable this person prepares or reviews. */
export function ownTaskPredicate(userId: string): ScopedSql {
  return {
    sql: `(t.assignee_id = ? OR t.reviewer_id = ?)`,
    binds: [userId, userId],
  };
}

/**
 * A client this person holds, is responsible for, or is doing work for.
 *
 * The last arm is what makes the other two usable: most staff meet a client by being
 * handed a return for it, and without it they could open the deliverable and not the
 * file it belongs to.
 *
 * A declined or ended allocation is not a way in. Somebody who exercised clause 8.2 to
 * refuse a client should not keep a window into it.
 */
export function ownClientPredicate(userId: string, alias = "c"): ScopedSql {
  return {
    sql: `(
      ${alias}.partner_id = ?
      OR ${alias}.manager_id = ?
      OR EXISTS (
        SELECT 1 FROM client_allocations a
         WHERE a.client_id = ${alias}.id AND a.user_id = ?
           AND a.status IN ('offered', 'accepted')
      )
      OR EXISTS (
        SELECT 1 FROM tasks ot
         WHERE ot.client_id = ${alias}.id AND (ot.assignee_id = ? OR ot.reviewer_id = ?)
      )
    )`,
    binds: [userId, userId, userId, userId, userId],
  };
}

/**
 * An engagement under a client this person reaches.
 *
 * Written as an EXISTS against `clients` rather than a join, so it can be dropped into a
 * query that has not joined that table.
 */
export function ownEngagementPredicate(userId: string): ScopedSql {
  const client = ownClientPredicate(userId, "sc");
  return {
    sql: `EXISTS (
      SELECT 1 FROM clients sc
       WHERE sc.id = e.client_id AND ${client.sql}
    )`,
    binds: client.binds,
  };
}
