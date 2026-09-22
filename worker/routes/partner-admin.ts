/**
 * The firm's side of growth partners, and the one page a prospect sees.
 *
 * Partner business throughout on the firm's side. Admitting somebody to sell for the
 * firm, extending a hold, and approving a commission are all decisions about money and
 * about who represents the firm outside it.
 *
 * Three things it is careful about.
 *
 * **Signing a client is the firm's act.** A prospect becomes `won` here and nowhere
 * else, and it is the same call that writes the partner onto the client record. A
 * partner who could declare it would be declaring their own commission.
 *
 * **Approving and paying are two decisions.** An accrual says what the arrangement
 * produced; approving says the firm agrees; recording payment says it has gone. Merging
 * them would make "what do we owe" unanswerable.
 *
 * **The proposal link is not an account.** A prospect has agreed to nothing yet, so they
 * are not given a login. The link is a one-time token, it expires, and what it opens is
 * one proposal - never a list, never anybody else's.
 */

import type { Env } from "../env";
import { requireRole } from "../auth";
import { tokenDigest } from "../auth";
import { newId, nowIso, requireEnum, requireString } from "../db";
import {
  Router,
  badRequest,
  conflict,
  json,
  noContent,
  notFound,
  readJson,
} from "../http";
import { MIN_SUPERVISOR_ROLE } from "../../shared/workflow";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { PARTNER_INVITATION_TTL_DAYS } from "../partner-auth";
import { issueInvitation } from "./partners";
import { issueAgreement } from "./partner-agreement";
import { readSettings } from "./settings";
import { sendToPerson } from "../email";
import { renderProposal, type ProposalDocument } from "../../shared/proposal-document";
import { readCatalogue } from "./subscriptions";
import {
  PARTNER_STATES,
  holdUntil,
  type PartnerState,
} from "../../shared/growth-partners";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerPartnerAdminRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------------------
  // The partners themselves
  // -------------------------------------------------------------------------

  router.get("/api/growth-partners", async ({ request, env }) => {
    await requireRole(env, request, MIN_SUPERVISOR_ROLE);

    const [partners, prospects, commissions] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, full_name, email, phone, business_name, status, note,
                commission_rate, commission_months, hold_days,
                agreement_signed_at, applied_at, approved_at, last_login_at,
                password_hash IS NOT NULL AS has_password
           FROM growth_partners ORDER BY full_name`,
      ),
      env.DB.prepare(
        `SELECT p.id, p.partner_id, p.business_name, p.contact_name, p.contact_email,
                p.stage, p.registered_on, p.hold_until, p.hold_extension_note,
                p.client_id, p.won_on, p.lost_reason, c.name AS client_name
           FROM partner_prospects p
           LEFT JOIN clients c ON c.id = p.client_id
          ORDER BY p.updated_at DESC LIMIT 400`,
      ),
      env.DB.prepare(
        `SELECT pc.id, pc.partner_id, pc.client_id, pc.kind, pc.month_index, pc.reference,
                pc.basis, pc.rate, pc.currency, pc.amount, pc.status, pc.created_at,
                pc.paid_at, c.name AS client_name, i.number AS invoice_number
           FROM partner_commissions pc
           LEFT JOIN clients c ON c.id = pc.client_id
           LEFT JOIN invoices i ON i.id = pc.invoice_id
          ORDER BY pc.created_at DESC LIMIT 400`,
      ),
    ]);

    return json({
      partners: partners.results,
      prospects: prospects.results,
      commissions: commissions.results,
      today: today(),
    });
  });

  /**
   * Adds somebody as a growth partner, and sends them the link that lets them set a
   * password.
   *
   * This is the only way a partner comes to exist. There is no application form: the
   * firm decides who sells for it, names them here, and the terms - the rate, the
   * months, the hold - are written onto that partner at the same time, so a deal
   * struck with somebody today survives the firm changing its standard terms next year.
   *
   * The row goes in `active` straight away. What stops them doing anything is not a
   * state but two absences: no password until they use the link, and no signature on
   * the engagement until they sign it in the portal.
   */
  router.post("/api/growth-partners", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{
      full_name?: unknown;
      email?: unknown;
      phone?: string;
      business_name?: string;
      commission_rate?: unknown;
      commission_months?: unknown;
      hold_days?: unknown;
    }>(request);

    const fullName = requireString(body.full_name, "full_name", { max: 120 });
    const email = requireString(body.email, "email", { max: 200 }).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      throw badRequest("That does not look like an email address.");
    }
    const rate = Number(body.commission_rate ?? 25);
    const months = Math.trunc(Number(body.commission_months ?? 6));
    const holdDays = Math.trunc(Number(body.hold_days ?? 90));
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
      throw badRequest("The commission has to be a percentage between 0 and 100.");
    }
    if (!Number.isInteger(months) || months < 1 || months > 60) {
      throw badRequest("Give the number of billed months, between 1 and 60.");
    }
    if (!Number.isInteger(holdDays) || holdDays < 1 || holdDays > 730) {
      throw badRequest("Give the hold in days, between 1 and 730.");
    }

    /*
     * Said plainly when the address is already on the list. This is a member of staff
     * with the role to see that list, not a stranger at a public form, so there is
     * nothing to hide.
     */
    const existing = await env.DB.prepare(
      `SELECT full_name FROM growth_partners WHERE email = ? COLLATE NOCASE`,
    )
      .bind(email)
      .first<{ full_name: string }>();
    if (existing) {
      throw conflict(`${existing.full_name} is already a growth partner with that address.`);
    }

    const id = newId();
    const businessName = body.business_name?.trim()?.slice(0, 160) || null;
    const timestamp = nowIso();
    await env.DB.prepare(
      `INSERT INTO growth_partners
         (id, full_name, email, phone, business_name, status,
          commission_rate, commission_months, hold_days,
          applied_at, approved_at, approved_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        fullName,
        email,
        body.phone?.trim()?.slice(0, 40) || null,
        businessName,
        rate,
        months,
        holdDays,
        timestamp,
        timestamp,
        actor.id,
        timestamp,
        timestamp,
      )
      .run();

    /*
     * Their engagement is cut now, with these terms written into it. Before the link
     * goes out, so that the first thing waiting for them when they sign in is the
     * document they have to sign before selling anything.
     */
    await issueAgreement(
      env,
      {
        id,
        full_name: fullName,
        business_name: businessName,
        commission_rate: rate,
        commission_months: months,
        hold_days: holdDays,
      },
      actor.id,
    );

    const link = await issueInvitation(env, id, PARTNER_INVITATION_TTL_DAYS * 24 * 60);
    const settings = await readSettings(env);
    await sendToPerson(env, {
      to: { email, full_name: fullName },
      subject: `Your growth partner account with ${settings.firm_name}`,
      headline: `${settings.firm_name} has set you up as a growth partner.`,
      detail:
        `Set a password and your portal is ready: register the businesses you are working on, ` +
        `build a proposal from our packages, and follow what you have earned. The link works once ` +
        `and for ${PARTNER_INVITATION_TTL_DAYS} days.`,
      link,
      linkLabel: "Set your password",
      firmName: settings.firm_name,
      reason: `${settings.firm_name} has added you as a growth partner`,
    });

    return json({ id, invitation_url: link });
  });

  /** Suspends, restores or ends somebody. */
  router.post("/api/growth-partners/:id/status", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ status?: unknown; reason?: string }>(request);
    const status = requireEnum(body.status, "status", PARTNER_STATES) as PartnerState;
    // Nothing writes this state any more; the column still allows it for rows that
    // predate the firm inviting rather than admitting.
    if (status === "applied") {
      throw badRequest("A partner cannot be put back to waiting.");
    }

    const timestamp = nowIso();
    const result = await env.DB.prepare(
      `UPDATE growth_partners
          SET status = ?, ended_at = ?, ended_reason = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(
        status,
        status === "ended" ? timestamp : null,
        status === "active" ? null : body.reason?.trim()?.slice(0, 300) || null,
        timestamp,
        params.id,
      )
      .run();
    if (!result.meta.changes) throw notFound("There is no such growth partner.");

    /*
     * Suspending or ending signs them out now rather than whenever the session would
     * have expired. What they have already earned is untouched: stopping somebody
     * selling is not the same as taking back what they sold.
     */
    if (status !== "active") {
      await env.DB.prepare(`DELETE FROM growth_partner_sessions WHERE partner_id = ?`)
        .bind(params.id)
        .run();
    }

    return noContent();
  });

  /** Sends a fresh link, for somebody who never used theirs or has lost their password. */
  router.post("/api/growth-partners/:id/invite", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const partner = await env.DB.prepare(
      `SELECT id, full_name, email, business_name, status, commission_rate,
              commission_months, hold_days
         FROM growth_partners WHERE id = ?`,
    )
      .bind(params.id)
      .first<{
        id: string;
        full_name: string;
        email: string;
        business_name: string | null;
        status: PartnerState;
        commission_rate: number;
        commission_months: number;
        hold_days: number;
      }>();
    if (!partner) throw notFound("There is no such growth partner.");
    if (partner.status !== "active") {
      throw badRequest("Admit them first. A link is no use to somebody who cannot sign in.");
    }

    /*
     * Cuts their engagement if they have not got one. A no-op where one already stands,
     * signed or not, so this cannot replace a signed engagement with a fresh unsigned
     * one - and it means a partner admitted before engagements existed gets theirs the
     * next time anybody sends them a link.
     */
    await issueAgreement(
      env,
      {
        id: partner.id,
        full_name: partner.full_name,
        business_name: partner.business_name,
        commission_rate: partner.commission_rate,
        commission_months: partner.commission_months,
        hold_days: partner.hold_days,
      },
      null,
    );

    const link = await issueInvitation(
      env,
      params.id,
      PARTNER_INVITATION_TTL_DAYS * 24 * 60,
    );
    const settings = await readSettings(env);
    await sendToPerson(env, {
      to: { email: partner.email, full_name: partner.full_name },
      subject: `Setting a password for ${settings.firm_name}`,
      headline: "Here is a link to set a password for your growth partner account.",
      detail: `It works once, and for ${PARTNER_INVITATION_TTL_DAYS} days.`,
      link,
      linkLabel: "Set your password",
      firmName: settings.firm_name,
      reason: `you are a growth partner of ${settings.firm_name}`,
    });
    return json({ invitation_url: link });
  });

  // -------------------------------------------------------------------------
  // Holds, and signing a client
  // -------------------------------------------------------------------------

  /**
   * Pushes a hold out.
   *
   * A reason is required. A hold extended with nothing said about why is a hold the next
   * person to look at it cannot judge, and the whole point of the ninety days is that a
   * registration made once is not a claim for ever.
   */
  router.post("/api/prospects/:id/extend-hold", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ days?: unknown; reason?: string }>(request);
    const days = Math.trunc(Number(body.days ?? 90));
    if (!Number.isInteger(days) || days < 1 || days > 730) {
      throw badRequest("Give the extension in days, between 1 and 730.");
    }
    const reason = requireString(body.reason, "reason", { max: 300 });

    const prospect = await env.DB.prepare(
      `SELECT id, hold_until, stage FROM partner_prospects WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; hold_until: string; stage: string }>();
    if (!prospect) throw notFound("There is no such prospect.");
    if (prospect.stage === "won" || prospect.stage === "lost") {
      throw badRequest("That one is decided. There is no hold left to extend.");
    }

    /*
     * From today where the hold has already run out, and from the end of it where it
     * has not. Extending a lapsed hold from its old end date would grant nothing.
     */
    const from = prospect.hold_until > today() ? prospect.hold_until : today();
    const timestamp = nowIso();
    await env.DB.prepare(
      `UPDATE partner_prospects
          SET hold_until = ?, hold_extended_at = ?, hold_extended_by = ?,
              hold_extension_note = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(holdUntil(from, days), timestamp, actor.id, reason, timestamp, params.id)
      .run();

    return json({ hold_until: holdUntil(from, days) });
  });

  /**
   * Records that a prospect has been signed, and puts their partner on the client.
   *
   * The one place `won` is written, and the one place a client gets a growth partner.
   * Both in the same batch, because a prospect marked won whose client does not carry
   * the partner is a commission that will never accrue and nobody will notice until the
   * partner asks.
   */
  router.post("/api/prospects/:id/won", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ client_id?: string; won_on?: string }>(request);
    const clientId = requireString(body.client_id, "client_id", { max: 64 });

    const [prospect, client] = await Promise.all([
      env.DB.prepare(
        `SELECT id, partner_id, business_name, stage FROM partner_prospects WHERE id = ?`,
      )
        .bind(params.id)
        .first<{ id: string; partner_id: string; business_name: string; stage: string }>(),
      env.DB.prepare(`SELECT id, name, growth_partner_id FROM clients WHERE id = ?`)
        .bind(clientId)
        .first<{ id: string; name: string; growth_partner_id: string | null }>(),
    ]);
    if (!prospect) throw notFound("There is no such prospect.");
    if (!client) throw notFound("There is no such client.");
    if (prospect.stage === "won") {
      throw conflict("That prospect is already recorded as signed.");
    }
    if (client.growth_partner_id && client.growth_partner_id !== prospect.partner_id) {
      throw conflict(
        `${client.name} is already recorded as sold by somebody else. Sort that out before attaching another partner.`,
      );
    }

    const wonOn = body.won_on?.trim() || today();
    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE partner_prospects
            SET stage = 'won', client_id = ?, won_on = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(clientId, wonOn, timestamp, params.id),
      env.DB.prepare(
        `UPDATE clients
            SET growth_partner_id = ?, partner_won_on = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(prospect.partner_id, wonOn, timestamp, clientId),
    ]);

    return json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Commissions
  // -------------------------------------------------------------------------

  /** Approves what has accrued, or refuses it with a reason. */
  router.post("/api/commissions/:id/approve", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const result = await env.DB.prepare(
      `UPDATE partner_commissions
          SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ?
        WHERE id = ? AND status = 'accrued'`,
    )
      .bind(nowIso(), actor.id, nowIso(), params.id)
      .run();
    if (!result.meta.changes) {
      throw badRequest("There is nothing awaiting approval there.");
    }
    return noContent();
  });

  router.post("/api/commissions/:id/cancel", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ reason?: string }>(request);
    const reason = requireString(body.reason, "reason", { max: 300 });
    const result = await env.DB.prepare(
      `UPDATE partner_commissions
          SET status = 'cancelled', cancelled_reason = ?, updated_at = ?
        WHERE id = ? AND status IN ('accrued', 'approved')`,
    )
      .bind(reason, nowIso(), params.id)
      .run();
    if (!result.meta.changes) throw badRequest("That one cannot be cancelled now.");
    return noContent();
  });

  /** Records that an approved commission has been paid. */
  router.post("/api/commissions/:id/paid", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<{ reference?: string; paid_on?: string }>(request);

    const result = await env.DB.prepare(
      `UPDATE partner_commissions
          SET status = 'paid', paid_at = ?, paid_by = ?, paid_reference = ?, updated_at = ?
        WHERE id = ? AND status = 'approved'`,
    )
      .bind(
        body.paid_on?.trim() || nowIso(),
        actor.id,
        body.reference?.trim()?.slice(0, 120) || null,
        nowIso(),
        params.id,
      )
      .run();
    if (!result.meta.changes) {
      throw badRequest("Approve it before recording that it has been paid.");
    }
    return noContent();
  });

  // -------------------------------------------------------------------------
  // The prospect's own copy
  // -------------------------------------------------------------------------

  /**
   * One proposal, opened from the link that was emailed.
   *
   * No account, and no list. The token opens exactly the document it was minted for; a
   * stale one opens nothing and says so without saying whose it was.
   */
  router.get("/api/proposals/:token", async ({ env, params }) => {
    const proposal = await loadByToken(env, params.token);
    return json(await assemble(env, proposal));
  });

  /** The same thing as a document, which is what gets printed and filed. */
  router.get("/api/proposals/:token/document", async ({ env, params }) => {
    const proposal = await loadByToken(env, params.token);
    const doc = await assemble(env, proposal);
    return new Response(renderProposal(doc.document), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${doc.document.reference}.html"`,
        "Cache-Control": "private, no-store",
      },
    });
  });

  /**
   * The prospect says yes or no.
   *
   * Saying yes is not a contract and does not sign anybody up - it tells the partner and
   * the firm to get on with the paperwork. The portal is careful to say that rather than
   * to imply a click has bound them to anything.
   */
  router.post("/api/proposals/:token/decide", async ({ request, env, params }) => {
    const body = await readJson<{ decision?: unknown; reason?: string }>(request);
    const decision = requireEnum(body.decision, "decision", ["accepted", "declined"] as const);
    const proposal = await loadByToken(env, params.token);
    if (proposal.status !== "sent") {
      throw badRequest("That proposal has already been answered.");
    }

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE partner_proposals
            SET status = ?, decided_at = ?, decline_reason = ?, updated_at = ?
          WHERE id = ? AND status = 'sent'`,
      ).bind(
        decision,
        timestamp,
        decision === "declined" ? body.reason?.trim()?.slice(0, 300) || null : null,
        timestamp,
        proposal.id,
      ),
      /*
       * Accepting moves the prospect to "contract out for signature", which is what
       * happens next and what the partner should be looking at. It never moves it to
       * won: that is the firm's act, and it needs a client record to point at.
       */
      env.DB.prepare(
        `UPDATE partner_prospects SET stage = ?, updated_at = ?
          WHERE id = ? AND stage = 'proposal_sent'`,
      ).bind(
        decision === "accepted" ? "contract_sent" : "pitching",
        timestamp,
        proposal.prospect_id,
      ),
    ]);

    const partner = await env.DB.prepare(
      `SELECT full_name, email FROM growth_partners WHERE id = ?`,
    )
      .bind(proposal.partner_id)
      .first<{ full_name: string; email: string }>();
    if (partner) {
      const settings = await readSettings(env);
      await sendToPerson(env, {
        to: partner,
        subject: `${proposal.prepared_for} has ${decision === "accepted" ? "accepted" : "declined"} ${proposal.reference}`,
        headline:
          decision === "accepted"
            ? `${proposal.prepared_for} has accepted your proposal ${proposal.reference}.`
            : `${proposal.prepared_for} has declined proposal ${proposal.reference}.`,
        detail:
          decision === "accepted"
            ? "Next is the engagement letter. We will be in touch to get it out."
            : body.reason?.trim()?.slice(0, 300) || null,
        link: `${(env.PORTAL_URL || "https://portal.kesmic.org").replace(/\/$/, "")}/partner`,
        linkLabel: "Open your portal",
        firmName: settings.firm_name,
        reason: `you are a growth partner of ${settings.firm_name}`,
      });
    }

    return noContent();
  });
}

interface ProposalRow {
  id: string;
  prospect_id: string;
  partner_id: string;
  reference: string;
  prepared_for: string;
  address: string | null;
  salutation: string | null;
  tier: string | null;
  currency: string;
  monthly_fee: number | null;
  discount: number;
  note: string | null;
  status: string;
  sent_at: string | null;
  token_expires_at: string | null;
}

/** The proposal behind a link, or a refusal that says nothing about whose it was. */
async function loadByToken(env: Env, token: string): Promise<ProposalRow> {
  const digest = await tokenDigest(decodeURIComponent(token));
  const row = await env.DB.prepare(
    `SELECT id, prospect_id, partner_id, reference, prepared_for, address, salutation,
            tier, currency, monthly_fee, discount, note, status, sent_at, token_expires_at
       FROM partner_proposals WHERE token_digest = ?`,
  )
    .bind(digest)
    .first<ProposalRow>();

  if (!row) throw notFound("This link is not valid. Please ask for a new one.");
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() <= Date.now()) {
    throw notFound("This link has expired. Please ask for a new one.");
  }

  // Noted the first time it is opened, so a partner can see it has been read.
  if (row.status === "sent") {
    await env.DB.prepare(
      `UPDATE partner_proposals SET viewed_at = COALESCE(viewed_at, ?) WHERE id = ?`,
    )
      .bind(nowIso(), row.id)
      .run();
  }

  return row;
}

/** Everything the proposal prints, assembled from the firm's own settings and packages. */
async function assemble(env: Env, proposal: ProposalRow) {
  const [settings, catalogue, lines, partner] = await Promise.all([
    readSettings(env),
    readCatalogue(env),
    env.DB.prepare(
      `SELECT description, frequency, amount FROM partner_proposal_lines
        WHERE proposal_id = ? ORDER BY position`,
    )
      .bind(proposal.id)
      .all<{ description: string; frequency: string; amount: number }>(),
    env.DB.prepare(`SELECT full_name, email, phone FROM growth_partners WHERE id = ?`)
      .bind(proposal.partner_id)
      .first<{ full_name: string; email: string; phone: string | null }>(),
  ]);

  const tier = catalogue.tiers.find((t) => t.tier === proposal.tier) ?? null;

  const document: ProposalDocument = {
    firm: {
      name: settings.firm_name,
      address_lines: (settings.firm_address || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
      city: settings.firm_city,
      phone: settings.firm_phone,
      email: settings.firm_finance_email,
      website: (settings.firm_website || "").replace(/^https?:\/\//, ""),
      logo: settings.logo_data_url,
      about: settings.firm_about || "",
    },
    reference: proposal.reference,
    prepared_for: proposal.prepared_for,
    address_lines: (proposal.address || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    salutation: proposal.salutation,
    date: (proposal.sent_at ?? nowIso()).slice(0, 10),
    currency: proposal.currency,
    packages: catalogue.tiers
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((row) => ({
        tier: row.tier,
        ideal_for: row.ideal_for,
        monthly_fee: row.monthly_fee,
        currency: row.currency,
        recommended: row.tier === proposal.tier,
        inclusions: catalogue.inclusions
          .filter((i) => i.tier === row.tier)
          .map((i) => ({
            label: i.label,
            sub: !!i.parent_id,
            position: i.position,
            parent_id: i.parent_id,
            id: i.id,
          })),
      })),
    recommended: tier
      ? {
          tier: tier.tier,
          label: tier.tier,
          monthly_fee: proposal.monthly_fee ?? tier.monthly_fee,
        }
      : null,
    lines: lines.results.map((line) => ({
      description: line.description,
      frequency: line.frequency,
      amount: line.amount,
    })),
    discount: proposal.discount,
    note: proposal.note,
    prepared_by: partner
      ? { name: partner.full_name, email: partner.email, phone: partner.phone }
      : null,
    core_services: (settings.firm_core_services || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    terms: (settings.proposal_terms || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };

  return {
    id: proposal.id,
    reference: proposal.reference,
    status: proposal.status,
    document,
  };
}
