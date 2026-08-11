/**
 * Erasing a period of data.
 *
 * Two endpoints on purpose. `preview` counts, changes nothing, and can be called as
 * often as the dates are adjusted. `erase` does the work, and will only do it for a
 * total it was already shown, so a preview left open while somebody else adds records
 * cannot be turned into a larger deletion than the one that was agreed.
 *
 * See shared/erase.ts for what is in scope and what never is.
 */

import type { Env } from "../env";
import { requireRole } from "../auth";
import { newId, nowIso, requireString } from "../db";
import { Router, badRequest, json, readJson } from "../http";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import {
  ERASE_CONFIRMATION,
  ERASE_SCOPES,
  type ErasePreviewRow,
  type EraseRange,
  type EraseScope,
  checkRange,
  warningsFor,
} from "../../shared/erase";

/**
 * The date each scope is judged on.
 *
 * A deliverable is placed by the period it relates to, not by when somebody last
 * touched it: erasing "2019" should mean the 2019 returns, wherever they were closed.
 * Records with no period of their own fall back to when they were created.
 */
const WHEN: Record<EraseScope, string> = {
  closed_deliverables: `date(COALESCE(period_end, statutory_due_date, internal_due_date, created_at))`,
  notifications: `date(created_at)`,
  activity_log: `date(created_at)`,
  client_requests: `date(created_at)`,
};

const TABLE: Record<EraseScope, string> = {
  closed_deliverables: "tasks",
  notifications: "notifications",
  activity_log: "task_events",
  client_requests: "client_requests",
};

/** Only finished work is ever in scope, whatever the dates say. */
const FINISHED = `status IN ('closed','cancelled')`;

/**
 * Rows that would follow a deleted deliverable by cascade. Counted so the preview can
 * say what the real cost is: five closed deliverables can carry several hundred review
 * points, comments and time entries with them.
 */
const CASCADES = [
  "task_checklist_items",
  "task_reviews",
  "review_points",
  "task_comments",
  "task_attachments",
  "time_entries",
  "task_events",
  "notifications",
] as const;

function readScopes(value: unknown): EraseScope[] {
  if (!Array.isArray(value) || !value.length) {
    throw badRequest("Choose at least one kind of record to erase.");
  }
  const scopes = value.map((raw) => {
    if (typeof raw !== "string" || !ERASE_SCOPES.includes(raw as EraseScope)) {
      throw badRequest(`"${String(raw)}" is not something this can erase.`);
    }
    return raw as EraseScope;
  });
  return [...new Set(scopes)];
}

function readRange(body: Record<string, unknown>): EraseRange {
  const checked = checkRange({ from: body.from, to: body.to });
  if (!checked.ok) throw badRequest(checked.problem);
  return checked.range;
}

/** The ids of the deliverables a range would remove. */
async function finishedTaskIds(env: Env, range: EraseRange): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT id FROM tasks
      WHERE ${FINISHED} AND ${WHEN.closed_deliverables} BETWEEN date(?) AND date(?)`,
  )
    .bind(range.from, range.to)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

async function countRows(
  env: Env,
  scope: EraseScope,
  range: EraseRange,
): Promise<number> {
  const extra = scope === "closed_deliverables" ? `${FINISHED} AND ` : "";
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${TABLE[scope]}
      WHERE ${extra}${WHEN[scope]} BETWEEN date(?) AND date(?)`,
  )
    .bind(range.from, range.to)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function buildPreview(env: Env, range: EraseRange, scopes: EraseScope[]) {
  const rows: ErasePreviewRow[] = [];

  for (const scope of scopes) {
    const count = await countRows(env, scope, range);
    const entry: ErasePreviewRow = { scope, count };

    if (scope === "closed_deliverables") {
      const ids = await finishedTaskIds(env, range);
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(", ");
        let cascade = 0;
        for (const table of CASCADES) {
          const row = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM ${table} WHERE task_id IN (${placeholders})`,
          )
            .bind(...ids)
            .first<{ n: number }>();
          cascade += row?.n ?? 0;
        }
        entry.cascade = cascade;
      }
      // Live work inside the same dates, named so its absence is not a surprise.
      const spared = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM tasks
          WHERE NOT (${FINISHED})
            AND ${WHEN.closed_deliverables} BETWEEN date(?) AND date(?)`,
      )
        .bind(range.from, range.to)
        .first<{ n: number }>();
      if (spared?.n) {
        entry.spared = {
          count: spared.n,
          reason: "still live, so left alone",
        };
      }
    }

    rows.push(entry);
  }

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return {
    range,
    rows,
    total,
    warnings: warningsFor(range, scopes, nowIso().slice(0, 10)),
  };
}

