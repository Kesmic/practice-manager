/**
 * Everything a growth partner can reach.
 *
 * The third population with accounts here, after staff and clients, and the rules are
 * the client portal's rules with one addition of their own.
 *
 * **Scope is never taken from the request.** Every query filters on `actor.id`, read off
 * the session row. There is no endpoint on which a partner names the partner whose
 * prospects, proposals or commissions they want.
 *
 * **A partner sees their own pipeline and their own earnings, and nothing else of the
 * firm.** Not other partners, not other clients, not what anybody else is paid. What
 * they do see of a client they sold is what they need to do the job: that the invoice
 * went out, and what it earned them.
 *
 * **Nobody applies; the firm invites.** There is no open form. A partner exists because
 * somebody at the firm added them, set their terms, and sent them a link to set a
 * password. So the only way onto the list is through a person with the role to add to
 * it, and the public sees a sign-in and nothing else.
 *
 * **A partner never marks their own prospect won.** Won means the firm has a signed
 * client, and the stage machine in shared/growth-partners.ts refuses the move. A partner
 * who could make it would be declaring their own commission.
 */

import type { Env } from "../env";
import {
  assertPasswordPolicy,
  decoyHash,
  hashPassword,
  newToken,
  tokenDigest,
  verifyPassword,
} from "../auth";
import {
  PARTNER_RESET_TTL_MINUTES,
  clearedPartnerCookie,
  createPartnerSession,
  destroyPartnerSession,
  requirePartner,
} from "../partner-auth";
import {
  assertLoginAllowed,
  attemptKeys,
  clearAccountFailures,
  recordFailure,
} from "../throttle";
import { newId, nowIso, requireEnum, requireString } from "../db";
import { readSettings } from "./settings";
import { readCatalogue } from "./subscriptions";
import { sendToPerson } from "../email";
import {
  Router,
  badRequest,
  conflict,
  json,
  noContent,
  notFound,
  readJson,
  unauthorized,
} from "../http";
import { CLIENT_TIERS, type ClientTier } from "../../shared/subscriptions";
import { CURRENCIES, DEFAULT_CURRENCY } from "../../shared/money";
import {
  PROSPECT_STAGES,
  describeEntitlement,
  holdUntil,
  mayMoveProspect,
  prospectKey,
  whyNotAProspect,
  type ProspectStage,
} from "../../shared/growth-partners";
import { readHistory } from "../commissions";
import { assertSigned } from "./partner-agreement";

/** One sentence for every way a sign-in can fail, for the client portal's reasons. */
const SIGN_IN_REFUSAL = "That email address and password do not match an account.";

/** How long a proposal link stands. Long enough to be read, short enough to expire. */
const PROPOSAL_TTL_DAYS = 30;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function portalBase(env: Env): string {
  return (env.PORTAL_URL || "https://portal.kesmic.org").replace(/\/$/, "");
}

/**
 * The link a partner follows to set a password, and the row behind it.
 *
 * Exported because the firm's own side issues one too - admitting a partner is what
 * sends the first link - and two ways of minting the same credential would eventually
 * differ in the one respect that mattered.
 */
