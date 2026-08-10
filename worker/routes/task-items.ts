/** Checklist steps, discussion comments, document links and time records. */

import type { Env } from "../env";
import { requireUser, type AuthenticatedUser } from "../auth";
import {
  eventStatement,
  newId,
  notifyMany,
  nowIso,
  optionalNumber,
  optionalString,
  requireDate,
  requireString,
} from "../db";
import { Router, badRequest, forbidden, json, notFound, readJson } from "../http";
import { MIN_SUPERVISOR_ROLE, atLeast, type TaskStatus } from "../../shared/workflow";

interface TaskRow {
  id: string;
  ref: string;
  status: TaskStatus;
  assignee_id: string | null;
  reviewer_id: string | null;
}

export function registerTaskItemRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // Checklist
  // -------------------------------------------------------------------------

  router.post("/api/tasks/:id/checklist", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const task = await loadTask(env, params.id);
    assertEditable(task);
    assertPreparerOrSupervisor(task, actor, "add checklist steps");

    const body = await readJson<Record<string, unknown>>(request);
    const label = requireString(body.label, "label", { max: 300 });
    const mandatory = body.mandatory === true;

    const next = await env.DB.prepare(
      `SELECT COALESCE(MAX(position), -1) + 1 AS position
         FROM task_checklist_items WHERE task_id = ?`,
    )
      .bind(task.id)
      .first<{ position: number }>();

    const id = newId();
    await env.DB.prepare(
      `INSERT INTO task_checklist_items (id, task_id, position, label, mandatory, is_done)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
      .bind(id, task.id, next?.position ?? 0, label, mandatory ? 1 : 0)
      .run();

    return json({ item: await loadChecklistItem(env, id) }, 201);
  });

  router.patch(
    "/api/tasks/:id/checklist/:itemId",
    async ({ request, env, params }) => {
      const actor = await requireUser(env, request);
      const task = await loadTask(env, params.id);
      assertEditable(task);

      const item = await env.DB.prepare(
        `SELECT id, is_done, label FROM task_checklist_items WHERE id = ? AND task_id = ?`,
      )
        .bind(params.itemId, task.id)
        .first<{ id: string; is_done: 0 | 1; label: string }>();
      if (!item) throw notFound("That checklist step does not exist.");

      const body = await readJson<{ is_done?: boolean; label?: string }>(request);

      if (body.label !== undefined) {
        assertPreparerOrSupervisor(task, actor, "rename checklist steps");
        await env.DB.prepare(`UPDATE task_checklist_items SET label = ? WHERE id = ?`)
          .bind(requireString(body.label, "label", { max: 300 }), item.id)
          .run();
      }

      if (body.is_done !== undefined) {
        assertPreparerOrSupervisor(task, actor, "tick off checklist steps");
        const done = body.is_done === true;
        await env.DB.prepare(
          `UPDATE task_checklist_items SET is_done = ?, done_by = ?, done_at = ? WHERE id = ?`,
        )
          .bind(done ? 1 : 0, done ? actor.id : null, done ? nowIso() : null, item.id)
          .run();
      }

      return json({ item: await loadChecklistItem(env, item.id) });
    },
  );

  router.delete(
    "/api/tasks/:id/checklist/:itemId",
    async ({ request, env, params }) => {
      const actor = await requireUser(env, request);
      const task = await loadTask(env, params.id);
      assertEditable(task);

      const item = await env.DB.prepare(
        `SELECT id, mandatory FROM task_checklist_items WHERE id = ? AND task_id = ?`,
      )
        .bind(params.itemId, task.id)
        .first<{ id: string; mandatory: 0 | 1 }>();
      if (!item) throw notFound("That checklist step does not exist.");

      // Mandatory steps come from the firm's standard procedures, so removing
      // one is a supervisory decision rather than a preparer's.
      if (item.mandatory && !atLeast(actor.role, MIN_SUPERVISOR_ROLE)) {
        throw forbidden(
          "Mandatory procedures can only be removed by Manager grade or above.",
        );
      }
      assertPreparerOrSupervisor(task, actor, "remove checklist steps");

      await env.DB.prepare(`DELETE FROM task_checklist_items WHERE id = ?`)
        .bind(item.id)
        .run();
      return json({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // Comments
  // -------------------------------------------------------------------------

  router.post("/api/tasks/:id/comments", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const task = await loadTask(env, params.id);

    const body = await readJson<{ body?: string }>(request);
    const text = requireString(body.body, "body", { max: 8000 });

    const id = newId();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_comments (id, task_id, author_id, body, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, task.id, actor.id, text, nowIso()),
      ...notifyMany(env, [task.assignee_id, task.reviewer_id], actor.id, {
        taskId: task.id,
        kind: "comment",
        title: `${task.ref} - new comment from ${actor.full_name}`,
        body: text.slice(0, 200),
      }),
    ]);

    const comment = await env.DB.prepare(
      `SELECT tc.*, u.full_name AS author_name
         FROM task_comments tc LEFT JOIN users u ON u.id = tc.author_id
        WHERE tc.id = ?`,
    )
      .bind(id)
      .first();
    return json({ comment }, 201);
  });

  // -------------------------------------------------------------------------
  // Document links
  // -------------------------------------------------------------------------

  router.post("/api/tasks/:id/attachments", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const task = await loadTask(env, params.id);
    assertEditable(task);

    const body = await readJson<Record<string, unknown>>(request);
    const label = requireString(body.label, "label", { max: 200 });
    const url = assertHttpUrl(requireString(body.url, "url", { max: 2000 }));
    const kind = optionalString(body.kind, "kind", 40);

    const id = newId();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_attachments (id, task_id, label, url, kind, added_by, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, task.id, label, url, kind, actor.id, nowIso()),
      eventStatement(env, {
        taskId: task.id,
        actorId: actor.id,
        kind: "attachment:added",
        detail: label,
      }),
    ]);

    const attachment = await env.DB.prepare(
      `SELECT a.*, u.full_name AS added_by_name
         FROM task_attachments a LEFT JOIN users u ON u.id = a.added_by
        WHERE a.id = ?`,
    )
      .bind(id)
      .first();
    return json({ attachment }, 201);
  });

  router.delete("/api/attachments/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const row = await env.DB.prepare(
      `SELECT id, task_id, label, added_by FROM task_attachments WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; task_id: string; label: string; added_by: string | null }>();
    if (!row) throw notFound("That document link does not exist.");

    if (row.added_by !== actor.id && !atLeast(actor.role, MIN_SUPERVISOR_ROLE)) {
      throw forbidden("You can only remove document links you added.");
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM task_attachments WHERE id = ?`).bind(row.id),
      eventStatement(env, {
        taskId: row.task_id,
        actorId: actor.id,
        kind: "attachment:removed",
        detail: row.label,
      }),
    ]);
    return json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Time records
  // -------------------------------------------------------------------------

  router.post("/api/tasks/:id/time", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const task = await loadTask(env, params.id);

    const body = await readJson<Record<string, unknown>>(request);
    const workDate = requireDate(body.work_date, "work_date");
    const hours = optionalNumber(body.hours, "hours", { min: 0.25, max: 24 });
    if (hours === null) throw badRequest(`"hours" is required.`);
    const narrative = optionalString(body.narrative, "narrative", 1000);
    const billable = body.billable === false ? 0 : 1;

    if (workDate > nowIso().slice(0, 10)) {
      throw badRequest("Time cannot be recorded against a future date.");
    }

    const id = newId();
    await env.DB.prepare(
      `INSERT INTO time_entries (id, task_id, user_id, work_date, hours, narrative,
                                 billable, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, task.id, actor.id, workDate, hours, narrative, billable, nowIso())
      .run();

    const entry = await env.DB.prepare(
      `SELECT te.*, u.full_name AS user_name
         FROM time_entries te LEFT JOIN users u ON u.id = te.user_id
        WHERE te.id = ?`,
    )
      .bind(id)
      .first();
    return json({ time_entry: entry }, 201);
  });

  router.delete("/api/time/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const row = await env.DB.prepare(
      `SELECT id, user_id FROM time_entries WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; user_id: string }>();
    if (!row) throw notFound("That time record does not exist.");
    if (row.user_id !== actor.id && !atLeast(actor.role, MIN_SUPERVISOR_ROLE)) {
      throw forbidden("You can only remove your own time records.");
    }

    await env.DB.prepare(`DELETE FROM time_entries WHERE id = ?`).bind(row.id).run();
    return json({ ok: true });
  });
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

async function loadTask(env: Env, id: string): Promise<TaskRow> {
  const task = await env.DB.prepare(
    `SELECT id, ref, status, assignee_id, reviewer_id FROM tasks WHERE id = ?`,
  )
    .bind(id)
    .first<TaskRow>();
  if (!task) throw notFound("That deliverable does not exist.");
  return task;
}

/** Closed and cancelled files are read-only until formally reopened. */
function assertEditable(task: TaskRow): void {
  if (task.status === "closed" || task.status === "cancelled") {
    throw badRequest(
      "This deliverable is closed. Reopen it before recording further work.",
    );
  }
}

function assertPreparerOrSupervisor(
  task: TaskRow,
  actor: AuthenticatedUser,
  what: string,
): void {
  if (task.assignee_id === actor.id) return;
  if (atLeast(actor.role, MIN_SUPERVISOR_ROLE)) return;
  throw forbidden(
    `Only the assigned associate or Manager grade and above may ${what}.`,
  );
}

/**
 * Document links point at the firm's existing document store. Restricting the
 * scheme to http(s) stops `javascript:` and `data:` URLs being stored and then
 * rendered as clickable links in the UI.
 */
function assertHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw badRequest("That does not look like a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw badRequest("Document links must start with https:// or http://");
  }
  return parsed.toString();
}

async function loadChecklistItem(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT ci.*, u.full_name AS done_by_name
       FROM task_checklist_items ci LEFT JOIN users u ON u.id = ci.done_by
      WHERE ci.id = ?`,
  )
    .bind(id)
    .first();
}
