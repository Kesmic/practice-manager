/**
 * Uploading a specimen signature, and handing the image back to the people entitled to
 * see it.
 *
 * shared/signatures.ts says what may be uploaded and why the list is shorter than the
 * one for identification documents. This is where that meets the bucket, and there are
 * four things it is careful about.
 *
 * **This is the one upload the portal renders rather than downloads.** Everywhere else
 * a file somebody supplied comes back as an attachment with `content-disposition:
 * attachment`, because rendering somebody else's file in the portal's own origin is how
 * an upload becomes a script running as the person reading it. A signature has to be
 * drawn on the page or it is not doing its job, so instead: the type allowlist excludes
 * SVG, which is the image format that can carry script; the content type served is
 * re-checked against that allowlist here rather than trusted from the row; `nosniff`
 * stops a browser deciding the bytes are something more interesting than the header
 * says; and the sandbox CSP applies in the case that all of that is somehow wrong.
 *
 * **Uploading never overwrites.** The previous specimen is marked retired and left
 * alone, object and all. A contract signed last year goes on showing the signature used
 * last year, and no amount of re-uploading restates anything already signed.
 *
 * **The object goes up before the row.** A failure half way leaves an object nobody
 * references, which costs a fraction of a penny and can be swept. The other order
 * records a signature whose image is not there.
 *
 * **Who may look.** The person themselves, and an HR administrator - the same line the
 * personnel record already draws. A specimen signature is the thing somebody would need
 * in order to forge a document in that person's name, so it is not shown to colleagues
 * who merely share a document with them.
 */

import type { Env } from "../env";
import { requireUser } from "../auth";
import { newId, nowIso } from "../db";
import { Router, badRequest, forbidden, json, noContent, notFound } from "../http";
import { isHrAdmin } from "../../shared/hr";
import {
  isSignatureType,
  signatureKey,
  whyNotASignature,
  type SignatureSpecimen,
} from "../../shared/signatures";

export interface SignatureRow {
  id: string;
  user_id: string;
  object_key: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  retired_at: string | null;
}

/**
 * The bucket, or a refusal that says what is actually wrong.
 *
 * The binding is optional so a deployment without it still runs. Somebody meeting that
 * deployment should be told the firm has not finished the setup, not shown a failure
 * they will read as their own image being rejected.
 */
function bucket(env: Env): R2Bucket {
  if (!env.FILES) {
    throw badRequest(
      "This portal is not set up to hold signature images yet. A Partner needs to finish the file storage setup.",
    );
  }
  return env.FILES;
}

/** The specimen somebody would sign with now: the newest one they have not retired. */
export async function currentSignature(
  env: Env,
  userId: string,
): Promise<SignatureRow | null> {
  return await env.DB.prepare(
    `SELECT id, user_id, object_key, content_type, size_bytes, uploaded_at, retired_at
       FROM staff_signatures
      WHERE user_id = ? AND retired_at IS NULL
      ORDER BY uploaded_at DESC
      LIMIT 1`,
  )
    .bind(userId)
    .first<SignatureRow>();
}

/** What the form is told about a specimen, which is everything except the image. */
function describe(row: SignatureRow | null): SignatureSpecimen | null {
  if (!row) return null;
  return {
    id: row.id,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: row.uploaded_at,
  };
}

/**
 * Hands the image back, drawable but inert.
 *
 * The content type is taken from the allowlist rather than from the row. The row's
 * value arrived in a request header, and although it was checked on the way in, a
 * second check on the way out costs nothing and means a future change to the upload
 * path cannot quietly turn this into a way to serve arbitrary content types from the
 * portal's origin.
 */
export async function serveSignature(env: Env, row: SignatureRow): Promise<Response> {
  if (!isSignatureType(row.content_type)) {
    throw notFound("That signature image is not in a format the portal can display.");
  }
  const object = await bucket(env).get(row.object_key);
  if (!object) {
    throw notFound(
      "That signature is recorded but its image is not in the store. It will need uploading again.",
    );
  }
  return new Response(object.body, {
    headers: {
      "content-type": row.content_type.split(";")[0].trim().toLowerCase(),
      "content-length": String(row.size_bytes),
      // Drawn as an image and nothing else, whatever the bytes turn out to contain.
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      // Somebody's signature has no business in a shared cache.
      "cache-control": "private, no-store",
    },
  });
}

