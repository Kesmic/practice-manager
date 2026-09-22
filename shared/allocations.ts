/**
 * Allocating a client to somebody, and their right to decline it.
 *
 * The Associate Consultant Agreement is built around the idea of an **Assigned Client**:
 * the fee is per assigned client per month, the onboarding obligations are per assigned
 * client, and Schedule 3 lists the clients assigned at the commencement date. Until now
 * the system had no such concept - a client had a partner and a manager, and that was
 * all - so the central unit of the agreement existed only on paper.
 *
 * It also had no way to satisfy clause 8.2, which is the reason this module exists:
 *
 * > The Associate may decline the allocation of a further client where acceptance
 * > would, in the Associate's reasonable professional judgement, prejudice the proper
 * > performance of the Services in respect of an existing Assigned Client. A refusal on
 * > that ground shall not constitute a breach of this Agreement.
 *
 * A contractual right that can only be exercised by email is a right in name. Three
 * things have to be true of it in the system for it to be worth anything:
 *
 * **An allocation must be an offer, not a fact.** If allocating simply set a column,
 * there would be nothing to decline. So an allocation starts as `offered` and becomes
 * real only when the person accepts.
 *
 * **The ground must be offered by name, not typed into a box.** Somebody exercising
 * clause 8.2 should not have to know it is clause 8.2, and the firm should not have to
 * read a free-text reason and decide afterwards which right was being exercised.
 *
 * **The record must say it was not a breach.** That is the operative half of the clause.
 * A decline recorded as a bare refusal, in a system that does not distinguish the
 * grounds, is evidence against the person who exercised the right the agreement gave
 * them.
 */

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/**
 * The packages the firm sells, which are also the tiers Schedule 2 of the Associate
 * agreement prices.
 *
 * One list, not two. What a client subscribes to and what an associate is paid for
 * servicing them are the same package - the agreement prices the associate's fee *by*
 * the client's tier - and two lists would be two answers to "what is this client on".
 *
 * These four are the ones in the firm's own pricing proposal. The names are fixed here
 * because a signed agreement names them and the screens are typed against them; what
 * each one costs, covers, and includes is data, editable in Portal settings.
 */
export const CLIENT_TIERS = ["starter", "growth", "firm", "enterprise"] as const;
export type ClientTier = (typeof CLIENT_TIERS)[number];

export const TIER_LABELS: Record<ClientTier, string> = {
  starter: "Starter",
  growth: "Growth",
  firm: "Firm",
  enterprise: "Enterprise",
};

/** The placeholder in the Associate agreement that prices each tier. */
export const TIER_FEE_TOKEN: Record<ClientTier, string> = {
  starter: "STARTER FEE",
  growth: "GROWTH FEE",
  firm: "FIRM FEE",
  enterprise: "ENTERPRISE FEE",
};

/**
 * Who each package is for, in the proposal's own terms.
 *
 * The bands are monthly turnover, which is what the proposal prices on. Firm and
 * Enterprise are not separated by a number: the first is for established local
 * businesses, the second for multinationals with complex transactions, and choosing
 * between them is a judgement rather than a threshold.
 */
