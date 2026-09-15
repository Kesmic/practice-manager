/**
 * Twice-weekly written status reports.
 *
 * The firm requires a short written report from everybody carrying client work, on the
 * days it sets - Wednesdays and Fridays by default. One report per person, covering
 * everything assigned to them, naming the deliverables it concerns.
 *
 * `shared/status-reports.ts` holds the scheduling rules and argues for them; this is
 * where they meet the database. Four things this file is careful about.
 *
 * **A report belongs to a reporting day, not to the day it was written.** A Wednesday
 * report handed in on Thursday is still Wednesday's, and recording it against Thursday
 * would hide that it was late. `due_on` is therefore derived from the calendar rather
 * than taken from the caller.
 *
 * **A second submission amends the first.** Not a parallel account of the same days:
 * two reports covering Thursday and Friday, disagreeing, with nothing saying which was
 * meant. Amendable while the period is current, fixed once the next one starts - an
 * account of a week that can be rewritten a month later is not an account of anything.
 *
 * **Referenced deliverables must be the person's own.** The dropdown offers what is
 * assigned to them, and the server checks it again, because a report naming somebody
 * else's job reads as a claim about work the writer did not do.
 *
 * **Nobody is asked for a report covering time before they arrived.** Somebody who
 * joined on Thursday did not miss Wednesday's report, and telling them they did on
 * their first morning is a poor way to start.
 */

import type { Env } from "../env";
import { requireUser, requireRole, type AuthenticatedUser } from "../auth";
import { newId, nowIso, optionalString, requireString } from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import { today } from "../dates";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { MIN_REVIEWER_ROLE, ROLE_RANK, type Role } from "../../shared/workflow";
import {
  DEFAULT_SCHEDULE,
  WEEKDAYS,
  type ReportSchedule,
  type Weekday,
  currentDueDate,
  missedDays,
  nextDueDate,
  periodFor,
  readSchedule,
  reportState,
  writeSchedule,
} from "../../shared/status-reports";

/**
 * Who may read other people's reports at all.
 *
 * Reviewer grade rather than supervisor: a senior associate who reviews a colleague's
 * deliverable has a direct reason to read what that colleague wrote about it, and
 * `mayRead` below still requires that specific relationship - this is only the floor.
 */
const MIN_OVERSIGHT_ROLE: Role = MIN_REVIEWER_ROLE;

/** Who may change the firm's reporting days. */
const MIN_POLICY_ROLE: Role = "partner";

const MAX_BODY = 8_000;
const MAX_BLOCKERS = 2_000;
const MAX_NOTE = 1_000;

function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

