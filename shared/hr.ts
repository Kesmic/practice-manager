/**
 * Employee portal domain: employment records, onboarding and portal documents.
 *
 * Like `workflow.ts`, this is imported by both the Worker and the React app so
 * that the access rules the server enforces are the same ones the UI reflects.
 */

import { ROLE_RANK, type Role } from "./workflow";

// ---------------------------------------------------------------------------
// Access thresholds
// ---------------------------------------------------------------------------

/** May browse the staff directory and see employment details (not personal). */
export const MIN_DIRECTORY_ROLE: Role = "manager";

/** May maintain employment records, onboarding and portal documents. */
export const MIN_HR_ADMIN_ROLE: Role = "partner";

/**
 * May see pay and bank details. Kept separate from HR administration so the
 * threshold can be raised without touching anything else.
 */
export const MIN_COMPENSATION_ROLE: Role = "partner";

export function isHrAdmin(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_HR_ADMIN_ROLE];
}

export function canSeeCompensation(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_COMPENSATION_ROLE];
}

export function canSeeDirectory(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_DIRECTORY_ROLE];
}

/**
 * Personal details - date of birth, home address, next of kin - are visible to
 * the employee themselves and to HR administrators only. A line manager has no
 * working need for them, so they do not get them.
 */
export function canSeePersonalDetails(
  viewer: { id: string; role: Role },
  subjectUserId: string,
): boolean {
  return viewer.id === subjectUserId || isHrAdmin(viewer.role);
}

// ---------------------------------------------------------------------------
// Employment reference data
// ---------------------------------------------------------------------------

export const EMPLOYMENT_TYPES = [
  "permanent",
  "fixed_term",
  "probation",
  "intern",
  "contractor",
  "consultant",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  permanent: "Permanent",
  fixed_term: "Fixed term",
  probation: "Probationary",
  intern: "Intern",
  contractor: "Contractor",
  consultant: "Consultant",
};

export const EMPLOYMENT_STATUSES = [
  "onboarding",
  "probation",
  "active",
  "notice",
  "exited",
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  onboarding: "Onboarding",
  probation: "On probation",
  active: "Active",
  notice: "Working notice",
  exited: "Exited",
};

export const EMPLOYMENT_STATUS_STYLES: Record<EmploymentStatus, string> = {
  onboarding: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  probation: "bg-amber-50 text-amber-800 ring-amber-200",
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  notice: "bg-rose-50 text-rose-700 ring-rose-200",
  exited: "bg-slate-100 text-slate-500 ring-slate-200",
};

export const PAY_FREQUENCIES = ["monthly", "fortnightly", "weekly", "hourly"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
  monthly: "Monthly",
  fortnightly: "Fortnightly",
  weekly: "Weekly",
  hourly: "Hourly",
};

export const DEPARTMENTS = [
  "Audit & Assurance",
  "Tax",
  "Accounting & Outsourcing",
  "Advisory",
  "Company Secretarial",
  "Operations",
  "Finance & Administration",
] as const;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_KINDS = [
  "contract",
  "policy",
  "handbook",
  "notice",
  "form",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  contract: "Contract",
  policy: "Policy",
  handbook: "Handbook section",
  notice: "Notice",
  form: "Form / template",
};

