/**
 * The engagement a growth partner signs before they sell anything.
 *
 * Issued when the firm admits them, with their own terms written into it, and signed by
 * them with a picture of their signature. Four things it is careful about.
 *
 * **What they signed is what is kept.** The body is written out in full when the
 * agreement is issued and hashed; the template can be edited afterwards and nothing
 * already signed changes. A partner who signed at 25% goes on holding a document that
 * says 25%.
 *
 * **They cannot sell until it is signed.** A growth partner represents the firm to
 * businesses that have never heard of it, and earns a share of what those businesses
 * pay. Registering a prospect and sending a proposal are refused until the engagement is
 * signed, and the portal says so rather than failing quietly.
 *
 * **The name has to be theirs.** The typed name is checked against the account, as it is
 * for staff signing a contract: a signature box that accepts anything is a signature box
 * that records nothing.
 *
 * **The image is inert.** shared/signatures.ts decides what may be uploaded and argues
 * for the short list; this is the second place in the portal that renders an upload
 * rather than downloading it, and it re-checks the content type on the way out for the
 * same reason worker/routes/signatures.ts does.
 */

import type { Env } from "./../env";
import { requireRole } from "../auth";
import { newId, nowIso, requireString } from "../db";
import {
  Router,
  badRequest,
  forbidden,
  json,
  notFound,
  readJson,
} from "../http";
import { requirePartner } from "../partner-auth";
import { MIN_SUPERVISOR_ROLE } from "../../shared/workflow";
import { readSettings } from "./settings";
import {
  isSignatureType,
  partnerSignatureKey,
  whyNotASignature,
} from "../../shared/signatures";
import { renderSignedCopy, type SignedCopy } from "../../shared/signed-copy";
import { signatureNameMatches } from "../../shared/growth-partners";

export interface AgreementRow {
  id: string;
  partner_id: string;
  title: string;
  body: string;
  content_hash: string;
  commission_rate: number;
  commission_months: number;
  hold_days: number;
  status: "issued" | "signed" | "superseded";
  issued_at: string;
  typed_name: string | null;
  signed_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  signature_key: string | null;
  signature_type: string | null;
}

function bucket(env: Env): R2Bucket {
  if (!env.FILES) {
    throw badRequest(
      "This portal is not set up to hold signature images yet. A Partner needs to finish the file storage setup.",
    );
  }
  return env.FILES;
}

/** SHA-256 of the exact text agreed to, the same way documents are hashed. */
export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Cuts an agreement from the template with this partner's terms written in.
 *
 * Called when the firm admits somebody. Silent where one already stands: admitting
 * twice, or sending a fresh password link, must not quietly replace a signed engagement
 * with an unsigned one.
 */
