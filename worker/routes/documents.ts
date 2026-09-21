/**
 * Portal documents: contracts, handbook policies, notices and templates, plus
 * the record of employees reading, acknowledging and signing them.
 *
 * A signature stores the SHA-256 of the exact text agreed to and is keyed to the
 * document version. Amending a published document raises its version, which
 * makes existing signatures historical rather than current - so an amended
 * policy is put back in front of staff instead of silently inheriting consent.
 */

import type { Env } from "../env";
import { requireRole, requireUser, type AuthenticatedUser } from "../auth";
import {
  hrEventStatement,
  newId,
  notificationStatement,
  nowIso,
  optionalDate,
  optionalId,
  optionalNumber,
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, conflict, forbidden, json, notFound, readJson } from "../http";
import {
  DOCUMENT_AUDIENCES,
  DOCUMENT_KINDS,
  MIN_HR_ADMIN_ROLE,
  isHrAdmin,
  requiredAction,
} from "../../shared/hr";
import { fieldFor, fillContract } from "../../shared/contract-fields";
import {
  NO_SIGNATURE_ON_FILE,
  isSignatureType,
  needsSignatureImage,
} from "../../shared/signatures";
import { currentSignature } from "./signatures";
import {
  renderSignedCopy,
  signedCopyFilename,
  type SignedCopy,
} from "../../shared/signed-copy";
import { resolveContract, withFirmName } from "../contract-fields";
import { readSettings } from "./settings";

