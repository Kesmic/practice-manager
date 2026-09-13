/**
 * Remembering a device, so the second step is not asked for on every sign-in.
 *
 * The case for it is that a second factor asked too often stops being used properly. A
 * partner signing in six times a day reaches for the phone six times, and the predictable
 * end of that is the authenticator app left open on the desk beside the laptop, which is
 * no second factor at all. Asking once a month on a machine the person owns is the
 * trade most systems have settled on, and it is a real improvement over the alternative
 * people actually resort to.
 *
 * What it deliberately is not:
 *
 * **It never skips the password.** A remembered device shortens sign-in by one step, not
 * two. Somebody who picks the laptop up still needs the password.
 *
 * **It is bound to one account.** The token identifies "this browser, trusted by this
 * person". Signing into a second account on the same machine gets its own challenge and
 * its own decision, so a shared office machine cannot be trusted once and reused.
 *
 * **It is revocable, and revoked by anything that suggests trouble.** Changing a
 * password, disabling or re-enrolling a second factor, or a partner resetting somebody's
 * enrolment all drop every remembered device for that person. The account screen lists
 * them and can forget any one, or all of them, at any time.
 */

/** The firm's setting: how long a device stays remembered, or not at all. */
export const DEVICE_TRUST_OFF = "off";

/** What "remember this device" means when the firm has not said otherwise. */
export const DEFAULT_TRUST_DAYS = 30;

/** The choices the settings screen offers. */
export const TRUST_DAY_CHOICES = [7, 14, 30, 60, 90] as const;

export const MIN_TRUST_DAYS = 1;

/**
 * Ninety days, and not longer.
 *
 * Past a quarter the second factor has stopped being a factor and become a formality:
 * a machine trusted in January that nobody thinks about again is exactly the laptop that
 * gets sold, stolen or handed to a leaver. If a firm wants longer than this, what they
 * actually want is no second factor, and they should turn that off deliberately on the
 * same screen rather than reaching the same place by a side door.
 */
export const MAX_TRUST_DAYS = 90;

export type DeviceTrustPolicy = { enabled: false } | { enabled: true; days: number };

/**
 * The stored setting.
 *
 * Unlike the two-factor policy, an absent value here means on at thirty days rather than
 * off - and the difference is what each does when nobody has chosen. An absent
 * two-factor policy that defaulted to "required" would confine every partner the moment
 * it deployed. This one changes nothing at all until a person ticks a box on their own
 * sign-in: the setting only decides whether that box is offered. So it ships offering it,
 * which is what was asked for, and a firm that would rather not can say so.
 */
export function readDeviceTrustPolicy(
  raw: string | null | undefined,
): DeviceTrustPolicy {
  const value = (raw ?? "").trim();
  if (value === DEVICE_TRUST_OFF) return { enabled: false };
  if (value === "") return { enabled: true, days: DEFAULT_TRUST_DAYS };

  const days = Number.parseInt(value, 10);
  if (!Number.isFinite(days)) return { enabled: true, days: DEFAULT_TRUST_DAYS };
  return { enabled: true, days: clampTrustDays(days) };
}

export function clampTrustDays(days: number): number {
  return Math.min(Math.max(Math.round(days), MIN_TRUST_DAYS), MAX_TRUST_DAYS);
}

export function writeDeviceTrustPolicy(policy: DeviceTrustPolicy): string {
  return policy.enabled ? String(clampTrustDays(policy.days)) : DEVICE_TRUST_OFF;
}

/** How somebody got through the second step. */
export type SecondFactorRoute = "totp" | "questions" | "recovery";

/**
 * Whether a device may be remembered on the strength of the route just taken.
 *
 * Only the authenticator app. The two recovery routes exist for somebody who cannot
 * produce a code, and neither is worth thirty days of not being asked for one: a
 * recovery code is a single-use secret spent getting back in, and a security answer is a
 * researchable fact that stays true for ever. Letting either mint a remembered device
 * would make the weakest factor the one deciding how often the strongest is asked for.
 *
 * A function rather than a condition written out at the call site, so the rule has one
 * home and can be tested without standing up a sign-in.
 */
export function mayRememberDevice(route: SecondFactorRoute): boolean {
  return route === "totp";
}

/** One remembered device, as the account screen sees it. */
export interface TrustedDevice {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  /** Whether this is the browser the list is being read in. */
  current: boolean;
}

/**
 * A readable name for a device, from its user agent.
 *
 * Deliberately coarse. The point is to let somebody recognise which row is the laptop
 * they are sitting at and which is the machine they used at a client in March - not to
 * fingerprint anything. A user agent is a claim by the browser, not evidence, so this is
 * a label and nothing depends on it.
 */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua.trim()) return "Unknown device";

  const platform =
    /iPhone/i.test(ua) ? "iPhone"
    : /iPad/i.test(ua) ? "iPad"
    : /Android/i.test(ua) ? "Android"
    : /Macintosh|Mac OS X/i.test(ua) ? "Mac"
    : /Windows/i.test(ua) ? "Windows"
    : /CrOS/i.test(ua) ? "ChromeOS"
    : /Linux/i.test(ua) ? "Linux"
    : null;

  // Order matters: Edge and Opera both claim to be Chrome, and Chrome claims Safari.
  const browser =
    /Edg\//i.test(ua) ? "Edge"
    : /OPR\/|Opera/i.test(ua) ? "Opera"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari"
    : null;

  if (platform && browser) return `${browser} on ${platform}`;
  return browser ?? platform ?? "Unknown device";
}