export async function readReportSchedule(env: Env): Promise<ReportSchedule> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("status_report_days")
    .first<{ value: string }>();
  return readSchedule(row?.value);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerStatusReportRoutes(router: Router<Env>): void {
  /**
   * Everything the person's own status-report screen needs, in one round trip: which
   * report is current, whether they have written it, what they wrote last time, and the
   * deliverables they may name.
   */
  router.get("/api/me/status-report", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    const schedule = await readReportSchedule(env);
    const now = today();

    const [submitted, mine, recent] = await env.DB.batch([
      env.DB.prepare(
        `SELECT due_on FROM status_reports
          WHERE user_id = ? AND due_on >= date(?, '-28 days')
          ORDER BY due_on DESC`,
      ).bind(actor.id, now),
      /*
       * What they may name as a reference: their own live work. Settled deliverables
       * are left out of the dropdown but not out of an existing report - somebody who
       * reported on a job on Wednesday and closed it on Thursday said something true.
       */
      env.DB.prepare(
        `SELECT t.id, t.ref, t.title, t.status, c.name AS client_name
           FROM tasks t
           JOIN clients c ON c.id = t.client_id
          WHERE t.assignee_id = ?
            AND t.status NOT IN ('approved','closed','cancelled')
          ORDER BY COALESCE(t.internal_due_date, t.statutory_due_date) ASC, t.ref ASC`,
      ).bind(actor.id),
      env.DB.prepare(
        `SELECT id, due_on, period_from, body, blockers, submitted_at, updated_at
           FROM status_reports
          WHERE user_id = ?
          ORDER BY due_on DESC
          LIMIT 8`,
      ).bind(actor.id),
    ]);

    const submittedFor = (submitted.results as Array<{ due_on: string }>).map(
      (r) => r.due_on,
    );
    const since = await joinedOn(env, actor.id);
    const state = reportState(now, schedule, submittedFor);

    // The current report, if it has already been written, so the form opens on it
    // rather than on a blank page the person has to retype.
    const reports = recent.results as Array<Record<string, unknown>>;
    const current = state.due_on
      ? (reports.find((r) => r.due_on === state.due_on) ?? null)
      : null;

    return json({
      schedule,
      state: state.state,
      due_on: state.due_on,
      period_from: state.from,
      next_due_on: nextDueDate(now, schedule.days),
      missed: missedDays(now, schedule, submittedFor, since).filter(
        (day) => day !== state.due_on,
      ),
      current: current ? await withTasks(env, current) : null,
      tasks: mine.results,
      recent: reports,
    });
  });

  /**
   * Writes or amends the current report.
   *
   * The reporting day is derived here rather than accepted from the caller. A client
   * that could name its own `due_on` could file Thursday's work against next
   * Wednesday, which is the one thing a reporting requirement exists to prevent.
   */
  router.post("/api/me/status-report", async ({ request, env }) => {
    const actor = await requireUser(env, request);
    const schedule = await readReportSchedule(env);
    if (!schedule.enabled) {
      throw badRequest("The firm is not asking for status reports at the moment.");
    }

    const now = today();
    const dueOn = currentDueDate(now, schedule.days);
    if (!dueOn) throw badRequest("There is no reporting day to file against.");

    const body = await readJson<{
      body?: unknown;
      blockers?: unknown;
      tasks?: unknown;
    }>(request);

    const narrative = requireString(body.body, "body", { max: MAX_BODY });
    const blockers = optionalString(body.blockers, "blockers", MAX_BLOCKERS);
    const references = readReferences(body.tasks);

    /*
     * Only the person's own deliverables. Checked on the server as well as filtered in
     * the dropdown: a report naming somebody else's job reads as a claim about work the
     * writer did not do, and the dropdown is not where that gets decided.
     */
    if (references.length) {
      const placeholders = references.map(() => "?").join(", ");
      const { results } = await env.DB.prepare(
        `SELECT id FROM tasks WHERE id IN (${placeholders}) AND assignee_id = ?`,
      )
        .bind(...references.map((r) => r.task_id), actor.id)
        .all<{ id: string }>();
      if (results.length !== references.length) {
        throw badRequest(
          "One of the deliverables named is not assigned to you. Choose from your own work.",
        );
      }
    }

    const existing = await env.DB.prepare(
      `SELECT id, due_on FROM status_reports WHERE user_id = ? AND due_on = ?`,
    )
      .bind(actor.id, dueOn)
      .first<{ id: string; due_on: string }>();

    const timestamp = nowIso();
    const { from } = periodFor(dueOn, schedule.days);
    const id = existing?.id ?? newId();

    const statements = existing
      ? [
          env.DB.prepare(
            `UPDATE status_reports SET body = ?, blockers = ?, updated_at = ?
              WHERE id = ?`,
          ).bind(narrative, blockers, timestamp, id),
          env.DB.prepare(`DELETE FROM status_report_tasks WHERE report_id = ?`).bind(id),
        ]
      : [
          env.DB.prepare(
            `INSERT INTO status_reports
               (id, user_id, due_on, period_from, body, blockers, submitted_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(id, actor.id, dueOn, from, narrative, blockers, timestamp, timestamp),
        ];

    for (const reference of references) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO status_report_tasks (report_id, task_id, note) VALUES (?, ?, ?)`,
        ).bind(id, reference.task_id, reference.note),
      );
    }

    await env.DB.batch(statements);
    return json({ report: await loadReport(env, id) }, existing ? 200 : 201);
  });

  /**
   * One person's reports, for them and for whoever supervises them.
   *
   * A status report is an account of firm work given to the firm, so it is not private
   * in the way a performance review is. It is still not open to everybody: a peer has
   * no reason to read a colleague's account of their week, and being read by people
   * with no stake in it is how a report turns into something written for an audience.
   */
  router.get("/api/employees/:id/status-reports", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    if (!(await mayRead(env, actor, params.id))) {
      throw forbidden("You cannot read this person's status reports.");
    }

    const { results } = await env.DB.prepare(
      `SELECT id, user_id, due_on, period_from, body, blockers, submitted_at, updated_at
         FROM status_reports
        WHERE user_id = ?
        ORDER BY due_on DESC
        LIMIT 40`,
    )
      .bind(params.id)
      .all<Record<string, unknown>>();

    return json({
      reports: await Promise.all(results.map((row) => withTasks(env, row))),
    });
  });

  /**
   * Who has reported and who has not, for the reporting day just passed.
   *
   * The question a supervisor actually has on a Thursday morning. Answering it needs
   * both halves - the reports filed and the people who owe one - because a list of what
   * arrived cannot show what did not.
   */
  router.get("/api/status-reports", async ({ request, env, url }) => {
    const actor = await requireRole(env, request, MIN_OVERSIGHT_ROLE);
    const schedule = await readReportSchedule(env);
    const now = today();

    const asked = url.searchParams.get("due_on");
    const dueOn = asked ?? currentDueDate(now, schedule.days);
    if (!dueOn) {
      return json({ schedule, due_on: null, period_from: null, people: [] });
    }
    const { from } = periodFor(dueOn, schedule.days);

    /*
     * Who owes a report: everybody active who is carrying client work, plus anybody
     * who filed one anyway. The second half matters - somebody whose last deliverable
     * was closed on Tuesday still wrote about the week, and dropping their report
     * because they now carry nothing would lose it.
     */
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.role,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.assignee_id = u.id
                  AND t.status NOT IN ('approved','closed','cancelled')) AS open_tasks,
              r.id AS report_id, r.due_on, r.period_from, r.body, r.blockers,
              r.submitted_at, r.updated_at
         FROM users u
         LEFT JOIN status_reports r ON r.user_id = u.id AND r.due_on = ?1
        WHERE u.status = 'active'
          AND (r.id IS NOT NULL
               OR EXISTS (SELECT 1 FROM tasks t
                           WHERE t.assignee_id = u.id
                             AND t.status NOT IN ('approved','closed','cancelled')))
        ORDER BY (r.id IS NOT NULL), u.full_name`,
    )
      .bind(dueOn)
      .all<Record<string, unknown>>();

    /*
     * The person and their report are built separately rather than by spreading one row
     * into the other. Spreading put the person's own id and name on the report and left
     * the report with no date of its own, which rendered as a dash where the reporting
     * day should have been.
     */
    const visible = [];
    for (const row of results) {
      if (!(await mayRead(env, actor, String(row.id)))) continue;

      const person = {
        id: String(row.id),
        full_name: row.full_name,
        role: row.role,
        open_tasks: Number(row.open_tasks ?? 0),
        report_id: (row.report_id as string | null) ?? null,
      };

      visible.push(
        row.report_id
          ? {
              ...person,
              report: await withTasks(env, {
                id: row.report_id,
                user_id: row.id,
                due_on: row.due_on,
                period_from: row.period_from,
                body: row.body,
                blockers: row.blockers,
                submitted_at: row.submitted_at,
                updated_at: row.updated_at,
              }),
            }
          : person,
      );
    }

    return json({
      schedule,
      due_on: dueOn,
      period_from: from,
      people: visible,
      outstanding: visible.filter((p) => !p.report_id).length,
    });
  });

  // -------------------------------------------------------------------------
  // The firm's reporting days
  // -------------------------------------------------------------------------

  router.get("/api/status-report-policy", async ({ request, env }) => {
    await requireUser(env, request);
    return json({ schedule: await readReportSchedule(env) });
  });

  router.put("/api/status-report-policy", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_POLICY_ROLE);
    const body = await readJson<{ enabled?: unknown; days?: unknown }>(request);

    const enabled = body.enabled !== false;
    const days = Array.isArray(body.days)
      ? body.days
          .map((d) => Number(d))
          .filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday))
      : DEFAULT_SCHEDULE.days;

    if (enabled && !days.length) {
      throw badRequest(
        "Choose at least one day, or switch status reports off altogether.",
      );
    }

    const schedule: ReportSchedule = { enabled, days };
    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by)
       VALUES ('status_report_days', ?, ?, ?)
       ON CONFLICT (key) DO UPDATE
         SET value = excluded.value,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`,
    )
      .bind(writeSchedule(schedule), nowIso(), actor.id)
      .run();

    return json({ schedule });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Reference {
  task_id: string;
  note: string | null;
}

