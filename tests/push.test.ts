/**
 * Web Push, done by hand with WebCrypto.
 *
 * A push that is encrypted wrongly does not fail loudly: the push service accepts it,
 * the device drops it, and nobody is told. So the test plays the device: it generates
 * a device key pair, has the Worker encrypt a message for it, and decrypts the result
 * with the device's private key the way a browser would. The VAPID token is verified
 * with the public key the way a push service would.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  MAX_PAYLOAD_BYTES,
  base64url,
  encryptPayload,
  fromBase64url,
  pushConfigured,
  vapidAuthorization,
} from "../worker/push";
import type { Env } from "../worker/env";

const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) }, key, length * 8),
  );
}

/** What a browser does with an aes128gcm body, per RFC 8291. */
async function deviceDecrypt(
  devicePrivate: CryptoKey,
  devicePublic: Uint8Array,
  authSecret: Uint8Array,
  body: Uint8Array,
): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const rs = new DataView(buf(body.slice(16, 20))).getUint32(0);
  const idlen = body[20];
  const senderPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  assert.equal(rs, 4096);
  assert.equal(idlen, 65);

  const senderKey = await subtle.importKey("raw", buf(senderPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: senderKey }, devicePrivate, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), devicePublic, senderPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await subtle.importKey("raw", buf(cek), "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: buf(nonce) }, aes, buf(ciphertext)));
  // The last byte is the record delimiter; 0x02 marks the final record.
  assert.equal(record[record.length - 1], 2);
  return record.slice(0, -1);
}

test("a message encrypted for a device can be read by that device, and only looks like noise otherwise", async () => {
  const device = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const devicePublic = new Uint8Array(await subtle.exportKey("raw", device.publicKey));
  const authSecret = webcrypto.getRandomValues(new Uint8Array(16));
  const keys = { p256dh: base64url(devicePublic), auth: base64url(authSecret) };
  const message = JSON.stringify({ title: "ACME-0042: assigned to you", body: "Open it to start.", url: "/tasks/1" });

  const body = await encryptPayload(keys, enc.encode(message));
  assert.ok(body.length > 21 + 65 + message.length, "the body carries a header and a tag");
  assert.equal(dec.decode(body).includes("assigned"), false, "nothing readable in the ciphertext");

  const plain = await deviceDecrypt(device.privateKey, devicePublic, authSecret, body);
  assert.equal(dec.decode(plain), message);

  // Every message gets its own salt and ephemeral key, so the same words never encrypt the same way twice.
  const again = await encryptPayload(keys, enc.encode(message));
  assert.notDeepEqual(again.slice(0, 16), body.slice(0, 16));
});

test("a message that will not fit in one record is refused before it is sent", async () => {
  const device = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const keys = {
    p256dh: base64url(new Uint8Array(await subtle.exportKey("raw", device.publicKey))),
    auth: base64url(webcrypto.getRandomValues(new Uint8Array(16))),
  };
  await assert.rejects(encryptPayload(keys, new Uint8Array(MAX_PAYLOAD_BYTES + 1)), /at most/);
  await encryptPayload(keys, new Uint8Array(MAX_PAYLOAD_BYTES));
});

test("the VAPID token is signed by the portal's key and names the push service", async () => {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = base64url(new Uint8Array(await subtle.exportKey("raw", pair.publicKey)));
  const { d } = await subtle.exportKey("jwk", pair.privateKey);
  const env = {
    VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: d,
    VAPID_SUBJECT: "mailto:portal@kesmic.test",
  } as unknown as Env;
  assert.equal(pushConfigured(env), true);
  assert.equal(pushConfigured({} as Env), false);

  const now = Date.UTC(2026, 8, 24, 9, 0, 0);
  const header = await vapidAuthorization(env, "https://fcm.googleapis.com/fcm/send/abc123", now);
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(match, "the header has the shape push services expect");
  assert.equal(match[2], publicKey);

  const [h, c, sig] = match[1].split(".");
  assert.deepEqual(JSON.parse(dec.decode(fromBase64url(h))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(dec.decode(fromBase64url(c)));
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "mailto:portal@kesmic.test");
  assert.equal(claims.exp, Math.floor(now / 1000) + 12 * 3600);

  const ok = await subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pair.publicKey,
    buf(fromBase64url(sig)),
    buf(enc.encode(`${h}.${c}`)),
  );
  assert.equal(ok, true);
});

test("base64url round-trips without padding or the two URL-unsafe characters", () => {
  const bytes = Uint8Array.from({ length: 200 }, (_, i) => (i * 37 + 11) % 256);
  const text = base64url(bytes);
  assert.doesNotMatch(text, /[+/=]/);
  assert.deepEqual(fromBase64url(text), bytes);
});
