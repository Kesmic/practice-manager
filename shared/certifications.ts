/**
 * The tools the practice works in, the certifications it asks people to hold, and
 * where each person has got to.
 *
 * The list of tools is the firm's, not the portal's. A practice picks up Odoo, drops
 * Sage, and the vendors rename their courses every couple of years - so tools and
 * certifications are rows an administrator maintains, never names written into the
 * code. Adding one is a screen, not a release.
 *
 * What this module holds is the arithmetic, which is the part worth being careful
 * about. "Certified" is not a fact that stays true: Xero Advisor and the QuickBooks
 * ProAdvisor certification both lapse after a year, and a portal that says somebody is
 * certified when their certificate expired in March is worse than one that says
 * nothing, because the firm will believe it.
 *
 * Imported by both the Worker and the browser, so a status shown on screen and a status
 * counted in a report cannot disagree.
 */

/** What somebody has been asked to do, as recorded. */
export const CERT_PROGRESS = ["assigned", "in_progress", "certified"] as const;
export type CertProgress = (typeof CERT_PROGRESS)[number];

/**
 * What that means today.
 *
 * Wider than what is stored, because three of these are facts about the calendar
 * rather than about the person: a certification does not become overdue or expire
 * because somebody pressed a button, it does so because a date passed.
 */
export const CERT_STATES = [
  "not_started",
  "in_progress",
  "overdue",
  "certified",
  "expiring",
  "expired",
] as const;
export type CertState = (typeof CERT_STATES)[number];

export const CERT_STATE_LABELS: Record<CertState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  overdue: "Overdue",
  certified: "Certified",
  expiring: "Expires soon",
  expired: "Expired",
};

/**
 * Which states are the firm's problem.
 *
 * Used for the counts at the top of the practice-wide view, and for deciding whether
 * a person has anything outstanding. "Expiring" is in: a certification with three weeks
 * left needs somebody to act, and finding out on the day it lapses is finding out late.
 */
export const CERT_NEEDS_ATTENTION: CertState[] = ["overdue", "expiring", "expired"];

export function needsAttention(state: CertState): boolean {
  return CERT_NEEDS_ATTENTION.includes(state);
}

/**
 * How long before expiry the portal starts saying so.
 *
 * Sixty days because these courses take an afternoon but getting an afternoon booked
 * in a busy practice takes longer, and because the renewal window at both Xero and
 * Intuit opens comfortably inside it.
 */
export const EXPIRY_WARNING_DAYS = 60;

/** Whole days from one ISO date to another. Negative when the second is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * When a certification completed today would run out.
 *
 * Null where the certification does not expire, which is a real case: a one-off course
 * on the firm's own procedures is done when it is done.
 *
 * Anchored on the day of the month, so a certification completed on 31 January and
 * valid for one month expires on 28 February rather than 3 March. Rolling over would
 * quietly extend every renewal that landed at the end of a long month.
 */
export function expiryDate(
  completedOn: string,
  validityMonths: number | null | undefined,
): string | null {
  if (!validityMonths || validityMonths <= 0) return null;
  const [y, m, d] = completedOn.split("-").map(Number);
  if (!y || !m || !d) return null;

  const targetMonth = m - 1 + validityMonths;
  const year = y + Math.floor(targetMonth / 12);
  const month = targetMonth % 12;
  // The last day of the target month, so a shorter month clamps rather than rolls over.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);

  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface CertRecord {
  progress: CertProgress;
  /** When the firm asked for it to be done by. Null where no date was set. */
  due_on?: string | null;
  /** When they finished. Null until they have. */
  completed_on?: string | null;
  /** When it lapses. Null for one that does not expire. */
  expires_on?: string | null;
}

/**
 * Where somebody stands today.
 *
 * The order of these tests is the whole of it, and two of them are worth stating:
 *
 * **Expiry beats completion.** Somebody who passed the course last year and whose
 * certificate lapsed in March is not certified. Reporting them as certified is how a
 * firm sends an uncertified person to a client believing otherwise.
 *
 * **A due date only bites before completion.** Somebody who finished late is finished;
 * the lateness is a fact about when they did it, not a thing still outstanding. A
 * portal that kept calling them overdue would be asking for work already done.
 */
export function certState(record: CertRecord, today: string): CertState {
  if (record.progress === "certified") {
    if (record.expires_on) {
      const left = daysBetween(today, record.expires_on);
      if (left < 0) return "expired";
      if (left <= EXPIRY_WARNING_DAYS) return "expiring";
    }
    return "certified";
  }

  // Not finished. A date that has passed makes it overdue, whether or not they started.
  if (record.due_on && daysBetween(today, record.due_on) < 0) return "overdue";
  return record.progress === "in_progress" ? "in_progress" : "not_started";
}

/**
 * The sentence under the status, or null where the status says everything.
 *
 * Dates rather than adjectives: "Expires in 3 days" is something somebody acts on,
 * "Expiring soon" on its own is something they scroll past.
 */
export function certDetail(record: CertRecord, today: string): string | null {
  const state = certState(record, today);
  switch (state) {
    case "expiring": {
      const left = daysBetween(today, record.expires_on!);
      return left === 0
        ? "Expires today"
        : `Expires in ${left} ${left === 1 ? "day" : "days"}`;
    }
    case "expired": {
      const ago = -daysBetween(today, record.expires_on!);
      return `Expired ${ago} ${ago === 1 ? "day" : "days"} ago`;
    }
    case "overdue": {
      const ago = -daysBetween(today, record.due_on!);
      return `Was due ${ago} ${ago === 1 ? "day" : "days"} ago`;
    }
    case "certified":
      return record.expires_on ? `Valid to ${record.expires_on}` : null;
    default:
      return record.due_on ? `Due by ${record.due_on}` : null;
  }
}

// ---------------------------------------------------------------------------
// What the firm may type
// ---------------------------------------------------------------------------

/**
 * How long a certification lasts, as the screen offers it.
 *
 * Twelve and twenty-four cover the vendors; "does not expire" covers a course the firm
 * runs itself. Anything else can be typed, so an unusual one is a number rather than a
 * reason to come back and change the code.
 */
export const COMMON_VALIDITY = [12, 24, 36] as const;

export function describeValidity(months: number | null | undefined): string {
  if (!months || months <= 0) return "Does not expire";
  if (months === 12) return "12 months";
  if (months % 12 === 0) return `${months / 12} years`;
  return `${months} months`;
}

/** Why this cannot be saved, or null. */
export function whyNotAName(value: string, what: string): string | null {
  const name = value.trim();
  if (!name) return `Give the ${what} a name.`;
  if (name.length > 120) return `That ${what} name is too long.`;
  return null;
}

/**
 * Why this link cannot be used, or null.
 *
 * Restricted to http and https for the same reason the document links are: a stored
 * `javascript:` address would run in a colleague's session the moment somebody clicked
 * it, and these links are clicked by everybody in the firm.
 */
export function whyNotALink(value: string): string | null {
  const link = value.trim();
  if (!link) return null;
  if (!/^https?:\/\//i.test(link)) {
    return "A link must begin http:// or https://.";
  }
  if (link.length > 500) return "That link is too long.";
  return null;
}

export function whyNotValidity(months: number | null): string | null {
  if (months === null) return null;
  if (!Number.isInteger(months) || months < 1 || months > 600) {
    return "Give how many months it lasts, or say it does not expire.";
  }
  return null;
}
