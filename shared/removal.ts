/**
 * Removing a person, and what it costs.
 *
 * "Delete the account" sounds like one action on one row. In this schema it is not. A
 * user row is referenced by forty-odd columns, and roughly a third of them cascade, so
 * `DELETE FROM users` takes with it things that are not about that person at all:
 *
 *   - every **review point they raised**, on somebody else's deliverable;
 *   - every **review round they conducted**, likewise;
 *   - every **comment they wrote**, on anybody's job;
 *   - every **hour they logged** against a client;
 *   - every **document they signed**, which is the evidence the firm keeps.
 *
 * That was measured, not assumed. Deleting a reviewer leaves the deliverable they were
 * reviewing sitting in `under_review` with no reviewer, no review round, and no record
 * of what was asked for or why - and the person whose deliverable it is did nothing.
 *
 * So this module exists to make the choice an informed one rather than a surprise. It
 * counts what a person is attached to, decides which of the two removals is honest, and
 * says so in words an administrator can act on.
 *
 * **Erase** is the full delete, and it is offered only where it is harmless: an account
 * that has touched no client work. Created by mistake, never used, wrong email address
 * typed at four o'clock - the common reason to want a row gone.
 *
 * **Retire** is for everybody else. The personal record goes - profile, pay, bank
 * details, identification, contract, documents, devices, security questions, reports -
 * and the user row stays, anonymised, so the client work keeps the shape of who did
 * what. It is what a practice needs anyway: an audit file has to show that a named
 * person prepared a return and another reviewed it, and a firm that deletes that has
 * lost the file, not tidied it.
 */

// ---------------------------------------------------------------------------
// What a person is attached to
// ---------------------------------------------------------------------------

/**
 * The counts that decide the answer.
 *
 * Only the ones that represent work belonging to the *firm* rather than facts about the
 * person. Their own onboarding steps, notifications and trusted devices are not here:
 * those go either way and nobody needs warning about them.
 */
export interface RemovalFootprint {
  /** Deliverables they prepare, review, or raised. */
  tasks: number;
  /** Review rounds they conducted. Cascades away with the row. */
  reviews: number;
  /** Review points they raised on anybody's work. Cascades away with the row. */
  review_points: number;
  /** Comments they wrote on anybody's deliverable. Cascades away with the row. */
  comments: number;
  /** Hours logged against clients. Cascades away with the row. */
  time_entries: number;
  /** Documents they have signed or acknowledged. Cascades away with the row. */
  signatures: number;
  /** Clients where they are the partner, the manager, or hold the allocation. */
  clients: number;
  /** Performance reviews about them, or written by them. */
  performance_reviews: number;
}

export const NO_FOOTPRINT: RemovalFootprint = {
  tasks: 0,
  reviews: 0,
  review_points: 0,
  comments: 0,
  time_entries: 0,
  signatures: 0,
  clients: 0,
  performance_reviews: 0,
};

export function footprintTotal(footprint: RemovalFootprint): number {
  return Object.values(footprint).reduce((total, n) => total + n, 0);
}

/**
 * Whether the row can simply go.
 *
 * True only when the person has left nothing behind that belongs to the firm, which is
 * the case the full delete is for: an account created by mistake and never used.
 */
export function canErase(footprint: RemovalFootprint): boolean {
  return footprintTotal(footprint) === 0;
}

// ---------------------------------------------------------------------------
// The two removals
// ---------------------------------------------------------------------------

export const REMOVALS = ["retire", "erase"] as const;
export type Removal = (typeof REMOVALS)[number];

export const REMOVAL_LABELS: Record<Removal, string> = {
  retire: "Remove their personal record",
  erase: "Delete the account entirely",
};

/**
 * What each removal does, said plainly enough that nobody needs to read the code.
 *
 * Written as a list rather than a paragraph because an administrator about to do
 * something irreversible reads a list and skims a paragraph.
 */
