/**
 * How much of the firm's client work one person can see.
 *
 * The bug this exists to close: every signed-in person could read every deliverable in
 * the practice, every client, and every engagement. An Associate engaged last week
 * opened Deliverables and saw six jobs, none of them theirs, each naming a client, a
 * service line, a deadline and a colleague. `GET /api/tasks` applied no scoping at all,
 * and `GET /api/tasks/:id` called `requireUser` and then threw the result away, so any
 * deliverable could be opened by anybody who had its id.
 *
 * In a practice that files other people's tax returns, that is not an untidy default.
 * The client list alone tells you who banks with whom; a deliverable tells you what
 * they earn and when they are late paying it.
 *
 * ---
 *
 * **The rule.** Below the grade that assigns and supervises work, a person sees the
 * work that is theirs. At and above it, they see the practice.
 *
 * That threshold is `MIN_FULL_PORTFOLIO`, and it is deliberately the same grade that
 * already decides who may assign a deliverable, allocate a client or close a job. Two
 * different answers to "who runs the practice" would be one answer too many, and the
 * one people would learn is whichever one bit them last.
 *
 * **What counts as theirs** is stated once here and read by every screen - the list,
 * the detail, the counts, the dashboard, the search. A list that filters and a detail
 * endpoint that does not is not a permission, it is a decoration; and a count that
 * disagrees with the list beneath it is worse than either.
 *
 * ---
 *
 * This is not the same thing as `shared/visibility.ts`, and the two compose. Visibility
 * answers "may this grade open the Clients screen at all", which is the firm's to set.
 * This answers "once they are on it, whose clients are those", which is not: showing an
 * Associate a client they have nothing to do with is a confidentiality question, not a
 * preference.
 */

import { MIN_SUPERVISOR_ROLE, ROLE_RANK, type Role } from "./workflow";

/**
 * The grade at and above which somebody sees the whole practice.
 *
 * Manager: the grade that already creates and assigns deliverables, allocates clients
 * and closes approved work. Somebody who may hand you a job has to be able to see the
 * jobs.
 */
export const MIN_FULL_PORTFOLIO: Role = MIN_SUPERVISOR_ROLE;

export function seesWholePractice(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_FULL_PORTFOLIO];
}

/**
 * What it means for a deliverable to be somebody's own.
 *
 * Preparer or reviewer, and nothing else. Deliberately not "anyone who ever touched
 * it": a partner who created a job in March and handed it on has no standing reason to
 * be reading it in September, and if they do it is because of their grade rather than
 * because of that one act.
 */
export const OWN_TASK_COLUMNS = ["assignee_id", "reviewer_id"] as const;

/**
 * What it means for a client to be somebody's own.
 *
 * Three ways in, and each of them is somebody having actually been given the client
 * rather than having seen it:
 *
 *   - they hold a live allocation of it - the Associate agreement's Assigned Client;
 *   - they are the named partner or manager on it;
 *   - they are preparing or reviewing a deliverable for it, which is how most staff
 *     come to a client and is the case that would otherwise leave somebody unable to
 *     open the file for the return they are writing.
 *
 * A declined or ended allocation is not a way in. Somebody who exercised clause 8.2 to
 * refuse a client should not keep a window into it.
 */
export interface PortfolioReach {
  allocated: boolean;
  responsible: boolean;
  working: boolean;
}

export function reachesClient(reach: PortfolioReach): boolean {
  return reach.allocated || reach.responsible || reach.working;
}

// ---------------------------------------------------------------------------
// What to say when somebody cannot see something
// ---------------------------------------------------------------------------

/**
 * Deliberately the same sentence whether the thing does not exist or is not theirs.
 *
 * Distinguishing them would turn the detail endpoint into a way of asking "is there a
 * deliverable with this id", which over enough guesses is a map of the firm's client
 * work. It is also the honest answer from where the reader stands: for them, there is
 * nothing there.
 */
export const NOT_YOURS = {
  task: "That deliverable does not exist, or is not one of yours.",
  client: "That client does not exist, or is not one of yours.",
  engagement: "That engagement does not exist, or is not one of yours.",
} as const;

/** What the empty list should say, which is different from "no results". */
export function emptyPortfolioMessage(role: Role, noun: "deliverable" | "client"): string {
  if (seesWholePractice(role)) {
    return `No ${noun}s match what you are looking for.`;
  }
  return noun === "deliverable"
    ? "Nothing is assigned to you yet. Deliverables appear here when somebody assigns you one."
    : "No clients are assigned to you yet. They appear here when you are allocated one or given work for it.";
}
