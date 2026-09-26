/**
 * Files attached to invoices, and the client's view of the ones shared with them.
 *
 * shared/invoice-files.ts says what may be attached and what sharing means. Here that
 * meets the bucket, carefully in the same four ways as the staff documents
 * (routes/staff-files.ts):
 *
 *  - every check the browser made is made again;
 *  - the object goes up before its row is written, and comes out after the row goes, so
 *    a failure strands at most an object nobody references - never a row with nothing
 *    behind it;
 *  - nothing is served inline: a file somebody uploaded, opened in the portal's own
 *    origin, is how a document becomes a script;
 *  - a client reaches only a file that is shared, on their own invoice, once issued -
 *    the scope comes from their session, never from the request.
 */

import type { Env } from "../env";
import { requireRole } from "../auth";
import { requireClientUser } from "../client-auth";
import { newId, nowIso } from "../db";
import { Router, badRequest, json, noContent, notFound, readJson } from "../http";
import { MIN_SUPERVISOR_ROLE } from "../../shared/workflow";
import {
  MAX_EMAIL_ATTACHMENT_BYTES,
  MAX_INVOICE_FILES,
  describeFileSize,
  invoiceFileKey,
  invoiceFileType,
  whyNotInvoiceFile,
} from "../../shared/invoice-files";
import type { InvoiceFileRow } from "../../shared/types";

interface FileRecord {
  id: string;
  invoice_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  shared: 0 | 1;
  uploaded_at: string;
  uploaded_by_name?: string | null;
}

function bucket(env: Env): R2Bucket {
  if (!env.FILES) {
    throw badRequest("This portal is not set up to hold files yet. A Partner needs to finish the file storage setup.");
  }
  return env.FILES;
}

/** A filename safe inside a header: quotes and newlines would end it early. */
function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9 ._()-]/g, "_").slice(0, 120).trim() || "file";
}