export async function issueAgreement(
  env: Env,
  partner: {
    id: string;
    full_name: string;
    business_name?: string | null;
    commission_rate: number;
    commission_months: number;
    hold_days: number;
  },
  issuedBy: string | null,
): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT id FROM partner_agreements
      WHERE partner_id = ? AND status IN ('issued', 'signed')`,
  )
    .bind(partner.id)
    .first();
  if (existing) return;

  const [template, settings] = await Promise.all([
    env.DB.prepare(`SELECT title, body FROM documents WHERE id = 'tpl_growth_partner'`)
      .first<{ title: string; body: string }>(),
    readSettings(env),
  ]);
  if (!template) return;

  /*
   * The firm's registered name comes from the same place the employment and associate
   * contracts take it: the firm-wide contract values, held as JSON in settings. Falling
   * back to the trading name rather than leaving a bracket in a signed instrument.
   */
  let legalName = settings.firm_name;
  try {
    const defaults = JSON.parse(settings.contract_defaults || "{}") as Record<string, string>;
    legalName = defaults["FIRM LEGAL NAME"]?.trim() || settings.firm_name;
  } catch {
    // Unset or unreadable, which is the ordinary state of a new deployment.
  }

  const timestamp = nowIso();
  const body = template.body
    .replace(/\[FIRM LEGAL NAME\]/g, legalName)
    .replace(/\[PARTNER NAME\]/g, partner.business_name
      ? `${partner.full_name} of ${partner.business_name}`
      : partner.full_name)
    .replace(/\[COMMISSION RATE\]/g, String(partner.commission_rate))
    .replace(/\[COMMISSION MONTHS\]/g, String(partner.commission_months))
    .replace(/\[HOLD DAYS\]/g, String(partner.hold_days))
    .replace(/\[AGREEMENT DATE\]/g, timestamp.slice(0, 10));

  await env.DB.prepare(
    `INSERT INTO partner_agreements
       (id, partner_id, title, body, content_hash, commission_rate, commission_months,
        hold_days, status, issued_at, issued_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?)`,
  )
    .bind(
      newId(),
      partner.id,
      template.title,
      body,
      await hashText(body),
      partner.commission_rate,
      partner.commission_months,
      partner.hold_days,
      timestamp,
      issuedBy,
      timestamp,
      timestamp,
    )
    .run();
}

/** The agreement a partner is under, signed or not. */
export async function liveAgreement(
  env: Env,
  partnerId: string,
): Promise<AgreementRow | null> {
  return await env.DB.prepare(
    `SELECT id, partner_id, title, body, content_hash, commission_rate,
            commission_months, hold_days, status, issued_at, typed_name, signed_at,
            ip_address, user_agent, signature_key, signature_type
       FROM partner_agreements
      WHERE partner_id = ? AND status IN ('issued', 'signed')`,
  )
    .bind(partnerId)
    .first<AgreementRow>();
}

/**
 * Refuses the thing a partner is trying to do until they have signed.
 *
 * One function, called from the two places that matter - registering a business and
 * sending a proposal - so the rule is stated once and the sentence is the same.
 */
export async function assertSigned(env: Env, partnerId: string): Promise<void> {
  const agreement = await liveAgreement(env, partnerId);
  if (agreement && agreement.status === "signed") return;
  throw forbidden(
    "Sign your engagement first. It is on your own page, and it takes a minute - it sets out what you may say on our behalf and what you earn.",
  );
}

export function registerPartnerAgreementRoutes(router: Router<Env>): void {
  /** What they are being asked to sign, or what they signed. */
  router.get("/api/partner/agreement", async ({ request, env }) => {
    const actor = await requirePartner(env, request);
    const agreement = await liveAgreement(env, actor.id);
    if (!agreement) return json({ agreement: null });

    return json({
      agreement: {
        id: agreement.id,
        title: agreement.title,
        body: agreement.body,
        status: agreement.status,
        issued_at: agreement.issued_at,
        signed_at: agreement.signed_at,
        typed_name: agreement.typed_name,
        commission_rate: agreement.commission_rate,
        commission_months: agreement.commission_months,
        hold_days: agreement.hold_days,
        has_signature: !!agreement.signature_key,
      },
      /** What they must type, so the form can say so rather than refuse afterwards. */
      full_name: actor.full_name,
    });
  });

  /**
   * Uploads the signature they will sign with.
   *
   * The image itself as the body rather than a multipart form, for the reason the staff
   * route gives: one file, no other fields, and a parser with no second use is a parser
   * to get wrong.
   */
  router.put("/api/partner/agreement/signature", async ({ request, env }) => {
    const actor = await requirePartner(env, request);
    const agreement = await liveAgreement(env, actor.id);
    if (!agreement) throw notFound("There is no engagement waiting for you to sign.");
    if (agreement.status === "signed") {
      throw badRequest("That engagement is already signed.");
    }

    const contentType = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    // What actually arrived, not what the sender claimed in Content-Length.
    const body = await request.arrayBuffer();
    const refusal = whyNotASignature({ type: contentType, size: body.byteLength });
    if (refusal) throw badRequest(refusal);

    const key = partnerSignatureKey(actor.id, agreement.id);
    // The object before the row: a failure between the two strands an object that costs
    // a fraction of a penny, where the other order records a signature with no image.
    await bucket(env).put(key, body, { httpMetadata: { contentType } });
    await env.DB.prepare(
      `UPDATE partner_agreements
          SET signature_key = ?, signature_type = ?, updated_at = ?
        WHERE id = ? AND status = 'issued'`,
    )
      .bind(key, contentType, nowIso(), agreement.id)
      .run();

    return json({ ok: true });
  });

  /** Signs it. */
  router.post("/api/partner/agreement/sign", async ({ request, env }) => {
    const actor = await requirePartner(env, request);
    const body = await readJson<{ typed_name?: string }>(request);
    const typed = requireString(body.typed_name, "typed_name", { max: 120 });

    const agreement = await liveAgreement(env, actor.id);
    if (!agreement) throw notFound("There is no engagement waiting for you to sign.");
    if (agreement.status === "signed") {
      throw badRequest("You have already signed this engagement.");
    }
    if (!agreement.signature_key) {
      throw badRequest("Upload the signature you sign with first.");
    }

    // The typed name must be the name on the account. shared/growth-partners.ts says
    // what counts as a match, so the form and this cannot disagree about it.
    if (!signatureNameMatches(typed, actor.full_name)) {
      throw badRequest(
        `Sign with the name on your account: ${actor.full_name}. Tell us if that name is wrong and we will change it before you sign.`,
      );
    }

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE partner_agreements
            SET status = 'signed', typed_name = ?, signed_at = ?, ip_address = ?,
                user_agent = ?, updated_at = ?
          WHERE id = ? AND status = 'issued'`,
      ).bind(
        typed.trim(),
        timestamp,
        request.headers.get("CF-Connecting-IP"),
        request.headers.get("User-Agent")?.slice(0, 300) ?? null,
        timestamp,
        agreement.id,
      ),
      env.DB.prepare(
        `UPDATE growth_partners SET agreement_signed_at = ?, updated_at = ? WHERE id = ?`,
      ).bind(timestamp, timestamp, actor.id),
    ]);

    return json({ signed_at: timestamp });
  });

  /** The signature image, for the page that draws it. */
  router.get("/api/partner/agreement/signature", async ({ request, env }) => {
    const actor = await requirePartner(env, request);
    const agreement = await liveAgreement(env, actor.id);
    if (!agreement?.signature_key) throw notFound("No signature is on file.");
    return await serveImage(env, agreement);
  });

  /** Their own signed copy, as a file they can keep. */
  router.get("/api/partner/agreement/copy", async ({ request, env }) => {
    const actor = await requirePartner(env, request);
    const agreement = await liveAgreement(env, actor.id);
    if (!agreement || agreement.status !== "signed") {
      throw notFound("There is no signed engagement to download yet.");
    }
    return await serveCopy(env, agreement, {
      name: actor.full_name,
      email: actor.email,
    });
  });

  // -------------------------------------------------------------------------
  // The firm's copy
  // -------------------------------------------------------------------------

  router.get("/api/growth-partners/:id/agreement", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const agreement = await liveAgreement(env, params.id);
    if (!agreement) return json({ agreement: null });
    return json({
      agreement: {
        id: agreement.id,
        title: agreement.title,
        status: agreement.status,
        issued_at: agreement.issued_at,
        signed_at: agreement.signed_at,
        typed_name: agreement.typed_name,
      },
    });
  });

  router.get("/api/growth-partners/:id/agreement/copy", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);
    const agreement = await liveAgreement(env, params.id);
    if (!agreement || agreement.status !== "signed") {
      throw notFound("That engagement has not been signed.");
    }
    const partner = await env.DB.prepare(
      `SELECT full_name, email FROM growth_partners WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ full_name: string; email: string }>();
    return await serveCopy(env, agreement, {
      name: partner?.full_name ?? agreement.typed_name ?? "",
      email: partner?.email ?? "",
    });
  });
}

/** Drawable but inert, the content type re-checked against the allowlist on the way out. */
async function serveImage(env: Env, agreement: AgreementRow): Promise<Response> {
  const type = agreement.signature_type ?? "";
  if (!isSignatureType(type)) {
    throw notFound("That signature image is not in a format the portal can display.");
  }
  const object = await bucket(env).get(agreement.signature_key as string);
  if (!object) throw notFound("That signature's image is not in the store.");
  return new Response(object.body, {
    headers: {
      "content-type": type,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}

/** The signed copy: the text as agreed, the evidence, and the signature drawn on it. */
async function serveCopy(
  env: Env,
  agreement: AgreementRow,
  signatory: { name: string; email: string },
): Promise<Response> {
  const settings = await readSettings(env);

  /*
   * The image is inlined rather than linked, for the reason shared/signed-copy.ts gives:
   * this file is sent to people who cannot sign in, and a linked signature would be a
   * broken image in every one of those copies.
   */
  let image: string | null = null;
  if (agreement.signature_key && isSignatureType(agreement.signature_type ?? "")) {
    const object = await bucket(env).get(agreement.signature_key);
    if (object) {
      const bytes = new Uint8Array(await object.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      image = `data:${agreement.signature_type};base64,${btoa(binary)}`;
    }
  }

  const copy: SignedCopy = {
    title: agreement.title,
    body: agreement.body,
    version: 1,
    kind: "form",
    signatory_name: signatory.name,
    signatory_email: signatory.email,
    typed_name: agreement.typed_name ?? "",
    action: "signed",
    signed_at: agreement.signed_at ?? agreement.issued_at,
    ip_address: agreement.ip_address,
    user_agent: agreement.user_agent,
    content_hash: agreement.content_hash,
    current_hash: await hashText(agreement.body),
    firm_name: settings.firm_name,
    signature_image: image,
    had_signature_image: !!agreement.signature_key,
  };

  return new Response(renderSignedCopy(copy), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="growth-partner-engagement.html"`,
      "Cache-Control": "private, no-store",
    },
  });
}
