/**
 * What a client subscribes to, what it costs, and when they have outgrown it.
 *
 * The firm sells one thing: the All-in-One Accounting, Payroll, Tax and Regulatory
 * Subscription Service, at one of three tiers. Schedule 2 of the Associate agreement
 * already names them and prices what the firm pays an associate for servicing a client
 * at each one. What has never existed anywhere is the other side of that: what the
 * client pays. This module is that half, and the arithmetic that decides which tier a
 * client belongs on.
 *
 * ## Three tiers, fixed. Everything else is data.
 *
 * `CLIENT_TIERS` in shared/allocations.ts is not a list this module may extend. The
 * tiers are contractual - they are named in a signed agreement, they set what associates
 * are paid, and `client_allocations.tier` has a CHECK constraint on exactly those three
 * values. A fourth tier added through a settings screen would be a fourth tier the
 * agreement has never heard of.
 *
 * What is data, and fully editable: the **criteria** a client is measured on, the
 * **ceilings** each tier sets on each criterion, and the **fee** each tier charges. Add
 * "bank accounts" or "branches" as a criterion whenever the firm starts pricing on it.
 *
 * ## How a tier is decided
 *
 * A tier covers a size of business, expressed as a ceiling per criterion. A client has
 * figures recorded against those same criteria. The tier that fits is the cheapest one
 * whose ceilings all still cover them, and the top tier has no ceilings, so there is
 * always an answer.
 *
 * The portal **suggests and never moves anybody**. Crossing a ceiling raises a flag on a
 * screen a Partner reads; it does not change a fee, and it does not send the client
 * anything. That is deliberate, and `outgrown()` is the only thing in here that decides
 * anything - what is done about it is a conversation.
 *
 * Imported by the Worker, the firm's screens and the client's own screen, so all three
 * agree about what "outgrown" means rather than each computing it and hoping.
 */

import { CLIENT_TIERS, TIER_LABELS, type ClientTier } from "./allocations";

export { CLIENT_TIERS, TIER_LABELS };
export type { ClientTier };

/**
 * Cheapest first.
 *
 * The order is the whole of the suggestion rule: the first tier that still covers a
 * client is the one they belong on. It is declared here rather than read off a fee
 * column because a firm that temporarily prices Growth above Enterprise during a
 * promotion has not thereby made Enterprise the smaller package.
 */
export const TIER_ORDER: ClientTier[] = ["starter", "growth", "enterprise"];

/** Where a tier sits in the ladder, for comparing two of them. */
export function tierRank(tier: ClientTier): number {
  return TIER_ORDER.indexOf(tier);
}

/** The tier above this one, or null at the top. */
export function tierAbove(tier: ClientTier): ClientTier | null {
  return TIER_ORDER[tierRank(tier) + 1] ?? null;
}

