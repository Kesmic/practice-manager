/**
 * Attaching, reading and replacing the two documents a member of staff holds on their
 * own record.
 *
 * shared/staff-files.ts says what may be attached and why these two are held at all.
 * This is where that meets the bucket, and there are four things it is careful about.
 *
 * **Every check the browser makes is made again here.** The form filters the file
 * chooser and refuses an oversized file before a slow upload, which is a kindness. It
 * is not a control: anything can post to this endpoint.
 *
 * **A passport scan is Partner business.** The person themselves and a Partner, and
 * nobody in between - the same line the rest of the personal record already draws
 * around pay and bank details. A Manager who can see that somebody has supplied their
 * identification still cannot open it.
 *
 * **The object goes up before the row changes, and the old object goes last.** If the
 * write fails half way the worst outcome is an object nobody references, which costs a
 * few pence and can be swept. The other order risks deleting the document somebody
 * just replaced and then failing to record the new one, which loses it.
 *
 * **Nothing is served inline.** These come back as attachments with a fixed content
 * type, because a file somebody else uploaded, rendered in the portal's own origin, is
 * how an uploaded document becomes a script running as the person reading it.
 */

import type { Env } from "../env";
import { requireUser, requireRole } from "../auth";
import { newId, nowIso } from "../db";
import { Router, badRequest, json, noContent, notFound } from "../http";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import {
  MAX_BYTES,
  STAFF_FILE_FIELDS,
  STAFF_FILE_KINDS,
  attachmentId,
  attachmentRef,
  isAcceptedType,
  objectKey,
  whyNotAcceptable,
  type StaffFileKind,
} from "../../shared/staff-files";

interface StaffFileRow {
  id: string;
  user_id: string;
  kind: StaffFileKind;
  object_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

/**
 * The bucket, or a refusal that says what is actually wrong.
 *
 * The binding is optional so that a deployment without the bucket still runs. Somebody
 * meeting that deployment should be told the firm has not finished setting this up,
 * not shown a generic failure they will read as their file being rejected.
 */
function bucket(env: Env): R2Bucket {
  if (!env.FILES) {
    throw badRequest(
      "This portal is not set up to hold attachments yet. A Partner needs to finish the file storage setup; until then, paste a link instead.",
    );
  }
  return env.FILES;
}

function readKind(raw: string | undefined): StaffFileKind {
  if (!raw || !STAFF_FILE_KINDS.includes(raw as StaffFileKind)) {
    throw notFound("There is no such attachment.");
  }
  return raw as StaffFileKind;
}

async function currentFile(
  env: Env,
  userId: string,
  kind: StaffFileKind,
): Promise<StaffFileRow | null> {
  return await env.DB.prepare(
    `SELECT id, user_id, kind, object_key, filename, content_type, size_bytes, uploaded_at
       FROM staff_files WHERE user_id = ? AND kind = ?`,
  )
    .bind(userId, kind)
    .first<StaffFileRow>();
}

/**
 * A filename safe to put in a header.
 *
 * Quotes and control characters end the header value early, and a newline starts a
 * header of the attacker's choosing. The original is kept in the database; this is only
 * what is handed back to a browser.
 */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ._-]/g, "_").slice(0, 100).trim();
  return cleaned || "document";
}

/** Hands an object back, always as a download and never inline. */
async function serve(env: Env, row: StaffFileRow): Promise<Response> {
  const object = await bucket(env).get(row.object_key);
  if (!object) {
    throw notFound(
      "That file is recorded but is not in the store. It will need attaching again.",
    );
  }
  return new Response(object.body, {
    headers: {
      "content-type": row.content_type,
      "content-disposition": `attachment; filename="${safeFilename(row.filename)}"`,
      "content-length": String(row.size_bytes),
      // Never let anything the portal did not write execute in its own origin.
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      // A personal document has no business in a shared cache.
      "cache-control": "private, no-store",
    },
  });
}

/** What the form shows about an attachment, without handing over the file itself. */
function describe(row: StaffFileRow | null) {
  if (!row) return null;
  return {
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: row.uploaded_at,
  };
}

