/**
 * Authentication: PBKDF2 password hashing and opaque database-backed sessions.
 *
 * The session cookie holds a random token; only its SHA-256 digest is stored,
 * so a database leak does not hand over live sessions. Cookies are HttpOnly,
 * Secure and SameSite=Lax - the API and the app are served from the same origin
 * by the same Worker, so no cross-site cookie relaxation is needed.
 */

import type { Env } from "./env";
import { HttpError, forbidden, unauthorized } from "./http";
import { atLeast, type Role } from "../shared/workflow";
import {
  isRequiredFor as twoFactorRequiredFor,
  readPolicy as readTwoFactorPolicy,
} from "../shared/twofactor";
import {
  IDLE_SIGNED_OUT_CODE,
  IDLE_SIGNED_OUT_MESSAGE,
  TOUCH_AFTER_SECONDS,
  readIdlePolicy,
  type IdlePolicy,
} from "../shared/session-policy";

/**
 * The PBKDF2 work factor is a deployment setting rather than a constant, because
 * what caps it is not cryptography but the Worker's CPU budget. Cloudflare
 * allows **10 ms of CPU per request on the Workers Free plan**, and
 * PBKDF2-SHA256 costs roughly 0.45 ms per thousand iterations, so the 600,000
 * iterations OWASP currently recommends - about 280 ms - is only reachable on
 * the Paid plan. Exceeding the budget does not fail gracefully: the request is
 * killed, so signing in becomes impossible rather than slow.
 *
 * The default below leaves room for the rest of a request inside 10 ms. Raise it
 * with the `PASSWORD_ITERATIONS` variable when the plan allows.
 *
 * The count is recorded inside each stored hash, so changing this setting never
 * invalidates an existing password: every hash verifies at the count it was
 * written with. Passwords set afterwards use the new count; to move an existing
 * account across, change or reset its password.
 */
const DEFAULT_ITERATIONS = 8_000;
const MIN_ITERATIONS = 1_000;
const MAX_ITERATIONS = 1_000_000;

const HASH_BYTES = 32;
const SALT_BYTES = 16;

/** Scheme labels recorded in stored hashes. `p` marks a peppered hash. */
const PLAIN = "pbkdf2";
const PEPPERED = "pbkdf2p";

export function passwordIterations(env: Env): number {
  const parsed = Number.parseInt(env.PASSWORD_ITERATIONS ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ITERATIONS;
  return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, parsed));
}

export const SESSION_COOKIE = "kpm_session";
const DEFAULT_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Allocates cryptographically random bytes. The array is created first and
 * filled in place so the result is typed against a plain ArrayBuffer, which is
 * what the WebCrypto `BufferSource` parameters require.
 */
function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Length-independent, value-constant-time comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Mixes the deployment's pepper into a password before the KDF runs.
 *
 * The pepper lives in Worker secrets and never in D1, so a leaked database
 * export - a mislaid backup, an over-scoped API token - cannot be attacked
 * offline at all, whatever the work factor. That is what makes an iteration
 * count trimmed to fit the CPU budget defensible. One HMAC costs microseconds.
 */
async function withPepper(secret: string, password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(password),
  );
  return toBase64(new Uint8Array(mac));
}

