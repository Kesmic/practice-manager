/**
 * Signing a client in, and keeping them where they belong.
 *
 * This is the first time anybody outside the firm has had an account here, and the way
 * that goes wrong is not subtle: a client reading a colleague's payroll, or another
 * client's fees. Four things keep it from happening, and each is a deliberate refusal to
 * reuse something that already existed.
 *
 * **A separate table.** The obvious design - a 'client' value added to the role CHECK on
 * `users` - would mean every `requireRole` already written, and every query that says
 * "all active users", silently starts including clients. There are dozens of each. This
 * file never touches `users`, and worker/auth.ts never touches `client_users`, so a
 * client session cannot satisfy a staff check: the staff path looks the token up in a
 * table the client's session is not in, finds nothing, and refuses.
 *
 * **A separate cookie.** `kpm_client`, not `kpm_session`. Two names rather than one so
 * that neither path can read the other's token even by accident, and so a browser signed
 * in to both - a Partner who is also a client of the firm, which happens - keeps them
 * apart.
 *
 * **Scope comes from the session, never from the request.** `requireClientUser` returns
 * the `client_id` off the row. Every client-facing query filters on that value and not
 * on anything the caller sent. There is no endpoint where a client names the client
 * whose data they want.
 *
 * **The firm never knows the password.** Staff get a temporary one typed by an
 * administrator, which is right for people who can walk to that administrator's desk. A
 * client sets their own through a one-time invitation link, and `password_hash` is null
 * until they do. Nobody at the firm can sign in as a client.
 *
 * Everything else is borrowed on purpose: the same PBKDF2 hashing, the same password
 * policy, and the same per-account and per-source attempt limits as staff sign-in, so a
 * client account is no cheaper to guess at than a Partner's.
 */

import type { Env } from "./env";
import { newToken, readCookie, tokenDigest, ttlDays } from "./auth";
import { HttpError, forbidden, unauthorized } from "./http";

/** Deliberately not `kpm_session`. See the header. */
export const CLIENT_SESSION_COOKIE = "kpm_client";

/**
 * How long an invitation stands.
 *
 * Seven days: long enough to survive a holiday and a forwarded email, short enough that
 * a link sitting in an inbox a year later opens nothing. Expiring is not a dead end -
 * a Partner can send another.
 */
export const INVITATION_TTL_DAYS = 7;

/**
 * How long a reset link a client asked for themselves stands.
 *
 * An hour, not the seven days an invitation gets. An invitation is arranged between two
 * people who know it is coming; a reset link arrives unannounced in an inbox that may
 * not be the client's alone, and every hour it stays valid is an hour it is a live
 * credential sitting in a mailbox. An hour is long enough to read an email and act on
 * it, and asking again costs nothing.
 */
export const RESET_TTL_MINUTES = 60;

export interface AuthenticatedClientUser {
  id: string;
  /** The client they belong to. Every query scopes on this and never on the request. */
  client_id: string;
  client_name: string;
  client_code: string;
  email: string;
  full_name: string;
  /** Digest of this caller's own session token, so it can be spared a bulk sign-out. */
  session_id: string;
}

export async function createClientSession(
  env: Env,
  clientUserId: string,
  userAgent: string | null,
): Promise<{ cookie: string }> {
  const token = newToken();
  const id = await tokenDigest(token);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays(env) * 86_400_000);

  await env.DB.prepare(
    `INSERT INTO client_sessions
       (id, client_user_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      clientUserId,
      now.toISOString(),
      expires.toISOString(),
      now.toISOString(),
      userAgent?.slice(0, 300) ?? null,
    )
    .run();

  const maxAge = ttlDays(env) * 86_400;
  return {
    cookie: `${CLIENT_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  };
}

export const clearedClientCookie = `${CLIENT_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function destroyClientSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request, CLIENT_SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare(`DELETE FROM client_sessions WHERE id = ?`)
    .bind(await tokenDigest(token))
    .run();
}

/**
 * The client signed in on this request, or null.
 *
 * The join to `clients` is not decoration: it is what makes a session belonging to a
 * deleted client resolve to nothing rather than to a user with a dangling client_id.
 */
export async function currentClientUser(
  env: Env,
  request: Request,
): Promise<AuthenticatedClientUser | null> {
  const token = readCookie(request, CLIENT_SESSION_COOKIE);
  if (!token) return null;

  const id = await tokenDigest(token);
  const row = await env.DB.prepare(
    `SELECT cu.id, cu.client_id, cu.email, cu.full_name, cu.status,
            c.name AS client_name, c.code AS client_code, c.status AS client_status,
            s.expires_at, s.last_seen_at
       FROM client_sessions s
       JOIN client_users cu ON cu.id = s.client_user_id
       JOIN clients c ON c.id = cu.client_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      client_id: string;
      email: string;
      full_name: string;
      status: string;
      client_name: string;
      client_code: string;
      client_status: string;
      expires_at: string;
      last_seen_at: string;
    }>();

  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(`DELETE FROM client_sessions WHERE id = ?`).bind(id).run();
    return null;
  }

  /*
   * Suspended here, and not only at sign-in. A Partner who suspends a client login
   * expects it to stop working now, not whenever that person next signs in - which,
   * with a seven-day session, could be a week.
   */
  if (row.status !== "active") return null;

  /*
   * A client the firm has exited keeps their history in the portal but loses their way
   * in. The subscription is over; the login goes with it.
   */
  if (row.client_status === "exited") return null;

  /*
   * Touched at most once an hour rather than on every request. The column exists to
   * spot a session nobody has used; to the hour is plenty for that, and a write per
   * request would cost a round trip on every single call for no gain.
   */
  const now = Date.now();
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (!Number.isFinite(lastSeen) || now - lastSeen > 3_600_000) {
    await env.DB.prepare(`UPDATE client_sessions SET last_seen_at = ? WHERE id = ?`)
      .bind(new Date(now).toISOString(), id)
      .run();
  }

  return {
    id: row.id,
    client_id: row.client_id,
    client_name: row.client_name,
    client_code: row.client_code,
    email: row.email,
    full_name: row.full_name,
    session_id: id,
  };
}

/** The signed-in client, or a refusal. */
export async function requireClientUser(
  env: Env,
  request: Request,
): Promise<AuthenticatedClientUser> {
  const actor = await currentClientUser(env, request);
  if (!actor) throw unauthorized("Please sign in.");
  return actor;
}

/**
 * The client_id a client-facing query must use.
 *
 * A function rather than a property read at each call site, so that a search for where
 * client scope comes from finds one place. If a client-facing endpoint ever takes a
 * client id from the request instead, it will be visibly not using this.
 */
export function scopeOf(actor: AuthenticatedClientUser): string {
  return actor.client_id;
}

/** A refusal that says nothing about whether the thing asked for exists. */
export function notYours(): HttpError {
  return forbidden("That is not available on your account.");
}
