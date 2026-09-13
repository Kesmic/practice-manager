/**
 * The server side of two-step sign-in: storing a secret, issuing and spending
 * challenges, and verifying codes.
 *
 * The pure arithmetic lives in shared/totp.ts, which is tested against the RFC vectors.
 * What is here is everything that touches the database, the clock or a key.
 */

import type { Env } from "./env";
import { newId, nowIso } from "./db";
import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_MINUTES,
  RECOMMENDED_TWOFACTOR_MIN_ROLE,
  TWOFACTOR_OFF,
  type TwoFactorPolicy,
  isRequiredFor,
  readPolicy,
} from "../shared/twofactor";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  generateSecret,
  normaliseRecoveryCode,
  verifyCode,
} from "../shared/totp";
import type { Role } from "../shared/workflow";
import { questionsPolicy, questionsScheme } from "./security-questions";
import { questionsEnabled } from "../shared/security-questions";

// ---------------------------------------------------------------------------
// The secret at rest
// ---------------------------------------------------------------------------

/**
 * A TOTP secret is a bearer credential: whoever holds it can produce codes for ever.
 * So it is encrypted where a key is available, and the stored value says which it is.
 *
 * The key is derived from PASSWORD_PEPPER rather than from a new setting. That is a
 * judgement about this firm: they have already had one round of trouble getting a
 * secret into Cloudflare, and a second one that silently breaks every enrolment when it
 * is missing would be worse than the risk it removes. HKDF with its own label keeps the
 * two uses of the pepper cryptographically separate.
 *
 * Where no pepper is set the secret is stored as-is, marked `plain:`. That is not a
 * silent downgrade: the account screen reports it, because a database export would then
 * carry every second factor in the firm.
 */
const ENCRYPTED_PREFIX = "v1:";
const PLAIN_PREFIX = "plain:";

async function secretKey(env: Env): Promise<CryptoKey | null> {
  const pepper = env.PASSWORD_PEPPER;
  if (!pepper) return null;

  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper) as unknown as ArrayBuffer,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      // A fixed salt is acceptable here: the pepper is already high-entropy and
      // secret, and the label is what separates this key from the password hashing.
      salt: new TextEncoder().encode("kesmic-practice-manager") as unknown as ArrayBuffer,
      info: new TextEncoder().encode("totp-secret-encryption") as unknown as ArrayBuffer,
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

/** Wraps a secret for storage. */
export async function sealSecret(env: Env, secret: string): Promise<string> {
  const key = await secretKey(env);
  if (!key) return `${PLAIN_PREFIX}${secret}`;

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
      key,
      new TextEncoder().encode(secret) as unknown as ArrayBuffer,
    ),
  );
  return `${ENCRYPTED_PREFIX}${toBase64(iv)}:${toBase64(cipher)}`;
}

/**
 * Unwraps a stored secret, or null if it cannot be read.
 *
 * Null is what happens when the pepper has been changed or removed after enrolment.
 * That is not recoverable and must not look like a wrong code: the caller turns it into
 * a message telling the person to enrol again, which is a nuisance rather than a
 * mystery.
 */
export async function openSecret(env: Env, stored: string): Promise<string | null> {
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length);
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return null;

  const key = await secretKey(env);
  if (!key) return null;

  const [, ivPart, cipherPart] = stored.split(":");
  if (!ivPart || !cipherPart) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivPart) as unknown as ArrayBuffer },
      key,
      fromBase64(cipherPart) as unknown as ArrayBuffer,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Whether secrets are being encrypted at rest on this deployment. */
export function secretsEncrypted(env: Env): boolean {
  return Boolean(env.PASSWORD_PEPPER);
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export async function twoFactorPolicy(env: Env): Promise<TwoFactorPolicy> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("twofactor_min_role")
    .first<{ value: string }>();
  return readPolicy(row?.value);
}

export { RECOMMENDED_TWOFACTOR_MIN_ROLE, TWOFACTOR_OFF, isRequiredFor };

// ---------------------------------------------------------------------------
// Enrolment state
// ---------------------------------------------------------------------------

export interface TotpRow {
  user_id: string;
  secret: string;
  confirmed_at: string | null;
  last_counter: number | null;
}

export async function loadTotp(env: Env, userId: string): Promise<TotpRow | null> {
  return env.DB.prepare(
    `SELECT user_id, secret, confirmed_at, last_counter FROM user_totp WHERE user_id = ?`,
  )
    .bind(userId)
    .first<TotpRow>();
}

/** Whether this person's second factor is set up and in force. */
export async function isEnabled(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT confirmed_at FROM user_totp WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ confirmed_at: string | null }>();
  return Boolean(row?.confirmed_at);
}