export async function hashPassword(env: Env, password: string): Promise<string> {
  const iterations = passwordIterations(env);
  const pepper = env.PASSWORD_PEPPER;
  const material = pepper ? await withPepper(pepper, password) : password;
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(material, salt, iterations);
  const scheme = pepper ? PEPPERED : PLAIN;
  return `${scheme}$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(
  env: Env,
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const scheme = parts[0];
  if (scheme !== PLAIN && scheme !== PEPPERED) return false;

  // Whether a hash was peppered is recorded in the hash itself, so switching the
  // pepper on later leaves existing passwords working. Switching it back off
  // does not: nothing can match, and reporting "password incorrect" would send
  // an administrator hunting for a problem that is not there.
  if (scheme === PEPPERED && !env.PASSWORD_PEPPER) {
    throw new HttpError(
      500,
      "This deployment's PASSWORD_PEPPER secret is missing, so no password can be checked.",
      "Restore the PASSWORD_PEPPER secret in the Cloudflare dashboard. It must keep the exact value it had when passwords were set.",
    );
  }

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < MIN_ITERATIONS) return false;
  try {
    const material =
      scheme === PEPPERED
        ? await withPepper(env.PASSWORD_PEPPER!, password)
        : password;
    const salt = fromBase64(parts[2]);
    const expected = fromBase64(parts[3]);
    const actual = await derive(material, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * A hash of a value nobody can supply, so an unknown email address costs the
 * same PBKDF2 time as a registered one and response latency does not reveal
 * which addresses exist. It is built at the deployment's *current* work factor:
 * a constant with an iteration count baked in would leak the difference through
 * timing, and - if that count were higher - would spend the CPU budget on
 * requests that could never succeed.
 */
export function decoyHash(env: Env): string {
  const scheme = env.PASSWORD_PEPPER ? PEPPERED : PLAIN;
  const salt = toBase64(new Uint8Array(SALT_BYTES));
  const hash = toBase64(new Uint8Array(HASH_BYTES));
  return `${scheme}$${passwordIterations(env)}$${salt}$${hash}`;
}

/** Minimum password policy for a system holding client tax data. */
export function assertPasswordPolicy(password: string): void {
  if (typeof password !== "string" || password.length < 12) {
    throw new HttpError(400, "Password must be at least 12 characters long.");
  }
  if (password.length > 200) {
    throw new HttpError(400, "Password must be 200 characters or fewer.");
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(password),
  ).length;
  if (classes < 3) {
    throw new HttpError(
      400,
      "Password must combine at least three of: lower case, upper case, digits, symbols.",
    );
  }
}

export function generateTemporaryPassword(): string {
  // Ambiguous characters removed so the password can be read out loud.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10)}!7`;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function digest(token: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toHex(buf);
}

function ttlDays(env: Env): number {
  const parsed = Number.parseInt(env.SESSION_TTL_DAYS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_DAYS;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  title: string | null;
  must_change_password: 0 | 1;
  /** Whether this person wants email as well as the in-app inbox. */
  email_notifications: 0 | 1;
  /** Digest of the caller's own session token, so it can be exempted from
   *  bulk session revocation. Never sent to the client. */
  session_id: string;
}

export async function createSession(
  env: Env,
  userId: string,
  userAgent: string | null,
): Promise<{ cookie: string }> {
  const token = toBase64(randomBytes(32));
  const id = await digest(token);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays(env) * 86_400_000);

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      now.toISOString(),
      expires.toISOString(),
      now.toISOString(),
      userAgent?.slice(0, 300) ?? null,
    )
    .run();

  const maxAge = ttlDays(env) * 86_400;
  return {
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  };
}

export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function destroySession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`)
    .bind(await digest(token))
    .run();
}

/** Resolves the signed-in user, or null when there is no valid session. */
/** The firm's inactivity setting. */
export async function idlePolicy(env: Env): Promise<IdlePolicy> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("idle_timeout_minutes")
    .first<{ value: string }>();
  return readIdlePolicy(row?.value);
}

/**
 * Who is signed in, and if nobody, whether that is because they were idle.
 *
 * The reason matters. Without it the browser cannot tell "your session ran out while you
 * were away" from "you are not signed in", and somebody who steps away for lunch comes
 * back to a sign-in screen with no explanation for where their afternoon went.
 */
export async function currentSession(
  env: Env,
  request: Request,
): Promise<{ user: AuthenticatedUser | null; idled: boolean }> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return { user: null, idled: false };

  const id = await digest(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.full_name, u.role, u.title, u.must_change_password,
            u.email_notifications, u.status, s.expires_at, s.last_seen_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      email: string;
      full_name: string;
      role: Role;
      title: string | null;
      must_change_password: 0 | 1;
      email_notifications: 0 | 1;
      status: string;
      expires_at: string;
      last_seen_at: string;
    }>();

  if (!row) return { user: null, idled: false };

  const now = Date.now();

  if (new Date(row.expires_at).getTime() <= now) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    return { user: null, idled: false };
  }

  if (row.status !== "active") return { user: null, idled: false };

  /*
   * The inactivity window, enforced here rather than only in the browser. This is the
   * half that holds for a tab closed without signing out, or a cookie lifted off a
   * machine: neither will ever run the page's own timer.
   */
  const policy = await idlePolicy(env);
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (policy.enabled && Number.isFinite(lastSeen)) {
    const idleMs = now - lastSeen;
    if (idleMs > policy.minutes * 60_000) {
      await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
      return { user: null, idled: true };
    }
    // Written back only when it has gone stale, so continuous work is not a write per
    // request. See TOUCH_AFTER_SECONDS for what that costs at the boundary.
    if (idleMs > TOUCH_AFTER_SECONDS * 1000) {
      await env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`)
        .bind(new Date(now).toISOString(), id)
        .run();
    }
  }

  return {
    user: {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      role: row.role,
      title: row.title,
      must_change_password: row.must_change_password,
      email_notifications: row.email_notifications,
      session_id: id,
    },
    idled: false,
  };
}

