/**
 * Web Push from a Worker, with nothing but WebCrypto.
 *
 * A push message goes to the browser's push service (Google's, Apple's, Mozilla's),
 * which hands it to the device. Two standards make that safe, and both are done here
 * by hand because the usual library assumes Node's crypto and this runs on a Worker:
 *
 * - **VAPID** (RFC 8292) proves to the push service that the message comes from this
 *   portal: a short JWT signed with the portal's own P-256 key, sent as the
 *   Authorization header. The push service knows the public half because the browser
 *   handed it over when the device subscribed.
 * - **aes128gcm** (RFC 8291) encrypts the message so only the device can read it: an
 *   ECDH agreement with the device's key, HKDF to a content key and nonce, AES-GCM,
 *   and a small header the device needs to do the same in reverse. The push service
 *   sees ciphertext and nothing else.
 *
 * The keys live in two environment variables (see docs/PUSH.md); without them the
 * portal sends no pushes and behaves exactly as it does today.
 */

import type { Env } from "./env";
import { nowIso } from "./db";

const enc = new TextEncoder();

export function pushConfigured(env: Env): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array {
  const normal = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normal + "=".repeat((4 - (normal.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

/** A plain ArrayBuffer for WebCrypto, which is strict about what it is handed. */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// VAPID
// ---------------------------------------------------------------------------

/**
 * The portal's signing key, from the two variables.
 *
 * The public key is the raw 65-byte point and the private key the raw 32-byte scalar,
 * both base64url - the shape `scripts/vapid-keys.mjs` prints and the shape browsers
 * take as `applicationServerKey`. WebCrypto wants a JWK, so the point is split into
 * its two coordinates on the way in.
 */
async function signingKey(env: Env): Promise<CryptoKey> {
  const point = fromBase64url(env.VAPID_PUBLIC_KEY ?? "");
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error("VAPID_PUBLIC_KEY is not an uncompressed P-256 point.");
  }
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64url(point.slice(1, 33)),
      y: base64url(point.slice(33, 65)),
      d: env.VAPID_PRIVATE_KEY,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/**
 * The Authorization header for one push service.
 *
 * The token is good for twelve hours and names the push service's origin, so a token
 * captured in transit is no use against a different service or next day.
 */
export async function vapidAuthorization(
  env: Env,
  endpoint: string,
  now: number = Date.now(),
): Promise<string> {
  const header = base64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: env.VAPID_SUBJECT || "mailto:portal@kesmic.org",
      }),
    ),
  );
  const input = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await signingKey(env),
    buf(enc.encode(input)),
  );
  return `vapid t=${input}.${base64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/** The two keys a device hands over when it subscribes. */
export interface DeviceKeys {
  p256dh: string;
  auth: string;
}

/** One record is all a notification ever needs; the limit is what fits in it. */
export const MAX_PAYLOAD_BYTES = 4096 - 16 - 1 - 86;

/**
 * Encrypts a payload for one device, per RFC 8291, and returns the body to POST.
 *
 * The body is the aes128gcm header - salt, record size, and this message's ephemeral
 * public key - followed by the one encrypted record. The device rebuilds the same
 * keys from its own private key and the header, and reads the message.
 */
export async function encryptPayload(device: DeviceKeys, payload: Uint8Array): Promise<Uint8Array> {
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`A push message may be at most ${MAX_PAYLOAD_BYTES} bytes.`);
  }
  const devicePublic = fromBase64url(device.p256dh);
  const authSecret = fromBase64url(device.auth);

  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const deviceKey = await crypto.subtle.importKey(
    "raw",
    buf(devicePublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: deviceKey }, local.privateKey, 256),
  );

  const ikm = await hkdf(
    authSecret,
    shared,
    concat(enc.encode("WebPush: info\0"), devicePublic, localPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", buf(contentKey), "AES-GCM", false, ["encrypt"]);
  // 0x02 marks the last (and only) record.
  const record = concat(payload, new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, aes, buf(record)),
  );

  const header = concat(salt, u32(4096), new Uint8Array([localPublic.length]), localPublic);
  return concat(header, ciphertext);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it goes, as a path within the portal. */
  url: string;
  /** Notifications with the same tag replace one another on the device. */
  tag?: string;
}

export type PushOutcome = "sent" | "gone" | "failed";

/**
 * Sends one message to one device.
 *
 * "gone" is the push service saying the subscription no longer exists - the person
 * revoked it, or reinstalled the browser - and the caller should forget the device.
 * "failed" is anything else, and is logged rather than thrown: a push that does not
 * arrive is a shame, not a reason for the request that caused it to fail.
 */
export async function sendPush(
  env: Env,
  device: DeviceKeys & { endpoint: string },
  message: PushMessage,
): Promise<PushOutcome> {
  try {
    const body = await encryptPayload(device, enc.encode(JSON.stringify(message)));
    const response = await fetch(device.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(env, device.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "normal",
      },
      body: buf(body),
    });
    if (response.status === 404 || response.status === 410) return "gone";
    if (!response.ok) {
      console.error(`Push to ${new URL(device.endpoint).origin} returned ${response.status}.`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("Push failed:", err);
    return "failed";
  }
}

interface DeviceRow extends DeviceKeys {
  id: string;
  user_id: string;
  endpoint: string;
}

/** Sends one message to every device a person has enrolled, tidying up as it goes. */
export async function pushToUser(env: Env, userId: string, message: PushMessage): Promise<number> {
  if (!pushConfigured(env)) return 0;
  const { results } = await env.DB.prepare(
    `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
  )
    .bind(userId)
    .all<DeviceRow>();
  return deliver(env, results, message);
}

