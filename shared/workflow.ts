/**
 * Practice workflow engine.
 *
 * This module is the single source of truth for the deliverable lifecycle. The
 * Worker imports it to authorise every transition server-side; the React app
 * imports it to decide which buttons to show. Neither may hard-code its own
 * copy of these rules.
 *
 * The lifecycle mirrors the prepare / review / clear-comments / sign-off cycle
 * used in accounting, tax and regulatory compliance practices: a preparer works
 * a deliverable, submits it, a reviewer of higher grade raises review points,
 * the preparer clears each point and resubmits, and only once every point is
 * disposed of can the deliverable be approved and closed.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = [
  "associate",
  "senior_associate",
  "manager",
  "partner",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

/** Higher rank = more authority. Used for all "at least this grade" checks. */
export const ROLE_RANK: Record<Role, number> = {
  associate: 10,
  senior_associate: 20,
  manager: 30,
  partner: 40,
  admin: 50,
};

export const ROLE_LABELS: Record<Role, string> = {
  associate: "Associate",
  senior_associate: "Senior Associate",
  manager: "Manager",
  partner: "Partner",
  admin: "System Administrator",
};

export function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Grades permitted to review work. */
export const MIN_REVIEWER_ROLE: Role = "senior_associate";

/** Grades permitted to create/assign work and close approved deliverables. */
export const MIN_SUPERVISOR_ROLE: Role = "manager";

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  "draft",
  "not_started",
  "in_progress",
  "awaiting_client",
  "on_hold",
  "submitted",
  "under_review",
  "rework",
  "approved",
  "closed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  draft: "Draft",
  not_started: "Not started",
  in_progress: "In progress",
  awaiting_client: "Awaiting client",
  on_hold: "On hold",
  submitted: "Submitted for review",
  under_review: "Under review",
  rework: "Rework required",
  approved: "Approved",
  closed: "Closed",
  cancelled: "Cancelled",
};

/** Tailwind classes for status pills, kept next to the statuses themselves. */
export const STATUS_STYLES: Record<TaskStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  not_started: "bg-slate-100 text-slate-700 ring-slate-200",
  in_progress: "bg-blue-50 text-blue-700 ring-blue-200",
  awaiting_client: "bg-amber-50 text-amber-800 ring-amber-200",
  on_hold: "bg-amber-50 text-amber-800 ring-amber-200",
  submitted: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  under_review: "bg-violet-50 text-violet-700 ring-violet-200",
  rework: "bg-rose-50 text-rose-700 ring-rose-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  closed: "bg-slate-200 text-slate-700 ring-slate-300",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
};

/** Statuses that represent live work - everything not finished or abandoned. */
export const OPEN_STATUSES: TaskStatus[] = [
  "draft",
  "not_started",
  "in_progress",
  "awaiting_client",
  "on_hold",
  "submitted",
  "under_review",
  "rework",
  "approved",
];

/** Statuses where the deliverable sits with the preparer. */
export const WITH_PREPARER: TaskStatus[] = [
  "not_started",
  "in_progress",
  "awaiting_client",
  "on_hold",
  "rework",
];

/** Statuses where the deliverable sits with the reviewer. */
export const WITH_REVIEWER: TaskStatus[] = ["submitted", "under_review"];