interface DocumentRow {
  id: string;
  kind: string;
  category: string | null;
  title: string;
  summary: string | null;
  body: string;
  version: number;
  status: string;
  requires_signature: 0 | 1;
  requires_acknowledgement: 0 | 1;
  audience: string;
  assigned_user_id: string | null;
  effective_from: string | null;
  position: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Columns for list views - deliberately excludes the document body. */
const LIST_COLUMNS = `d.id, d.kind, d.category, d.title, d.summary, d.version, d.status,
  d.requires_signature, d.requires_acknowledgement, d.audience, d.assigned_user_id,
  d.effective_from, d.position, d.published_at, d.created_at, d.updated_at,
  u.full_name AS assigned_user_name`;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Published documents that apply to a given employee and require a response.
 * Firm-wide documents apply to everyone; individually-addressed ones only to
 * their addressee.
 */
export const APPLICABLE_DOCUMENTS_SQL = `
  SELECT ${LIST_COLUMNS}
    FROM documents d
    LEFT JOIN users u ON u.id = d.assigned_user_id
   WHERE d.status = 'published'
     AND (d.requires_signature = 1 OR d.requires_acknowledgement = 1)
     AND (d.audience = 'all' OR d.assigned_user_id = ?1)
`;

/** Applicable documents the employee has not yet responded to at this version. */
export const OUTSTANDING_DOCUMENTS_SQL = `
  ${APPLICABLE_DOCUMENTS_SQL}
     AND NOT EXISTS (
       SELECT 1 FROM document_signatures s
        WHERE s.document_id = d.id
          AND s.version = d.version
          AND s.user_id = ?1
     )
   ORDER BY CASE d.kind WHEN 'contract' THEN 0 ELSE 1 END, d.position, d.title
`;

/**
 * A specimen as the browser sees it: enough to show it and say when it was uploaded,
 * without the object key. Nothing outside the Worker has any use for where a thing
 * lives in the bucket.
 */
/**
 * The signature image inlined into the signed copy, or null.
 *
 * Inlined rather than linked because a signed copy has to open on a machine that has
 * never heard of the portal - that is what it is for. A missing object returns null
 * rather than failing: the rest of the evidence is intact and worth handing over, and
 * the certificate says the image could not be included.
 */
async function signatureDataUri(
  env: Env,
  row: Record<string, unknown>,
): Promise<string | null> {
  const key = row.signature_key as string | null | undefined;
  const type = row.signature_type as string | null | undefined;
  if (!key || !type || !env.FILES) return null;
  if (!isSignatureType(type)) return null;

  const object = await env.FILES.get(key);
  if (!object) return null;

  const bytes = new Uint8Array(await object.arrayBuffer());
  /*
   * Chunked. `String.fromCharCode(...bytes)` on a two-megabyte image spreads two
   * million arguments across the stack and throws; a chunk at a time does not.
   */
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${type.split(";")[0].trim().toLowerCase()};base64,${btoa(binary)}`;
}

function describeSpecimen(
  row: { id: string; content_type: string; size_bytes: number; uploaded_at: string } | null,
) {
  if (!row) return null;
  return {
    id: row.id,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_at: row.uploaded_at,
  };
}

export function registerDocumentRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /**
   * The handbook and any other documents the caller may see. HR administrators
   * additionally see drafts and other people's individually-addressed documents.
   */
  router.get("/api/documents", async ({ request, env, url }) => {
    const actor = await requireUser(env, request);
    const admin = isHrAdmin(actor.role);

    /*
     * Placeholders are numbered explicitly rather than positional. The viewer's
     * own id is referenced from the SELECT subqueries as well as the WHERE
     * clause, and SQLite numbers a bare `?` by textual position - mixing the two
     * styles silently shifts every index. `?1` is always the viewer.
     */
    const binds: unknown[] = [actor.id];
    const param = (value: unknown): string => {
      binds.push(value);
      return `?${binds.length}`;
    };

    const filters: string[] = [];

    const kind = url.searchParams.get("kind");
    if (kind) {
      filters.push(`d.kind = ${param(requireEnum(kind, "kind", DOCUMENT_KINDS))}`);
    }

    if (admin) {
      const status = url.searchParams.get("status");
      if (status) {
        filters.push(
          `d.status = ${param(
            requireEnum(status, "status", ["draft", "published", "archived"] as const),
          )}`,
        );
      }
      const forUser = url.searchParams.get("user_id");
      if (forUser) {
        filters.push(`(d.audience = 'all' OR d.assigned_user_id = ${param(forUser)})`);
      }
    } else {
      // Everyone else sees published documents addressed to them or to all.
      filters.push(`d.status = 'published'`);
      filters.push(`(d.audience = 'all' OR d.assigned_user_id = ?1)`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { results } = await env.DB.prepare(
      `SELECT ${LIST_COLUMNS},
              (SELECT s.action FROM document_signatures s
                WHERE s.document_id = d.id AND s.version = d.version
                  AND s.user_id = ?1) AS my_action,
              (SELECT s.signed_at FROM document_signatures s
                WHERE s.document_id = d.id AND s.version = d.version
                  AND s.user_id = ?1) AS my_signed_at
         FROM documents d
         LEFT JOIN users u ON u.id = d.assigned_user_id
         ${where}
         ORDER BY d.kind, d.position, d.title`,
    )
      .bind(...binds)
      .all();

    return json({ documents: results });
  });

  router.get("/api/documents/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);
    const doc = await loadDocument(env, params.id);
    assertMayRead(doc, actor);

    const mine = await env.DB.prepare(
      `SELECT * FROM document_signatures
        WHERE document_id = ? AND version = ? AND user_id = ?`,
    )
      .bind(doc.id, doc.version, actor.id)
      .first();

    const payload: Record<string, unknown> = {
      document: { ...doc, assigned_user_name: null },
      my_signature: mine ?? null,
      /*
       * Whether they have a signature to sign with, so the form can say so before they
       * have read three pages rather than after. Only for documents that need one: an
       * acknowledgement never asks for an image, and offering the upload there would
       * suggest otherwise.
       */
      my_signature_specimen: needsSignatureImage(doc)
        ? describeSpecimen(await currentSignature(env, actor.id))
        : null,
    };

    // HR administrators also get the firm-wide compliance picture.
    if (isHrAdmin(actor.role)) {
      const [signatures, outstanding] = await env.DB.batch([
        env.DB.prepare(
          `SELECT s.*, u.full_name AS user_name
             FROM document_signatures s
             JOIN users u ON u.id = s.user_id
            WHERE s.document_id = ?
            ORDER BY s.version DESC, s.signed_at DESC`,
        ).bind(doc.id),
        env.DB.prepare(
          `SELECT u.id AS user_id, u.full_name
             FROM users u
            WHERE u.status = 'active'
              AND (?2 = 'all' OR u.id = ?3)
              AND NOT EXISTS (
                SELECT 1 FROM document_signatures s
                 WHERE s.document_id = ?1 AND s.version = ?4 AND s.user_id = u.id
              )
            ORDER BY u.full_name`,
        ).bind(doc.id, doc.audience, doc.assigned_user_id, doc.version),
      ]);
      payload.signatures = signatures.results;
      payload.outstanding = outstanding.results;
    }

    return json(payload);
  });

  // -------------------------------------------------------------------------
  // Signing and acknowledging
  // -------------------------------------------------------------------------

  router.post("/api/documents/:id/sign", async ({ request, env, params }) => {
    const actor = await requireUser(env, request, { allowPasswordPending: false });
    const doc = await loadDocument(env, params.id);

    if (doc.status !== "published") {
      throw badRequest("This document is not published, so it cannot be signed.");
    }
    if (doc.audience === "individual" && doc.assigned_user_id !== actor.id) {
      throw forbidden("This document is addressed to someone else.");
    }

    const action = requiredAction(doc);
    if (!action) {
      throw badRequest("This document does not require a signature or acknowledgement.");
    }

    const body = await readJson<{ typed_name?: string }>(request);
    const typedName = requireString(body.typed_name, "typed_name", { max: 160 });

    /*
     * The typed name must match the name on the account. Accepting anything at
     * all would make the record worthless; comparing loosely (case and internal
     * spacing) keeps it usable without weakening it.
     */
    if (normaliseName(typedName) !== normaliseName(actor.full_name)) {
      throw badRequest(
        `Please type your full name exactly as it appears on your account: ${actor.full_name}`,
      );
    }

    /*
     * A contract needs the person's signature on it, not only their name typed into a
     * box. shared/signatures.ts sets out why that is asked for signing and not for
     * acknowledging: a policy acknowledgement records that somebody read something,
     * and an upload for each of a dozen policies buys nothing the click does not
     * already prove.
     *
     * Checked here as well as in the form, because the form is a courtesy and anything
     * can post to this endpoint.
     */
    const specimen = needsSignatureImage(doc)
      ? await currentSignature(env, actor.id)
      : null;
    if (needsSignatureImage(doc) && !specimen) {
      throw badRequest(NO_SIGNATURE_ON_FILE);
    }

    const existing = await env.DB.prepare(
      `SELECT id FROM document_signatures
        WHERE document_id = ? AND version = ? AND user_id = ?`,
    )
      .bind(doc.id, doc.version, actor.id)
      .first<{ id: string }>();
    if (existing) {
      throw conflict("You have already responded to this version of the document.");
    }

    const timestamp = nowIso();
    const contentHash = await sha256Hex(doc.body);
    // Recorded as evidence of the circumstances of signature.
    const ip =
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For") ??
      null;

    const statements = [
      env.DB.prepare(
        /*
         * The specimen is recorded by id, fixing which signature was used. Uploading a
         * different one later adds a row rather than replacing this one, so what is on
         * this contract stays what was on it.
         */
        `INSERT INTO document_signatures
           (id, document_id, version, user_id, action, typed_name, content_hash,
            signed_at, ip_address, user_agent, signature_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId(),
        doc.id,
        doc.version,
        actor.id,
        action,
        typedName,
        contentHash,
        timestamp,
        ip,
        request.headers.get("User-Agent")?.slice(0, 300) ?? null,
        specimen?.id ?? null,
      ),
      hrEventStatement(env, {
        subjectId: actor.id,
        actorId: actor.id,
        kind: `document:${action}`,
        detail: `${doc.title} (version ${doc.version})`,
      }),
    ];

