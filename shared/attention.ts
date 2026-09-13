/**
 * What is waiting for the person signed in, counted per sidebar destination.
 *
 * A badge is a promise: it says "there is something here that will not resolve itself
 * unless you open this". So what counts is deliberately narrow - work that is
 * *outstanding on this person*, not work that merely exists.
 *
 * Two things follow from that, and both are the reason the deliverable queues are
 * absent from this list. A partner has forty open deliverables on any given Tuesday and
 * none of them is news; a badge reading 40 beside Deliverables would be furniture within
 * a day, and furniture beside it makes the badge that *is* news easier to miss. And a
 * count that never reaches zero teaches people that these numbers are decoration.
 *
 * Everything here can reach zero, and every one of them is cleared by the person doing
 * something specific: sign the document, tick the step, decide the request.
 */

/** One count per destination that can carry a badge. */
export interface Attention {
  /** Published documents this person has not responded to at the current version. */
  documents: number;
  /** Onboarding steps that are this person's own to complete. */
  onboarding: number;
  /** Client enquiries nobody has picked up or decided yet. */
  client_requests: number;
  /** Unread inbox entries. */
  notifications: number;
}

export const NO_ATTENTION: Attention = {
  documents: 0,
  onboarding: 0,
  client_requests: 0,
  notifications: 0,
};

/**
 * How a count is written on a badge.
 *
 * Capped, because a three-digit badge stops being a number and becomes a smear, and
 * because the difference between 100 and 140 things waiting changes nobody's next
 * action.
 */
export const BADGE_CAP = 99;

export function badgeText(count: number): string {
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}

/**
 * What a screen reader says instead of reading a bare number out of context.
 *
 * Without this the badge announces as "Employee handbook 6", which sounds like a
 * heading number rather than six things somebody has to do.
 */
export function badgeLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"} needing your attention`;
}
