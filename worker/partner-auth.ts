/**
 * Signing a growth partner in.
 *
 * The third population with accounts here, after staff and clients, and the same wall
 * stands between it and the other two. worker/client-auth.ts sets out the argument at
 * length; what matters is that it applies word for word:
 *
 * **A separate table.** A growth partner is not a `users` row with another role. Every
 * `requireRole` already written, and every query that says "all active users", would
 * silently start including people who do not work for the firm.
 *
 * **A separate cookie.** `kpm_partner`, so that a browser signed in as a partner cannot
 * present that token to a staff or client endpoint even by accident - and somebody who
 * is both a growth partner and a client of the firm keeps the two apart.
 *
 * **Scope comes from the session.** `requirePartner` returns the partner's own id off
 * the row, and every partner-facing query filters on that. There is no endpoint where a
 * partner names the partner whose prospects or commissions they want.
 *
 * **The firm never knows the password.** They set their own from a one-time link, and
 * `password_hash` is null until they do.
 *
 * One thing is different from a client, and deliberately: a growth partner signs
 * themselves up. Anybody may apply. What an applicant gets is an account in `applied`
 * with no password and no way in - the firm admits them, and only then does a link go
 * out. Applying is therefore not a way to get a foothold in the portal; it is a way to
 * get on a list somebody at the firm reads.
 */

import type { Env } from "./env";
import { newToken, readCookie, tokenDigest, ttlDays } from "./auth";
import { forbidden, unauthorized, type HttpError } from "./http";
import { partnerMayWork, type PartnerState } from "../shared/growth-partners";

/** Deliberately neither `kpm_session` nor `kpm_client`. */
export const PARTNER_SESSION_COOKIE = "kpm_partner";

/** How long an invitation to set a first password stands. */
export const PARTNER_INVITATION_TTL_DAYS = 7;

/**
 * How long a reset link a partner asked for themselves stands.
 *
 * An hour, for the reason the client's own reset gives: a link nobody arranged, sitting
 * in a mailbox that may not be theirs alone, is a live credential for as long as it
 * lasts. Asking again costs nothing.
 */
export const PARTNER_RESET_TTL_MINUTES = 60;

export interface AuthenticatedPartner {
  id: string;
  email: string;
  full_name: string;
  business_name: string | null;
  status: PartnerState;
  /** The terms as they stand for this partner, not the firm's current standard ones. */
  commission_rate: number;
  commission_months: number;
  hold_days: number;
  agreement_signed_at: string | null;
  /** Digest of this caller's own session token, so it can be spared a bulk sign-out. */
  session_id: string;
}

export async function createPartnerSession(
  env: Env,
  partnerId: string,
  userAgent: string | null,
): Promise<{ cookie: string }> {
  const token = newToken();
  const id = await tokenDigest(token);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays(env) * 86_400_000);

  await env.DB.prepare(
    `INSERT INTO growth_partner_sessions
       (id, partner_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      partnerId,
      now.toISOString(),
      expires.toISOString(),
      now.toISOString(),
      userAgent?.slice(0, 300) ?? null,
    )
    .run();

  const maxAge = ttlDays(env) * 86_400;
  return {
    cookie: `${PARTNER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  };
}

export const clearedPartnerCookie = `${PARTNER_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function destroyPartnerSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request, PARTNER_SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare(`DELETE FROM growth_partner_sessions WHERE id = ?`)
    .bind(await tokenDigest(token))
    .run();
}

/** The growth partner signed in on this request, or null. */
export async function currentPartner(
  env: Env,
  request: Request,
): Promise<AuthenticatedPartner | null> {
  const token = readCookie(request, PARTNER_SESSION_COOKIE);
  if (!token) return null;

  const id = await tokenDigest(token);
  const row = await env.DB.prepare(
    `SELECT p.id, p.email, p.full_name, p.business_name, p.status,
            p.commission_rate, p.commission_months, p.hold_days, p.agreement_signed_at,
            s.expires_at, s.last_seen_at
       FROM growth_partner_sessions s
       JOIN growth_partners p ON p.id = s.partner_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      email: string;
      full_name: string;
      business_name: string | null;
      status: PartnerState;
      commission_rate: number;
      commission_months: number;
      hold_days: number;
      agreement_signed_at: string | null;
      expires_at: string;
      last_seen_at: string;
    }>();

  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(`DELETE FROM growth_partner_sessions WHERE id = ?`)
      .bind(id)
      .run();
    return null;
  }

  /*
   * Checked here and not only at sign-in. Suspending somebody who sells for the firm is
   * a thing the firm does because something has gone wrong, and it has to stop working
   * now rather than whenever that person next signs in.
   */
  if (!partnerMayWork(row.status)) return null;

  // Touched at most once an hour, for the reason client-auth.ts gives.
  const now = Date.now();
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (!Number.isFinite(lastSeen) || now - lastSeen > 3_600_000) {
    await env.DB.prepare(
      `UPDATE growth_partner_sessions SET last_seen_at = ? WHERE id = ?`,
    )
      .bind(new Date(now).toISOString(), id)
      .run();
  }

  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    business_name: row.business_name,
    status: row.status,
    commission_rate: row.commission_rate,
    commission_months: row.commission_months,
    hold_days: row.hold_days,
    agreement_signed_at: row.agreement_signed_at,
    session_id: id,
  };
}

/** The signed-in growth partner, or a refusal. */
export async function requirePartner(
  env: Env,
  request: Request,
): Promise<AuthenticatedPartner> {
  const actor = await currentPartner(env, request);
  if (!actor) throw unauthorized("Please sign in.");
  return actor;
}

/**
 * The partner_id a partner-facing query must use.
 *
 * A function rather than a property read at each call site, so a search for where
 * partner scope comes from finds one place.
 */
export function partnerScope(actor: AuthenticatedPartner): string {
  return actor.id;
}

/** A refusal that says nothing about whether the thing asked for exists. */
export function notTheirs(): HttpError {
  return forbidden("That is not one of yours.");
}