export const DOCUMENT_STATUSES = ["draft", "published", "archived"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export const DOCUMENT_STATUS_STYLES: Record<DocumentStatus, string> = {
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  published: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  archived: "bg-slate-100 text-slate-500 ring-slate-200",
};

export const DOCUMENT_AUDIENCES = ["all", "individual"] as const;
export type DocumentAudience = (typeof DOCUMENT_AUDIENCES)[number];

/** A signature is a stronger act than an acknowledgement, and is labelled so. */
export type SignatureAction = "acknowledged" | "signed";

export function requiredAction(doc: {
  requires_signature: 0 | 1;
  requires_acknowledgement: 0 | 1;
}): SignatureAction | null {
  if (doc.requires_signature === 1) return "signed";
  if (doc.requires_acknowledgement === 1) return "acknowledged";
  return null;
}

export const ACTION_VERB: Record<SignatureAction, string> = {
  signed: "Sign",
  acknowledged: "Acknowledge",
};

export const ACTION_DONE: Record<SignatureAction, string> = {
  signed: "Signed",
  acknowledged: "Acknowledged",
};

/**
 * Wording shown immediately above the signature box. Deliberately explicit
 * about what the person is agreeing to, because a vague confirmation is worth
 * very little as evidence.
 */
export const ATTESTATION: Record<SignatureAction, string> = {
  signed:
    "I confirm that I have read and understood this document in full, that I agree to be bound by its terms, and that typing my full name below constitutes my signature.",
  acknowledged:
    "I confirm that I have read and understood this policy, and that I agree to comply with it.",
};

// ---------------------------------------------------------------------------
// Onboarding programme
// ---------------------------------------------------------------------------

export interface OnboardingSeedItem {
  label: string;
  detail?: string;
  owner: "employee" | "hr";
  category: string;
}

/**
 * The standard onboarding programme, created for every new joiner. HR-owned
 * items are the firm's side of setting someone up; employee-owned items are the
 * new joiner's. Document signing and acknowledgement are tracked separately
 * through `documents`, so they are not duplicated here.
 */
export const ONBOARDING_PROGRAMME: OnboardingSeedItem[] = [
  {
    label: "Read the welcome message from the Managing Director",
    owner: "employee",
    category: "Welcome",
  },
  {
    label: "Complete your personal and emergency contact details",
    detail:
      "We need these before your first day so that payroll and emergency contact records are correct.",
    owner: "employee",
    category: "Your details",
  },
  {
    label: "Provide your bank details for payroll",
    detail: "Give these to a partner directly - they are recorded on your file, not entered here.",
    owner: "employee",
    category: "Your details",
  },
  {
    label: "Provide identification and right-to-work documents",
    detail: "National identification, and any permit required to work.",
    owner: "employee",
    category: "Your details",
  },
  {
    label: "Provide certificates of qualification and professional membership",
    owner: "employee",
    category: "Your details",
  },
  {
    label: "Sign your contract of employment",
    detail: "Read it in full before signing. Ask a partner about anything unclear.",
    owner: "employee",
    category: "Contract",
  },
  {
    label: "Read and acknowledge every policy in the Employee Handbook",
    detail: "Each policy is acknowledged separately so the record shows what you agreed to and when.",
    owner: "employee",
    category: "Handbook",
  },
  {
    label: "Complete the annual independence declaration",
    owner: "employee",
    category: "Compliance",
  },
  { label: "Issue contract of employment", owner: "hr", category: "Contract" },
  { label: "Verify identification and right-to-work documents", owner: "hr", category: "Checks" },
  { label: "Take up references", owner: "hr", category: "Checks" },
  {
    label: "Create system accounts and assign access",
    detail: "Portal account, email, accounting and tax software, document store.",
    owner: "hr",
    category: "Setup",
  },
  { label: "Register for payroll and statutory deductions", owner: "hr", category: "Setup" },
  { label: "Assign a buddy and book the first-week introductions", owner: "hr", category: "Setup" },
  {
    label: "Hold the first-week induction on firm systems and the review process",
    owner: "hr",
    category: "Induction",
  },
  {
    label: "Set probation objectives and diarise the probation review",
    owner: "hr",
    category: "Induction",
  },
];

// ---------------------------------------------------------------------------
// Onboarding progress
// ---------------------------------------------------------------------------

export interface OnboardingProgress {
  items_total: number;
  items_done: number;
  documents_total: number;
  documents_done: number;
  profile_complete: boolean;
  /** 0–1 across checklist items, documents, and the profile as one unit. */
  fraction: number;
  complete: boolean;
}

export function computeProgress(input: {
  items_total: number;
  items_done: number;
  documents_total: number;
  documents_done: number;
  profile_complete: boolean;
}): OnboardingProgress {
  const total = input.items_total + input.documents_total + 1;
  const done =
    input.items_done + input.documents_done + (input.profile_complete ? 1 : 0);
  const fraction = total === 0 ? 1 : done / total;
  return {
    ...input,
    fraction,
    complete: done >= total,
  };
}

/**
 * Fields a new joiner must supply before their profile counts as complete.
 * Used both to gate onboarding and to drive the "still needed" list in the UI.
 */
export const REQUIRED_PROFILE_FIELDS = [
  "phone",
  "residential_address",
  "date_of_birth",
  "emergency_contact_name",
  "emergency_contact_phone",
] as const;

export const PROFILE_FIELD_LABELS: Record<string, string> = {
  phone: "Mobile number",
  residential_address: "Residential address",
  date_of_birth: "Date of birth",
  emergency_contact_name: "Emergency contact name",
  emergency_contact_phone: "Emergency contact number",
  emergency_contact_relationship: "Relationship to emergency contact",
  personal_email: "Personal email",
  next_of_kin_name: "Next of kin",
  next_of_kin_phone: "Next of kin number",
  gender: "Gender",
  marital_status: "Marital status",
  highest_qualification: "Highest qualification",
  professional_body: "Professional body",
  membership_number: "Membership number",
};

export function missingProfileFields(
  profile: Record<string, unknown> | null,
): string[] {
  if (!profile) return [...REQUIRED_PROFILE_FIELDS];
  return REQUIRED_PROFILE_FIELDS.filter((field) => {
    const value = profile[field];
    return value === null || value === undefined || value === "";
  });
}
