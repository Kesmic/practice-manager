/**
 * Growth partners: people outside the firm who sell for it.
 *
 * They are not introducers. A growth partner runs the whole cycle in consultation with
 * the firm - the pitch, the proposal, getting the contract signed - and the firm comes
 * in when a meeting needs somebody from it. That is why this module has stages rather
 * than a referral flag, and why what they can see of the billing is part of the design
 * rather than an afterthought.
 *
 * Everything below is the commercial arrangement expressed once, so the partner's own
 * screen, the firm's screen and whatever accrues the commission all give the same
 * answer.
 *
 * ## The entitlement
 *
 * Twenty-five per cent of the subscription fee, for the client's first six **billed**
 * months. Billed, not calendar: a client who pauses raises no invoice, so nothing
 * accrues and nothing is used up - their partner's entitlement pauses with them rather
 * than draining while the client is not paying.
 *
 * ## Subscription work and one-off work
 *
 * The baseline is the subscription. Where a client is signed onto a subscription, that
 * is what earns, and additional work billed alongside it does not - the partner is paid
 * for the client, not for every piece of work the firm ever does for them.
 *
 * Where a client only ever wants one piece of work, the arrangement would otherwise pay
 * nothing at all, which cannot be right for a sale the partner made. So a client who has
 * never been on a subscription earns the same 25% on their one-off work, once per
 * assignment, and only on work invoiced inside the same six-month window. An assignment
 * that recurs every year is one commission, not one a year.
 *
 * A client who starts on a subscription and later buys one-off work is a subscription
 * client throughout: the one-off earns nothing, whenever it happens.
 *
 * ## The hold
 *
 * Registering a prospect gives the partner ninety days of exclusivity on that business.
 * It stops two partners working the same company and then both claiming it, and it stops
 * a registration made once in 2026 being produced in 2031 as a claim on a client the
 * firm found itself. The firm can extend a hold where a sale is genuinely still moving.
 */

// ---------------------------------------------------------------------------
// The terms
// ---------------------------------------------------------------------------

/** Per cent of the subscription fee. */
export const COMMISSION_RATE = 25;

/** How many billed months it runs for. */
export const COMMISSION_MONTHS = 6;

/** How long a registered prospect is held exclusively, in days. */
export const HOLD_DAYS = 90;

// ---------------------------------------------------------------------------
// A partner's standing with the firm
// ---------------------------------------------------------------------------

/**
 * The firm adds them, and either side can end it.
 *
 * `applied` is kept for the column's CHECK and for any row written before the firm
 * invited rather than admitted; nothing writes it now. A partner in it has no portal at
 * all, which is the same as it always was.
 */
export const PARTNER_STATES = ["applied", "active", "suspended", "ended"] as const;
export type PartnerState = (typeof PARTNER_STATES)[number];

export const PARTNER_STATE_LABELS: Record<PartnerState, string> = {
  applied: "Waiting on us",
  active: "Active",
  suspended: "Suspended",
  ended: "Ended",
};

/** Whether this partner may use the portal at all. */
export function partnerMayWork(state: PartnerState): boolean {
  return state === "active";
}

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

/**
 * Where a prospect has got to.
 *
 * Named for what the partner has done rather than for how the firm feels about it, so
 * that moving one on is a statement of fact they can make without asking anybody.
 */
export const PROSPECT_STAGES = [
  "registered",
  "pitching",
  "proposal_sent",
  "contract_sent",
  "won",
  "lost",
] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

export const PROSPECT_STAGE_LABELS: Record<ProspectStage, string> = {
  registered: "Registered",
  pitching: "Pitching",
  proposal_sent: "Proposal sent",
  contract_sent: "Contract out for signature",
  won: "Signed",
  lost: "Not proceeding",
};

/** What the partner does next, in the order they would do it. */
export const NEXT_STAGES: Record<ProspectStage, ProspectStage[]> = {
  registered: ["pitching", "lost"],
  pitching: ["proposal_sent", "lost"],
  proposal_sent: ["contract_sent", "lost"],
  /*
   * A prospect is never marked `won` by the partner. Won means the firm has a signed
   * client, and the firm is where that becomes true - a partner who could declare it
   * would be declaring their own commission.
   */
  contract_sent: ["lost"],
  won: [],
  lost: ["pitching"],
};

export function mayMoveProspect(from: ProspectStage, to: ProspectStage): boolean {
  return NEXT_STAGES[from].includes(to);
}

// ---------------------------------------------------------------------------
// The hold
// ---------------------------------------------------------------------------