function readReferences(raw: unknown): Reference[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw badRequest("Send the deliverables as a list.");

  const seen = new Set<string>();
  const out: Reference[] = [];
  for (const entry of raw) {
    const item = typeof entry === "string" ? { task_id: entry } : entry;
    if (!item || typeof item !== "object") throw badRequest("Bad deliverable reference.");

    const taskId = String((item as { task_id?: unknown }).task_id ?? "").trim();
    if (!taskId) throw badRequest("A deliverable reference has no deliverable.");
    // Naming the same job twice is a slip, not a second reference.
    if (seen.has(taskId)) continue;
    seen.add(taskId);

    out.push({
      task_id: taskId,
      note: optionalString((item as { note?: unknown }).note, "note", MAX_NOTE),
    });
  }
  return out;
}

/**
 * Their start date, so nobody is told they missed a report from before they arrived.
 *
 * Falls back to when the account was created, which is the right answer for somebody
 * whose employment record has no start date: an account that did not exist cannot have
 * owed anything.
 */
async function joinedOn(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(p.start_date, date(u.created_at)) AS joined
       FROM users u LEFT JOIN employee_profiles p ON p.user_id = u.id
      WHERE u.id = ?`,
  )
    .bind(userId)
    .first<{ joined: string | null }>();
  return row?.joined ?? null;
}

async function loadReport(env: Env, id: string) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, due_on, period_from, body, blockers, submitted_at, updated_at
       FROM status_reports WHERE id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) throw notFound("That status report does not exist.");
  return await withTasks(env, row);
}

/** Attaches the deliverables a report names, with enough of each to be readable. */
async function withTasks(env: Env, row: Record<string, unknown>) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.ref, t.title, t.status, c.name AS client_name, srt.note
       FROM status_report_tasks srt
       JOIN tasks t ON t.id = srt.task_id
       JOIN clients c ON c.id = t.client_id
      WHERE srt.report_id = ?
      ORDER BY t.ref`,
  )
    .bind(String(row.id))
    .all<Record<string, unknown>>();
  return { ...row, tasks: results };
}

/**
 * Who may read one person's reports: themselves, their line manager, anybody who
 * reviews their work, and HR administrators.
 *
 * A peer at the same grade is deliberately excluded. A status report is an account of
 * firm work given to the firm, not a broadcast, and a report written knowing the whole
 * office reads it stops being an account of the week.
 */
async function mayRead(
  env: Env,
  actor: AuthenticatedUser,
  subjectId: string,
): Promise<boolean> {
  if (actor.id === subjectId) return true;
  if (atLeast(actor.role, MIN_HR_ADMIN_ROLE)) return true;
  if (!atLeast(actor.role, MIN_OVERSIGHT_ROLE)) return false;

  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM employee_profiles p
         WHERE p.user_id = ?1 AND p.line_manager_id = ?2) AS manages,
       (SELECT COUNT(*) FROM tasks t
         WHERE t.assignee_id = ?1 AND t.reviewer_id = ?2) AS reviews`,
  )
    .bind(subjectId, actor.id)
    .first<{ manages: number; reviews: number }>();

  return (row?.manages ?? 0) > 0 || (row?.reviews ?? 0) > 0;
}