export function isOpen(status: TaskStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const WORKFLOW_ACTIONS = [
  "activate",
  "start",
  "await_client",
  "hold",
  "resume",
  "submit",
  "resubmit",
  "recall",
  "begin_review",
  "request_rework",
  "approve",
  "close",
  "reopen",
  "cancel",
] as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

/** Who, relative to the deliverable, may fire an action. */
export type ActorKind =
  | "assignee" // the preparer of record
  | "reviewer" // the named reviewer
  | "supervisor" // manager grade or above
  | "any_reviewer_grade"; // anyone of senior associate grade or above

export interface TransitionRule {
  action: WorkflowAction;
  from: TaskStatus[];
  to: TaskStatus;
  /** Any one of these actor kinds is sufficient. */
  allow: ActorKind[];
  label: string;
  /** Short help text shown on the action button. */
  hint: string;
  /**
   * When true the actor must NOT be the deliverable's assignee. This enforces
   * segregation of duties - nobody signs off their own work, at any grade.
   */
  forbidSelfReview?: boolean;
  /** When true the UI collects a mandatory note before firing. */
  requiresNote?: boolean;
  /** Visual weight of the button in the UI. */
  intent?: "primary" | "danger" | "neutral";
}

export const TRANSITIONS: TransitionRule[] = [
  {
    action: "activate",
    from: ["draft"],
    to: "not_started",
    allow: ["supervisor"],
    label: "Release to associate",
    hint: "Publish this draft deliverable so the assigned associate can begin.",
    intent: "primary",
  },
  {
    action: "start",
    from: ["not_started"],
    to: "in_progress",
    allow: ["assignee", "supervisor"],
    label: "Start work",
    hint: "Mark the deliverable as being actively worked on.",
    intent: "primary",
  },
  {
    action: "await_client",
    from: ["in_progress", "not_started", "rework"],
    to: "awaiting_client",
    allow: ["assignee", "supervisor"],
    label: "Awaiting client",
    hint: "Pause the clock because information is outstanding from the client.",
    requiresNote: true,
    intent: "neutral",
  },
  {
    action: "hold",
    from: ["in_progress", "not_started", "rework"],
    to: "on_hold",
    allow: ["assignee", "supervisor"],
    label: "Place on hold",
    hint: "Suspend the deliverable for an internal reason.",
    requiresNote: true,
    intent: "neutral",
  },
  {
    action: "resume",
    from: ["awaiting_client", "on_hold"],
    to: "in_progress",
    allow: ["assignee", "supervisor"],
    label: "Resume work",
    hint: "The blocker is cleared - put the deliverable back into progress.",
    intent: "primary",
  },
  {
    action: "submit",
    from: ["in_progress"],
    to: "submitted",
    allow: ["assignee", "supervisor"],
    label: "Submit for review",
    hint: "Hand the completed deliverable to the reviewer.",
    intent: "primary",
  },
  {
    // The way out of rework: every review point has been answered and the
    // deliverable goes back to the reviewer for the next round.
    action: "resubmit",
    from: ["rework"],
    to: "submitted",
    allow: ["assignee", "supervisor"],
    label: "Resubmit for review",
    hint: "Return the corrected deliverable to the reviewer. Every must-fix review point needs a response first.",
    intent: "primary",
  },
  {
    action: "recall",
    from: ["submitted"],
    to: "in_progress",
    allow: ["assignee", "supervisor"],
    label: "Recall submission",
    hint: "Withdraw the submission before the reviewer has picked it up.",
    requiresNote: true,
    intent: "neutral",
  },
  {
    action: "begin_review",
    from: ["submitted"],
    to: "under_review",
    allow: ["reviewer", "any_reviewer_grade"],
    label: "Begin review",
    hint: "Take up the review and open a new review round.",
    forbidSelfReview: true,
    intent: "primary",
  },
  {
    action: "request_rework",
    from: ["under_review"],
    to: "rework",
    allow: ["reviewer", "any_reviewer_grade"],
    label: "Return for rework",
    hint: "Issue your review points and send the deliverable back to the preparer.",
    forbidSelfReview: true,
    requiresNote: true,
    intent: "danger",
  },
  {
    action: "approve",
    from: ["under_review"],
    to: "approved",
    allow: ["reviewer", "any_reviewer_grade"],
    label: "Approve",
    hint: "Sign the deliverable off. All must-fix review points have to be disposed of first.",
    forbidSelfReview: true,
    intent: "primary",
  },
  {
    action: "close",
    from: ["approved"],
    to: "closed",
    allow: ["supervisor"],
    label: "Close deliverable",
    hint: "Record final delivery to the client and close the file.",
    intent: "primary",
  },
  {
    action: "reopen",
    from: ["closed", "cancelled"],
    to: "in_progress",
    allow: ["supervisor"],
    label: "Reopen",
    hint: "Reopen a closed or cancelled deliverable. Partner grade or above.",
    requiresNote: true,
    intent: "danger",
  },
  {
    action: "cancel",
    from: [
      "draft",
      "not_started",
      "in_progress",
      "awaiting_client",
      "on_hold",
      "submitted",
      "under_review",
      "rework",
    ],
    to: "cancelled",
    allow: ["supervisor"],
    label: "Cancel",
    hint: "Abandon the deliverable. It stays on file for audit purposes.",
    requiresNote: true,
    intent: "danger",
  },
];

/** `reopen` is deliberately partner-only, above the generic supervisor bar. */
const ACTION_MIN_ROLE: Partial<Record<WorkflowAction, Role>> = {
  reopen: "partner",
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** The minimum slice of a task the engine needs in order to decide. */
export interface WorkflowTask {
  status: TaskStatus;
  assignee_id: string | null;
  reviewer_id: string | null;
}

export interface WorkflowActor {
  id: string;
  role: Role;
}

/** Review-point counts, needed for the resubmission and approval gates. */
export interface ReviewGateCounts {
  /** Must-fix points with no preparer response yet. */
  unansweredMustFix: number;
  /** Must-fix points not yet resolved or waived by a reviewer. */
  unresolvedMustFix: number;
}

/** Checklist counts, needed for the submission gate. */
export interface ChecklistGateCounts {
  mandatoryOutstanding: number;
}

export interface GateContext {
  review?: ReviewGateCounts;
  checklist?: ChecklistGateCounts;
}

export type Denial = { allowed: false; reason: string };
export type Permission = { allowed: true } | Denial;

export function findTransition(
  action: WorkflowAction,
  status: TaskStatus,
): TransitionRule | undefined {
  return TRANSITIONS.find((t) => t.action === action && t.from.includes(status));
}

/**
 * First submission and resubmission after rework are the same event as far as
 * the workflow gates and the review-round counter are concerned.
 */
export function isSubmission(action: WorkflowAction): boolean {
  return action === "submit" || action === "resubmit";
}

function actorMatches(
  kind: ActorKind,
  task: WorkflowTask,
  actor: WorkflowActor,
): boolean {
  switch (kind) {
    case "assignee":
      return task.assignee_id === actor.id;
    case "reviewer":
      return task.reviewer_id === actor.id;
    case "supervisor":
      return atLeast(actor.role, MIN_SUPERVISOR_ROLE);
    case "any_reviewer_grade":
      return atLeast(actor.role, MIN_REVIEWER_ROLE);
  }
}

/**
 * Decide whether `actor` may fire `action` on `task`.
 *
 * Gate counts are optional: omit them and the structural rules (status, role,
 * segregation of duties) are still applied, but the review-point and checklist
 * gates are skipped. The Worker always passes them; the UI passes what it has
 * loaded so buttons can be disabled with an explanation.
 */
export function can(
  action: WorkflowAction,
  task: WorkflowTask,
  actor: WorkflowActor,
  gates: GateContext = {},
): Permission {
  const rule = findTransition(action, task.status);
  if (!rule) {
    return {
      allowed: false,
      reason: `"${action}" is not available from status "${STATUS_LABELS[task.status]}".`,
    };
  }

  const minRole = ACTION_MIN_ROLE[action];
  if (minRole && !atLeast(actor.role, minRole)) {
    return {
      allowed: false,
      reason: `Restricted to ${ROLE_LABELS[minRole]} grade and above.`,
    };
  }

  if (!rule.allow.some((kind) => actorMatches(kind, task, actor))) {
    return {
      allowed: false,
      reason: describeAllowance(rule),
    };
  }

  if (rule.forbidSelfReview && task.assignee_id && task.assignee_id === actor.id) {
    return {
      allowed: false,
      reason:
        "You prepared this deliverable, so you cannot review it. Segregation of duties requires a different reviewer.",
    };
  }

  if (isSubmission(action)) {
    if (gates.checklist) {
      const outstanding = gates.checklist.mandatoryOutstanding;
      if (outstanding > 0) {
        return {
          allowed: false,
          reason: `${outstanding} mandatory checklist ${
            outstanding === 1 ? "step is" : "steps are"
          } still outstanding.`,
        };
      }
    }
    if (gates.review) {
      // Nothing goes back to the reviewer with a must-fix point unanswered.
      const unanswered = gates.review.unansweredMustFix;
      if (unanswered > 0) {
        return {
          allowed: false,
          reason: `${unanswered} must-fix review ${
            unanswered === 1 ? "point has" : "points have"
          } no response yet.`,
        };
      }
    }
  }

  if (action === "approve" && gates.review) {
    const unresolved = gates.review.unresolvedMustFix;
    if (unresolved > 0) {
      return {
        allowed: false,
        reason: `${unresolved} must-fix review ${
          unresolved === 1 ? "point is" : "points are"
        } not yet resolved or waived.`,
      };
    }
  }

  return { allowed: true };
}

function describeAllowance(rule: TransitionRule): string {
  const parts = rule.allow.map((kind) => {
    switch (kind) {
      case "assignee":
        return "the assigned associate";
      case "reviewer":
        return "the named reviewer";
      case "supervisor":
        return `${ROLE_LABELS[MIN_SUPERVISOR_ROLE]} grade or above`;
      case "any_reviewer_grade":
        return `${ROLE_LABELS[MIN_REVIEWER_ROLE]} grade or above`;
    }
  });
  const unique = [...new Set(parts)];
  return `Only ${unique.join(" or ")} may do this.`;
}

/** Every action currently offerable on a task, with per-action availability. */
export function availableActions(
  task: WorkflowTask,
  actor: WorkflowActor,
  gates: GateContext = {},
): Array<{ rule: TransitionRule; permission: Permission }> {
  return TRANSITIONS.filter((t) => t.from.includes(task.status)).map((rule) => ({
    rule,
    permission: can(rule.action, task, actor, gates),
  }));
}

// ---------------------------------------------------------------------------
// Review points
// ---------------------------------------------------------------------------

export const REVIEW_SEVERITIES = ["must_fix", "should_fix", "observation"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const SEVERITY_LABELS: Record<ReviewSeverity, string> = {
  must_fix: "Must fix",
  should_fix: "Should fix",
  observation: "Observation",
};

export const SEVERITY_STYLES: Record<ReviewSeverity, string> = {
  must_fix: "bg-rose-50 text-rose-700 ring-rose-200",
  should_fix: "bg-amber-50 text-amber-800 ring-amber-200",
  observation: "bg-slate-100 text-slate-600 ring-slate-200",
};

export const REVIEW_POINT_STATUSES = [
  "open",
  "addressed",
  "resolved",
  "waived",
] as const;
export type ReviewPointStatus = (typeof REVIEW_POINT_STATUSES)[number];

export const REVIEW_POINT_STATUS_LABELS: Record<ReviewPointStatus, string> = {
  open: "Open",
  addressed: "Addressed - awaiting reviewer",
  resolved: "Resolved",
  waived: "Waived",
};

export const REVIEW_POINT_STATUS_STYLES: Record<ReviewPointStatus, string> = {
  open: "bg-rose-50 text-rose-700 ring-rose-200",
  addressed: "bg-blue-50 text-blue-700 ring-blue-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  waived: "bg-slate-100 text-slate-600 ring-slate-200",
};

/** A review point is disposed of once a reviewer has resolved or waived it. */
export function isDisposed(status: ReviewPointStatus): boolean {
  return status === "resolved" || status === "waived";
}

// ---------------------------------------------------------------------------
// Practice reference data
// ---------------------------------------------------------------------------

export const SERVICE_LINES = [
  "audit_assurance",
  "tax_compliance",
  "tax_advisory",
  "regulatory_filing",
  "bookkeeping",
  "payroll",
  "company_secretarial",
  "advisory",
] as const;
export type ServiceLine = (typeof SERVICE_LINES)[number];

export const SERVICE_LINE_LABELS: Record<ServiceLine, string> = {
  audit_assurance: "Audit & Assurance",
  tax_compliance: "Tax Compliance",
  tax_advisory: "Tax Advisory",
  regulatory_filing: "Regulatory Filing",
  bookkeeping: "Bookkeeping & Accounts",
  payroll: "Payroll",
  company_secretarial: "Company Secretarial",
  advisory: "Advisory & Consulting",
};

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_STYLES: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-600 ring-slate-200",
  normal: "bg-slate-100 text-slate-700 ring-slate-200",
  high: "bg-amber-50 text-amber-800 ring-amber-200",
  urgent: "bg-rose-50 text-rose-700 ring-rose-200",
};

export const ENTITY_TYPES = [
  "company",
  "individual",
  "partnership",
  "trust",
  "ngo",
  "branch",
  "public_sector",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  company: "Limited company",
  individual: "Individual",
  partnership: "Partnership",
  trust: "Trust",
  ngo: "NGO / Not-for-profit",
  branch: "External company / branch",
  public_sector: "Public sector",
};

export const CLIENT_STATUSES = ["prospect", "active", "dormant", "exited"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  dormant: "Dormant",
  exited: "Exited",
};

export const RISK_RATINGS = ["low", "medium", "high"] as const;
export type RiskRating = (typeof RISK_RATINGS)[number];

export const ENGAGEMENT_STATUSES = [
  "planned",
  "active",
  "on_hold",
  "completed",
  "cancelled",
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const ENGAGEMENT_STATUS_LABELS: Record<EngagementStatus, string> = {
  planned: "Planned",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const RECURRENCES = [
  "none",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: "One-off",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Half-yearly",
  annual: "Annual",
};