export function registerStaffFileRoutes(router: Router<Env>): void {
  /**
   * Attaches or replaces one of the person's own documents.
   *
   * The body is the file itself rather than a multipart form: there is exactly one file
   * and no other fields, and a parser for a format with no second use is a parser to
   * get wrong.
   */
  router.put("/api/me/files/:kind", async ({ request, env, params }) => {
    const actor = await requireUser(env, request, {
      /*
       * Reachable part-way through a first sign-in. Attaching identification is one of
       * the things the first run asks for, so an endpoint that refuses anybody who has
       * not finished their first run refuses exactly the people it exists for.
       */
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const kind = readKind(params.kind);

    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!isAcceptedType(contentType)) {
      throw badRequest("Attach a PDF or a photograph - PDF, JPEG, PNG, WebP or HEIC.");
    }

    /*
     * Read before trusting the length. Content-Length is the sender's claim about the
     * body, and the check that matters is on what actually arrived.
     */
    const body = await request.arrayBuffer();
    const refusal = whyNotAcceptable({ type: contentType, size: body.byteLength });
    if (refusal) throw badRequest(refusal);

    const filename = (request.headers.get("x-filename") ?? "").trim() || "document";
    const previous = await currentFile(env, actor.id, kind);
    const id = newId();
    const key = objectKey(actor.id, id);
    const timestamp = nowIso();

    await bucket(env).put(key, body, { httpMetadata: { contentType } });

    /*
     * The row and the profile column move together. The column is what every other part
     * of the portal already reads to answer "has this person supplied this", so an
     * attachment that is not recorded there would leave somebody's first run incomplete
     * with the document sitting in the bucket.
     */
    try {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM staff_files WHERE user_id = ? AND kind = ?`).bind(
          actor.id,
          kind,
        ),
        env.DB.prepare(
          `INSERT INTO staff_files
             (id, user_id, kind, object_key, filename, content_type, size_bytes,
              uploaded_at, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          id,
          actor.id,
          kind,
          key,
          filename.slice(0, 200),
          contentType,
          body.byteLength,
          timestamp,
          actor.id,
        ),
        env.DB.prepare(
          `UPDATE employee_profiles SET ${STAFF_FILE_FIELDS[kind]} = ?, updated_at = ?
            WHERE user_id = ?`,
        ).bind(attachmentRef(id), timestamp, actor.id),
      ]);
    } catch (err) {
      // Nothing was recorded, so leaving the object would strand it.
      await bucket(env).delete(key);
      throw err;
    }

    // Last, and only once the new one is safely recorded.
    if (previous) await bucket(env).delete(previous.object_key);

    return json({
      attached: describe({
        ...(previous ?? ({} as StaffFileRow)),
        id,
        user_id: actor.id,
        kind,
        object_key: key,
        filename,
        content_type: contentType,
        size_bytes: body.byteLength,
        uploaded_at: timestamp,
      }),
    });
  });

  /** The person's own attachment. */
  router.get("/api/me/files/:kind", async ({ request, env, params }) => {
    const actor = await requireUser(env, request, {
      /*
       * Reachable part-way through a first sign-in. Attaching identification is one of
       * the things the first run asks for, so an endpoint that refuses anybody who has
       * not finished their first run refuses exactly the people it exists for.
       */
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const row = await currentFile(env, actor.id, readKind(params.kind));
    if (!row) throw notFound("You have not attached that yet.");
    return await serve(env, row);
  });

  /** Removes it, so the person can attach a different one or paste a link instead. */
  router.delete("/api/me/files/:kind", async ({ request, env, params }) => {
    const actor = await requireUser(env, request, {
      /*
       * Reachable part-way through a first sign-in. Attaching identification is one of
       * the things the first run asks for, so an endpoint that refuses anybody who has
       * not finished their first run refuses exactly the people it exists for.
       */
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const kind = readKind(params.kind);
    const row = await currentFile(env, actor.id, kind);
    if (!row) throw notFound("You have not attached that yet.");

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM staff_files WHERE id = ?`).bind(row.id),
      /*
       * Only clears the column if it still points at this attachment. Somebody who
       * pasted a link after attaching a file should not lose the link because the old
       * attachment was tidied away.
       */
      env.DB.prepare(
        `UPDATE employee_profiles SET ${STAFF_FILE_FIELDS[kind]} = NULL, updated_at = ?
          WHERE user_id = ? AND ${STAFF_FILE_FIELDS[kind]} = ?`,
      ).bind(nowIso(), actor.id, attachmentRef(row.id)),
    ]);
    await bucket(env).delete(row.object_key);

    return noContent();
  });

  /**
   * Somebody else's, for a Partner.
   *
   * Partner grade rather than Manager, deliberately. Identification and pay are the two
   * things the personnel record already holds back to Partners, and a scan of a
   * passport is not a lesser thing than the number typed off it.
   */
  router.get("/api/employees/:id/files/:kind", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const kind = readKind(params.kind);
    const row = await currentFile(env, String(params.id), kind);
    if (!row) throw notFound("Nothing has been attached for that person.");
    return await serve(env, row);
  });
}

/**
 * What the profile screen needs to show about somebody's attachments, in one query.
 *
 * Exported rather than a route of its own because it belongs to the profile payload:
 * a form that showed the fields first and the attachments a moment later would flash
 * "nothing attached" at somebody who had attached something.
 */
export async function attachmentsFor(
  env: Env,
  userId: string,
): Promise<Record<string, ReturnType<typeof describe>>> {
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, kind, object_key, filename, content_type, size_bytes, uploaded_at
       FROM staff_files WHERE user_id = ?`,
  )
    .bind(userId)
    .all<StaffFileRow>();

  const out: Record<string, ReturnType<typeof describe>> = {};
  for (const kind of STAFF_FILE_KINDS) {
    out[kind] = describe(results.find((r) => r.kind === kind) ?? null);
  }
  return out;
}

/**
 * Deletes everything in the bucket belonging to somebody, for the account-removal path.
 *
 * Called by both removals. A retirement removes the personal record, and an
 * identification document is the most personal thing in it; an erase removes the row,
 * and the `staff_files` rows go with it by cascade - but a cascade in D1 knows nothing
 * about R2, so without this the passport scan of somebody the firm deleted stays in the
 * bucket indefinitely.
 *
 * Tolerant of a missing binding, because a removal must not be blocked by storage the
 * firm never set up. There is nothing to delete in that case.
 */
export async function deleteStaffFiles(env: Env, userId: string): Promise<number> {
  if (!env.FILES) return 0;
  const { results } = await env.DB.prepare(
    `SELECT object_key FROM staff_files WHERE user_id = ?`,
  )
    .bind(userId)
    .all<{ object_key: string }>();
  if (!results.length) return 0;
  await env.FILES.delete(results.map((r) => r.object_key));
  return results.length;
}

/** Whether a stored column value points at an attachment that really exists. */
export async function attachmentExists(
  env: Env,
  value: string | null | undefined,
): Promise<boolean> {
  const id = attachmentId(value);
  if (!id) return false;
  const row = await env.DB.prepare(`SELECT id FROM staff_files WHERE id = ?`)
    .bind(id)
    .first<{ id: string }>();
  return Boolean(row);
}

export { MAX_BYTES };