/** The tier below this one, or null at the bottom. */
export function tierBelow(tier: ClientTier): ClientTier | null {
  const i = tierRank(tier);
  return i > 0 ? TIER_ORDER[i - 1] : null;
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

/**
 * How a criterion is written down.
 *
 * Two units rather than a free-text one, because the difference changes how a figure is
 * formatted, how it is entered, and how a ceiling reads. A count is a count; money is
 * money and carries the firm's currency.
 */
export const CRITERION_UNITS = ["count", "money"] as const;
export type CriterionUnit = (typeof CRITERION_UNITS)[number];

export const CRITERION_UNIT_LABELS: Record<CriterionUnit, string> = {
  count: "A count",
  money: "An amount",
};

export interface Criterion {
  id: string;
  name: string;
  unit: CriterionUnit;
  /** How the firm arrives at the number, shown wherever one is entered or read. */
  how_measured: string | null;
  position: number;
}

/** A tier's ceiling on one criterion. Null is no ceiling. */
export interface Ceiling {
  tier: ClientTier;
  criterion_id: string;
  ceiling: number | null;
}

/** What has actually been recorded for a client against one criterion. */
export interface Figure {
  criterion_id: string;
  value: number;
  as_of: string;
  recorded_by_name?: string | null;
  recorded_at?: string;
}

// ---------------------------------------------------------------------------
// Standing
// ---------------------------------------------------------------------------

/**
 * How close to a ceiling counts as close.
 *
 * Ninety per cent, so that a client heading for the next tier shows up on a Partner's
 * screen with a month or two in hand rather than on the day they cross. The whole value
 * of the flag is in having the conversation before the invoice rather than after it.
 */
export const CLOSE_AT = 0.9;

export const STANDINGS = ["unknown", "within", "close", "outgrown"] as const;
export type Standing = (typeof STANDINGS)[number];

export const STANDING_LABELS: Record<Standing, string> = {
  unknown: "No figures recorded",
  within: "Right tier",
  close: "Close to the ceiling",
  outgrown: "Outgrown this tier",
};

/**
 * Where one figure sits against one ceiling.
 *
 * No ceiling means nothing to outgrow, which is what the top tier is. No figure means
 * unknown, and unknown is deliberately not "fine": a criterion nobody has recorded makes
 * every judgement built on it a guess, and the screens say so rather than defaulting to
 * the comfortable answer.
 */
export function standingOf(
  value: number | null | undefined,
  ceiling: number | null | undefined,
): Standing {
  if (value === null || value === undefined) return "unknown";
  if (ceiling === null || ceiling === undefined) return "within";
  if (value > ceiling) return "outgrown";
  if (ceiling > 0 && value / ceiling >= CLOSE_AT) return "close";
  return "within";
}

/** The worst of several standings, which is the one a person needs to see. */
export function worstStanding(standings: Standing[]): Standing {
  if (standings.includes("outgrown")) return "outgrown";
  if (standings.includes("close")) return "close";
  /*
   * Unknown ranks below close and above within on purpose. A missing figure is not as
   * urgent as a breached ceiling, but it is worse than a confirmed pass, because it is
   * the absence of a judgement rather than a good one.
   */
  if (standings.includes("unknown")) return "unknown";
  return standings.length ? "within" : "unknown";
}

/** How far along a criterion is, 0 to 1, for a meter. Null where there is no ceiling. */
export function fractionOfCeiling(
  value: number | null | undefined,
  ceiling: number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (ceiling === null || ceiling === undefined || ceiling <= 0) return null;
  return Math.min(value / ceiling, 1);
}

// ---------------------------------------------------------------------------
// Which tier fits
// ---------------------------------------------------------------------------

/** Every ceiling for one tier, keyed by criterion. */
export function ceilingsFor(
  ceilings: Ceiling[],
  tier: ClientTier,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const c of ceilings) {
    if (c.tier === tier) map.set(c.criterion_id, c.ceiling);
  }
  return map;
}

/** Whether every recorded figure still sits inside this tier's ceilings. */
export function tierCovers(
  tier: ClientTier,
  ceilings: Ceiling[],
  figures: Figure[],
): boolean {
  const mine = ceilingsFor(ceilings, tier);
  for (const figure of figures) {
    const ceiling = mine.get(figure.criterion_id);
    if (ceiling === null || ceiling === undefined) continue;
    if (figure.value > ceiling) return false;
  }
  return true;
}

/**
 * The tier a client's figures point at: the cheapest one that still covers them.
 *
 * Null when nothing has been recorded, because with no figures there is nothing to
 * suggest from - and a suggestion made out of no evidence is worse than no suggestion,
 * since it looks like one.
 */
export function suggestTier(
  ceilings: Ceiling[],
  figures: Figure[],
): ClientTier | null {
  if (!figures.length) return null;
  for (const tier of TIER_ORDER) {
    if (tierCovers(tier, ceilings, figures)) return tier;
  }
  // The top tier has no ceilings, so this is unreachable unless somebody has given it
  // one. Returning it rather than null keeps the caller honest either way.
  return TIER_ORDER[TIER_ORDER.length - 1];
}

/** The criteria that put a client past their tier, in the order they were given. */
export function breaches(
  tier: ClientTier,
  ceilings: Ceiling[],
  figures: Figure[],
): Array<{ criterion_id: string; value: number; ceiling: number }> {
  const mine = ceilingsFor(ceilings, tier);
  const out: Array<{ criterion_id: string; value: number; ceiling: number }> = [];
  for (const figure of figures) {
    const ceiling = mine.get(figure.criterion_id);
    if (ceiling === null || ceiling === undefined) continue;
    if (figure.value > ceiling) {
      out.push({ criterion_id: figure.criterion_id, value: figure.value, ceiling });
    }
  }
  return out;
}

/**
 * Everything a screen needs to say about where a client stands, worked out once.
 *
 * Returned together rather than as four exported functions a caller has to remember to
 * call in the right order - the firm's list, the client's own page and a reminder email
 * all want the same answer, and the way they drift apart is by each assembling it.
 */
export interface Assessment {
  standing: Standing;
  /** The tier the figures point at, or null when nothing has been recorded. */
  suggested: ClientTier | null;
  /** True when the suggestion is above what they are on. */
  should_move: boolean;
  /** What put them over, empty unless outgrown. */
  breaches: Array<{ criterion_id: string; value: number; ceiling: number }>;
  /** Per criterion, for the meters. */
  lines: Array<{
    criterion_id: string;
    value: number | null;
    ceiling: number | null;
    fraction: number | null;
    standing: Standing;
  }>;
}

