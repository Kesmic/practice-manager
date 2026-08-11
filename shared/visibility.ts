/**
 * Which grades can see which parts of the portal.
 *
 * The firm asked to be able to tick this themselves rather than have it decided for
 * them, and that is right: how much of the practice a Senior Associate should see is
 * a judgement about this firm, not a fact about software.
 *
 * Two things it deliberately does not do.
 *
 * **It is not a way round the professional controls.** Nobody reviews their own work,
 * an Associate cannot be made a reviewer, and pay is Partner business. Those are not
 * preferences, they are the reason a review file is worth anything, so they are not
 * on this screen and cannot be reached from it. Each area below carries a `floor`: the
 * lowest grade the firm is allowed to open it to. Where the floor equals the default
 * the area is fixed, and it is shown as fixed rather than quietly ignored.
 *
 * **It is not only about the sidebar.** Hiding a link while the endpoint behind it
 * still answers is not a permission, it is a decoration. The Worker reads this same
 * setting, so granting an area actually grants it and removing one actually removes it.
 */

import { ROLES, ROLE_RANK, type Role } from "./workflow";

export const AREAS = [
  "clients",
  "engagements",
  "templates",
  "client_requests",
  "reports",
  "people",
] as const;

export type Area = (typeof AREAS)[number];

export interface AreaSpec {
  label: string;
  /** What a person gains when this is open to their grade. */
  detail: string;
  /** Applied when the firm has never changed it. */
  defaultMin: Role;
  /**
   * The lowest grade this may ever be opened to. Where it equals `defaultMin` the
   * area cannot be loosened at all, only tightened.
   */
  floor: Role;
  /** Why the floor is where it is. Shown next to the control. */
  floorReason?: string;
}

export const AREA_SPECS: Record<Area, AreaSpec> = {
  clients: {
    label: "Clients",
    detail: "The client list and each client's file, including the links to SharePoint.",
    defaultMin: "associate",
    floor: "associate",
  },
  engagements: {
    label: "Engagements",
    detail: "The engagements under each client, and their scope and fees.",
    defaultMin: "associate",
    floor: "associate",
  },
  templates: {
    label: "Job templates",
    detail:
      "The standard procedures and deadline rules, and generating a period of work from them.",
    defaultMin: "associate",
    floor: "associate",
  },
  client_requests: {
    label: "Client requests",
    detail:
      "Enquiries from the public onboarding and service-request links, and turning one into a client.",
    defaultMin: "manager",
    floor: "senior_associate",
    floorReason:
      "An enquiry carries a stranger's contact details and their description of their affairs, so it needs at least Senior Associate judgement.",
  },
  reports: {
    label: "Reports",
    detail:
      "Practice-wide figures: workload by person, review quality by preparer, overdue work across every client.",
    defaultMin: "manager",
    floor: "senior_associate",
    floorReason:
      "These figures compare colleagues with each other. Opening them below Senior Associate rarely ends well.",
  },
  people: {
    label: "People",
    detail:
      "The staff directory and onboarding progress. Pay and personal records are never included here.",
    defaultMin: "manager",
    floor: "manager",
    floorReason:
      "Personnel information stays with those who manage people. This one cannot be loosened.",
  },
};

/** What a new deployment behaves like, and what Reset restores. */
export const DEFAULT_VISIBILITY: Record<Area, Role> = Object.fromEntries(
  AREAS.map((area) => [area, AREA_SPECS[area].defaultMin]),
) as Record<Area, Role>;

export type Visibility = Record<Area, Role>;

/** Whether an area can be loosened at all, or only tightened. */
export function isFixed(area: Area): boolean {
  return AREA_SPECS[area].floor === AREA_SPECS[area].defaultMin;
}

/** The grades the firm may choose from for an area, lowest first. */
export function choicesFor(area: Area): Role[] {
  const floor = ROLE_RANK[AREA_SPECS[area].floor];
  return ROLES.filter((role) => ROLE_RANK[role] >= floor);
}

/**
 * Reads a stored setting into a complete, safe map.
 *
 * Anything missing, unknown, or below an area's floor falls back to the default. That
 * matters more than it looks: this value is enforced server-side, so a hand-edited or
 * half-written setting must fail closed rather than open.
 */
export function readVisibility(raw: string | null | undefined): Visibility {
  const result: Visibility = { ...DEFAULT_VISIBILITY };
  if (!raw) return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return result;

  for (const area of AREAS) {
    const value = (parsed as Record<string, unknown>)[area];
    if (typeof value !== "string") continue;
    if (!ROLES.includes(value as Role)) continue;
    const role = value as Role;
    // Never below the floor, however the setting got there.
    if (ROLE_RANK[role] < ROLE_RANK[AREA_SPECS[area].floor]) continue;
    result[area] = role;
  }
  return result;
}

/** Serialises only what differs from the defaults, so the row stays small and legible. */
export function writeVisibility(visibility: Visibility): string {
  const changed: Record<string, Role> = {};
  for (const area of AREAS) {
    if (visibility[area] !== DEFAULT_VISIBILITY[area]) changed[area] = visibility[area];
  }
  return Object.keys(changed).length ? JSON.stringify(changed) : "";
}

/** The one question both the sidebar and the Worker ask. */
export function canSeeArea(visibility: Visibility, area: Area, role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[visibility[area]];
}
