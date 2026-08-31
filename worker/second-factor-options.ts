/**
 * The server side of remembering a device and of secret questions.
 *
 * The reasoning about what each of these costs lives in shared/second-factor-options.ts.
 * What is here is everything that touches the database, the clock or a cookie.
 */

import type { Env } from "./env";
import { newId, nowIso } from "./db";
import {
  SECRET_QUESTION_COUNT,
  type QuestionDraft,
  type SecretQuestionPolicy,
  type TrustedDevicePolicy,
  normaliseAnswer,
  normaliseQuestion,
  readSecretQuestionPolicy,
  readTrustedDevicePolicy,
} from "../shared/second-factor-options";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export async function trustedDevicePolicy(env: Env): Promise<TrustedDevicePolicy> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("trusted_device_days")
    .first<{ value: string }>();
  return readTrustedDevicePolicy(row?.value);
}

export async function secretQuestionPolicy(env: Env): Promise<SecretQuestionPolicy> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("secret_questions_enabled")
    .first<{ value: string }>();
  return readSecretQuestionPolicy(row?.value);
}

// ---------------------------------------------------------------------------
// Remembered devices
// ---------------------------------------------------------------------------

export const TRUSTED_DEVICE_COOKIE = "kpm_device";

/**
 * A short, honest name for a browser, from its user agent.
 *
 * Not to identify anybody, only so the list on the account screen reads "Chrome on
 * Windows" rather than a hundred characters of version string. A list somebody cannot
 * read is a list they will not prune, and pruning it is the only revocation there is.
 */
export function describeDevice(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : "A browser";

  const platform =
    /Windows/.test(ua) ? "Windows"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "an unknown system";

  return `${browser} on ${platform}`;
}

