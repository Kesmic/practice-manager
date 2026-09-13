/**
 * What a new joiner goes through, in the order it happens and with the dates attached.
 *
 * Two things this module exists to fix.
 *
 * **A flat list tells nobody when.** The programme was sixteen unordered steps, so a new
 * joiner could see what was coming but not whether it was due on Monday or in March, and
 * the firm could not tell whether somebody was behind. Every step now belongs to a stage,
 * and every stage has a point in time relative to the person's start date.
 *
 * **One programme cannot serve two kinds of engagement.** An employee is registered for
 * PAYE and SSNIT; an Associate Consultant invoices and settles their own. Running the
 * same checklist over both means either asking a contractor to do something that does not
 * apply, or leaving an employee's payroll registration off a list nobody checks again.
 *
 * Everything else is common to both, deliberately. Both sign a contract, both are paid
 * and so both give bank details, both acknowledge the handbook, both complete the
 * independence declaration, and both get objectives set and a first review diarised.
 */

import type { EmploymentType } from "./hr";

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export const STAGES = [
  "before_start",
  "first_signin",
  "first_week",
  "first_month",
  "first_review",
] as const;
export type Stage = (typeof STAGES)[number];

export interface StageSpec {
  label: string;
  /** What this stage is for, in the person's own terms. */
  detail: string;
  /**
   * Working days from the start date by which the stage should be done. Negative means
   * before they arrive. Null means it is pinned to the probation or first-review date
   * rather than to a fixed offset.
   */
  offsetDays: number | null;
  /** How the timing reads on screen when there is no start date to count from. */
  whenLabel: string;
}

export const STAGE_SPECS: Record<Stage, StageSpec> = {
  before_start: {
    label: "Before you start",
    detail:
      "Things the firm does so that everything is ready on your first morning. Nothing here is yours to do.",
    offsetDays: -1,
    whenLabel: "Before your first day",
  },
  first_signin: {
    label: "Your first sign-in",
    detail:
      "Everything we need from you before you can get to work. It is asked once, and all of it is required.",
    offsetDays: 0,
    whenLabel: "On your first day",
  },
  first_week: {
    label: "Your first week",
    detail:
      "Reading and signing what you are agreeing to, and being shown how the firm works.",
    offsetDays: 5,
    whenLabel: "Within your first week",
  },
  first_month: {
    label: "Your first month",
    detail: "The compliance obligations that come with the work, once you have started it.",
    offsetDays: 30,
    whenLabel: "Within your first month",
  },
  first_review: {
    label: "Your first review",
    detail:
      "Objectives set at the start, and the review that judges them at the end of the period.",
    offsetDays: null,
    whenLabel: "At the end of your probation or onboarding period",
  },
};

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export interface OnboardingStep {
  label: string;
  detail?: string;
  /** Whose step it is: the new joiner's, or the firm's. */
  owner: "employee" | "hr";
  category: string;
  stage: Stage;
}

/**
 * Common to every kind of engagement.
 *
 * Written once and shared rather than duplicated per type, so a step added here reaches
 * everybody and the two programmes cannot silently drift apart.
 */
const COMMON: OnboardingStep[] = [
  // --------------------------------------------------------- before you start
  {
    label: "Issue the contract",
    detail: "Completed from the right template and addressed to this person alone.",
    owner: "hr",
    category: "Contract",
    stage: "before_start",
  },
  {
    label: "Take up references",
    owner: "hr",
    category: "Checks",
    stage: "before_start",
  },
  {
    label: "Create system accounts and assign access",
    detail: "Portal account, email, accounting and tax software, document store.",
    owner: "hr",
    category: "Setup",
    stage: "before_start",
  },
  {
    label: "Assign a buddy and book the first-week introductions",
    owner: "hr",
    category: "Setup",
    stage: "before_start",
  },

  // ---------------------------------------------------------- first sign-in
  {
    label: "Choose your own password",
    detail:
      "The one you were given is temporary and reaches nothing else until you replace it.",
    owner: "employee",
    category: "Access",
    stage: "first_signin",
  },
  {
    label: "Set up two-step sign-in, if your grade requires it",
    detail: "An authenticator app, plus recovery codes to keep somewhere safe.",
    owner: "employee",
    category: "Access",
    stage: "first_signin",
  },
  {
    label: "Give your personal and emergency contact details",
    owner: "employee",
    category: "Your details",
    stage: "first_signin",
  },
  {
    label: "Give your bank details",
    detail: "So you can be paid. Visible to Partners only.",
    owner: "employee",
    category: "Your details",
    stage: "first_signin",
  },
  {
    label: "Give your identification and right-to-work details",
    owner: "employee",
    category: "Your details",
    stage: "first_signin",
  },
  {
    label: "Give your qualifications and professional membership",
    owner: "employee",
    category: "Your details",
    stage: "first_signin",
  },

  // ------------------------------------------------------------- first week
  {
    label: "Read the welcome message from the Managing Director",
    owner: "employee",
    category: "Welcome",
    stage: "first_week",
  },
  {
    label: "Read and sign your contract",
    detail: "Read it in full before signing. Ask a Partner about anything unclear.",
    owner: "employee",
    category: "Contract",
    stage: "first_week",
  },
  {
    label: "Read and acknowledge every policy in the handbook",
    detail:
      "Each is acknowledged separately, so the record shows what you agreed to and when.",
    owner: "employee",
    category: "Handbook",
    stage: "first_week",
  },
  {
    label: "Verify identification and right-to-work documents",
    owner: "hr",
    category: "Checks",
    stage: "first_week",
  },
  {
    label: "Hold the induction on firm systems and the review process",
    owner: "hr",
    category: "Induction",
    stage: "first_week",
  },

  // ------------------------------------------------------------ first month
  {
    label: "Complete the annual independence declaration",
    detail:
      "Confirms no undisclosed interest, relationship or position involving a client.",
    owner: "employee",
    category: "Compliance",
    stage: "first_month",
  },

  // ----------------------------------------------------------- first review
  {
    label: "Set objectives and diarise the first review",
    owner: "hr",
    category: "Performance",
    stage: "first_review",
  },
  {
    label: "Hold the first review and record its outcome",
    owner: "hr",
    category: "Performance",
    stage: "first_review",
  },
];

