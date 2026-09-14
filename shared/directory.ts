/**
 * The staff directory: who works here, and how to reach them.
 *
 * A practice needs one. Somebody preparing a return has to be able to find out who
 * reviews for the tax team, what a colleague's job title is, and which email address to
 * use - and asking around for that is how a new joiner spends their first fortnight.
 *
 * So the list itself is firm-wide: everybody appears, and everybody can open it. What
 * differs by grade is not *who* you can see but *what you can see about them*.
 *
 * ---
 *
 * **What everybody sees** is the working identity: name, grade, job title, department,
 * work email, where they sit, and who they report to. This is what is on an internal
 * phone list, and there is nothing in it a colleague should have to ask permission for.
 *
 * **What nobody below Manager sees** is everything that is about the person rather than
 * the post. Personal phone and address, date of birth, next of kin, staff number, pay,
 * bank details, identification, qualifications, onboarding progress - and employment
 * status, which is the one people forget: `probation` on a directory card tells the
 * whole firm something about a colleague that is between them and their manager.
 *
 * **What Managers and above see** is the same list with the personnel file behind it,
 * which is `/api/employees` and has always been gated. This module does not loosen that.
 *
 * ---
 *
 * Alongside the grade rule there is a work rule, which adds rather than subtracts: the
 * directory marks the colleagues you are actually working with, and on how many
 * deliverables. That is the half of "who do I talk to" that a grade cannot answer.
 */

import { ROLE_RANK, type Role } from "./workflow";

/**
 * The grade at and above which the directory carries employment facts as well as
 * working identity. The same line the personnel file already uses.
 */
export const MIN_DIRECTORY_DETAIL: Role = "manager";

export function seesEmploymentDetail(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_DIRECTORY_DETAIL];
}

/**
 * One person as the directory shows them.
 *
 * The optional fields are the ones that arrive only for a reader at Manager grade or
 * above. They are absent rather than blanked, so a screen cannot accidentally render an
 * empty "Employment status" row and invite somebody to wonder what is being hidden.
 */
export interface DirectoryEntry {
  id: string;
  full_name: string;
  role: Role;
  /** Their post, not their grade: "Tax Associate" rather than "Associate". */
  title: string | null;
  department: string | null;
  /** The firm's address for them. Never their personal one. */
  email: string;
  work_location: string | null;
  line_manager_name: string | null;
  /** Whether the account is active. A suspended colleague is still in the directory. */
  active: boolean;

  /**
   * How many live deliverables the reader shares with this person, either way round.
   * Zero for most of the firm, and the reason the directory is worth opening for the
   * few it is not zero for.
   */
  shared_deliverables: number;

  /** Manager grade and above only. */
  employment_status?: string | null;
  staff_no?: string | null;
  start_date?: string | null;
}

/**
 * The fields a reader below Manager grade must never receive.
 *
 * Listed so the rule can be tested rather than trusted: a field added to the query
 * without being thought about will fail the test rather than reach the browser.
 */
export const DETAIL_ONLY_FIELDS = [
  "employment_status",
  "staff_no",
  "start_date",
] as const;

/** How the "you work with them" line reads. */
export function sharedWorkLabel(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "You share a deliverable with them"
    : `You share ${count} deliverables with them`;
}

/**
 * Groups the directory by department, with the unassigned last.
 *
 * A flat alphabetical list of forty people answers "is there somebody called Mensah";
 * grouped by department it answers "who is in tax", which is the question somebody
 * actually has.
 */
export function byDepartment(
  entries: DirectoryEntry[],
): Array<{ department: string; people: DirectoryEntry[] }> {
  const groups = new Map<string, DirectoryEntry[]>();
  for (const entry of entries) {
    const key = entry.department?.trim() || "";
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }

  const named = [...groups.entries()]
    .filter(([key]) => key !== "")
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([department, people]) => ({ department, people }));

  const rest = groups.get("");
  return rest ? [...named, { department: "Elsewhere in the firm", people: rest }] : named;
}