async function serve(env: Env, row: FileRecord): Promise<Response> {
  const object = await bucket(env).get(row.object_key);
  if (!object) throw notFound("That file is recorded but is not in the store. It will need attaching again.");
  return new Response(object.body, {
    headers: {
      "content-type": row.content_type,
      "content-disposition": `attachment; filename="${safeFilename(row.filename)}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "content-length": String(row.size_bytes),
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}

function describe(row: FileRecord): InvoiceFileRow {
  return {
    id: row.id,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    shared: row.shared,
    uploaded_at: row.uploaded_at,
    uploaded_by_name: row.uploaded_by_name ?? null,
  };
}

/** An invoice's files, oldest first - all of them, or only those shared with the client. */
export async function filesFor(
  env: Env,
  invoiceId: string,
  options: { sharedOnly?: boolean } = {},
): Promise<InvoiceFileRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT f.*, u.full_name AS uploaded_by_name
       FROM invoice_files f LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.invoice_id = ? ${options.sharedOnly ? "AND f.shared = 1" : ""}
      ORDER BY f.uploaded_at`,
  )
    .bind(invoiceId)
    .all<FileRecord>();
  return results.map(describe);
}

/**
 * The files chosen to go out with an invoice email, read from the bucket. Only this
 * invoice's, and only shared ones: a file the firm has not shared never leaves it, the
 * email being just another way out.
 */
export async function emailFiles(
  env: Env,
  invoiceId: string,
  ids: string[],
): Promise<Array<{ filename: string; bytes: Uint8Array; contentType: string }>> {
  if (!ids.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT * FROM invoice_files
      WHERE invoice_id = ? AND shared = 1 AND id IN (${ids.map(() => "?").join(",")})
      ORDER BY uploaded_at`,
  )
    .bind(invoiceId, ...ids)
    .all<FileRecord>();
  if (results.length !== new Set(ids).size) {
    throw badRequest("A file chosen for the email is not shared with the client, or is no longer on this invoice.");
  }
  const total = results.reduce((n, r) => n + r.size_bytes, 0);
  if (total > MAX_EMAIL_ATTACHMENT_BYTES) {
    throw badRequest(
      `Those files come to ${describeFileSize(total)}; an email carries at most ${describeFileSize(MAX_EMAIL_ATTACHMENT_BYTES)}. The client can still download them in the portal.`,
    );
  }
  return await Promise.all(
    results.map(async (r) => {
      const object = await bucket(env).get(r.object_key);
      if (!object) throw badRequest(`${r.filename} is recorded but not in the store. Attach it again.`);
      return { filename: r.filename, bytes: new Uint8Array(await object.arrayBuffer()), contentType: r.content_type };
    }),
  );
}

async function fileById(env: Env, id: string): Promise<FileRecord> {
  const row = await env.DB.prepare(`SELECT * FROM invoice_files WHERE id = ?`).bind(id).first<FileRecord>();
  if (!row) throw notFound("There is no such file.");
  return row;
}

export function registerInvoiceFileRoutes(router: Router<Env>): void {
  /**
   * Attaches one file. The body is the file itself; its name comes in a header,
   * URI-encoded so a name in any language survives the trip. `?shared=1` shares it
   * with the client from the start.
   */
  router.put("/api/invoices/:id/files", async ({ request, env, params, url }) => {
    const actor = await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const invoice = await env.DB.prepare(`SELECT id FROM invoices WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!invoice) throw notFound("There is no such invoice.");

    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM invoice_files WHERE invoice_id = ?`)
      .bind(invoice.id)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_INVOICE_FILES) {
      throw badRequest(`An invoice holds at most ${MAX_INVOICE_FILES} files. Remove one first.`);
    }

    let filename = "file";
    try {
      filename = decodeURIComponent(request.headers.get("x-filename") ?? "").trim() || "file";
    } catch {
      // A malformed name is not worth refusing the file over.
    }
    filename = filename.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200);
    const claimed = request.headers.get("content-type") ?? "";
    // Read before trusting the size: Content-Length is the sender's claim.
    const body = await request.arrayBuffer();
    const refusal = whyNotInvoiceFile({ type: claimed, name: filename, size: body.byteLength });
    if (refusal) throw badRequest(refusal);
    const contentType = invoiceFileType(claimed, filename)!;

    const id = newId();
    const key = invoiceFileKey(invoice.id, id);
    const shared = url.searchParams.get("shared") === "1" ? 1 : 0;
    await bucket(env).put(key, body, { httpMetadata: { contentType } });
    try {
      await env.DB.prepare(
        `INSERT INTO invoice_files
           (id, invoice_id, object_key, filename, content_type, size_bytes, shared, uploaded_by, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, invoice.id, key, filename, contentType, body.byteLength, shared, actor.id, nowIso())
        .run();
    } catch (err) {
      await bucket(env).delete(key);
      throw err;
    }
    return json({ files: await filesFor(env, invoice.id) });
  });

  /** Shares a file with the client, or stops sharing it. */
  router.patch("/api/invoice-files/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const body = await readJson<{ shared?: unknown }>(request);
    if (typeof body.shared !== "boolean") throw badRequest("Say whether the client may see it.");
    const row = await fileById(env, params.id);
    await env.DB.prepare(`UPDATE invoice_files SET shared = ? WHERE id = ?`)
      .bind(body.shared ? 1 : 0, row.id)
      .run();
    return json({ files: await filesFor(env, row.invoice_id) });
  });

  router.delete("/api/invoice-files/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const row = await fileById(env, params.id);
    await env.DB.prepare(`DELETE FROM invoice_files WHERE id = ?`).bind(row.id).run();
    // After the row: at worst an object nobody points at, never a row pointing at nothing.
    if (env.FILES) await env.FILES.delete(row.object_key);
    return noContent();
  });

  router.get("/api/invoice-files/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    return await serve(env, await fileById(env, params.id));
  });

  /**
   * A shared file on the client's own issued invoice. Anything else - another client's,
   * one not shared, one on a draft - is simply absent.
   */
  router.get("/api/client/invoices/:invoiceId/files/:id", async ({ request, env, params }) => {
    const actor = await requireClientUser(env, request);
    const row = await env.DB.prepare(
      `SELECT f.* FROM invoice_files f JOIN invoices i ON i.id = f.invoice_id
        WHERE f.id = ? AND f.invoice_id = ? AND f.shared = 1
          AND i.client_id = ? AND i.state <> 'draft'`,
    )
      .bind(params.id, params.invoiceId, actor.client_id)
      .first<FileRecord>();
    if (!row) throw notFound("There is no such file on your account.");
    return await serve(env, row);
  });
}