export interface TrustedDeviceRow {
  id: string;
  user_id: string;
  label: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

/**
 * Remembers this browser, returning the cookie to set.
 *
 * Called only after a second step has actually been completed. Nothing here is a factor
 * on its own: it is a note that the factor was presented, and it expires.
 */
export async function rememberDevice(
  env: Env,
  userId: string,
  userAgent: string | null,
  days: number,
): Promise<string> {
  const token = newToken();
  const now = Date.now();
  const expiresAt = new Date(now + days * 86_400_000).toISOString();
  const timestamp = new Date(now).toISOString();

  await env.DB.batch([
    // Housekeeping, here rather than on a timer: this is the only moment the table is
    // certainly being written, and an expired row is worth nothing to anybody.
    env.DB.prepare(`DELETE FROM trusted_devices WHERE expires_at <= ?`).bind(timestamp),
    env.DB.prepare(
      `INSERT INTO trusted_devices
         (id, user_id, label, created_at, last_used_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      await sha256(token),
      userId,
      describeDevice(userAgent),
      timestamp,
      timestamp,
      expiresAt,
      userAgent,
    ),
  ]);

  const maxAge = Math.floor(days * 86_400);
  return `${TRUSTED_DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export const clearedDeviceCookie = `${TRUSTED_DEVICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Whether this request carries a live remembered-device token for this account.
 *
 * The user id is part of the lookup rather than read off the row and compared afterwards.
 * That way a token belonging to somebody else simply does not match, and there is no
 * branch where a mistake could let one account's device stand in for another's.
 *
 * An expired row is deleted on sight, so a stale cookie cannot sit in the table being
 * checked for ever.
 */
export async function deviceIsTrusted(
  env: Env,
  request: Request,
  userId: string,
): Promise<boolean> {
  const token = readCookie(request, TRUSTED_DEVICE_COOKIE);
  if (!token || token.length !== 64) return false;

  const id = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT id, expires_at FROM trusted_devices WHERE id = ? AND user_id = ?`,
  )
    .bind(id, userId)
    .first<{ id: string; expires_at: string }>();
  if (!row) return false;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(`DELETE FROM trusted_devices WHERE id = ?`).bind(id).run();
    return false;
  }

  await env.DB.prepare(`UPDATE trusted_devices SET last_used_at = ? WHERE id = ?`)
    .bind(nowIso(), id)
    .run();
  return true;
}

/** The devices this person is currently letting past the second step. */
export async function listDevices(
  env: Env,
  userId: string,
  request: Request,
): Promise<Array<TrustedDeviceRow & { this_one: boolean }>> {
  const token = readCookie(request, TRUSTED_DEVICE_COOKIE);
  const thisId = token && token.length === 64 ? await sha256(token) : null;

  const { results } = await env.DB.prepare(
    `SELECT id, user_id, label, created_at, last_used_at, expires_at
       FROM trusted_devices
      WHERE user_id = ? AND expires_at > ?
      ORDER BY last_used_at DESC`,
  )
    .bind(userId, nowIso())
    .all<TrustedDeviceRow>();

  return (results ?? []).map((row) => ({ ...row, this_one: row.id === thisId }));
}

/** Drops one device. Scoped to the owner, so nobody can revoke somebody else's. */
export async function forgetDevice(
  env: Env,
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `DELETE FROM trusted_devices WHERE id = ? AND user_id = ?`,
  )
    .bind(id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Drops every remembered device for one person.
 *
 * Called wherever the second factor itself changes hands: a reset, a re-enrolment, or
 * the person asking. A device remembered against the old enrolment must not survive it,
 * or resetting somebody's two-step sign-in would leave the browser that was already past
 * it still past it, which is the opposite of what a reset is for.
 */
export async function forgetAllDevices(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM trusted_devices WHERE user_id = ?`)
    .bind(userId)
    .run();
}

// ---------------------------------------------------------------------------
// Secret questions
// ---------------------------------------------------------------------------

/** Salted with the user id, so a hash means nothing on another account. */
async function answerHash(userId: string, answer: string): Promise<string> {
  return sha256(`${userId}:${normaliseAnswer(answer)}`);
}

export interface QuestionRow {
  id: string;
  position: number;
  question: string;
}

/** The questions to put to somebody, without anything that would help answer them. */
export async function loadQuestions(env: Env, userId: string): Promise<QuestionRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, position, question FROM secret_questions
      WHERE user_id = ? ORDER BY position`,
  )
    .bind(userId)
    .all<QuestionRow>();
  return results ?? [];
}

export async function hasQuestions(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM secret_questions WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ n: number }>();
  return (row?.n ?? 0) === SECRET_QUESTION_COUNT;
}

/** Replaces the whole set. Validated by the caller before it gets here. */
export async function setQuestions(
  env: Env,
  userId: string,
  drafts: QuestionDraft[],
): Promise<void> {
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM secret_questions WHERE user_id = ?`).bind(userId),
    ...(await Promise.all(
      drafts.map(async (draft, index) =>
        env.DB.prepare(
          `INSERT INTO secret_questions
             (id, user_id, position, question, answer_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          newId(),
          userId,
          index,
          normaliseQuestion(draft.question),
          await answerHash(userId, draft.answer),
          timestamp,
        ),
      ),
    )),
  ]);
}

export async function clearQuestions(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM secret_questions WHERE user_id = ?`)
    .bind(userId)
    .run();
}

/**
 * Checks a set of answers. Every one must be right.
 *
 * Two things this deliberately does not do. It does not say which answer was wrong,
 * because that turns one guess at two questions into two independent guesses at one. And
 * it does not stop at the first failure, so the work done is the same whether the first
 * answer was right or wrong, and the time taken says nothing.
 */
export async function checkAnswers(
  env: Env,
  userId: string,
  answers: unknown,
): Promise<boolean> {
  const rows = await loadQuestions(env, userId);
  if (rows.length !== SECRET_QUESTION_COUNT) return false;
  if (!Array.isArray(answers) || answers.length !== rows.length) return false;

  const stored = await env.DB.prepare(
    `SELECT position, answer_hash FROM secret_questions WHERE user_id = ? ORDER BY position`,
  )
    .bind(userId)
    .all<{ position: number; answer_hash: string }>();

  const expected = new Map(
    (stored.results ?? []).map((row) => [row.position, row.answer_hash]),
  );

  let allMatched = true;
  for (let index = 0; index < rows.length; index++) {
    const given = answers[index];
    if (typeof given !== "string" || normaliseAnswer(given).length === 0) {
      allMatched = false;
      continue;
    }
    const hash = await answerHash(userId, given);
    if (hash !== expected.get(rows[index].position)) allMatched = false;
  }
  return allMatched;
}