    // A signed contract is something HR needs to know about without asking.
    if (doc.kind === "contract") {
      const admins = await env.DB.prepare(
        `SELECT id FROM users
          WHERE status = 'active' AND role IN ('partner','admin')`,
      ).all<{ id: string }>();
      for (const admin of admins.results) {
        statements.push(
          notificationStatement(env, {
            userId: admin.id,
            taskId: null,
            kind: "hr:contract_signed",
            title: `${actor.full_name} signed their contract`,
            body: doc.title,
          }),
        );
      }
    }

    await env.DB.batch(statements);

    const signature = await env.DB.prepare(
      `SELECT * FROM document_signatures
        WHERE document_id = ? AND version = ? AND user_id = ?`,
    )
      .bind(doc.id, doc.version, actor.id)
      .first();

    return json({ signature }, 201);
  });

  // -------------------------------------------------------------------------
  // Authoring
  // -------------------------------------------------------------------------

  router.post("/api/documents", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<Record<string, unknown>>(request);
    const fields = await readDocumentFields(env, body, true);

    const id = newId();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO documents
         (id, kind, category, title, summary, body, version, status,
          requires_signature, requires_acknowledgement, audience, assigned_user_id,
          effective_from, position, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        fields.kind,
        fields.category,
        fields.title,
        fields.summary,
        fields.body,
        fields.requires_signature,
        fields.requires_acknowledgement,
        fields.audience,
        fields.assigned_user_id,
        fields.effective_from,
        fields.position ?? 0,
        actor.id,
        timestamp,
        timestamp,
      )
      .run();

    return json({ document: await loadDocument(env, id) }, 201);
  });

  /**
   * Copies a document for one employee. This is how a contract is issued.
   *
   * A contract cannot work like a handbook policy. A policy is one text everybody
   * acknowledges, so one record serves the whole firm. A contract is a different
   * document for each person: their job title, their salary, their start date, their
   * notice period. Publishing one contract to everyone would ask every employee to
   * sign somebody else's terms.
   *
   * So the seeded contract stays an unpublished template, and this endpoint makes a
   * copy of it addressed to one person, as a draft, for the firm to fill in and then
   * publish to them alone. The template is never touched, so it stays reusable, and
   * each employee's contract is its own record with its own signature and its own
   * version history.
   */
  /**
   * A downloadable copy of a document somebody has signed, with the evidence attached.
   *
   * The portal already recorded everything a typed-name signature needs to stand up -
   * who signed, the name they typed, when, from what address, on which version, and a
   * SHA-256 of the text agreed to. All of it lived in a row the signatory could not
   * obtain, so somebody asked for their contract by a bank or a landlord had a
   * screenshot to offer.
   *
   * Returned as a file rather than a page. It is the document plus a signature
   * certificate, styled to print to a clean PDF from any browser.
   */
  router.get("/api/documents/:id/signed-copy", async ({ request, env, params }) => {
    const actor = await requireUser(env, request);

    /*
     * Whose copy this is. A person may download their own; an HR administrator may
     * download anybody's, because the personnel file is theirs to keep. Nobody else,
     * whatever their grade - a signed contract is the terms of somebody's employment.
     */
    const forUserId =
      new URL(request.url).searchParams.get("user_id")?.trim() || actor.id;
    if (forUserId !== actor.id && !isHrAdmin(actor.role)) {
      throw forbidden("You can only download your own signed documents.");
    }

    const row = await env.DB.prepare(
      /*
       * Left join to the specimen: the signature record is the thing that must be
       * found, and an image that has since been lost must not make the whole signed
       * copy unobtainable. The certificate says which case it is.
       */
      `SELECT d.title, d.body, d.kind, s.version, s.action, s.typed_name,
              s.content_hash, s.signed_at, s.ip_address, s.user_agent,
              s.signature_id,
              sig.object_key AS signature_key, sig.content_type AS signature_type,
              u.full_name AS signatory_name, u.email AS signatory_email
         FROM document_signatures s
         JOIN documents d ON d.id = s.document_id
         JOIN users u ON u.id = s.user_id
         LEFT JOIN staff_signatures sig ON sig.id = s.signature_id
        WHERE s.document_id = ? AND s.user_id = ?
        ORDER BY s.version DESC
        LIMIT 1`,
    )
      .bind(params.id, forUserId)
      .first<Record<string, unknown>>();

    /*
     * One sentence whether the document does not exist or was never signed. Splitting
     * them would let anybody probe which documents exist and who has signed what.
     */
    if (!row) {
      throw notFound("There is no signed copy of that document for this person.");
    }

    const settings = await readSettings(env);
    const body = String(row.body);

    const copy: SignedCopy = {
      title: String(row.title),
      body,
      kind: String(row.kind),
      version: Number(row.version),
      signatory_name: String(row.signatory_name),
      signatory_email: String(row.signatory_email),
      typed_name: String(row.typed_name),
      action: row.action === "acknowledged" ? "acknowledged" : "signed",
      signed_at: String(row.signed_at),
      ip_address: (row.ip_address as string | null) ?? null,
      user_agent: (row.user_agent as string | null) ?? null,
      content_hash: String(row.content_hash),
      signature_image: await signatureDataUri(env, row),
      had_signature_image: Boolean(row.signature_id),
      // Worked out here rather than trusted, which is what lets the certificate say
      // whether the text in the file is the text that was signed.
      current_hash: await sha256Hex(body),
      firm_name: settings.firm_name,
    };

    return new Response(renderSignedCopy(copy), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${signedCopyFilename(copy)}"`,
        // A signed copy is somebody's employment terms; nothing should cache it.
        "Cache-Control": "no-store",
      },
    });
  });

  router.post("/api/documents/:id/copy-for", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      assigned_user_id?: unknown;
      title?: unknown;
      kind?: unknown;
      requires_signature?: unknown;
    }>(request);

    const source = await env.DB.prepare(
      `SELECT kind, category, title, summary, body, requires_signature,
              requires_acknowledgement, effective_from, position
         FROM documents WHERE id = ?`,
    )
      .bind(params.id)
      .first<Record<string, unknown>>();
    if (!source) throw notFound("That document does not exist.");

    /*
     * Two things deliberately differ from the source.
     *
     * The copy requires a signature unless told otherwise. The seeded contract
     * template is stored as a form with no signature required, because nobody signs a
     * template; the copy is the thing that gets signed, and inheriting 0 here would
     * produce an unsignable contract, which is the one outcome that would make this
     * endpoint pointless.
     *
     * The copy may also be given a different kind, so an issued contract files under
     * Contracts rather than under Form / template where its source lives. The caller
     * says so explicitly rather than the server guessing from the title.
     */
    const requiresSignature =
      body.requires_signature === false || body.requires_signature === 0 ? 0 : 1;
    const kind = body.kind === undefined
      ? String(source.kind)
      : requireEnum(body.kind, "kind", DOCUMENT_KINDS);

    const assignedUserId = optionalId(body.assigned_user_id, "assigned_user_id");
    if (!assignedUserId) {
      throw badRequest("Choose the employee this copy is for.");
    }
    const person = await env.DB.prepare(
      `SELECT full_name FROM users WHERE id = ?`,
    )
      .bind(assignedUserId)
      .first<{ full_name: string }>();
    if (!person) throw badRequest("The selected employee does not exist.");

    /*
     * Complete the placeholders from what the firm already knows.
     *
     * Both templates are written with bracketed fields - the person's name, their job
     * title, the notice period, the fee for each tier. Substituting them here rather
     * than leaving them to be found by hand is the difference between issuing a
     * contract and issuing a form. Thirty-eight of them in the Associate agreement:
     * the ones that get missed by hand are the ones deep in the schedules, which is
     * also where the money is.
     *
     * Anything without a value is left as its bracket rather than blanked. A contract
     * reading "notice of  days" is grammatical enough to skim past; one reading
     * "notice of [NOTICE DAYS] days" is not, and the response says which are left so
     * the screen can put them in front of whoever is issuing it.
     */
    const resolution = await resolveContract(env, assignedUserId);
    const settings = await readSettings(env);
    const merged = fillContract(
      String(source.body),
      resolution ? withFirmName(resolution, settings.firm_name).values : {},
    );

    // Their name in the title by default, because a personnel file with four
    // documents all called "Contract of Employment (template)" is unusable.
    const title =
      optionalString(body.title, "title", 200) ??
      `${String(source.title).replace(/\s*\(template\)\s*$/i, "")} - ${person.full_name}`;

    const id = newId();
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO documents
         (id, kind, category, title, summary, body, version, status,
          requires_signature, requires_acknowledgement, audience, assigned_user_id,
          effective_from, position, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'draft', ?, ?, 'individual', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        kind,
        source.category,
        title,
        source.summary,
        merged.text,
        requiresSignature,
        source.requires_acknowledgement ?? 0,
        assignedUserId,
        source.effective_from,
        source.position ?? 0,
        actor.id,
        timestamp,
        timestamp,
      )
      .run();

    return json(
      {
        document: await loadDocument(env, id),
        /*
         * What the copy still needs, so the screen can say so rather than leaving it
         * to be discovered by the employee reading their own contract.
         *
         * `outstanding` is what a merge field was meant to fill and could not.
         * `awaiting_employee` is the subset of those that answer themselves when the
         * person signs in for the first time - their address, TIN and Ghana Card
         * number - which is a different instruction to whoever is issuing it.
         * `manual` is what no merge field was ever going to fill: the assigned-client
         * schedule, and the date beside each signature.
         */
        merge: {
          filled: merged.filled,
          outstanding: merged.outstanding,
          awaiting_employee: merged.outstanding.filter(
            (token) => fieldFor(token)?.from?.filledBy === "employee",
          ),
          manual: merged.manual,
        },
      },
      201,
    );
  });

  router.patch("/api/documents/:id", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const doc = await loadDocument(env, params.id);
    const body = await readJson<Record<string, unknown>>(request);
    const fields = await readDocumentFields(env, body, false);

    /*
     * Editing the text of a published document raises its version. That is what
     * puts it back in front of everyone: outstanding-document queries compare
     * signatures against the current version, so previous consent no longer
     * counts once the terms have changed. Editing a draft changes nothing,
     * because nobody has agreed to it yet.
     */
    const bodyChanged =
      fields.body !== undefined && fields.body !== null && fields.body !== doc.body;
    const bumpVersion = bodyChanged && doc.status === "published";

    const assignments: string[] = [];
    const binds: unknown[] = [];
    for (const [column, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      binds.push(value);
    }
    if (bumpVersion) assignments.push(`version = version + 1`);
    if (!assignments.length) throw badRequest("No changes supplied.");

    assignments.push(`updated_at = ?`);
    binds.push(nowIso(), params.id);

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE documents SET ${assignments.join(", ")} WHERE id = ?`,
      ).bind(...binds),
      hrEventStatement(env, {
        subjectId: doc.assigned_user_id,
        actorId: actor.id,
        kind: bumpVersion ? "document:amended" : "document:edited",
        detail: bumpVersion
          ? `${doc.title} amended to version ${doc.version + 1}; acknowledgements reset`
          : doc.title,
      }),
    ]);

    return json({ document: await loadDocument(env, params.id) });
  });

  /** Publishing is what makes a document visible and actionable to staff. */
  router.post("/api/documents/:id/publish", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const doc = await loadDocument(env, params.id);
    const body = await readJson<{ status?: string }>(request);
    const target = requireEnum(body.status ?? "published", "status", [
      "published",
      "archived",
      "draft",
    ] as const);

    if (target === doc.status) {
      throw badRequest(`This document is already ${target}.`);
    }
    if (target === "published" && !doc.body.trim()) {
      throw badRequest("A document cannot be published with an empty body.");
    }

    const timestamp = nowIso();
    const statements = [
      env.DB.prepare(
        `UPDATE documents
            SET status = ?,
                published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END,
                published_by = CASE WHEN ? = 'published' THEN ? ELSE published_by END,
                updated_at = ?
          WHERE id = ?`,
      ).bind(target, target, timestamp, target, actor.id, timestamp, doc.id),
      hrEventStatement(env, {
        subjectId: doc.assigned_user_id,
        actorId: actor.id,
        kind: `document:${target}`,
        detail: `${doc.title} (version ${doc.version})`,
      }),
    ];

    // Tell the people who now have something to do about it.
    if (target === "published" && requiredAction(doc)) {
      const recipients = await env.DB.prepare(
        doc.audience === "all"
          ? `SELECT id FROM users WHERE status = 'active'`
          : `SELECT id FROM users WHERE status = 'active' AND id = ?`,
      )
        .bind(...(doc.audience === "all" ? [] : [doc.assigned_user_id]))
        .all<{ id: string }>();

      const verb = doc.requires_signature ? "signature" : "acknowledgement";
      for (const person of recipients.results) {
        statements.push(
          notificationStatement(env, {
            userId: person.id,
            taskId: null,
            kind: "hr:document_published",
            title: `${doc.title} needs your ${verb}`,
            body: doc.summary,
          }),
        );
      }
    }

    await env.DB.batch(statements);
    return json({ document: await loadDocument(env, doc.id) });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadDocument(env: Env, id: string): Promise<DocumentRow> {
  const doc = await env.DB.prepare(`SELECT * FROM documents WHERE id = ?`)
    .bind(id)
    .first<DocumentRow>();
  if (!doc) throw notFound("That document does not exist.");
  return doc;
}

function assertMayRead(doc: DocumentRow, actor: AuthenticatedUser): void {
  if (isHrAdmin(actor.role)) return;
  if (doc.status !== "published") {
    throw notFound("That document does not exist.");
  }
  if (doc.audience === "individual" && doc.assigned_user_id !== actor.id) {
    throw forbidden("This document is addressed to someone else.");
  }
}

/** Collapses case and internal whitespace so a typed name is compared fairly. */
function normaliseName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function readDocumentFields(
  env: Env,
  body: Record<string, unknown>,
  creating: boolean,
) {
  const audience = creating
    ? (body.audience
        ? requireEnum(body.audience, "audience", DOCUMENT_AUDIENCES)
        : "all")
    : body.audience === undefined
      ? undefined
      : requireEnum(body.audience, "audience", DOCUMENT_AUDIENCES);

  const assignedUserId = optionalId(body.assigned_user_id, "assigned_user_id");
  if (assignedUserId) {
    const exists = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
      .bind(assignedUserId)
      .first<{ id: string }>();
    if (!exists) throw badRequest("The selected employee does not exist.");
  }
  if (audience === "individual" && !assignedUserId) {
    throw badRequest("An individually addressed document needs an employee.");
  }

  const requiresSignature =
    body.requires_signature === undefined
      ? creating
        ? 0
        : undefined
      : body.requires_signature === true || body.requires_signature === 1
        ? 1
        : 0;
  const requiresAck =
    body.requires_acknowledgement === undefined
      ? creating
        ? 0
        : undefined
      : body.requires_acknowledgement === true || body.requires_acknowledgement === 1
        ? 1
        : 0;

  const fields: Record<string, unknown> = {
    kind: creating
      ? requireEnum(body.kind, "kind", DOCUMENT_KINDS)
      : body.kind === undefined
        ? undefined
        : requireEnum(body.kind, "kind", DOCUMENT_KINDS),
    category: optionalString(body.category, "category", 80),
    title: creating
      ? requireString(body.title, "title", { max: 200 })
      : body.title === undefined
        ? undefined
        : requireString(body.title, "title", { max: 200 }),
    summary: optionalString(body.summary, "summary", 500),
    body: creating
      ? requireString(body.body, "body", { max: 200_000 })
      : body.body === undefined
        ? undefined
        : requireString(body.body, "body", { max: 200_000 }),
    requires_signature: requiresSignature,
    requires_acknowledgement: requiresAck,
    audience,
    effective_from: optionalDate(body.effective_from, "effective_from"),
    position: optionalNumber(body.position, "position", { max: 10_000 }),
    // `optionalId` already turns an absent value into null, which is what the
    // INSERT needs. Mapping it back to `undefined` here would bind undefined to
    // D1 and fail the whole request - an all-staff policy, which is the ordinary
    // case, carries no assigned employee. Updates are handled by the loop below.
    assigned_user_id: assignedUserId,
  };

  /*
   * The `optional*` helpers turn an absent value into null, which is right when
   * creating (the INSERT needs a value for every column) but wrong when
   * updating: it would blank the category, summary and effective date of any
   * document edited through a partial PATCH, and would try to write NULL into
   * the NOT NULL `position` column. So on update, drop anything the caller did
   * not actually send.
   */
  if (!creating) {
    for (const key of Object.keys(fields)) {
      if (body[key] === undefined) delete fields[key];
    }
  }

  return fields as {
    kind?: string;
    category?: string | null;
    title?: string;
    summary?: string | null;
    body?: string;
    requires_signature?: 0 | 1;
    requires_acknowledgement?: 0 | 1;
    audience?: string;
    assigned_user_id?: string | null;
    effective_from?: string | null;
    position?: number | null;
  };
}