export const REMOVAL_EFFECTS: Record<Removal, { keeps: string[]; destroys: string[] }> = {
  retire: {
    keeps: [
      "Their deliverables, review rounds and review points, so nobody else's work is disturbed",
      "The hours logged against clients",
      "Who prepared and who reviewed each job, under a settled name",
    ],
    destroys: [
      "Their personal and emergency contact details",
      "Their pay, bank details and tax references",
      "Their identification, right-to-work and qualification records",
      "Their contract and personnel-file documents, and the signatures on them",
      "Their performance reviews and objectives",
      "Their onboarding programme, status reports and contract details",
      "Their sign-in credentials, two-step key, recovery codes, security questions and remembered devices",
    ],
  },
  erase: {
    keeps: [],
    destroys: [
      "The account itself, and everything a retirement would remove",
      "Every review round they conducted and review point they raised, on anybody's deliverable",
      "Every comment they wrote, on anybody's deliverable",
      "Every hour they logged against a client",
      "Every document signature they gave",
    ],
  },
};

/** The name an anonymised user row carries afterwards. */
export const RETIRED_NAME = "Former colleague";

/**
 * The address a retired account is given.
 *
 * `.invalid` is reserved by RFC 2606 precisely so that it can never be routed. A retired
 * account must keep *some* address - the column is unique and not null, and sign-in
 * looks people up by it - and one that could deliver, or could later be registered by
 * somebody, is not a retired account.
 */
export function retiredEmail(userId: string): string {
  return `retired-${userId}@removed.invalid`;
}

export function isRetiredEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@removed.invalid");
}

// ---------------------------------------------------------------------------
// What to tell the administrator
// ---------------------------------------------------------------------------

export interface RemovalAdvice {
  /** The removal that is honest for this person. */
  recommended: Removal;
  /** Whether the full delete may be offered at all. */
  erase_available: boolean;
  /** One sentence saying why. */
  summary: string;
  /** The specific things a full delete would take with it. */
  collateral: string[];
}

/** How each footprint entry reads when it is about to be destroyed. */
const COLLATERAL: Array<{
  key: keyof RemovalFootprint;
  one: string;
  many: string;
  /** False where the loss is confined to this person's own record. */
  othersAffected: boolean;
}> = [
  { key: "review_points", one: "review point they raised", many: "review points they raised", othersAffected: true },
  { key: "reviews", one: "review round they conducted", many: "review rounds they conducted", othersAffected: true },
  { key: "comments", one: "comment they wrote", many: "comments they wrote", othersAffected: true },
  { key: "time_entries", one: "hour entry logged against a client", many: "hour entries logged against clients", othersAffected: true },
  { key: "signatures", one: "document signature", many: "document signatures", othersAffected: false },
  { key: "performance_reviews", one: "performance review", many: "performance reviews", othersAffected: false },
];

function phrase(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function adviseRemoval(footprint: RemovalFootprint): RemovalAdvice {
  const collateral = COLLATERAL.filter((item) => footprint[item.key] > 0).map((item) =>
    phrase(footprint[item.key], item.one, item.many),
  );

  if (canErase(footprint)) {
    return {
      recommended: "erase",
      erase_available: true,
      summary:
        "This account has touched no client work, so deleting it entirely takes nothing else with it.",
      collateral: [],
    };
  }

  /*
   * The strongest sentence is reserved for the case that actually damages somebody
   * else's records. A person with only their own signatures and reviews is losing their
   * own history; a person who has reviewed other people's work is not.
   */
  const touchesOthers = COLLATERAL.some(
    (item) => item.othersAffected && footprint[item.key] > 0,
  );

  return {
    recommended: "retire",
    erase_available: true,
    summary: touchesOthers
      ? "Deleting this account entirely would also remove their work from other people's deliverables, which would leave those records incomplete."
      : "Deleting this account entirely would remove the firm's record of what they did.",
    collateral,
  };
}

/**
 * The exact words an administrator has to type to confirm.
 *
 * Their own name, rather than a fixed word. "DELETE" can be typed without reading, and
 * the point of the confirmation is not friction - it is to make somebody look at which
 * person they have selected before the row goes.
 */
export function removalConfirmation(fullName: string): string {
  return fullName.trim();
}

export function confirmationMatches(typed: string, fullName: string): boolean {
  return (
    typed.trim().toLocaleLowerCase().replace(/\s+/g, " ") ===
    fullName.trim().toLocaleLowerCase().replace(/\s+/g, " ")
  );
}
