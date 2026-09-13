/**
 * Probation and annual performance reviews.
 *
 * The single source of truth for what a review is made of and who may do what to it,
 * imported by both the Worker and the browser, in the same way `workflow.ts` governs
 * deliverables. A button appears exactly when the server would permit the action.
 *
 * ## What a review is for, and what it is evidence of
 *
 * Two different things, and the design follows the second. A review is a conversation
 * about somebody's work, which mostly happens away from a screen. What the portal holds
 * is the record of it - and that record has to be good enough to rely on at the moment
 * it matters, which is never during a good year. It matters when somebody is not
 * confirmed at the end of probation, when a promotion goes to one of two candidates, or
 * when a dismissal is challenged. A record that was written generously to avoid an
 * awkward conversation is worth nothing at all in any of those.
 *
 * So the shape here is deliberately uncomfortable in one specific way: the rating scale
 * has no middle. Five-point scales collapse into everybody getting the middle box, which
 * records nothing and helps nobody - least of all the person, who learns where they
 * stand only when it is too late to act on it.
 *
 * ## The employee's half
 *
 * A review is not finished when the reviewer has written it. It is sent to the person,
 * who reads it, adds their own comments and signs. Their comments are theirs: nobody
 * else can edit them, and they are kept whether they agree or not. A performance record
 * with only one voice in it is a record of what one person thought, and is treated as
 * such by anyone who later has to weigh it.
 */

import { ROLE_RANK, type Role } from "./workflow";

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

