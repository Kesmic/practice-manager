/**
 * Two-step sign-in: what the firm requires, and of whom.
 *
 * The shape of this is deliberate in three ways.
 *
 * **Required rather than optional, for the grades that hold the keys.** A partner can
 * read every client file, every pay record, and can create accounts. A password alone
 * guarding that is a single reused string between an attacker and the whole practice.
 * Which grades are held to it is the firm's choice, but the default is Partner and
 * above, because that is where the damage is.
 *
 * **Enrolment is enforced by confinement, not by lockout.** Someone required to use it
 * who has not set it up can still sign in, and then can reach exactly two things: their
 * own account screen, to enrol, and sign out. Locking them out instead would mean the
 * day the policy changes is the day nobody can work, and the person who could fix it is
 * locked out too.
 *
 * **Recovery codes are part of the feature, not an extra.** A partner with a lost phone
 * and no way in is a worse outage than no second factor at all. Ten single-use codes are
 * issued at enrolment, and any other partner can reset someone's enrolment entirely.
 */

import { ROLE_RANK, ROLES, type Role } from "./workflow";

/**
 * What the settings screen offers as the sensible choice: the grades that can reach
 * everything are the grades worth holding to this.
 *
 * Recommended, not default. See `readPolicy` for why that distinction matters.
 */
export const RECOMMENDED_TWOFACTOR_MIN_ROLE: Role = "partner";

/**
 * The setting's meaning when nobody is required: "off" rather than a grade.
 *
 * A separate value rather than a grade above the top one, so the screen can say
 * "nobody is required to" plainly instead of "System Administrator and above", which
 * reads as though somebody is.
 */
export const TWOFACTOR_OFF = "off";

export type TwoFactorPolicy = Role | typeof TWOFACTOR_OFF;

/**
 * The firm's policy, from the stored setting.
 *
 * **An absent setting means off, not the recommended grade.** This was the other way
 * round for one afternoon and it was wrong twice over. On a new deployment it confined
 * the very first administrator the moment they bootstrapped, before they could create a
 * single account. On an existing one, the migration that added the table would have
 * confined every partner and administrator at the firm the instant it deployed, with no
 * warning and no opportunity to enrol first: an outage caused by a security feature
 * switching itself on.
 *
 * Requiring a second factor is a decision the firm makes, and the screen recommends it
 * plainly. It is not a decision a migration makes on their behalf.
 *
 * An unreadable value is treated the same way. The only thing that writes here is a
 * validating endpoint, so a value that will not parse means the row is damaged, and a
 * damaged row is not consent to lock people out.
 */
export function readPolicy(raw: string | null | undefined): TwoFactorPolicy {
  const value = (raw ?? "").trim();
  if (ROLES.includes(value as Role)) return value as Role;
  return TWOFACTOR_OFF;
}

/** Whether this grade must have a second factor set up. */
export function isRequiredFor(policy: TwoFactorPolicy, role: Role): boolean {
  if (policy === TWOFACTOR_OFF) return false;
  return ROLE_RANK[role] >= ROLE_RANK[policy];
}

/** How long a half-finished sign-in stays valid, in minutes. */
export const CHALLENGE_MINUTES = 5;

/**
 * Attempts allowed against one challenge before it is thrown away.
 *
 * Five. A six-digit code is one in a million, so five guesses inside five minutes is
 * not a meaningful chance; but leaving it unbounded would make an automated run at a
 * known password worth trying, because the code space is small enough to matter.
 */
export const CHALLENGE_MAX_ATTEMPTS = 5;

/** What the sign-in screen is told after a correct password. */
export interface Challenge {
  /** Opaque, and the only thing that identifies the half-finished sign-in. */
  token: string;
  /** Which factors this person can answer with. */
  methods: Array<"totp" | "recovery">;
  expires_at: string;
}

/** What the account screen shows about the reader's own second factor. */
export interface TwoFactorStatus {
  enabled: boolean;
  /** Set up but never confirmed with a code, so not yet in force. */
  pending: boolean;
  confirmed_at: string | null;
  /** Unused recovery codes left. */
  recovery_remaining: number;
  /** Whether this person's grade obliges them to have it. */
  required: boolean;
  /** The firm's policy, so the screen can explain who is covered. */
  policy: TwoFactorPolicy;
  /**
   * Whether secrets are encrypted at rest on this deployment. Surfaced rather than
   * hidden: storing them in the clear is a reasonable position for a small firm, but not
   * one anybody should arrive at without being told.
   */
  secrets_encrypted: boolean;
  /** How many security questions this person has saved. Zero means none. */
  questions_count: number;
  /** Whether the firm currently accepts questions in place of a code. */
  questions_allowed: boolean;
  /**
   * Whether saved answers are keyed with PASSWORD_PEPPER rather than only salted.
   * Reported for the same reason `secrets_encrypted` is: an answer to "what was your
   * first car" is low-entropy, so a merely salted digest in a leaked database is a
   * dictionary attack rather than a barrier, and a firm should not have to assume the
   * stronger of the two.
   */
  answers_keyed: boolean;
}

/**
 * The steps of enrolment, in the order the screen presents them. Written here so the
 * guide, the screen and the tests describe the same process.
 */
export const ENROLMENT_STEPS = [
  "Scan the square with an authenticator app, or type the key in by hand.",
  "Enter the six-digit code the app shows, to prove it is set up.",
  "Save the ten recovery codes somewhere that is not your phone.",
] as const;

/** Apps that are known to work, for the screen to name rather than assume. */
export const KNOWN_APPS = [
  "Google Authenticator",
  "Microsoft Authenticator",
  "Authy",
  "1Password",
  "Bitwarden",
] as const;
