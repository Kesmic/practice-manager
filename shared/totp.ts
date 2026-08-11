/**
 * Time-based one-time passwords, RFC 6238.
 *
 * The second factor is an authenticator app rather than a code by email or SMS, and
 * that choice is worth stating. This firm's email is at the same domain as the portal:
 * if someone reads a partner's mailbox, emailing them the code hands over both factors
 * at once, and the second factor stops being a second factor. SMS has the same problem
 * through the phone company. An authenticator app holds a secret that never travels
 * after enrolment, costs nothing per sign-in, and works when the network does not.
 *
 * Everything here is pure and shared, so the Worker verifies with exactly the code the
 * tests exercise. Nothing in this file touches the database or the clock except through
 * an argument.
 */

/** Digits in a code. Six is what every authenticator app shows. */
export const TOTP_DIGITS = 6;

/** Seconds each code is valid for. Thirty is the universal default. */
export const TOTP_PERIOD = 30;

/**
 * How many periods either side of now are accepted.
 *
 * One, meaning a 90-second window in total. Phone clocks drift, and a code typed at
 * the moment it rolls over must not be rejected: that failure is indistinguishable
 * from a wrong code to the person typing it, and it teaches them the system is
 * unreliable. Wider than one starts to matter, because a code seen over someone's
 * shoulder stays usable for longer.
 */
export const TOTP_DRIFT = 1;

/** Bytes of entropy in a secret. Twenty is 160 bits, as RFC 4226 recommends. */
export const SECRET_BYTES = 20;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Base32, RFC 4648, without padding.
 *
 * Authenticator apps expect base32 and nothing else, and they expect it unpadded: a
 * trailing "=" is accepted by some and rejected by others.
 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Decodes base32, forgiving the things people actually do: lower case, spaces from
 * a secret displayed in groups, and padding. Returns null on anything else, so a
 * mistyped secret fails as a bad secret rather than as a silently different one.
 */
export function base32Decode(input: string): Uint8Array | null {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!clean.length) return null;

  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh secret, from the platform's own randomness. */
export function generateSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** Which time step a moment falls in. */
export function counterFor(atMs: number): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD);
}

/**
 * The code for one time step.
 *
 * SHA-1 is not a mistake here. RFC 6238 defines HMAC-SHA1 as the default, every
 * authenticator app implements it, and several implement nothing else. The security of
 * a TOTP does not rest on SHA-1's collision resistance: it rests on HMAC with a secret
 * key, where SHA-1 is still sound, and on the code lasting thirty seconds.
 */
export async function codeFor(secret: string, counter: number): Promise<string | null> {
  const key = base32Decode(secret);
  if (!key || !key.length) return null;

  // The counter as a big-endian 64-bit value.
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index--) {
    message[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, message as unknown as ArrayBuffer),
  );

  // Dynamic truncation, RFC 4226 section 5.3.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Whatever the person typed, reduced to digits. Apps and people both add spaces. */
export function normaliseCode(input: unknown): string {
  return typeof input === "string" ? input.replace(/\D/g, "") : "";
}

/**
 * Whether a code is right for this secret at this moment, and which step it matched.
 *
 * The step is returned because it has to be remembered: without it, a code stays
 * usable for its whole window, and anyone who reads it over a shoulder or out of a
 * proxy log can replay it. The caller stores the last step accepted and refuses
 * anything at or below it.
 */
export async function verifyCode(
  secret: string,
  input: unknown,
  atMs: number,
  lastUsedCounter: number | null,
): Promise<{ ok: boolean; counter: number | null; reason?: "replay" | "mismatch" }> {
  const code = normaliseCode(input);
  if (code.length !== TOTP_DIGITS) return { ok: false, counter: null, reason: "mismatch" };

  const now = counterFor(atMs);
  for (let drift = -TOTP_DRIFT; drift <= TOTP_DRIFT; drift++) {
    const counter = now + drift;
    if (counter < 0) continue;
    const expected = await codeFor(secret, counter);
    if (expected && timingSafeEqual(expected, code)) {
      if (lastUsedCounter !== null && counter <= lastUsedCounter) {
        return { ok: false, counter, reason: "replay" };
      }
      return { ok: true, counter };
    }
  }
  return { ok: false, counter: null, reason: "mismatch" };
}

/**
 * Compares two strings in time that does not depend on where they differ.
 *
 * Both are the same length here, so this is belt and braces rather than the only
 * thing standing between an attacker and the code. It costs nothing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * The otpauth:// URI an authenticator app reads from the QR code.
 *
 * The label carries the issuer twice, once as a prefix and once as a parameter. That
 * looks redundant and is not: the prefix is what older apps display in their list, and
 * the parameter is what current ones use. Omitting either leaves somebody with an
 * entry called "michael@kesmic.org" and no idea which system it unlocks.
 */
export function otpauthUri(input: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const issuer = encodeURIComponent(input.issuer);
  const account = encodeURIComponent(input.account);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${issuer}:${account}?${params.toString()}`;
}

/** The secret in groups of four, which is how it can be typed in without losing count. */
export function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(" ");
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/** How many recovery codes are issued at once. */
export const RECOVERY_CODE_COUNT = 10;

/** Characters in a recovery code, excluding the digits and letters people confuse. */
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * A recovery code: two groups of five, hyphenated.
 *
 * These exist because the alternative is a partner with a lost phone and no way into
 * the firm's own system. Ambiguous characters are left out on purpose, because these
 * get printed and read back from paper, where 0 against O and 1 against I are a real
 * source of failed attempts.
 */
export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte % 32]);
  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => generateRecoveryCode());
}

/** Recovery codes are matched case-insensitively and without their hyphen. */
export function normaliseRecoveryCode(input: unknown): string {
  return typeof input === "string"
    ? input.replace(/[^0-9A-Za-z]/g, "").toUpperCase()
    : "";
}
