/**
 * The server side of remembering a device.
 *
 * Policy and reasoning live in `shared/device-trust.ts`. What is here is the cookie, the
 * table, and the one question that matters at sign-in: may this browser skip the second
 * step for this account.
 */

import type { Env } from "./env";
import { nowIso } from "./db";
import {
  clampTrustDays,
  describeDevice,
  readDeviceTrustPolicy,
  type DeviceTrustPolicy,
  type TrustedDevice,
} from "../shared/device-trust";

/**
 * Its own cookie, separate from the session.
 *
 * The two have different lifetimes and different meanings. A session says "somebody is
 * signed in right now" and ends when they sign out or go idle; this says "this browser
 * has been vouched for by this person" and has to survive both. Folding them together
 * would mean either sessions that outlive their idle timeout or trust that evaporates
 * every lunchtime.
 */
export const DEVICE_COOKIE = "kpm_device";

export const clearedDeviceCookie =
  `${DEVICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value) as unknown as ArrayBuffer,
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The firm's setting. */
export async function deviceTrustPolicy(env: Env): Promise<DeviceTrustPolicy> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind("trusted_device_days")
    .first<{ value: string }>();
  return readDeviceTrustPolicy(row?.value);
}

/**
 * Whether this browser may skip the second step for this account.
 *
 * Matched on the token digest **and** the user id. A device remembered by one colleague
 * must not carry another past their own second factor on the same machine, and matching
 * on the token alone would do exactly that.
 *
 * Expiry is checked in the query rather than after it, so a row that has run out is
 * never even considered, and the sweep that deletes it can happen whenever.
 */
export async function deviceIsTrusted(
  env: Env,
  request: Request,
  userId: string,
): Promise<boolean> {
  const policy = await deviceTrustPolicy(env);
  if (!policy.enabled) return false;

  const token = readCookie(request, DEVICE_COOKIE);
  if (!token || token.length !== 64) return false;

  const id = await digest(token);
  const row = await env.DB.prepare(
    `SELECT id FROM trusted_devices
      WHERE id = ? AND user_id = ? AND expires_at > ?`,
  )
    .bind(id, userId, nowIso())
    .first<{ id: string }>();
  if (!row) return false;

  // Recorded so the account screen can say when a device was last relied on, which is
  // what makes an unfamiliar row on that list recognisable as a problem.
  await env.DB.prepare(`UPDATE trusted_devices SET last_used_at = ? WHERE id = ?`)
    .bind(nowIso(), id)
    .run();
  return true;
}

/**
 * Remembers this browser, returning the cookie to set.
 *
 * Only ever called after a second factor has actually been satisfied - a device cannot
 * vouch for itself. Returns null when the firm has the feature switched off, so the
 * caller does not have to check twice.
 */
export async function rememberDevice(
  env: Env,
  request: Request,
  userId: string,
): Promise<string | null> {
  const policy = await deviceTrustPolicy(env);
  if (!policy.enabled) return null;

  const token = newToken();
  const id = await digest(token);
  const now = new Date();
  const days = clampTrustDays(policy.days);
  const expires = new Date(now.getTime() + days * 86_400_000);

  await env.DB.batch([
    // Housekeeping on the one path that adds a row, so the table cannot grow on expired
    // entries nobody revisits.
    env.DB.prepare(`DELETE FROM trusted_devices WHERE expires_at <= ?`).bind(
      now.toISOString(),
    ),
    env.DB.prepare(
      `INSERT INTO trusted_devices (id, user_id, label, created_at, last_used_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      userId,
      describeDevice(request.headers.get("User-Agent")),
      now.toISOString(),
      now.toISOString(),
      expires.toISOString(),
    ),
  ]);

  return `${DEVICE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86_400}`;
}

/** The devices this person has remembered, newest first. */
export async function listDevices(
  env: Env,
  request: Request,
  userId: string,
): Promise<TrustedDevice[]> {
  const token = readCookie(request, DEVICE_COOKIE);
  const currentId = token && token.length === 64 ? await digest(token) : null;

  const { results } = await env.DB.prepare(
    `SELECT id, label, created_at, last_used_at, expires_at
       FROM trusted_devices
      WHERE user_id = ? AND expires_at > ?
      ORDER BY last_used_at DESC`,
  )
    .bind(userId, nowIso())
    .all<Omit<TrustedDevice, "current">>();

  return results.map((row) => ({ ...row, current: row.id === currentId }));
}

/** Forgets one device. Returns false when it was not this person's to forget. */
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
 * Forgets every device this person has remembered.
 *
 * Called by everything that suggests the account's footing has changed: a password
 * change, enrolling or disabling a second factor, a partner resetting somebody's
 * enrolment. The common thread is that each of those is either a response to trouble or
 * a change to what "signed in as this person" is worth, and a remembered device that
 * survived any of them would quietly outlive the decision.
 */
export async function forgetAllDevices(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM trusted_devices WHERE user_id = ?`)
    .bind(userId)
    .run();
}

/** A statement, for callers already building a batch. */
export function forgetAllDevicesStatement(env: Env, userId: string) {
  return env.DB.prepare(`DELETE FROM trusted_devices WHERE user_id = ?`).bind(userId);
}