export const TIER_HINTS: Record<ClientTier, string> = {
  starter: "Solo entrepreneurs and startups, turning over up to 8,000 a month.",
  growth: "Growing businesses with minimal transactions, between 8,000 and 15,000 a month.",
  firm: "Established local businesses with high transaction volumes, above 15,000 a month.",
  enterprise: "Multinational enterprises handling complex transactions.",
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const ALLOCATION_STATUSES = [
  "offered",
  "accepted",
  "declined",
  "withdrawn",
  "ended",
] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

export const ALLOCATION_STATUS_LABELS: Record<AllocationStatus, string> = {
  offered: "Awaiting their response",
  accepted: "Assigned",
  declined: "Declined",
  withdrawn: "Withdrawn",
  ended: "Reallocated",
};

/** An allocation that is live: the person either holds it or is deciding. */
export function isLive(status: AllocationStatus): boolean {
  return status === "offered" || status === "accepted";
}

/** An allocation the person actually holds, and is paid for. */
export function isHeld(status: AllocationStatus): boolean {
  return status === "accepted";
}

// ---------------------------------------------------------------------------
// Declining
// ---------------------------------------------------------------------------

export const DECLINE_GROUNDS = ["capacity", "conflict", "other"] as const;
export type DeclineGround = (typeof DECLINE_GROUNDS)[number];

export interface GroundSpec {
  label: string;
  /** What the person is asserting, in their own terms. */
  detail: string;
  /**
   * Whether refusing on this ground is, of itself, a breach of the engagement.
   *
   * `capacity` is clause 8.2 of the Associate agreement, which says in terms that a
   * refusal on that ground is not a breach. `conflict` is a professional obligation
   * that overrides any engagement: an accountant who takes work they cannot
   * independently perform has a larger problem than a contractual one. `other` is
   * deliberately neutral - the system does not know what was said, so it does not
   * pronounce on it either way.
   */
  breach: boolean;
  /** The clause this ground rests on, where it rests on one. */
  clause?: string;
}

export const GROUND_SPECS: Record<DeclineGround, GroundSpec> = {
  capacity: {
    label: "It would prejudice a client I already hold",
    detail:
      "Taking this on would, in your reasonable professional judgement, stop you performing properly for a client already assigned to you.",
    breach: false,
    clause: "8.2",
  },
  conflict: {
    label: "A conflict of interest or independence problem",
    detail:
      "You hold an interest, relationship or position that would compromise your independence in respect of this client.",
    breach: false,
  },
  other: {
    label: "Another reason",
    detail: "Say what it is. This is not one of the protected grounds.",
    breach: true,
  },
};

/**
 * Whether declining on this ground counts against the person.
 *
 * The operative half of clause 8.2, and the reason the grounds are named rather than
 * typed. A refusal recorded as a bare "declined", in a system that cannot tell the
 * grounds apart, is evidence against somebody exercising a right their agreement gave
 * them.
 */
export function isProtectedGround(ground: DeclineGround): boolean {
  return !GROUND_SPECS[ground].breach;
}

/** How a decline is described back to the firm and to the person who declined. */
export function describeDecline(ground: DeclineGround, associate: boolean): string {
  const spec = GROUND_SPECS[ground];
  if (!spec.breach && spec.clause && associate) {
    return `Declined under clause ${spec.clause}. A refusal on this ground is not a breach of the agreement.`;
  }
  if (!spec.breach) {
    return "Declined on a protected ground. This does not count against them.";
  }
  return "Declined. This is not one of the protected grounds.";
}

// ---------------------------------------------------------------------------
// What can be done to an allocation
// ---------------------------------------------------------------------------

export type AllocationAction =
  | "accept"
  | "decline"
  | "withdraw"
  | "end"
  | "reoffer";

export const ALLOCATION_ACTION_LABELS: Record<AllocationAction, string> = {
  accept: "Accept this client",
  decline: "Decline",
  withdraw: "Withdraw the offer",
  end: "Reallocate away",
  reoffer: "Offer it again",
};

/**
 * What the viewer may do to this allocation.
 *
 * Accepting and declining belong to the person it was offered to, and to nobody else -
 * a right somebody else can exercise on your behalf is not a right. Everything else
 * belongs to the firm.
 */
export function availableAllocationActions(
  status: AllocationStatus,
  options: { isSubject: boolean; canAllocate: boolean },
): AllocationAction[] {
  const actions: AllocationAction[] = [];

  if (status === "offered") {
    // Deliberately not gated on canAllocate: whether somebody may be offered a client
    // is the firm's decision, but answering an offer already made is theirs alone.
    if (options.isSubject) actions.push("accept", "decline");
    if (options.canAllocate) actions.push("withdraw");
    return actions;
  }

  if (!options.canAllocate) return actions;

  if (status === "accepted") actions.push("end");
  if (status === "declined" || status === "withdrawn" || status === "ended") {
    actions.push("reoffer");
  }
  return actions;
}

/**
 * Why an action is not available, for a caller that tried it anyway.
 *
 * Written as sentences rather than codes because they are shown to the person who hit
 * the rule, and "409" tells nobody what to do next.
 */
export function describeAllocationProblem(
  status: AllocationStatus,
  action: AllocationAction,
): string | null {
  if (action === "accept" || action === "decline") {
    if (status === "accepted") return "You have already accepted this client.";
    if (status === "declined") return "You have already declined this client.";
    if (status === "withdrawn") return "That offer was withdrawn.";
    if (status === "ended") return "That client is no longer allocated to you.";
    return null;
  }
  if (action === "withdraw" && status !== "offered") {
    return "Only an offer that has not been answered can be withdrawn.";
  }
  if (action === "end" && status !== "accepted") {
    return "Only a client somebody holds can be reallocated away.";
  }
  if (action === "reoffer" && isLive(status)) {
    return "That allocation is still live.";
  }
  return null;
}