/** The one step that differs: how the person's tax and pension are handled. */
const EMPLOYED_ONLY: OnboardingStep[] = [
  {
    label: "Register for payroll and statutory deductions",
    detail: "PAYE with the GRA, and SSNIT Tier 1 and Tier 2.",
    owner: "hr",
    category: "Setup",
    stage: "before_start",
  },
];

const ENGAGED_ONLY: OnboardingStep[] = [
  {
    label: "Confirm tax registration and invoicing arrangements",
    detail:
      "An Associate Consultant settles their own tax and pension. Confirm their GRA registration and TIN, and agree how invoices are submitted. No PAYE is operated and no SSNIT contribution is made; withholding tax is deducted at source.",
    owner: "hr",
    category: "Setup",
    stage: "before_start",
  },
];

/**
 * Which engagement types are contracts *for* services rather than of service.
 *
 * The distinction decides one step of the programme, and the contract template the firm
 * issues at the first one. Everything else is the same for both, which is the point: an
 * Associate is still paid, still signs a contract, still acknowledges the conduct
 * standards, and still gets objectives and a review.
 */
export function isEngagedNotEmployed(type: EmploymentType): boolean {
  return type === "contractor" || type === "consultant";
}

/** The programme for one kind of engagement, in the order it happens. */
export function programmeFor(type: EmploymentType): OnboardingStep[] {
  const specific = isEngagedNotEmployed(type) ? ENGAGED_ONLY : EMPLOYED_ONLY;
  return [...COMMON, ...specific].sort(
    (a, b) => stageIndex(a.stage) - stageIndex(b.stage),
  );
}

/** Which contract template applies. Used to label the step and guide whoever issues it. */
export function contractTemplateFor(type: EmploymentType): string {
  return isEngagedNotEmployed(type)
    ? "Associate Consultant Agreement"
    : "Contract of Employment";
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * When a stage falls due, given a start date.
 *
 * Returns null where there is nothing to count from, which is the honest answer: a
 * person whose start date has not been recorded has no dates, and inventing one from
 * today would put every step in the past the moment the record is opened.
 */
export function stageDueDate(
  stage: Stage,
  startDate: string | null | undefined,
  probationEnd?: string | null,
): string | null {
  if (stage === "first_review") return probationEnd ?? null;
  if (!startDate) return null;

  const spec = STAGE_SPECS[stage];
  if (spec.offsetDays === null) return null;

  const base = Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  return new Date(base + spec.offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface StageProgress {
  stage: Stage;
  /** Every step in the stage, the firm's as well as the person's. */
  total: number;
  done: number;
  /** Only the steps this person has to do themselves. */
  own_total: number;
  own_done: number;
  /** Complete when every step in it is done, and there is at least one. */
  complete: boolean;
  due: string | null;
}

/**
 * How far through the programme somebody is, stage by stage.
 *
 * "Where they have got to" is the first stage that is not finished, rather than the last
 * one with anything ticked - because a person who has done one step of their first week
 * while their first sign-in is still outstanding has not reached their first week.
 */
export function stageProgress(
  items: Array<{ stage: string | null; is_done: 0 | 1 | boolean; owner?: string }>,
  startDate?: string | null,
  probationEnd?: string | null,
): { stages: StageProgress[]; current: Stage | null } {
  const isDone = (i: { is_done: 0 | 1 | boolean }) => i.is_done === 1 || i.is_done === true;

  const stages = STAGES.map((stage) => {
    const inStage = items.filter((i) => i.stage === stage);
    const own = inStage.filter((i) => i.owner === "employee");
    return {
      stage,
      total: inStage.length,
      done: inStage.filter(isDone).length,
      own_total: own.length,
      own_done: own.filter(isDone).length,
      complete: inStage.length > 0 && inStage.every(isDone),
      due: stageDueDate(stage, startDate, probationEnd),
    };
  });

  /*
   * "Where you have got to" is measured by the person's own steps, not the firm's.
   *
   * Measuring it across everything would tell a new joiner on their first morning that
   * they are at "Before you start" - a stage made entirely of things the firm does - and
   * leave them looking for something to act on that was never theirs. Where they have
   * nothing left outstanding anywhere, the answer is the first stage the firm has not
   * finished, which is the honest "waiting on us".
   */
  const current =
    stages.find((s) => s.own_total > 0 && s.own_done < s.own_total)?.stage ??
    stages.find((s) => s.total > 0 && !s.complete)?.stage ??
    null;

  return { stages, current };
}