export function registerEraseRoutes(router: Router<Env>): void {
  // What would go. Changes nothing.
  router.post("/api/erase/preview", async ({ request, env }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<Record<string, unknown>>(request);
    const range = readRange(body);
    const scopes = readScopes(body.scopes);
    return json({ preview: await buildPreview(env, range, scopes) });
  });

  // What has gone. The erasure is recorded before anything is removed, so a failure
  // part-way through still leaves the attempt on the record.
  router.post("/api/erase", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<Record<string, unknown>>(request);
    const range = readRange(body);
    const scopes = readScopes(body.scopes);

    if (body.confirm !== ERASE_CONFIRMATION) {
      throw badRequest(`Type ${ERASE_CONFIRMATION} to confirm.`);
    }
    const reason = requireString(body.reason, "reason", { max: 500, min: 4 });

    const preview = await buildPreview(env, range, scopes);
    /*
     * The caller sends back the total it showed the firm. If the database has moved
     * on since, this refuses rather than erasing a different, larger set than the one
     * that was agreed to.
     */
    const expected = body.expected_total;
    if (typeof expected !== "number" || !Number.isInteger(expected)) {
      throw badRequest("The confirmation is missing the total it was shown.");
    }
    if (expected !== preview.total) {
      throw badRequest(
        `The records have changed since you looked: ${preview.total} would now be erased, not ${expected}. Check the preview again.`,
      );
    }
    if (preview.total === 0) {
      throw badRequest("Nothing in that period matches, so there is nothing to erase.");
    }

    const removed: Record<string, number> = {};
    const statements: D1PreparedStatement[] = [];

    for (const scope of scopes) {
      const row = preview.rows.find((r) => r.scope === scope);
      removed[scope] = row?.count ?? 0;
      const extra = scope === "closed_deliverables" ? `${FINISHED} AND ` : "";
      statements.push(
        env.DB.prepare(
          `DELETE FROM ${TABLE[scope]}
            WHERE ${extra}${WHEN[scope]} BETWEEN date(?) AND date(?)`,
        ).bind(range.from, range.to),
      );
    }

    const record = {
      id: newId(),
      created_at: nowIso(),
    };

    // Written first, and in the same batch, so the log and the deletion stand or
    // fall together.
    statements.unshift(
      env.DB.prepare(
        `INSERT INTO erasures (id, actor_id, actor_name, actor_email, period_from,
                               period_to, scopes, removed, total_removed, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        record.id,
        actor.id,
        actor.full_name,
        actor.email,
        range.from,
        range.to,
        scopes.join(","),
        JSON.stringify(removed),
        preview.total,
        reason,
        record.created_at,
      ),
    );

    await env.DB.batch(statements);

    return json({
      erased: { id: record.id, range, removed, total: preview.total },
    });
  });

  // The log. Readable by the same grade that can erase, and by nothing else.
  router.get("/api/erasures", async ({ request, env }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const { results } = await env.DB.prepare(
      `SELECT * FROM erasures ORDER BY created_at DESC LIMIT 100`,
    ).all();
    return json({ erasures: results });
  });
}