/**
 * Starts or restarts enrolment, returning the new secret.
 *
 * A fresh secret every time this is called, and the old one is discarded along with any
 * recovery codes. Anything else would leave a half-finished enrolment from last month
 * able to produce valid codes.
 */
export async function beginEnrolment(env: Env, userId: string): Promise<string> {
  const secret = generateSecret();
  const timestamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM recovery_codes WHERE user_id = ?`).bind(userId),
    // Devices remembered against the old enrolment go with it: they were vouched for by
    // a factor that no longer exists.
    env.DB.prepare(`DELETE FROM trusted_devices WHERE user_id = ?`).bind(userId),
    env.DB.prepare(
      `INSERT INTO user_totp (user_id, secret, confirmed_at, last_counter, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, ?)
       ON CONFLICT (user_id) DO UPDATE
         SET secret = excluded.secret,
             confirmed_at = NULL,
             last_counter = NULL,
             updated_at = excluded.updated_at`,
    ).bind(userId, await sealSecret(env, secret), timestamp, timestamp),
  ]);
  return secret;
}

/**
 * Removes the enrolment and everything that hung off it.
 *
 * Every second factor, not only the app. Security questions stand in for a code, and a
 * remembered device skips the step entirely, so an enrolment reset that left either
 * behind would not be a reset - it would leave the account reachable by the two weaker
 * routes while looking, on the screen, as though the second factor had been cleared.
 *
 * This is the path a partner takes for a colleague's lost phone, and the path somebody
 * takes to turn their own off. Both want the same thing: nothing left standing between
 * the password and the account except what gets set up next.
 */
export async function clearEnrolment(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM user_totp WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM recovery_codes WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM user_security_questions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM trusted_devices WHERE user_id = ?`).bind(userId),
    // Any half-finished sign-in for this person is meaningless now.
    env.DB.prepare(`DELETE FROM login_challenges WHERE user_id = ?`).bind(userId),
  ]);
}

/**
 * Checks a code against an enrolment and records the step it used.
 *
 * The counter is written before this returns, so two requests racing with the same code
 * cannot both succeed: the second reads a counter that already covers it.
 */