export function assess(
  tier: ClientTier,
  criteria: Criterion[],
  ceilings: Ceiling[],
  figures: Figure[],
): Assessment {
  const mine = ceilingsFor(ceilings, tier);
  const byCriterion = new Map(figures.map((f) => [f.criterion_id, f]));

  const lines = criteria.map((criterion) => {
    const figure = byCriterion.get(criterion.id);
    const value = figure ? figure.value : null;
    const ceiling = mine.get(criterion.id) ?? null;
    return {
      criterion_id: criterion.id,
      value,
      ceiling,
      fraction: fractionOfCeiling(value, ceiling),
      standing: standingOf(value, ceiling),
    };
  });

  const suggested = suggestTier(ceilings, figures);
  return {
    standing: worstStanding(lines.map((l) => l.standing)),
    suggested,
    should_move: suggested !== null && tierRank(suggested) > tierRank(tier),
    breaches: breaches(tier, ceilings, figures),
    lines,
  };
}

// ---------------------------------------------------------------------------
// Additional services - the work sold outside any tier
// ---------------------------------------------------------------------------

/**
 * How a fee is expressed.
 *
 * Three, because a practice quotes three ways and flattening them loses the meaning: a
 * statutory audit cannot be a fixed number before anybody has seen the records, and
 * revenue-audit support is priced by the day because nobody knows how many days it will
 * take.
 */
export const FEE_BASES = ["fixed", "daily", "from"] as const;
export type FeeBasis = (typeof FEE_BASES)[number];

export const FEE_BASIS_LABELS: Record<FeeBasis, string> = {
  fixed: "Fixed",
  daily: "A day",
  from: "Quoted, from",
};

/** How a fee reads to somebody being asked to pay it. */
export function describeFee(
  fee: number | null | undefined,
  basis: FeeBasis,
  money: (amount: number) => string,
): string {
  if (fee === null || fee === undefined) return "Quoted on request";
  if (basis === "daily") return `${money(fee)} a day`;
  if (basis === "from") return `from ${money(fee)}`;
  return money(fee);
}

/**
 * Where a piece of additional work has got to.
 *
 * A client asks; the firm quotes; the client agrees; the firm delivers. Declined ends it
 * from either side. The steps exist because the fee is agreed in the middle of them -
 * this is the record of what was asked for and what was said, not a workflow engine.
 */
export const SERVICE_STATES = [
  "requested",
  "quoted",
  "agreed",
  "delivered",
  "declined",
] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

export const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  requested: "Asked for",
  quoted: "Quoted",
  agreed: "Agreed",
  delivered: "Delivered",
  declined: "Not proceeding",
};

/** What the client is told, which is not always what the firm calls it. */
export const SERVICE_STATE_CLIENT_LABELS: Record<ServiceState, string> = {
  requested: "With us - we will come back to you",
  quoted: "Quoted - waiting for you",
  agreed: "Agreed - in hand",
  delivered: "Done",
  declined: "Not proceeding",
};

/** Which states a request may move to from here, and who may move it. */
export function nextStates(state: ServiceState): ServiceState[] {
  switch (state) {
    case "requested":
      return ["quoted", "declined"];
    case "quoted":
      return ["agreed", "declined"];
    case "agreed":
      return ["delivered", "declined"];
    default:
      return [];
  }
}

/**
 * Whether the client may make this move themselves.
 *
 * They may ask for work, and they may accept or refuse a quote. They may not mark
 * anything delivered, and they may not quote themselves a fee.
 */
export function clientMayMove(from: ServiceState, to: ServiceState): boolean {
  return from === "quoted" && (to === "agreed" || to === "declined");
}

// ---------------------------------------------------------------------------
// Refusals, worded once so the form and the server say the same thing
// ---------------------------------------------------------------------------

export function whyNotACriterionName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the criterion a name.";
  if (trimmed.length > 80) return "That name is too long - keep it under 80 characters.";
  return null;
}

export function whyNotACeiling(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null; // Empty is "no ceiling", which is allowed.
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "A ceiling has to be a number, or empty for none.";
  if (value < 0) return "A ceiling cannot be negative.";
  return null;
}

export function whyNotAFee(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null; // Empty means quoted on request.
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "A fee has to be a number, or empty to quote it.";
  if (value < 0) return "A fee cannot be negative.";
  if (value > 1_000_000_000) return "That fee is implausibly large.";
  return null;
}

export function whyNotAFigure(raw: string, unit: CriterionUnit): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Enter the figure.";
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "That is not a number.";
  if (value < 0) return "A figure cannot be negative.";
  if (unit === "count" && !Number.isInteger(value)) {
    return "A count has to be a whole number.";
  }
  if (value > 1_000_000_000_000) return "That figure is implausibly large.";
  return null;
}