/** Ninety days on from the day it was registered, as a date. */
export function holdUntil(registeredOn: string, days: number = HOLD_DAYS): string {
  const at = Date.parse(`${registeredOn.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(at)) return registeredOn.slice(0, 10);
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days of exclusivity left, negative once it has run out. */
export function holdDaysLeft(holdUntilDate: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${holdUntilDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * How a hold reads on a screen.
 *
 * A held prospect that has been won keeps no countdown: the hold did its job and saying
 * "expired" against a signed client would read as a loss.
 */
export function describeHold(
  prospect: { stage: ProspectStage; hold_until: string },
  today: string,
): string {
  if (prospect.stage === "won") return "Signed - the hold is spent";
  if (prospect.stage === "lost") return "Not proceeding";
  const left = holdDaysLeft(prospect.hold_until, today);
  if (left < 0) return `Hold ran out ${-left} day${-left === 1 ? "" : "s"} ago`;
  if (left === 0) return "Hold runs out today";
  return `${left} day${left === 1 ? "" : "s"} of hold left`;
}

/**
 * Whether a business is still somebody else's to work on.
 *
 * A lost prospect releases its hold immediately: a partner who has been told no should
 * not be sitting on a business nobody else may approach for another two months.
 */
export function holdIsLive(
  prospect: { stage: ProspectStage; hold_until: string },
  today: string,
): boolean {
  if (prospect.stage === "lost") return false;
  if (prospect.stage === "won") return true;
  return holdDaysLeft(prospect.hold_until, today) >= 0;
}

/**
 * The key two registrations of the same business collide on.
 *
 * Case, punctuation and the company suffix removed, because "Acme Ltd.", "ACME Limited"
 * and "Acme  Ltd" are one business and a hold that any of the three walked around would
 * not be a hold at all. It is deliberately blunt: the firm would rather two partners be
 * made to talk about a near-collision than have one of them lose a client to a full stop.
 */
export function prospectKey(businessName: string): string {
  return businessName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(ltd|limited|plc|llc|inc|incorporated|company|co|enterprise|enterprises|ghana|gh)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// What is earned
// ---------------------------------------------------------------------------

export const COMMISSION_KINDS = ["subscription", "one_off"] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];

export const COMMISSION_STATES = ["accrued", "approved", "paid", "cancelled"] as const;
export type CommissionState = (typeof COMMISSION_STATES)[number];

export const COMMISSION_STATE_LABELS: Record<CommissionState, string> = {
  accrued: "Earned, awaiting approval",
  approved: "Approved for payment",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** Money to the pesewa, the same way shared/invoices.ts rounds it. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function commissionOn(basis: number, rate: number = COMMISSION_RATE): number {
  if (!Number.isFinite(basis) || basis <= 0) return 0;
  return round2((basis * rate) / 100);
}

/** What an invoice offers up for commission, line by line. */
export interface CommissionableInvoice {
  /** The subscription amount on it, before tax and after any discount. */
  subscription: number;
  /** The one-off work on it: additional services and manual lines. */
  one_off: Array<{ id: string; amount: number; assignment_key: string }>;
  /** 'YYYY-MM' the subscription line covers, so a month cannot be counted twice. */
  period: string | null;
  /** The day the invoice was issued, against which the one-off window is measured. */
  issued_on: string;
}

/** What the partner has already earned on this client. */
export interface CommissionHistory {
  /** How many billed subscription months have already accrued. */
  subscription_months: number;
  /**
   * The months already earned, as 'YYYY-MM'.
   *
   * The count alone is not enough. An invoice cancelled after its commission had been
   * paid, and then raised again for the same month, would otherwise earn a second time -
   * the client billed once and the partner paid twice. A month is earned once, whatever
   * happens to the paperwork afterwards.
   */
  periods: string[];
  /** Assignments that have already earned, so an annual repeat earns nothing. */
  assignments: string[];
  /** Whether this client has ever been on a subscription. */
  ever_subscribed: boolean;
  /** The day the client was signed, from which the one-off window runs. */
  won_on: string | null;
}

export interface CommissionLine {
  kind: CommissionKind;
  basis: number;
  amount: number;
  /** 'YYYY-MM' on a subscription month, the assignment's key on one-off work. */
  reference: string | null;
  /** Which of the six months this is. Null on one-off work. */
  month_index: number | null;
  /** Said back to whoever is reading the accrual, in the firm's own words. */
  why: string;
}

/** Months are counted from the win, so the one-off window is six of them. */
function withinWindow(wonOn: string | null, issuedOn: string, months: number): boolean {
  if (!wonOn) return true;
  const won = new Date(`${wonOn.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(won.getTime())) return true;
  const deadline = new Date(won);
  deadline.setUTCMonth(deadline.getUTCMonth() + months);
  return issuedOn.slice(0, 10) < deadline.toISOString().slice(0, 10);
}

/**
 * What this invoice earns the partner who sold the client.
 *
 * Everything the arrangement says, in one function, because the alternative is the
 * partner's statement and the firm's payable disagreeing about a number somebody is
 * owed. Called once per issued invoice; an invoice that earns nothing returns nothing,
 * which is the ordinary case from the seventh month on.
 */
export function commissionFor(
  invoice: CommissionableInvoice,
  history: CommissionHistory,
  terms: { rate?: number; months?: number } = {},
): CommissionLine[] {
  const rate = terms.rate ?? COMMISSION_RATE;
  const months = terms.months ?? COMMISSION_MONTHS;
  const lines: CommissionLine[] = [];

  if (invoice.subscription > 0) {
    const earnedAlready = !!invoice.period && history.periods.includes(invoice.period);
    if (!earnedAlready && history.subscription_months < months) {
      const index = history.subscription_months + 1;
      lines.push({
        kind: "subscription",
        basis: round2(invoice.subscription),
        amount: commissionOn(invoice.subscription, rate),
        reference: invoice.period,
        month_index: index,
        why: `Month ${index} of ${months} billed months at ${rate}%.`,
      });
    }
    // Nothing else off this invoice. See the module header: where there is a
    // subscription, the subscription is what earns.
    return lines;
  }

  /*
   * One-off work, and only for a client who has never been on a subscription. A client
   * who started on a subscription and later bought a piece of work is a subscription
   * client throughout, even on an invoice where the subscription does not appear - a
   * month they were paused, say.
   */
  if (history.ever_subscribed) return lines;
  if (!withinWindow(history.won_on, invoice.issued_on, months)) return lines;

  const already = new Set(history.assignments);
  for (const line of invoice.one_off) {
    if (line.amount <= 0) continue;
    // An assignment that recurs every year is one commission, not one a year.
    if (already.has(line.assignment_key)) continue;
    already.add(line.assignment_key);
    lines.push({
      kind: "one_off",
      basis: round2(line.amount),
      amount: commissionOn(line.amount, rate),
      reference: line.assignment_key,
      month_index: null,
      why: `One-off work for a client with no subscription, at ${rate}%, once for this assignment.`,
    });
  }

  return lines;
}

/**
 * What a partner is still owed on a client, in plain words.
 *
 * Written for the partner's own screen, where the question is always the same: how much
 * of this is left.
 */
export function describeEntitlement(
  history: Pick<CommissionHistory, "subscription_months" | "ever_subscribed">,
  months: number = COMMISSION_MONTHS,
): string {
  if (!history.ever_subscribed) {
    return "One-off work only, so the commission is the once per assignment.";
  }
  const left = Math.max(months - history.subscription_months, 0);
  if (left === 0) return `All ${months} billed months have been earned.`;
  return `${history.subscription_months} of ${months} billed months earned, ${left} to go. A month the client pauses is not one of them.`;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export function whyNotAProspect(input: {
  business_name?: string;
  contact_email?: string | null;
}): string | null {
  const name = (input.business_name ?? "").trim();
  if (name.length < 2) return "Give the name of the business.";
  if (name.length > 160) return "That name is too long.";
  if (!prospectKey(name)) {
    return "That name has nothing in it to register - give the business's own name.";
  }
  const email = (input.contact_email ?? "").trim();
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return "That does not look like an email address.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Signing the engagement
// ---------------------------------------------------------------------------

/**
 * Whether the name somebody typed into a signature box is the name on their account.
 *
 * Case and spacing are taken out. "ama serwaa" is the same person as "Ama  Serwaa", and
 * refusing over a capital letter teaches people to distrust the box rather than to read
 * what is above it. Anything more than that - initials, a middle name dropped, a married
 * name - is refused, because the point of the box is that the name recorded is the name
 * the firm holds.
 *
 * Here rather than in the Worker so the form can say which name to type before somebody
 * gets it wrong, and so the two cannot disagree about what counts as a match.
 */
export function signatureNameMatches(typed: string, onAccount: string): boolean {
  const squash = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  return squash(typed) === squash(onAccount) && squash(typed).length > 0;
}
