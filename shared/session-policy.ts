/**
 * Signing people out when a screen is left unattended.
 *
 * The case this is for is ordinary and unglamorous: a laptop open on a desk in a shared
 * office, or a browser left signed in on a machine somebody else uses next. A password
 * and a second factor both guard the front door; neither does anything about a door
 * already open.
 *
 * Two halves, and both are needed for different reasons.
 *
 * **The server decides.** Each session records when it was last used, and a request
 * arriving after the idle window has passed is refused and the session destroyed. This is
 * what makes the setting real: it holds for a browser tab that was closed without signing
 * out, and for a session cookie copied off a machine, neither of which will run any of our
 * code again.
 *
 * **The browser warns.** The server can only notice idleness when the next request
 * arrives, which for an unattended screen is never. So the page also watches for real
 * interaction, warns before the deadline, and signs out when it passes. That is the half
 * the firm actually sees, and the warning is the part that stops it losing anybody's work.
 */

/** Minutes of inactivity before a session is over. */
export const DEFAULT_IDLE_MINUTES = 10;

/** The choices the settings screen offers. */
export const IDLE_MINUTE_CHOICES = [5, 10, 15, 20, 30, 45, 60] as const;

/** Shortest and longest the firm may set, whatever arrives in the request. */
export const MIN_IDLE_MINUTES = 1;
export const MAX_IDLE_MINUTES = 480;

/**
 * Seconds of warning before the deadline.
 *
 * Ninety. Long enough to notice, reach the mouse and press a button, without being so
 * long that the dialog becomes part of the furniture. Somebody reading a long policy
 * document without touching anything is the case this protects: without a warning they
 * lose their place, and if they were part-way through writing a review point they lose
 * that too.
 */
export const IDLE_WARNING_SECONDS = 90;

/**
 * How stale the recorded last-used time is allowed to get before it is written again.
 *
 * Every authenticated request would otherwise be a database write. Twenty seconds keeps
 * that down to at most one write per twenty seconds of continuous work, at the cost of
 * signing somebody out up to twenty seconds early at the very boundary: on a ten-minute
 * window that is three per cent, and in practice the browser's own timer reaches the
 * deadline first and reaches it exactly.
 */
export const TOUCH_AFTER_SECONDS = 20;

/** Off, or a number of minutes. */
export type IdlePolicy = { enabled: false } | { enabled: true; minutes: number };

export const IDLE_OFF = "off";

/**
 * Reads the stored setting.
 *
 * Unlike the two-factor policy, an absent value here means the default rather than off.
 * The difference is what each does when it is wrong: a second factor imposed by surprise
 * confines people to one screen with no way out from inside the portal, while an idle
 * timeout imposed by surprise signs somebody out, which is the behaviour being asked for
 * and is undone by one click on this screen. So this one ships on.
 */
export function readIdlePolicy(raw: string | null | undefined): IdlePolicy {
  const value = (raw ?? "").trim();
  if (value === IDLE_OFF) return { enabled: false };
  if (value === "") return { enabled: true, minutes: DEFAULT_IDLE_MINUTES };

  const minutes = Number.parseInt(value, 10);
  if (!Number.isFinite(minutes)) return { enabled: true, minutes: DEFAULT_IDLE_MINUTES };
  return { enabled: true, minutes: clampIdleMinutes(minutes) };
}

export function clampIdleMinutes(minutes: number): number {
  return Math.min(Math.max(Math.round(minutes), MIN_IDLE_MINUTES), MAX_IDLE_MINUTES);
}

/** What gets stored for a policy. */
export function writeIdlePolicy(policy: IdlePolicy): string {
  return policy.enabled ? String(clampIdleMinutes(policy.minutes)) : IDLE_OFF;
}

/** How the sign-in screen explains an absence the person did not ask for. */
export const IDLE_SIGNED_OUT_MESSAGE =
  "You were signed out because the portal was left idle. Sign in again to carry on.";

/**
 * Marker on the 401 that says which kind of absence this was.
 *
 * Without it the browser cannot tell "your session ran out while you were away" from
 * "you are not signed in", and the person is left guessing why their work disappeared.
 */
export const IDLE_SIGNED_OUT_CODE = "idle_timeout";
