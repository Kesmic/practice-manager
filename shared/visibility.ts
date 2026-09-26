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
 * lowest grade the firm is allowed to open it to. The floor is a lower bound only.
 * Tightening is always allowed, because a firm that does not want Associates reading the
 * client list is entitled to say so.
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
  "reports",
  "people",
  "directory",
] as const;

export type Area = (typeof AREAS)[number];

/**
 * An area is open to a grade, or to nobody at all.
 *
 * "Off" is not the same as "open to Partners only". Some things a firm may simply not
 * want to have - a practice of six people in one room has no use for a staff directory,
 * and offering it at a grade nobody holds would leave a dead link in the sidebar rather
 * than answering the question. Only an area whose spec says so can be switched off; for
 * the rest the question is who sees it, not whether it exists.
 */
export const OFF = "off";
export type Openness = Role | typeof OFF;

export function isOff(value: Openness): value is typeof OFF {
  return value === OFF;
}

export interface AreaSpec {
  label: string;
  /** What a person gains when this is open to their grade. */
  detail: string;
  /** Applied when the firm has never changed it. */
  defaultMin: Role;
  /**
   * The lowest grade this may ever be opened to. A lower bound only: the firm may set
   * anything at or above it, including grades stricter than the default.
   */
  floor: Role;
  /** Why the floor is where it is. Shown next to the control. */
  floorReason?: string;
  /**
   * Whether the firm may switch this off for everybody, rather than only choose a grade.
   *
   * Set on an area the practice can genuinely do without. It is not set on anything the
   * work depends on: switching off Clients would not be a preference, it would be a
   * portal that cannot be used for its purpose.
   */
  canSwitchOff?: boolean;
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
    /*
     * Closed to staff by default, at the firm's request, and the reason is the fees.
     * An engagement says what a client agreed to pay and for what - which is commercial
     * information about the practice as much as about the client, and not something a
     * new joiner needs in order to prepare a return.
     *
     * The floor stays at Associate, so a firm that wants its staff to see the scope
     * they are working to can open it. Opened, it is still scoped: a person sees the
     * engagements of the clients they reach, never the whole book.
     */
    defaultMin: "manager",
    floor: "associate",
  },
  templates: {
    label: "Job templates",
    detail:
      "The standard procedures and deadline rules, and generating a period of work from them.",
    defaultMin: "associate",
    floor: "associate",
  },
  reports: {
    label: "Reports",
    detail:
      "Practice-wide figures: workload by person, review quality by preparer, overdue work across every client.",
    defaultMin: "manager",
    floor: "senior_associate",
    floorReason:
      "Cannot be opened below Senior Associate: these figures compare colleagues with each other.",
  },
  people: {
    label: "People",
    detail:
      "The staff directory and onboarding progress. Pay and personal records are never included here.",
    defaultMin: "manager",
    floor: "manager",
    floorReason:
      "Cannot be opened below Manager: personnel information stays with those who manage people.",
  },
  directory: {
    label: "Staff directory",
    detail:
      "Who works here, their job title and department, and how to reach them. Never pay, personal addresses or HR records.",
    /*
     * On by default and open to everybody, because knowing who your colleagues are is
     * ordinary and a new joiner needs it most.
     *
     * Switchable off because a firm is entitled to decide it does not want one. A small
     * practice where everybody already knows everybody gains nothing from it, and a
     * firm may simply prefer that a list of its staff and their addresses does not sit
     * behind one sign-in. What a reader sees is still limited by grade either way.
     */
    defaultMin: "associate",
    floor: "associate",
    canSwitchOff: true,
  },
};

/** What a new deployment behaves like, and what Reset restores. */
export const DEFAULT_VISIBILITY: Record<Area, Openness> = Object.fromEntries(
  AREAS.map((area) => [area, AREA_SPECS[area].defaultMin]),
) as Record<Area, Openness>;

export type Visibility = Record<Area, Openness>;

/**
 * The grades the firm may choose from for an area, lowest first.
 *
 * The floor is a lower bound only. Tightening is always allowed: a firm that does not
 * want Associates reading the client list is entitled to say so, and refusing that
 * would make the screen a list of things it will not do.
 */
export function choicesFor(area: Area): Role[] {
  const floor = ROLE_RANK[AREA_SPECS[area].floor];
  return ROLES.filter((role) => ROLE_RANK[role] >= floor);
}

/** Whether the firm may switch this area off entirely. */
export function canSwitchOff(area: Area): boolean {
  return AREA_SPECS[area].canSwitchOff === true;
}

/**
 * Every setting the firm may choose for an area, in the order the screen offers them:
 * Off first where it is allowed, then the grades from the floor upwards.
 */
export function opennessChoicesFor(area: Area): Openness[] {
  return canSwitchOff(area) ? [OFF, ...choicesFor(area)] : choicesFor(area);
}

/**
 * Whether there is any choice to offer. Only true for an area whose floor is the top
 * grade, which none currently is, so this is a guard rather than a live case.
 */
export function isFixed(area: Area): boolean {
  return choicesFor(area).length <= 1;
}

/** Whether an area is already as open as the firm is allowed to make it. */
export function atFloor(area: Area, visibility: Visibility): boolean {
  return visibility[area] === AREA_SPECS[area].floor;
}

/** How a setting reads on the screen and in a refusal. */
export function opennessLabel(value: Openness, roleLabel: (role: Role) => string): string {
  return isOff(value) ? "Off" : `${roleLabel(value)} and above`;
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
    // Off, but only where the area allows it. A stored "off" on any other area is a
    // corrupted setting, and falling back to the default is the closed answer there.
    if (value === OFF) {
      if (canSwitchOff(area)) result[area] = OFF;
      continue;
    }
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
  const changed: Record<string, Openness> = {};
  for (const area of AREAS) {
    if (visibility[area] !== DEFAULT_VISIBILITY[area]) changed[area] = visibility[area];
  }
  return Object.keys(changed).length ? JSON.stringify(changed) : "";
}

/**
 * The one question both the sidebar and the Worker ask.
 *
 * Off is off for everybody, including a Partner and an administrator. "Turn off the
 * staff directory" means the firm does not have one, not that it has one which only the
 * people who asked for it gone can see. Nothing is lost by that: the setting itself
 * lives under Portal settings, which is reachable regardless, so whoever switched it off
 * can switch it back on.
 */
export function canSeeArea(visibility: Visibility, area: Area, role: Role): boolean {
  const openness = visibility[area];
  if (isOff(openness)) return false;
  return ROLE_RANK[role] >= ROLE_RANK[openness];
}