/** The caller, or null. Keeps the older shape for everything that does not need a reason. */
export async function currentUser(
  env: Env,
  request: Request,
): Promise<AuthenticatedUser | null> {
  return (await currentSession(env, request)).user;
}

/** Strips server-only fields before a user record goes over the wire. */
export function publicUser(user: AuthenticatedUser) {
  const { session_id: _session, ...rest } = user;
  return rest;
}

/**
 * Resolves the caller or rejects the request.
 *
 * A user signed in on a temporary password is deliberately confined to the
 * account screen: set `allowPasswordPending` only on the endpoints that let them
 * choose a new one. Enforcing this here rather than in the UI means an issued
 * temporary password cannot be used to drive the API indefinitely.
 */
export async function requireUser(
  env: Env,
  request: Request,
  {
    allowPasswordPending = false,
    allowTwoFactorPending = false,
  }: { allowPasswordPending?: boolean; allowTwoFactorPending?: boolean } = {},
): Promise<AuthenticatedUser> {
  const { user, idled } = await currentSession(env, request);
  if (!user) {
    throw idled
      ? new HttpError(401, IDLE_SIGNED_OUT_MESSAGE, IDLE_SIGNED_OUT_CODE)
      : unauthorized();
  }
  if (user.must_change_password === 1 && !allowPasswordPending) {
    throw forbidden(
      "You are signed in with a temporary password. Set a new password before continuing.",
    );
  }

  /*
   * Someone whose grade obliges them to use a second factor, and who has not set one up,
   * is confined to doing so, exactly as a temporary password confines them to choosing a
   * new one. Confinement rather than refusal at sign-in: locking them out instead would
   * mean the day a partner turns this on is the day nobody can work, including whoever
   * would have to turn it back off.
   *
   * The check is one indexed lookup and only runs for grades the policy covers, so it
   * costs nothing for the associates who are the bulk of the requests.
   */
  if (!allowTwoFactorPending && (await mustEnrolTwoFactor(env, user))) {
    throw forbidden(
      "Two-step sign-in is required at your grade. Set it up under My account before continuing.",
    );
  }

  return user;
}

/**
 * Whether this person is obliged to have a second factor and has not confirmed one.
 *
 * Kept here rather than in twofactor.ts to avoid a cycle: the auth module is imported by
 * everything, including the two-factor routes.
 */
async function mustEnrolTwoFactor(
  env: Env,
  user: AuthenticatedUser,
): Promise<boolean> {
  const setting = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("twofactor_min_role")
    .first<{ value: string }>();
  const policy = readTwoFactorPolicy(setting?.value);
  if (!twoFactorRequiredFor(policy, user.role)) return false;

  const row = await env.DB.prepare(
    `SELECT confirmed_at FROM user_totp WHERE user_id = ?`,
  )
    .bind(user.id)
    .first<{ confirmed_at: string | null }>();
  return !row?.confirmed_at;
}

export async function requireRole(
  env: Env,
  request: Request,
  minimum: Role,
): Promise<AuthenticatedUser> {
  const user = await requireUser(env, request);
  if (!atLeast(user.role, minimum)) {
    throw forbidden("Your grade does not permit this action.");
  }
  return user;
}

/** Best-effort cleanup of expired sessions, called opportunistically on login. */
export async function pruneSessions(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= ?`)
    .bind(new Date().toISOString())
    .run();
}