export const REVIEW_KINDS = ["probation", "annual", "interim"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const REVIEW_KIND_LABELS: Record<ReviewKind, string> = {
  probation: "Probation review",
  annual: "Annual review",
  interim: "Interim review",
};

export const REVIEW_KIND_HINTS: Record<ReviewKind, string> = {
  probation:
    "Held before the end of the probationary period, and decides whether the person is confirmed in post.",
  annual: "The yearly review of performance and objectives.",
  interim:
    "Held between annual reviews, usually to follow up on something that needed attention.",
};

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

/**
 * What everybody is rated against.
 *
 * Written for an accounting practice rather than adapted from a generic appraisal form:
 * these are the things that decide whether work can be relied on and whether a client
 * keeps the firm. `minimum` restricts a criterion to the grades it applies to - rating
 * an Associate on supervising juniors would be rating them on a job they do not have.
 */
export interface Criterion {
  key: string;
  label: string;
  /** What a reviewer is actually being asked to judge. Shown beside the rating. */
  detail: string;
  /** Lowest grade this applies to. Absent means everybody. */
  minimum?: Role;
}

export const CRITERIA: readonly Criterion[] = [
  {
    key: "technical",
    label: "Technical competence",
    detail:
      "Accuracy of the work, grasp of the standards and legislation it rests on, and knowing the limits of their own knowledge.",
  },
  {
    key: "review_quality",
    label: "Quality of submitted work",
    detail:
      "How much rework their deliverables need. Consider the review points raised against them and whether the same ones recur.",
  },
  {
    key: "deadlines",
    label: "Meeting deadlines",
    detail:
      "Statutory filings and internal targets met, and whether slippage is flagged early or discovered late.",
  },
  {
    key: "client_handling",
    label: "Client handling",
    detail:
      "Responsiveness, judgement about what to answer and what to escalate, and how the client would describe dealing with them.",
  },
  {
    key: "judgement",
    label: "Professional judgement",
    detail:
      "Recognising when something does not look right, and raising it rather than working around it.",
  },
  {
    key: "conduct",
    label: "Conduct and reliability",
    detail:
      "Ethical standards, confidentiality, independence obligations, and being where they said they would be.",
  },
  {
    key: "supervision",
    label: "Supervision and review of others",
    detail:
      "Quality of the reviews they give, and whether the people they supervise improve.",
    minimum: "senior_associate",
  },
  {
    key: "development",
    label: "Development and initiative",
    detail:
      "Progress against last period's objectives, professional study, and taking work on without being pushed.",
  },
];

/** The criteria that apply at a given grade. */
export function criteriaFor(role: Role): Criterion[] {
  return CRITERIA.filter(
    (c) => !c.minimum || ROLE_RANK[role] >= ROLE_RANK[c.minimum],
  );
}

export function criterionByKey(key: string): Criterion | undefined {
  return CRITERIA.find((c) => c.key === key);
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

/**
 * Four points, and no middle.
 *
 * A five-point scale in a small firm becomes everybody scoring three, which records
 * nothing, tells the person nothing they can act on, and is worth nothing when a
 * decision actually turns on it. Four forces the reviewer to decide which side of the
 * line somebody falls on, which is the only judgement a review is really asking for.
 */
export const RATINGS = ["below", "meets", "strong", "outstanding"] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABELS: Record<Rating, string> = {
  below: "Below expectation",
  meets: "Meets expectation",
  strong: "Strong",
  outstanding: "Outstanding",
};

export const RATING_HINTS: Record<Rating, string> = {
  below: "Falls short of what the grade requires. Say what has to change, and by when.",
  meets: "Does the job of the grade properly and dependably.",
  strong: "Consistently above what the grade requires.",
  outstanding: "Exceptional, and evidenced. Reserve it for work you would point at.",
};

export const RATING_STYLES: Record<Rating, string> = {
  below: "bg-rose-50 text-rose-700 ring-rose-200",
  meets: "bg-slate-100 text-slate-700 ring-slate-200",
  strong: "bg-blue-50 text-blue-700 ring-blue-200",
  outstanding: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export const RATING_SCORE: Record<Rating, number> = {
  below: 1,
  meets: 2,
  strong: 3,
  outstanding: 4,
};

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

export const OVERALL_OUTCOMES = [
  "below",
  "meets",
  "strong",
  "outstanding",
] as const;
export type OverallOutcome = (typeof OVERALL_OUTCOMES)[number];

/** What a probation review decides. Only meaningful on a probation review. */
export const PROBATION_DECISIONS = ["confirm", "extend", "not_confirmed"] as const;
export type ProbationDecision = (typeof PROBATION_DECISIONS)[number];

export const PROBATION_DECISION_LABELS: Record<ProbationDecision, string> = {
  confirm: "Confirm in post",
  extend: "Extend probation",
  not_confirmed: "Do not confirm",
};

export const PROBATION_DECISION_HINTS: Record<ProbationDecision, string> = {
  confirm: "The person has met what the role requires and is confirmed.",
  extend:
    "Not yet, but reachable. Requires an end date and objectives that say plainly what has to change.",
  not_confirmed:
    "The person will not be confirmed. Take advice before recording this, and make sure what was said at the review matches what is written here.",
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Three states, and the middle one is the point.
 *
 * `draft` is the reviewer writing, visible to nobody else - half-written judgements
 * about a colleague should not be readable while they are still being formed.
 * `shared` is the review with the person, who can read it and add their own comments.
 * `complete` is after they have signed, and nothing in it can be changed afterwards.
 */
export const REVIEW_STATUSES = ["draft", "shared", "complete"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Being written",
  shared: "With the employee",
  complete: "Complete",
};

export const REVIEW_STATUS_STYLES: Record<ReviewStatus, string> = {
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  shared: "bg-amber-50 text-amber-800 ring-amber-200",
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

/** Objectives carry to the next review, so they have a state of their own. */
export const OBJECTIVE_STATUSES = ["open", "met", "partly_met", "not_met"] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

export const OBJECTIVE_STATUS_LABELS: Record<ObjectiveStatus, string> = {
  open: "Open",
  met: "Met",
  partly_met: "Partly met",
  not_met: "Not met",
};

// ---------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------

/** The minimum grade that may write a review at all. */
export const MIN_REVIEWER_GRADE: Role = "manager";

export interface ReviewActor {
  id: string;
  role: Role;
}

export interface ReviewSubject {
  /** The person being reviewed. */
  id: string;
  /** Their line manager, where one is recorded. */
  line_manager_id: string | null;
}

/**
 * Whether somebody may write or amend a review of this person.
 *
 * Their line manager, or anybody at HR administration grade. Manager grade alone is not
 * enough for somebody else's report: a manager in another part of the firm has no
 * standing to record a judgement about a person they do not work with.
 *
 * And nobody reviews themselves, at any grade, for the same reason nobody signs off
 * their own deliverable. This one has no override either - a partner who needs their own
 * review recorded gets it from another partner.
 */
export function canReview(
  actor: ReviewActor,
  subject: ReviewSubject,
  isHrAdmin: boolean,
): boolean {
  if (actor.id === subject.id) return false;
  if (isHrAdmin) return true;
  return (
    subject.line_manager_id === actor.id &&
    ROLE_RANK[actor.role] >= ROLE_RANK[MIN_REVIEWER_GRADE]
  );
}

/**
 * Whether somebody may read this review.
 *
 * The person themselves - but only once it has been shared with them, because a draft is
 * a judgement still being formed. Otherwise, whoever may write it.
 *
 * Peers cannot, whatever their grade. A performance record is one of the two or three
 * most sensitive things the portal holds, and "Manager grade" is not a need to know.
 */
export function canReadReview(
  actor: ReviewActor,
  subject: ReviewSubject,
  status: ReviewStatus,
  isHrAdmin: boolean,
): boolean {
  if (actor.id === subject.id) return status !== "draft";
  return canReview(actor, subject, isHrAdmin);
}

/** What is missing before a review can be put in front of the person. */
export function describeShareProblem(review: {
  kind: ReviewKind;
  overall: OverallOutcome | null;
  ratings: Array<{ criterion: string; rating: Rating | null }>;
  applicable: Criterion[];
  probation_decision: ProbationDecision | null;
  probation_extend_to: string | null;
}): string | null {
  const unrated = review.applicable.filter(
    (c) => !review.ratings.find((r) => r.criterion === c.key && r.rating),
  );
  if (unrated.length) {
    return `Rate every criterion first. Still to do: ${unrated
      .map((c) => c.label)
      .join(", ")}.`;
  }
  if (!review.overall) return "Choose an overall outcome.";

  if (review.kind === "probation") {
    if (!review.probation_decision) {
      return "A probation review has to decide whether the person is confirmed.";
    }
    if (review.probation_decision === "extend" && !review.probation_extend_to) {
      return "Extending probation needs a date for the person to work towards.";
    }
  }
  return null;
}