export function registerSignatureRoutes(router: Router<Env>): void {
  /**
   * What the person has on file, if anything.
   *
   * Reachable part-way through a first sign-in, because signing the contract is one of
   * the first things a new joiner is asked to do and uploading the signature for it
   * comes first.
   */
  router.get("/api/me/signature", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    return json({ signature: describe(await currentSignature(env, actor.id)) });
  });

  /**
   * Uploads a new specimen.
   *
   * The body is the image itself rather than a multipart form: there is one file and
   * no other fields, and a parser for a format with no second use is a parser to get
   * wrong.
   */
  router.put("/api/me/signature", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });

    const contentType = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    /*
     * Read the body before trusting any claim about its length. Content-Length is what
     * the sender said; the check that matters is on what actually arrived.
     */
    const body = await request.arrayBuffer();
    const refusal = whyNotASignature({ type: contentType, size: body.byteLength });
    if (refusal) throw badRequest(refusal);

    const previous = await currentSignature(env, actor.id);
    const id = newId();
    const key = signatureKey(actor.id, id);
    const timestamp = nowIso();

    await bucket(env).put(key, body, { httpMetadata: { contentType } });

    try {
      await env.DB.batch([
        /*
         * The old one is retired, not deleted, and its object stays in the bucket.
         * Documents signed with it point at it, and they have to go on resolving.
         */
        env.DB.prepare(
          `UPDATE staff_signatures SET retired_at = ?
            WHERE user_id = ? AND retired_at IS NULL`,
        ).bind(timestamp, actor.id),
        env.DB.prepare(
          `INSERT INTO staff_signatures
             (id, user_id, object_key, content_type, size_bytes, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(id, actor.id, key, contentType, body.byteLength, timestamp),
      ]);
    } catch (err) {
      // Nothing was recorded, so leaving the object would strand it.
      await bucket(env).delete(key);
      throw err;
    }

    return json({
      signature: describe({
        id,
        user_id: actor.id,
        object_key: key,
        content_type: contentType,
        size_bytes: body.byteLength,
        uploaded_at: timestamp,
        retired_at: null,
      }),
      replaced: Boolean(previous),
    });
  });

  /**
   * Takes the current specimen out of use.
   *
   * Retired rather than deleted, for the same reason a replacement retires the old one:
   * whatever has already been signed with it keeps its image. What this changes is that
   * the person has nothing to sign with until they upload another.
   */
  router.delete("/api/me/signature", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const current = await currentSignature(env, actor.id);
    if (!current) throw notFound("You have no signature on file.");
    await env.DB.prepare(`UPDATE staff_signatures SET retired_at = ? WHERE id = ?`)
      .bind(nowIso(), current.id)
      .run();
    return noContent();
  });

  /**
   * One specimen's image, by id.
   *
   * By id rather than by person because a document shows the signature that was used on
   * it, which is not necessarily the one the person would use today.
   */
  router.get("/api/signatures/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const row = await env.DB.prepare(
      `SELECT id, user_id, object_key, content_type, size_bytes, uploaded_at, retired_at
         FROM staff_signatures WHERE id = ?`,
    )
      .bind(params.id)
      .first<SignatureRow>();

    /*
     * One sentence whether it does not exist or belongs to somebody else. Splitting them
     * would let anybody confirm which signature ids are real.
     */
    if (!row) throw notFound("There is no such signature.");
    if (row.user_id !== actor.id && !isHrAdmin(actor.role)) {
      throw forbidden("You can only view your own signature.");
    }
    return await serveSignature(env, row);
  });
}

/**
 * Every signature image belonging to somebody, for the account-removal sweep.
 *
 * Retired specimens included, which is the whole point: they are the ones a sweep that
 * only looked at the current signature would leave in the bucket.
 */
export async function deleteSignatureImages(env: Env, userId: string): Promise<number> {
  if (!env.FILES) return 0;
  const rows = await env.DB.prepare(
    `SELECT object_key FROM staff_signatures WHERE user_id = ?`,
  )
    .bind(userId)
    .all<{ object_key: string }>();
  const keys = rows.results.map((r) => r.object_key);
  if (!keys.length) return 0;
  await env.FILES.delete(keys);
  return keys.length;
}
