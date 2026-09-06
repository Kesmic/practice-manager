/**
 * How many times a password may be guessed before the portal stops listening.
 *
 * The portal already caps the two-step code (five tries per challenge) and the public
 * intake forms (five submissions an hour per sender). The password itself had nothing in
 * front of it, which is the wrong way round: it is the only credential most accounts
 * have, and it is the one an attacker can attack from anywhere without a link or a
 * challenge token.
 *
 * It matters more here than it would elsewhere because of the work factor. Cloudflare's
 * Free plan allows 10 ms of CPU per request, so PBKDF2 runs at 8,000 iterations rather
 * than the 600,000 OWASP asks for - see the note in `worker/auth.ts`. A slow hash is what
 * normally makes online guessing pointless. With a fast one, the only thing making it
 * pointless is a limit on attempts.
 *
 * Two counters, because they stop different attacks:
 *
 * **Per account.** One address being tried over and over is somebody working through a
 * password list. Ten failures in fifteen minutes ends it.
 *
 * **Per address.** One source trying many accounts is credential stuffing, which the
 * per-account counter never sees because no single account gets near its limit. Fifty in
 * the same window ends that, set high enough that a whole office behind one NAT
 * mistyping passwords on a Monday morning never reaches it.
 *
 * ## The lockout is short on purpose
 *
 * A per-account counter can be turned around: somebody who knows a colleague's email
 * address can fail ten sign-ins and lock them out. That is a real cost and it is the
 * reason the window is fifteen minutes rather than an hour, and why nothing here needs an
 * administrator to clear it. Fifteen minutes reduces a guessing attack from millions of
 * tries a day to under a thousand, which is the whole benefit; making it an hour would
 * gain almost nothing against the attack and would quadruple what a nuisance can do to a
 * colleague.
 *
 * A successful sign-in clears that account's failures immediately, so somebody who simply
 * could not remember their password is not still serving a sentence after they get it
 * right.
 */

/** Failures counted against one email address before it stops being tried. */
export const MAX_ACCOUNT_FAILURES = 10;

/** Failures counted against one source address, across every account it tried. */
export const MAX_SOURCE_FAILURES = 50;

/** How far back the counting goes, and therefore how long a lockout lasts. */
export const FAILURE_WINDOW_MINUTES = 15;

/** How long a recorded failure is kept before it is pruned. */
export const FAILURE_RETENTION_MINUTES = 60;

/** What the two counters found in the window. */
export interface FailureCounts {
  account: number;
  source: number;
}

export type LoginGate =
  | { allowed: true }
  | { allowed: false; scope: "account" | "source"; message: string };

/**
 * Whether another attempt may be made.
 *
 * Both messages say the same thing and neither says which counter tripped. Telling
 * somebody "this account is locked" confirms the account exists, which the sign-in screen
 * is otherwise careful never to do: an unknown address and a wrong password produce the
 * same words and, because of the decoy hash, the same delay.
 */
export function gateLogin(counts: FailureCounts): LoginGate {
  const message =
    `Too many sign-in attempts. Wait ${FAILURE_WINDOW_MINUTES} minutes and try again, ` +
    `or ask an administrator to reset your password.`;

  if (counts.account >= MAX_ACCOUNT_FAILURES) {
    return { allowed: false, scope: "account", message };
  }
  if (counts.source >= MAX_SOURCE_FAILURES) {
    return { allowed: false, scope: "source", message };
  }
  return { allowed: true };
}

/** Attempts left before the account counter trips. Used only for logging. */
export function accountAttemptsLeft(counts: FailureCounts): number {
  return Math.max(0, MAX_ACCOUNT_FAILURES - counts.account);
}