export async function issueInvitation(
  env: Env,
  partnerId: string,
  minutes: number,
): Promise<string> {
  const token = newToken();
  const timestamp = nowIso();
  await env.DB.batch([
    // Any link already out stops working, so there is never more than one live.
    env.DB.prepare(
      `DELETE FROM growth_partner_invitations WHERE partner_id = ? AND used_at IS NULL`,
    ).bind(partnerId),
    env.DB.prepare(
      `INSERT INTO growth_partner_invitations (id, partner_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(
      await tokenDigest(token),
      partnerId,
      new Date(Date.now() + minutes * 60_000).toISOString(),
      timestamp,
    ),
  ]);
  return `${portalBase(env)}/partner/invitation/${encodeURIComponent(token)}`;
}

export function registerPartnerRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // Getting in
  // -------------------------------------------------------------------------

  router.post("/api/partner/login", async ({ request, env }) => {
    const body = await readJson<{ email?: string; password?: string }>(request);
    const email = (body.email ?? "").trim().toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";

    const keys = await attemptKeys(request, email || "@partner");
    await assertLoginAllowed(env, keys);

    const row = await env.DB.prepare(
      `SELECT id, password_hash, status FROM growth_partners WHERE email = ? COLLATE NOCASE`,
    )
      .bind(email)
      .first<{ id: string; password_hash: string | null; status: string }>();

    // A decoy hash where there is no account, so the two take the same time to refuse.
    const hash = row?.password_hash ?? decoyHash(env);
    const ok = await verifyPassword(env, password, hash);

    if (!row || !row.password_hash || !ok || row.status !== "active") {
      await recordFailure(env, keys);
      throw unauthorized(SIGN_IN_REFUSAL);
    }

    await clearAccountFailures(env, keys);
    const { cookie } = await createPartnerSession(
      env,
      row.id,
      request.headers.get("User-Agent"),
    );
    await env.DB.prepare(`UPDATE growth_partners SET last_login_at = ? WHERE id = ?`)
      .bind(nowIso(), row.id)
      .run();

    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  });

  router.post("/api/partner/logout", async ({ request, env }) => {
    await destroyPartnerSession(env, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearedPartnerCookie });
  });

  router.get("/api/partner/session", async ({ request, env }) => {
    const actor = await requirePartner(env, request);
    return json({
      partner: {
        id: actor.id,
        email: actor.email,
        full_name: actor.full_name,
        business_name: actor.business_name,
        commission_rate: actor.commission_rate,
        commission_months: actor.commission_months,
        hold_days: actor.hold_days,
        agreement_signed_at: actor.agreement_signed_at,
      },
    });
  });

  /** Whether a link is still good, saying nothing about whose it is. */
  router.get("/api/partner/invitation/:token", async ({ env, params }) => {
    const row = await env.DB.prepare(
      `SELECT i.expires_at, i.used_at, p.full_name, p.email
         FROM growth_partner_invitations i
         JOIN growth_partners p ON p.id = i.partner_id
        WHERE i.id = ?`,
    )
      .bind(await tokenDigest(decodeURIComponent(params.token)))
      .first<{
        expires_at: string;
        used_at: string | null;
        full_name: string;
        email: string;
      }>();

    if (!row || row.used_at) {
      throw notFound("This link is not valid. Please ask us for a new one.");
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw notFound("This link has expired. Please ask us for a new one.");
    }
    return json({ full_name: row.full_name, email: row.email });
  });

  /** Sets a first password, or another one, and signs them in. */
  router.post("/api/partner/invitation/:token", async ({ request, env, params }) => {
    const body = await readJson<{ password?: string }>(request);
    const password = requireString(body.password, "password", { max: 200 });

    const digest = await tokenDigest(decodeURIComponent(params.token));
    const keys = await attemptKeys(request, `@partner-invitation:${digest.slice(0, 16)}`);
    await assertLoginAllowed(env, keys);

    const invitation = await env.DB.prepare(
      `SELECT id, partner_id, expires_at, used_at FROM growth_partner_invitations WHERE id = ?`,
    )
      .bind(digest)
      .first<{ id: string; partner_id: string; expires_at: string; used_at: string | null }>();

    if (!invitation || invitation.used_at) {
      await recordFailure(env, keys);
      throw notFound("This link is not valid. Please ask us for a new one.");
    }
    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      throw notFound("This link has expired. Please ask us for a new one.");
    }

    // The same policy staff and clients are held to.
    assertPasswordPolicy(password);

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE growth_partners
            SET password_hash = ?, status = 'active', updated_at = ?
          WHERE id = ? AND status IN ('applied', 'active')`,
      ).bind(await hashPassword(env, password), timestamp, invitation.partner_id),
      env.DB.prepare(`UPDATE growth_partner_invitations SET used_at = ? WHERE id = ?`).bind(
        timestamp,
        invitation.id,
      ),
      env.DB.prepare(
        `DELETE FROM growth_partner_invitations WHERE partner_id = ? AND used_at IS NULL`,
      ).bind(invitation.partner_id),
      // And every session they had, for the reason the client's own reset gives.
      env.DB.prepare(`DELETE FROM growth_partner_sessions WHERE partner_id = ?`).bind(
        invitation.partner_id,
      ),
    ]);

    await clearAccountFailures(env, keys);
    const { cookie } = await createPartnerSession(
      env,
      invitation.partner_id,
      request.headers.get("User-Agent"),
    );
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  });

  /**
   * A partner who has lost their password asks for a link themselves.
   *
   * Answers identically whether or not the address is one the firm holds, and does the
   * work afterwards, so that the reply cannot be timed. Its own throttle key, so a flood
   * of resets cannot lock somebody out of signing in.
   */
  router.post("/api/partner/forgot-password", async ({ request, env, waitUntil }) => {
    const body = await readJson<{ email?: string }>(request);
    const email = (body.email ?? "").trim().toLowerCase();

    const keys = await attemptKeys(request, `partner-reset:${email}`);
    await assertLoginAllowed(env, keys);
    await recordFailure(env, keys);

    const answer = json({
      ok: true,
      message:
        "If that address belongs to a growth partner of ours, a link to set a new password is on its way.",
    });

    waitUntil(
      (async () => {
        const row = await env.DB.prepare(
          `SELECT id, full_name, email FROM growth_partners
            WHERE email = ? COLLATE NOCASE AND status = 'active'`,
        )
          .bind(email)
          .first<{ id: string; full_name: string; email: string }>();
        if (!row) return;

        const link = await issueInvitation(env, row.id, PARTNER_RESET_TTL_MINUTES);
        const settings = await readSettings(env);
        await sendToPerson(env, {
          to: { email: row.email, full_name: row.full_name },
          subject: `Setting a new password for ${settings.firm_name}`,
          headline: "Somebody asked for a new password for your growth partner account.",
          detail: `The link works once and for ${PARTNER_RESET_TTL_MINUTES} minutes. If that was not you, nothing has changed and you can ignore this.`,
          link,
          linkLabel: "Set a new password",
          firmName: settings.firm_name,
          reason: `you are a growth partner of ${settings.firm_name}`,
        });
      })(),
    );

    return answer;
  });

  /** Changing a password from inside, which needs the old one. */
  router.post("/api/partner/password", async ({ request, env }) => {
    const actor = await requirePartner(env, request);
    const body = await readJson<{ current?: string; password?: string }>(request);
    const current = typeof body.current === "string" ? body.current : "";
    const next = requireString(body.password, "password", { max: 200 });

    const keys = await attemptKeys(request, actor.email);
    await assertLoginAllowed(env, keys);

    const row = await env.DB.prepare(
      `SELECT password_hash FROM growth_partners WHERE id = ?`,
    )
      .bind(actor.id)
      .first<{ password_hash: string | null }>();
    if (!row?.password_hash || !(await verifyPassword(env, current, row.password_hash))) {
      await recordFailure(env, keys);
      throw badRequest("That is not your current password.");
    }

    assertPasswordPolicy(next);
    await clearAccountFailures(env, keys);

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE growth_partners SET password_hash = ?, updated_at = ? WHERE id = ?`,
      ).bind(await hashPassword(env, next), timestamp, actor.id),
      env.DB.prepare(
        `DELETE FROM growth_partner_sessions WHERE partner_id = ? AND id <> ?`,
      ).bind(actor.id, actor.session_id),
    ]);

    return noContent();
  });

  // -------------------------------------------------------------------------
  // The pipeline
  // -------------------------------------------------------------------------

  /** Everything they are working on, with what each one has earned so far. */
  router.get("/api/partner/prospects", async ({ request, env }) => {
    const actor = await requirePartner(env, request);

    const [prospects, proposals, commissions] = await env.DB.batch([
      env.DB.prepare(
        `SELECT p.id, p.business_name, p.contact_name, p.contact_email, p.contact_phone,
                p.sector, p.note, p.stage, p.registered_on, p.hold_until,
                p.hold_extension_note, p.client_id, p.won_on, p.lost_reason
           FROM partner_prospects p
          WHERE p.partner_id = ?
          ORDER BY p.stage = 'lost', p.updated_at DESC`,
      ).bind(actor.id),
      env.DB.prepare(
        `SELECT id, prospect_id, reference, status, tier, currency, monthly_fee,
                discount, sent_at, viewed_at, decided_at
           FROM partner_proposals WHERE partner_id = ? ORDER BY created_at DESC`,
      ).bind(actor.id),
      env.DB.prepare(
        `SELECT id, client_id, prospect_id, kind, month_index, reference, basis, rate,
                currency, amount, status, created_at, paid_at
           FROM partner_commissions WHERE partner_id = ? ORDER BY created_at DESC`,
      ).bind(actor.id),
    ]);

    return json({
      prospects: prospects.results,
      proposals: proposals.results,
      commissions: commissions.results,
      terms: {
        rate: actor.commission_rate,
        months: actor.commission_months,
        hold_days: actor.hold_days,
      },
      today: today(),
    });
  });

  /**
   * Registers a business, which starts the hold.
   *
   * The unique index is what stops two partners holding the same business; the check
   * here only exists to turn the constraint into a sentence somebody can act on, and to
   * say who to talk to about it.
   */
  router.post("/api/partner/prospects", async ({ request, env }) => {
    const actor = await requirePartner(env, request);
    const body = await readJson<{
      business_name?: string;
      contact_name?: string;
      contact_email?: string;
      contact_phone?: string;
      sector?: string;
      note?: string;
    }>(request);

    // Nothing is sold in the firm's name before the engagement is signed.
    await assertSigned(env, actor.id);

    const businessName = requireString(body.business_name, "business_name", { max: 160 });
    const refusal = whyNotAProspect({
      business_name: businessName,
      contact_email: body.contact_email,
    });
    if (refusal) throw badRequest(refusal);

    const key = prospectKey(businessName);
    const id = newId();
    const timestamp = nowIso();
    const registeredOn = today();

    try {
      await env.DB.prepare(
        `INSERT INTO partner_prospects
           (id, partner_id, business_name, name_key, contact_name, contact_email,
            contact_phone, sector, note, stage, registered_on, hold_until,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?, ?, ?, ?)`,
      )
        .bind(
          id,
          actor.id,
          businessName,
          key,
          body.contact_name?.trim()?.slice(0, 120) || null,
          body.contact_email?.trim()?.toLowerCase()?.slice(0, 200) || null,
          body.contact_phone?.trim()?.slice(0, 40) || null,
          body.sector?.trim()?.slice(0, 80) || null,
          body.note?.trim()?.slice(0, 1000) || null,
          registeredOn,
          holdUntil(registeredOn, actor.hold_days),
          timestamp,
          timestamp,
        )
        .run();
    } catch (err) {
      if (/UNIQUE/i.test(String(err))) {
        const held = await env.DB.prepare(
          `SELECT partner_id FROM partner_prospects
            WHERE name_key = ? AND stage <> 'lost'`,
        )
          .bind(key)
          .first<{ partner_id: string }>();
        throw conflict(
          held?.partner_id === actor.id
            ? "You have already registered that business."
            : "That business is already registered with us by somebody else. Talk to us before spending time on it.",
        );
      }
      throw err;
    }

    return json({ id }, 201);
  });

  /** Moves one along, or records that it is not proceeding. */
  router.patch("/api/partner/prospects/:id", async ({ request, env, params }) => {
    const actor = await requirePartner(env, request);
    const body = await readJson<{
      stage?: unknown;
      note?: string;
      lost_reason?: string;
      contact_name?: string;
      contact_email?: string;
      contact_phone?: string;
    }>(request);

    const existing = await env.DB.prepare(
      `SELECT id, stage FROM partner_prospects WHERE id = ? AND partner_id = ?`,
    )
      .bind(params.id, actor.id)
      .first<{ id: string; stage: ProspectStage }>();
    if (!existing) throw notFound("That is not one of yours.");

    const timestamp = nowIso();

    if (body.stage !== undefined) {
      const stage = requireEnum(body.stage, "stage", PROSPECT_STAGES) as ProspectStage;
      if (!mayMoveProspect(existing.stage, stage)) {
        throw badRequest(
          stage === "won"
            ? "We mark a prospect signed when the client's account is set up here - it is not something to declare from this side."
            : "That is not the next step from where this one is.",
        );
      }
      await env.DB.prepare(
        `UPDATE partner_prospects
            SET stage = ?, lost_at = ?, lost_reason = ?, updated_at = ?
          WHERE id = ? AND partner_id = ?`,
      )
        .bind(
          stage,
          stage === "lost" ? timestamp : null,
          stage === "lost" ? body.lost_reason?.trim()?.slice(0, 300) || null : null,
          timestamp,
          params.id,
          actor.id,
        )
        .run();
    }

    if (
      body.note !== undefined ||
      body.contact_name !== undefined ||
      body.contact_email !== undefined ||
      body.contact_phone !== undefined
    ) {
      await env.DB.prepare(
        `UPDATE partner_prospects
            SET note = COALESCE(?, note),
                contact_name = COALESCE(?, contact_name),
                contact_email = COALESCE(?, contact_email),
                contact_phone = COALESCE(?, contact_phone),
                updated_at = ?
          WHERE id = ? AND partner_id = ?`,
      )
        .bind(
          body.note?.slice(0, 1000) ?? null,
          body.contact_name?.slice(0, 120) ?? null,
          body.contact_email?.trim()?.toLowerCase()?.slice(0, 200) ?? null,
          body.contact_phone?.slice(0, 40) ?? null,
          timestamp,
          params.id,
          actor.id,
        )
        .run();
    }

    return noContent();
  });

  // -------------------------------------------------------------------------
  // Proposals
  // -------------------------------------------------------------------------

  /** The packages, so a proposal is built from what the firm actually sells. */
  router.get("/api/partner/packages", async ({ request, env }) => {
    await requirePartner(env, request);
    const catalogue = await readCatalogue(env);
    return json({
      tiers: catalogue.tiers,
      inclusions: catalogue.inclusions,
      services: catalogue.services.filter((s) => (s as { active: number }).active === 1),
    });
  });

  router.post("/api/partner/prospects/:id/proposals", async ({ request, env, params }) => {
    const actor = await requirePartner(env, request);
    const body = await readJson<{
      tier?: unknown;
      currency?: unknown;
      monthly_fee?: unknown;
      discount?: unknown;
      prepared_for?: string;
      address?: string;
      salutation?: string;
      note?: string;
      lines?: Array<{ description?: unknown; frequency?: unknown; amount?: unknown }>;
    }>(request);

    const prospect = await env.DB.prepare(
      `SELECT id, business_name, contact_name, stage FROM partner_prospects
        WHERE id = ? AND partner_id = ?`,
    )
      .bind(params.id, actor.id)
      .first<{
        id: string;
        business_name: string;
        contact_name: string | null;
        stage: ProspectStage;
      }>();
    if (!prospect) throw notFound("That is not one of yours.");
    if (prospect.stage === "lost") {
      throw badRequest("That one is marked as not proceeding. Put it back in play first.");
    }

    const tier = body.tier
      ? (requireEnum(body.tier, "tier", CLIENT_TIERS) as ClientTier)
      : null;
    const currency = body.currency
      ? requireEnum(body.currency, "currency", CURRENCIES)
      : DEFAULT_CURRENCY;
    const fee = body.monthly_fee === undefined || body.monthly_fee === null || body.monthly_fee === ""
      ? null
      : Number(body.monthly_fee);
    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) {
      throw badRequest("That monthly fee is not an amount.");
    }
    const discount = Number(body.discount ?? 0);
    if (!Number.isFinite(discount) || discount < 0) {
      throw badRequest("That discount is not an amount.");
    }

    const id = newId();
    const timestamp = nowIso();
    const reference = await nextProposalReference(env);

    const statements = [
      env.DB.prepare(
        `INSERT INTO partner_proposals
           (id, prospect_id, partner_id, reference, prepared_for, address, salutation,
            tier, currency, monthly_fee, discount, note, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      ).bind(
        id,
        params.id,
        actor.id,
        reference,
        body.prepared_for?.trim()?.slice(0, 160) || prospect.business_name,
        body.address?.trim()?.slice(0, 400) || null,
        body.salutation?.trim()?.slice(0, 80) || prospect.contact_name || null,
        tier,
        currency,
        fee,
        discount,
        body.note?.trim()?.slice(0, 1000) || null,
        timestamp,
        timestamp,
      ),
    ];

    (body.lines ?? []).forEach((line, index) => {
      const description = String(line?.description ?? "").trim().slice(0, 200);
      if (!description) return;
      const amount = Number(line?.amount ?? 0);
      statements.push(
        env.DB.prepare(
          `INSERT INTO partner_proposal_lines
             (id, proposal_id, description, frequency, amount, position)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          newId(),
          id,
          description,
          ["monthly", "quarterly", "annual", "one_off"].includes(String(line?.frequency))
            ? String(line?.frequency)
            : "one_off",
          Number.isFinite(amount) && amount > 0 ? amount : 0,
          index,
        ),
      );
    });

    await env.DB.batch(statements);
    return json({ id, reference }, 201);
  });

  /**
   * Sends it: freezes what it says, mints the link and emails the prospect.
   *
   * The prospect's own copy is reached by that link rather than by an account. Somebody
   * who has not yet agreed to anything should not have to be given a login to read what
   * they are being offered.
   */
  router.post("/api/partner/proposals/:id/send", async ({ request, env, params }) => {
    const actor = await requirePartner(env, request);
    await assertSigned(env, actor.id);

    const proposal = await env.DB.prepare(
      `SELECT p.id, p.prospect_id, p.reference, p.status, p.prepared_for, p.salutation,
              pr.contact_email, pr.contact_name, pr.business_name, pr.stage
         FROM partner_proposals p
         JOIN partner_prospects pr ON pr.id = p.prospect_id
        WHERE p.id = ? AND p.partner_id = ?`,
    )
      .bind(params.id, actor.id)
      .first<{
        id: string;
        prospect_id: string;
        reference: string;
        status: string;
        prepared_for: string;
        salutation: string | null;
        contact_email: string | null;
        contact_name: string | null;
        business_name: string;
        stage: ProspectStage;
      }>();
    if (!proposal) throw notFound("That is not one of yours.");
    if (proposal.status !== "draft") {
      throw badRequest("That proposal has already gone out.");
    }
    if (!proposal.contact_email) {
      throw badRequest(
        "There is no email address on that prospect. Add one and it can go straight to them.",
      );
    }

    const token = newToken();
    const timestamp = nowIso();
    const settings = await readSettings(env);
    const link = `${portalBase(env)}/proposal/${encodeURIComponent(token)}`;

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE partner_proposals
            SET status = 'sent', sent_at = ?, token_digest = ?, token_expires_at = ?,
                updated_at = ?
          WHERE id = ? AND status = 'draft'`,
      ).bind(
        timestamp,
        await tokenDigest(token),
        new Date(Date.now() + PROPOSAL_TTL_DAYS * 86_400_000).toISOString(),
        timestamp,
        params.id,
      ),
      // The pipeline follows the thing that actually happened.
      env.DB.prepare(
        `UPDATE partner_prospects SET stage = 'proposal_sent', updated_at = ?
          WHERE id = ? AND stage IN ('registered', 'pitching')`,
      ).bind(timestamp, proposal.prospect_id),
    ]);

    await sendToPerson(env, {
      to: {
        email: proposal.contact_email,
        full_name: proposal.contact_name ?? proposal.prepared_for,
      },
      subject: `Pricing proposal ${proposal.reference} from ${settings.firm_name}`,
      headline: `${actor.full_name} has prepared a pricing proposal for ${proposal.business_name}.`,
      detail: `It sets out what we do, the package we recommend and what it costs. The link works for ${PROPOSAL_TTL_DAYS} days.`,
      link,
      linkLabel: "Read the proposal",
      firmName: settings.firm_name,
      reason: `${actor.full_name} is working with you on behalf of ${settings.firm_name}`,
    });

    return json({ link });
  });

  /** Takes one back before it is decided. */
  router.post("/api/partner/proposals/:id/withdraw", async ({ request, env, params }) => {
    const actor = await requirePartner(env, request);
    const result = await env.DB.prepare(
      `UPDATE partner_proposals
          SET status = 'withdrawn', token_digest = NULL, updated_at = ?
        WHERE id = ? AND partner_id = ? AND status IN ('draft', 'sent')`,
    )
      .bind(nowIso(), params.id, actor.id)
      .run();
    if (!result.meta.changes) {
      throw notFound("There is nothing to withdraw there.");
    }
    return noContent();
  });

  // -------------------------------------------------------------------------
  // What they have earned
  // -------------------------------------------------------------------------

  /**
   * Their statement: every accrual, what it was worked out on, and where it has got to.
   *
   * The client's name and the invoice's number, and nothing else about either. A growth
   * partner does not see what else the firm does for a client they sold, or what
   * anybody else earns.
   */
  router.get("/api/partner/statement", async ({ request, env }) => {
    const actor = await requirePartner(env, request);

    const { results } = await env.DB.prepare(
      `SELECT pc.id, pc.kind, pc.month_index, pc.reference, pc.basis, pc.rate,
              pc.currency, pc.amount, pc.status, pc.created_at, pc.approved_at,
              pc.paid_at, pc.paid_reference, pc.cancelled_reason,
              c.name AS client_name, i.number AS invoice_number, i.issued_on
         FROM partner_commissions pc
         LEFT JOIN clients c ON c.id = pc.client_id
         LEFT JOIN invoices i ON i.id = pc.invoice_id
        WHERE pc.partner_id = ?
        ORDER BY pc.created_at DESC`,
    )
      .bind(actor.id)
      .all<{ currency: string; amount: number; status: string }>();

    /*
     * Totalled per currency rather than added up across them. A partner with a client
     * billed in dollars and another in cedis is owed two amounts, and one converted
     * figure would be a number the firm never agreed to - see shared/money.ts.
     */
    const totals: Record<string, { earned: number; approved: number; paid: number }> = {};
    for (const row of results) {
      const bucket = (totals[row.currency] ??= { earned: 0, approved: 0, paid: 0 });
      if (row.status === "cancelled") continue;
      bucket.earned = Math.round((bucket.earned + row.amount) * 100) / 100;
      if (row.status === "approved") {
        bucket.approved = Math.round((bucket.approved + row.amount) * 100) / 100;
      }
      if (row.status === "paid") {
        bucket.paid = Math.round((bucket.paid + row.amount) * 100) / 100;
      }
    }

    // Per client, so "how much of this one is left" has an answer on the screen.
    const { results: clients } = await env.DB.prepare(
      `SELECT DISTINCT c.id, c.name, c.partner_won_on
         FROM partner_commissions pc JOIN clients c ON c.id = pc.client_id
        WHERE pc.partner_id = ?`,
    )
      .bind(actor.id)
      .all<{ id: string; name: string; partner_won_on: string | null }>();

    const entitlements = [];
    for (const client of clients) {
      const history = await readHistory(env, client.id, client.partner_won_on);
      entitlements.push({
        client_id: client.id,
        client_name: client.name,
        months_earned: history.subscription_months,
        ever_subscribed: history.ever_subscribed,
        description: describeEntitlement(history, actor.commission_months),
      });
    }

    return json({
      commissions: results,
      totals,
      entitlements,
      terms: { rate: actor.commission_rate, months: actor.commission_months },
    });
  });
}

/** KP-2026-0007, from its own counter so proposals read together. */
async function nextProposalReference(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    `INSERT INTO counters (name, value) VALUES ('proposal', 1)
     ON CONFLICT(name) DO UPDATE SET value = value + 1
     RETURNING value`,
  ).first<{ value: number }>();
  const n = row?.value ?? 1;
  return `KP-${new Date().getUTCFullYear()}-${String(n).padStart(4, "0")}`;
}
