/**
 * The sign-in rate limit.
 *
 * Policy and numbers live in `shared/login-policy.ts`; this is the D1 half - counting
 * failures in the window, recording new ones, and clearing an account's tally once
 * somebody gets in.
 *
 * Three things about how it is used, all of which matter:
 *
 * **Checked before the hash runs.** `assertLoginAllowed` is called before PBKDF2, not
 * after. Otherwise a locked-out account still costs the Worker its full hashing budget on
 * every attempt, and the limit protects the password without protecting the deployment.
 *
 * **A failure is recorded for a wrong password and for an unknown address alike.** The
 * sign-in screen is built so those two cases are indistinguishable - same words, and the
 * decoy hash gives them the same delay. Counting only the ones that name a real account
 * would undo that, because the point at which the limit bit would tell you the address
 * existed.
 *
 * **The second step counts too.** A password that is right but a code that is wrong is
 * still a failed sign-in. The challenge has its own five-attempt cap, but nothing stops
 * an attacker starting a fresh challenge each time, so without this the per-challenge cap
 * is just a speed bump.
 */

import type { Env } from "./env";
import { tooMany } from "./http";
import { newId, nowIso } from "./db";
import {
  FAILURE_RETENTION_MINUTES,
  FAILURE_WINDOW_MINUTES,
  gateLogin,
  type FailureCounts,
} from "../shared/login-policy";

/** The two keys an attempt is counted against. Both are digests, never the values. */
export interface AttemptKeys {
  account: string;
  source: string;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Derives the keys for one attempt.
 *
 * The email is lower-cased first so that `Someone@Firm.org` and `someone@firm.org` count
 * against the same account - otherwise changing the capitalisation would be enough to
 * start a fresh allowance.
 *
 * `local` stands in for a missing CF-Connecting-IP, which happens only under
 * `wrangler dev`. In production Cloudflare always sets it, and it cannot be spoofed by
 * the client: Cloudflare overwrites whatever arrived.
 */
export async function attemptKeys(
  request: Request,
  email: string,
): Promise<AttemptKeys> {
  const source = request.headers.get("CF-Connecting-IP") ?? "local";
  const [account, sourceKey] = await Promise.all([
    sha256(`account:${email.trim().toLowerCase()}`),
    sha256(`source:${source}`),
  ]);
  return { account, source: sourceKey };
}

/** How many failures each counter has seen inside the window. */
export async function failureCounts(
  env: Env,
  keys: AttemptKeys,
): Promise<FailureCounts> {
  const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60_000).toISOString();
  const row = await env.DB.prepare(
    // One scan answering both questions, the same shape the intake limiter uses.
    `SELECT
       SUM(CASE WHEN account_key = ?1 THEN 1 ELSE 0 END) AS account,
       SUM(CASE WHEN source_key  = ?2 THEN 1 ELSE 0 END) AS source
     FROM login_attempts
     WHERE created_at >= ?3 AND (account_key = ?1 OR source_key = ?2)`,
  )
    .bind(keys.account, keys.source, since)
    .first<{ account: number | null; source: number | null }>();

  return { account: row?.account ?? 0, source: row?.source ?? 0 };
}

/**
 * Refuses the attempt when either counter has tripped.
 *
 * Throws 429 rather than 401 deliberately. The person on the other end is usually the
 * account's real owner on a bad morning, and "too many attempts, wait fifteen minutes" is
 * an answer they can act on, where a eleventh "email or password is incorrect" would send
 * them hunting for a password that was right two tries ago.
 */
export async function assertLoginAllowed(
  env: Env,
  keys: AttemptKeys,
): Promise<void> {
  const gate = gateLogin(await failureCounts(env, keys));
  if (!gate.allowed) throw tooMany(gate.message);
}

/**
 * Records one failure, and opportunistically prunes rows past their retention.
 *
 * The prune is deliberately cheap and deliberately here: pruning on the success path
 * would mean a deployment under attack, where nothing succeeds, is the one that never
 * tidies up.
 */
export async function recordFailure(env: Env, keys: AttemptKeys): Promise<void> {
  const cutoff = new Date(
    Date.now() - FAILURE_RETENTION_MINUTES * 60_000,
  ).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO login_attempts (id, account_key, source_key, created_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(newId(), keys.account, keys.source, nowIso()),
    env.DB.prepare(`DELETE FROM login_attempts WHERE created_at < ?`).bind(cutoff),
  ]);
}

/**
 * Clears an account's tally after a completed sign-in.
 *
 * Only the account's own rows. The source counter is left alone on purpose: one machine
 * signing successfully into its own account must not wipe the evidence of the forty
 * other accounts it just tried.
 */
export async function clearAccountFailures(
  env: Env,
  keys: AttemptKeys,
): Promise<void> {
  await env.DB.prepare(`DELETE FROM login_attempts WHERE account_key = ?`)
    .bind(keys.account)
    .run();
}
