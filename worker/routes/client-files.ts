/**
 * The client file: links to documents held elsewhere.
 *
 * Three rules shape this file, and all three are about what the portal deliberately
 * does not do.
 *
 * 1. **It stores no document content.** Every row is a title and a link. The firm's
 *    SharePoint holds the document, its versions and its permissions.
 * 2. **It grants no access.** Following a link puts the person in front of Microsoft or
 *    Google with their own sign-in. If they have no access there, they are refused
 *    there. The portal cannot widen anybody's reach, which is the main reason this is
 *    a safe feature to add.
 * 3. **It never fetches the link.** No preview, no title lookup, no liveness check.
 *    A Worker fetching a URL an employee typed would be a way to make the firm's
 *    infrastructure issue requests on someone else's behalf, and the portal would learn
 *    nothing it could rely on anyway.
 *
 * Who may do what: any signed-in user may add and edit links, because indexing the
 * work is part of doing it. Removing one needs Manager grade, not because a link is
 * precious but because a client file with things quietly missing from it is worse than
 * one with something stale in it.
 */

import type { Env } from "../env";
import { requireRole, requireUser } from "../auth";
import {
  newId,
  nowIso,
  optionalId,
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, json, noContent, notFound, readJson } from "../http";
import { MIN_SUPERVISOR_ROLE } from "../../shared/workflow";
import {
  FILE_KINDS,
  FILE_LIMITS,
  checkFileUrl,
  providerFromUrl,
} from "../../shared/files";

const FILE_SELECT = `
  SELECT f.*, u.full_name AS added_by_name, e.name AS engagement_name
    FROM client_files f
    LEFT JOIN users u ON u.id = f.added_by
    LEFT JOIN engagements e ON e.id = f.engagement_id`;

/**
 * Folders first, then by category and period. The ordering is in SQL rather than in the
 * client so that every consumer of this endpoint agrees, including anything added later.
 */
const FILE_ORDER = `
  ORDER BY CASE f.kind WHEN 'folder' THEN 0 ELSE 1 END,
           COALESCE(f.category, 'zzz'),
           f.period_label DESC,
           f.title`;

async function loadFile(env: Env, id: string) {
  const row = await env.DB.prepare(`${FILE_SELECT} WHERE f.id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) throw notFound("That entry is not in any client file.");
  return row;
}

/** Validates a link and returns it with the provider worked out from its hostname. */
function readUrl(value: unknown): { url: string; provider: string } {
  const url = requireString(value, "url", { max: FILE_LIMITS.url });
  const check = checkFileUrl(url);
  if (!check.ok) throw badRequest(check.reason);
  return { url, provider: providerFromUrl(url) };
}

export function registerClientFileRoutes(router: Router<Env>): void {
  /** Everything in one client's file. Readable by anyone signed in. */
  router.get("/api/clients/:id/files", async ({ request, env, params }) => {
    await requireUser(env, request);
    const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!client) throw notFound("That client does not exist.");

    const { results } = await env.DB.prepare(
      `${FILE_SELECT} WHERE f.client_id = ? ${FILE_ORDER}`,
    )
      .bind(params.id)
      .all();
    return json({ files: results });
  });

  router.post("/api/clients/:id/files", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!client) throw notFound("That client does not exist.");

    const body = await readJson<Record<string, unknown>>(request);
    const { url, provider } = readUrl(body.url);
    const title = requireString(body.title, "title", { max: FILE_LIMITS.title });
    const kind = body.kind === undefined ? "document" : requireEnum(body.kind, "kind", FILE_KINDS);

    const engagementId = optionalId(body.engagement_id, "engagement_id");
    if (engagementId) {
      // Checked against this client rather than merely existing: filing a document
      // under another client's engagement would put it where nobody will look for it.
      const engagement = await env.DB.prepare(
        `SELECT id FROM engagements WHERE id = ? AND client_id = ?`,
      )
        .bind(engagementId, params.id)
        .first<{ id: string }>();
      if (!engagement) {
        throw badRequest("That engagement does not belong to this client.");
      }
    }

    const id = newId();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO client_files
         (id, client_id, engagement_id, kind, provider, title, url, category,
          period_label, notes, added_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        params.id,
        engagementId,
        kind,
        provider,
        title,
        url,
        optionalString(body.category, "category", FILE_LIMITS.category),
        optionalString(body.period_label, "period_label", FILE_LIMITS.period_label),
        optionalString(body.notes, "notes", FILE_LIMITS.notes),
        actor.id,
        timestamp,
        timestamp,
      )
      .run();

    return json({ file: await loadFile(env, id) }, 201);
  });

  router.patch("/api/client-files/:id", async ({ request, env, params }) => {
    await requireUser(env, request);
    const existing = await loadFile(env, params.id);
    const body = await readJson<Record<string, unknown>>(request);

    // The provider follows the link, so changing one changes the other.
    const link =
      body.url === undefined
        ? { url: String(existing.url), provider: String(existing.provider) }
        : readUrl(body.url);

    const engagementId =
      body.engagement_id === undefined
        ? (existing.engagement_id as string | null)
        : optionalId(body.engagement_id, "engagement_id");
    if (engagementId && engagementId !== existing.engagement_id) {
      const engagement = await env.DB.prepare(
        `SELECT id FROM engagements WHERE id = ? AND client_id = ?`,
      )
        .bind(engagementId, existing.client_id)
        .first<{ id: string }>();
      if (!engagement) {
        throw badRequest("That engagement does not belong to this client.");
      }
    }

    await env.DB.prepare(
      `UPDATE client_files
          SET title = ?, url = ?, provider = ?, kind = ?, category = ?,
              period_label = ?, notes = ?, engagement_id = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        body.title === undefined
          ? existing.title
          : requireString(body.title, "title", { max: FILE_LIMITS.title }),
        link.url,
        link.provider,
        body.kind === undefined ? existing.kind : requireEnum(body.kind, "kind", FILE_KINDS),
        body.category === undefined
          ? existing.category
          : optionalString(body.category, "category", FILE_LIMITS.category),
        body.period_label === undefined
          ? existing.period_label
          : optionalString(body.period_label, "period_label", FILE_LIMITS.period_label),
        body.notes === undefined
          ? existing.notes
          : optionalString(body.notes, "notes", FILE_LIMITS.notes),
        engagementId,
        nowIso(),
        params.id,
      )
      .run();

    return json({ file: await loadFile(env, params.id) });
  });

  /**
   * Removes the reference. The document itself is untouched, and says so in the
   * message the screen shows, because "delete" beside a document link reads more
   * alarming than what it does.
   */
  router.delete("/api/client-files/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    await loadFile(env, params.id);
    await env.DB.prepare(`DELETE FROM client_files WHERE id = ?`).bind(params.id).run();
    return noContent();
  });
}