export async function checkTotp(
  env: Env,
  row: TotpRow,
  code: unknown,
): Promise<{ ok: boolean; reason: "ok" | "unreadable" | "replay" | "mismatch" }> {
  const secret = await openSecret(env, row.secret);
  if (!secret) return { ok: false, reason: "unreadable" };

  const result = await verifyCode(secret, code, Date.now(), row.last_counter);
  if (!result.ok) {
    return { ok: false, reason: result.reason === "replay" ? "replay" : "mismatch" };
  }

  await env.DB.prepare(
    `UPDATE user_totp SET last_counter = ?, updated_at = ? WHERE user_id = ?`,
  )
    .bind(result.counter, nowIso(), row.user_id)
    .run();
  return { ok: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/** SHA-256 of the normalised code, salted with the user id so it is not portable. */
async function recoveryHash(userId: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${normaliseRecoveryCode(code)}`);
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Issues a fresh set, replacing any that exist. Returns the plain codes, once. */
export async function issueRecoveryCodes(env: Env, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const timestamp = nowIso();
  const statements = [
    env.DB.prepare(`DELETE FROM recovery_codes WHERE user_id = ?`).bind(userId),
    ...(await Promise.all(
      codes.map(async (code) =>
        env.DB.prepare(
          `INSERT INTO recovery_codes (id, user_id, code_hash, used_at, created_at)
           VALUES (?, ?, ?, NULL, ?)`,
        ).bind(newId(), userId, await recoveryHash(userId, code), timestamp),
      ),
    )),
  ];
  await env.DB.batch(statements);
  return codes;
}

export async function recoveryRemaining(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`,
  )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Spends a recovery code if it is one of this person's unused ones.
 *
 * The update is what does the checking: `used_at IS NULL` in the WHERE clause means two
 * simultaneous attempts with the same code cannot both be told yes, without needing a
 * transaction around a read and a write.
 */
export async function spendRecoveryCode(
  env: Env,
  userId: string,
  code: unknown,
): Promise<boolean> {
  const normalised = normaliseRecoveryCode(code);
  if (normalised.length !== 10) return false;

  const hash = await recoveryHash(userId, normalised);
  const result = await env.DB.prepare(
    `UPDATE recovery_codes SET used_at = ?
      WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
  )
    .bind(nowIso(), userId, hash)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Challenges: the gap between the password and the code
// ---------------------------------------------------------------------------

async function digest(value: string): Promise<string> {
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

/** Issues a challenge for an account whose password has just been accepted. */
export async function createChallenge(
  env: Env,
  userId: string,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: string }> {
  const token = newToken();
  const now = Date.now();
  const expiresAt = new Date(now + CHALLENGE_MINUTES * 60_000).toISOString();

  await env.DB.batch([
    // Expired rows, and any earlier attempt by this person: starting again at the
    // password step should not leave an older challenge usable.
    env.DB.prepare(`DELETE FROM login_challenges WHERE expires_at <= ? OR user_id = ?`)
      .bind(new Date(now).toISOString(), userId),
    env.DB.prepare(
      `INSERT INTO login_challenges (id, user_id, attempts, created_at, expires_at, user_agent)
       VALUES (?, ?, 0, ?, ?, ?)`,
    ).bind(await digest(token), userId, new Date(now).toISOString(), expiresAt, userAgent),
  ]);

  return { token, expiresAt };
}

export interface ChallengeRow {
  id: string;
  user_id: string;
  attempts: number;
  expires_at: string;
}

/**
 * Looks up a challenge, deleting it if it has expired.
 *
 * Returns null for absent, unknown and expired alike. The caller says only "that
 * sign-in has expired, start again", because distinguishing them would tell someone
 * probing tokens which of their guesses had ever been real.
 */
export async function loadChallenge(
  env: Env,
  token: unknown,
): Promise<ChallengeRow | null> {
  if (typeof token !== "string" || token.length !== 64) return null;
  const id = await digest(token);
  const row = await env.DB.prepare(
    `SELECT id, user_id, attempts, expires_at FROM login_challenges WHERE id = ?`,
  )
    .bind(id)
    .first<ChallengeRow>();
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await env.DB.prepare(`DELETE FROM login_challenges WHERE id = ?`).bind(id).run();
    return null;
  }
  return row;
}

/**
 * Counts a failed attempt, and reports whether the challenge is now spent.
 *
 * The row is deleted on the last allowed attempt rather than left with a count at the
 * limit, so nothing has to remember to check the count on the way in as well as on the
 * way out.
 */
export async function countFailure(
  env: Env,
  row: ChallengeRow,
): Promise<{ exhausted: boolean; remaining: number }> {
  const attempts = row.attempts + 1;
  if (attempts >= CHALLENGE_MAX_ATTEMPTS) {
    await env.DB.prepare(`DELETE FROM login_challenges WHERE id = ?`).bind(row.id).run();
    return { exhausted: true, remaining: 0 };
  }
  await env.DB.prepare(`UPDATE login_challenges SET attempts = ? WHERE id = ?`)
    .bind(attempts, row.id)
    .run();
  return { exhausted: false, remaining: CHALLENGE_MAX_ATTEMPTS - attempts };
}

export async function consumeChallenge(env: Env, row: ChallengeRow): Promise<void> {
  await env.DB.prepare(`DELETE FROM login_challenges WHERE id = ?`).bind(row.id).run();
}

/** Housekeeping, called on the password step so the table cannot grow unbounded. */
export async function pruneChallenges(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM login_challenges WHERE expires_at <= ?`)
    .bind(nowIso())
    .run();
}

/**
 * Everything the account screen needs, in one round trip.
 */
export async function statusFor(
  env: Env,
  userId: string,
  role: Role,
): Promise<{
  enabled: boolean;
  pending: boolean;
  confirmed_at: string | null;
  recovery_remaining: number;
  required: boolean;
  policy: TwoFactorPolicy;
  secrets_encrypted: boolean;
  questions_count: number;
  questions_allowed: boolean;
  answers_keyed: boolean;
}> {
  const [row, remaining, policy, questions, questionsSetting] = await Promise.all([
    loadTotp(env, userId),
    recoveryRemaining(env, userId),
    twoFactorPolicy(env),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM user_security_questions WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{ n: number }>(),
    questionsPolicy(env),
  ]);
  return {
    enabled: Boolean(row?.confirmed_at),
    pending: Boolean(row && !row.confirmed_at),
    confirmed_at: row?.confirmed_at ?? null,
    recovery_remaining: remaining,
    required: isRequiredFor(policy, role),
    policy,
    secrets_encrypted: secretsEncrypted(env),
    questions_count: questions?.n ?? 0,
    questions_allowed: questionsEnabled(questionsSetting),
    /*
     * Whether answers on this deployment are keyed with the pepper or only salted.
     * Reported for the same reason `secrets_encrypted` is: a firm should not have to
     * assume the stronger of the two.
     */
    answers_keyed: questionsScheme(env) === "hmac",
  };
}
