/**
 * Authentication: PBKDF2 password hashing and opaque database-backed sessions.
 *
 * The session cookie holds a random token; only its SHA-256 digest is stored,
 * so a database leak does not hand over live sessions. Cookies are HttpOnly,
 * Secure and SameSite=Lax — the API and the app are served from the same origin
 * by the same Worker, so no cross-site cookie relaxation is needed.
 */

import type { Env } from "./env";
import { HttpError, forbidden, unauthorized } from "./http";
import { atLeast, type Role } from "../shared/workflow";

const PBKDF2_ITERATIONS = 210_000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

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

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  try {
    const salt = fromBase64(parts[2]);
    const expected = fromBase64(parts[3]);
    const actual = await derive(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
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
export async function currentUser(
  env: Env,
  request: Request,
): Promise<AuthenticatedUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const id = await digest(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.full_name, u.role, u.title, u.must_change_password,
            u.status, s.expires_at
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
      status: string;
      expires_at: string;
    }>();

  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
    return null;
  }

  if (row.status !== "active") return null;

  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    title: row.title,
    must_change_password: row.must_change_password,
    session_id: id,
  };
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
  { allowPasswordPending = false }: { allowPasswordPending?: boolean } = {},
): Promise<AuthenticatedUser> {
  const user = await currentUser(env, request);
  if (!user) throw unauthorized();
  if (user.must_change_password === 1 && !allowPasswordPending) {
    throw forbidden(
      "You are signed in with a temporary password. Set a new password before continuing.",
    );
  }
  return user;
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
