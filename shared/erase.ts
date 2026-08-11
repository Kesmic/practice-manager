/**
 * Erasing data for a chosen period.
 *
 * A practice accumulates records it eventually has to be able to remove: a client
 * that left years ago, a test year entered while learning the system, deliverables
 * from a period already filed and archived elsewhere. Without a tool for it the only
 * options are to keep everything for ever or to go into the database by hand, and
 * the second is how a firm loses something it needed.
 *
 * So this exists, and it is built to be hard to regret:
 *
 * 1. **Only finished work.** Live deliverables are never erased, whatever the dates
 *    say. Work in progress belongs to somebody, and a date range is not a reason to
 *    take it from them.
 * 2. **Nothing that is evidence.** Employment records, signed documents and the
 *    signatures on them are outside every scope here. They are what the firm would
 *    produce if a member of staff or a regulator asked, and no housekeeping tool
 *    should be able to touch them. Clients themselves are also excluded: deleting a
 *    client would cascade through everything ever done for them.
 * 3. **Say what will go before it goes.** Every erasure is previewed as exact counts
 *    per record type, and the confirmation carries the total it was shown, so a
 *    preview that has gone stale cannot be acted on.
 * 4. **The erasure is itself a record.** What was erased, by whom, when, and over
 *    what period is written to a log that these scopes cannot erase.
 */

/** What the firm can choose to erase. Each is independent. */
export const ERASE_SCOPES = [
  "closed_deliverables",
  "notifications",
  "activity_log",
  "client_requests",
] as const;

export type EraseScope = (typeof ERASE_SCOPES)[number];

export const ERASE_SCOPE_LABELS: Record<EraseScope, string> = {
  closed_deliverables: "Closed and cancelled deliverables",
  notifications: "Portal inbox notifications",
  activity_log: "Activity log entries",
  client_requests: "Client enquiries from the public forms",
};

export const ERASE_SCOPE_DETAIL: Record<EraseScope, string> = {
  closed_deliverables:
    "Deliverables already closed or cancelled, with their procedures, review points, review rounds, comments, attachment links, time entries and history. Anything still live is left alone even if its dates fall inside the period.",
  notifications:
    "Inbox entries only. What they were about stays: they are copies of things that happened, not the things themselves.",
  activity_log:
    "Who did what and when, on deliverables that still exist. This is the audit trail. Erase it only if you are certain you will not need to show how a piece of work progressed.",
  client_requests:
    "Enquiries submitted through the new and existing client links, including any that were never dealt with. Clients created from them are not affected.",
};

/**
 * Scopes that remove an audit trail rather than working data. Presented apart from
 * the rest and off by default, because their cost is only felt later, when somebody
 * asks a question the log would have answered.
 */
export const AUDIT_SCOPES: EraseScope[] = ["activity_log"];

/** What is never erasable here, and why. Shown on the screen, not just documented. */
export const NEVER_ERASED: Array<{ what: string; why: string }> = [
  {
    what: "Staff records and pay history",
    why: "Employment records carry their own retention periods, and losing them can leave the firm unable to answer a question it is obliged to answer.",
  },
  {
    what: "Signed documents and the signatures on them",
    why: "A signature is evidence that a person accepted something. It has to outlive the housekeeping.",
  },
  {
    what: "Clients and engagements",
    why: "Removing a client would take everything ever done for them with it. Deliverables can be erased period by period instead.",
  },
  {
    what: "Live deliverables",
    why: "Work that is not yet closed belongs to whoever is doing it, whatever its dates.",
  },
  {
    what: "User accounts",
    why: "An account is what attributes past work to a person. Suspend an account instead: the work stays attributable.",
  },
];

/**
 * Typed by hand to confirm. Not a formality: it is the difference between a
 * mis-click and a decision, and it names the thing being done.
 */
export const ERASE_CONFIRMATION = "ERASE";

/**
 * Years of records a Ghanaian practice would normally expect to keep. Used to warn
 * when a period reaches into recent years, never to refuse: how long this firm keeps
 * its own records is the firm's judgement, not this tool's.
 */
export const RETENTION_YEARS = 6;

export interface EraseRange {
  /** Inclusive, ISO date. */
  from: string;
  /** Inclusive, ISO date. */
  to: string;
}

export interface ErasePreviewRow {
  scope: EraseScope;
  /** Records that would be removed directly. */
  count: number;
  /** Records that would follow them by cascade, such as a deliverable's comments. */
  cascade?: number;
  /** Anything inside the dates that is deliberately being left, and why. */
  spared?: { count: number; reason: string };
}

export interface ErasePreview {
  range: EraseRange;
  rows: ErasePreviewRow[];
  total: number;
  warnings: string[];
}

/** ISO date, no time, as the date inputs produce. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function checkRange(range: {
  from?: unknown;
  to?: unknown;
}): { ok: true; range: EraseRange } | { ok: false; problem: string } {
  const from = typeof range.from === "string" ? range.from.trim() : "";
  const to = typeof range.to === "string" ? range.to.trim() : "";
  if (!DATE.test(from) || !DATE.test(to)) {
    return { ok: false, problem: "Give a start and an end date." };
  }
  if (from > to) {
    return { ok: false, problem: "The start date falls after the end date." };
  }
  return { ok: true, range: { from, to } };
}

/**
 * Things worth saying before an erasure, in the order they matter. Kept here rather
 * than in the Worker so the screen can show them while the dates are being chosen,
 * which is when they can still change the answer.
 */
export function warningsFor(
  range: EraseRange,
  scopes: EraseScope[],
  todayIso: string,
): string[] {
  const warnings: string[] = [];

  const cutoff = `${Number(todayIso.slice(0, 4)) - RETENTION_YEARS}${todayIso.slice(4)}`;
  if (range.to > cutoff) {
    warnings.push(
      `This period reaches later than ${RETENTION_YEARS} years ago. A practice is normally expected to be able to produce records going back that far, so check that what you are erasing is held somewhere else first.`,
    );
  }
  if (range.to > todayIso) {
    warnings.push(
      "The end date is in the future, so anything created between now and then would also be caught if you repeated this later. Only what exists today will be erased.",
    );
  }
  if (scopes.some((scope) => AUDIT_SCOPES.includes(scope))) {
    warnings.push(
      "You have included the activity log. Deliverables will survive with no record of how they got to where they are.",
    );
  }
  return warnings;
}