async function deliver(env: Env, devices: DeviceRow[], message: PushMessage): Promise<number> {
  let sent = 0;
  for (const device of devices) {
    const outcome = await sendPush(env, device, message);
    if (outcome === "sent") {
      sent += 1;
      await env.DB.prepare(`UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?`)
        .bind(nowIso(), device.id)
        .run();
    } else if (outcome === "gone") {
      await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(device.id).run();
    } else {
      await env.DB.prepare(`UPDATE push_subscriptions SET failed_at = ? WHERE id = ?`)
        .bind(nowIso(), device.id)
        .run();
    }
  }
  return sent;
}

/**
 * Pushes every inbox notification that has not been pushed yet.
 *
 * Run after any request that might have written one, so that nothing has to know
 * which requests those are. Rows are claimed with one UPDATE ... RETURNING before
 * anything is sent, so two requests finishing together cannot both push the same
 * notification. Only the last day's rows are considered: anything older than that
 * was either pushed already or predates push altogether.
 */
export async function dispatchPush(env: Env): Promise<void> {
  if (!pushConfigured(env)) return;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { results: claimed } = await env.DB.prepare(
      `UPDATE notifications SET pushed_at = ?1
        WHERE pushed_at IS NULL AND created_at > ?2
        RETURNING id, user_id, task_id, title, body`,
    )
      .bind(nowIso(), since)
      .all<{ id: string; user_id: string; task_id: string | null; title: string; body: string | null }>();
    if (!claimed.length) return;

    const userIds = [...new Set(claimed.map((n) => n.user_id))];
    const { results: devices } = await env.DB.prepare(
      `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions
        WHERE user_id IN (${userIds.map(() => "?").join(", ")})`,
    )
      .bind(...userIds)
      .all<DeviceRow>();
    if (!devices.length) return;

    for (const notification of claimed) {
      const mine = devices.filter((d) => d.user_id === notification.user_id);
      if (!mine.length) continue;
      await deliver(env, mine, {
        title: notification.title,
        body: notification.body ?? "",
        url: notification.task_id ? `/tasks/${notification.task_id}` : "/notifications",
        tag: notification.id,
      });
    }
  } catch (err) {
    console.error("Push dispatch failed:", err);
  }
}
