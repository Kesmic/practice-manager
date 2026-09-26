/**
 * Wire types shared between the Worker API and the React client.
 * These mirror the D1 schema in `migrations/`.
 */

import type { PackageService, ServiceInclusion } from "./package-services";
import type {
  ClientStatus,
  EngagementStatus,
  EntityType,
  Priority,
  Recurrence,
  ReviewPointStatus,
  ReviewSeverity,
  RiskRating,
  Role,
  ServiceLine,
  TaskStatus,
} from "./workflow";
import type { StaffAttachment, StaffFileKind } from "./staff-files";
import type {
  AllocationAction,
  AllocationStatus,
  ClientTier,
  DeclineGround,
} from "./allocations";
import type { ContractField, ContractTemplate } from "./contract-fields";
import type {
  CommissionKind,
  CommissionState,
  PartnerState,
  ProspectStage,
} from "./growth-partners";
import type {
  DiscountKind,
  DiscountRun,
  DiscountScope,
  DiscountState,
  Discount,
} from "./discounts";
import type { RemovalAdvice, RemovalFootprint } from "./removal";
import type { ReportDuty, ReportSchedule, ReportState } from "./status-reports";
import type { Stage, StageProgress } from "./onboarding";
import type {
  Criterion,
  ObjectiveStatus,
  OverallOutcome,
  ProbationDecision,
  Rating,
  ReviewKind,
  ReviewStatus,
} from "./performance";
import type {
  DocumentAudience,
  DocumentKind,
  DocumentStatus,
  EmploymentStatus,
  EmploymentType,
  OnboardingProgress,
  PayFrequency,
  SignatureAction,
} from "./hr";
import type { RequestKind, RequestStatus } from "./intake";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  title: string | null;
  status: "active" | "suspended";
  must_change_password: 0 | 1;
  /** Whether this person receives email as well as the in-app inbox. */
  email_notifications: 0 | 1;
  created_at: string;
  last_login_at: string | null;
}

/** Trimmed user record used for assignee/reviewer pickers. */
export interface UserRef {
  id: string;
  full_name: string;
  email: string;
  role: Role;
}

export interface Client {
  id: string;
  code: string;
  name: string;
  entity_type: EntityType;
  tax_id: string | null;
  registration_no: string | null;
  industry: string | null;
  fiscal_year_end: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  risk_rating: RiskRating;
  status: ClientStatus;
  partner_id: string | null;
  manager_id: string | null;
  onboarded_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientSummary extends Client {
  partner_name: string | null;
  manager_name: string | null;
  open_tasks: number;
  overdue_tasks: number;
  engagements: number;
}

/**
 * Something submitted through one of the two public intake links.
 *
 * Every text field here was typed by someone outside the firm, which is why the
 * review screen presents them as a submission to be checked rather than as facts.
 */
export interface ClientRequest {
  id: string;
  reference: string;
  kind: RequestKind;
  status: RequestStatus;
  organisation: string;
  /** What an existing client believes its reference to be. Never matched on. */
  client_ref: string | null;
  /** Set by a person: matched to a file, or created when a new request is accepted. */
  client_id: string | null;
  entity_type: EntityType | null;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  tax_id: string | null;
  registration_no: string | null;
  industry: string | null;
  fiscal_year_end: string | null;
  address: string | null;
  /** Service lines asked for, as submitted. */
  services: ServiceLine[];
  details: string | null;
  preferred_start: string | null;
  handled_by: string | null;
  handled_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientRequestSummary extends ClientRequest {
  /** The matched client's name, once someone has matched it. */
  client_name: string | null;
  client_code: string | null;
  handled_by_name: string | null;
}

export interface Engagement {
  id: string;
  client_id: string;
  code: string;
  name: string;
  /**
   * The engagement's primary service line - the first one chosen, and the one it is
   * filed under. Kept alongside `service_lines` rather than derived from it because it
   * is a stored column, and because a list has to sort on something.
   */
  service_line: ServiceLine;
  /** Every service line this engagement covers, primary first. Never empty. */
  service_lines: ServiceLine[];
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  fee_amount: number | null;
  currency: string;
  budget_hours: number | null;
  status: EngagementStatus;
  partner_id: string | null;
  manager_id: string | null;
  engagement_letter_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface EngagementSummary extends Engagement {
  client_name: string;
  client_code: string;
  partner_name: string | null;
  manager_name: string | null;
  open_tasks: number;
  total_tasks: number;
  logged_hours: number;
}

export interface Task {
  id: string;
  ref: string;
  client_id: string;
  engagement_id: string | null;
  /** The package line this job is delivering, when it is inside what the client pays for. */
  package_service_id: string | null;
  /** The one-off request this job is delivering, when it is work the client asked for. */
  client_service_id: string | null;
  title: string;
  description: string | null;
  service_line: ServiceLine;
  task_type: string | null;
  priority: Priority;
  status: TaskStatus;
  review_round: number;
  assignee_id: string | null;
  reviewer_id: string | null;
  period_label: string | null;
  period_end: string | null;
  planned_start_date: string | null;
  internal_due_date: string | null;
  statutory_due_date: string | null;
  budget_hours: number | null;
  recurrence: Recurrence;
  template_id: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Task plus the joined display fields the list and board views need. */
export interface TaskSummary extends Task {
  client_name: string;
  client_code: string;
  engagement_name: string | null;
  package_service_name: string | null;
  package_service_parent: string | null;
  client_service_name: string | null;
  assignee_name: string | null;
  reviewer_name: string | null;
  open_review_points: number;
  checklist_total: number;
  checklist_done: number;
  logged_hours: number;
}

export interface ChecklistItem {
  id: string;
  task_id: string;
  position: number;
  label: string;
  is_done: 0 | 1;
  mandatory: 0 | 1;
  done_by: string | null;
  done_by_name: string | null;
  done_at: string | null;
}

export interface ReviewRound {
  id: string;
  task_id: string;
  round: number;
  reviewer_id: string;
  reviewer_name: string | null;
  submitted_by: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
  started_at: string;
  decided_at: string | null;
  decision: "approved" | "rework" | null;
  summary: string | null;
}

export interface ReviewPoint {
  id: string;
  task_id: string;
  review_id: string | null;
  round: number;
  seq: number;
  severity: ReviewSeverity;
  body: string;
  reference: string | null;
  status: ReviewPointStatus;
  raised_by: string;
  raised_by_name: string | null;
  raised_at: string;
  response: string | null;
  responded_by: string | null;
  responded_by_name: string | null;
  responded_at: string | null;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  label: string;
  url: string;
  kind: string | null;
  added_by: string | null;
  added_by_name: string | null;
  added_at: string;
}

export interface TimeEntry {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string | null;
  work_date: string;
  hours: number;
  narrative: string | null;
  billable: 0 | 1;
  created_at: string;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  actor_id: string | null;
  actor_name: string | null;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  detail: string | null;
  created_at: string;
}

/** Everything the task detail screen needs, in one round trip. */
export interface TaskDetail {
  task: TaskSummary;
  checklist: ChecklistItem[];
  reviews: ReviewRound[];
  review_points: ReviewPoint[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
  time_entries: TimeEntry[];
  events: TaskEvent[];
}

export interface ChecklistTemplateItem {
  label: string;
  mandatory?: boolean;
}

/**
 * Rule for deriving a statutory due date from a period end.
 * `day` is the day of month; `month_offset` counts months after the period end.
 */
export interface DueDateRule {
  month_offset: number;
  day: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  service_line: ServiceLine;
  task_type: string | null;
  description: string | null;
  default_priority: Priority;
  default_recurrence: Recurrence;
  budget_hours: number | null;
  /** JSON-encoded ChecklistTemplateItem[] on the wire. */
  checklist: ChecklistTemplateItem[];
  /** JSON-encoded DueDateRule or null. */
  due_date_rule: DueDateRule | null;
  /** Days before the statutory date that internal delivery is targeted. */
  internal_lead_days: number;
  active: 0 | 1;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  task_id: string | null;
  task_ref: string | null;
  kind: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export interface DashboardStats {
  assigned_open: number;
  awaiting_my_review: number;
  /**
   * Submitted work with no reviewer named. Practice-wide rather than personal,
   * and reported as 0 to anyone below supervisor grade, who cannot act on it.
   */
  awaiting_a_reviewer: number;
  in_rework: number;
  overdue: number;
  due_this_week: number;
  unread_notifications: number;
}

export interface Dashboard {
  stats: DashboardStats;
  my_tasks: TaskSummary[];
  awaiting_my_review: TaskSummary[];
  awaiting_a_reviewer: TaskSummary[];
  overdue: TaskSummary[];
}

export interface WorkloadRow {
  user_id: string;
  full_name: string;
  role: Role;
  open_tasks: number;
  overdue_tasks: number;
  in_review: number;
  budget_hours: number;
  logged_hours: number;
}

export interface ServiceLineRow {
  service_line: ServiceLine;
  open_tasks: number;
  overdue_tasks: number;
  closed_tasks: number;
  logged_hours: number;
}

export interface ReviewQualityRow {
  user_id: string;
  full_name: string;
  submissions: number;
  rework_rounds: number;
  must_fix_points: number;
  first_pass_rate: number;
}

export interface Reports {
  workload: WorkloadRow[];
  service_lines: ServiceLineRow[];
  review_quality: ReviewQualityRow[];
  status_counts: Array<{ status: TaskStatus; count: number }>;
}

export interface ApiError {
  error: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Employee portal
// ---------------------------------------------------------------------------

export interface EmployeeProfile {
  /**
   * The work email address this person has been given, and the record of handing it
   * over. The portal does not create the mailbox; see shared/staff-email.ts.
   *
   * The temporary password is deliberately absent - it is passed through once and
   * never stored.
   */
  work_email?: string | null;
  work_email_host?: string | null;
  work_email_issued_at?: string | null;
  work_email_issued_to?: string | null;
  user_id: string;
  staff_no: string | null;
  job_title: string | null;
  department: string | null;
  employment_type: EmploymentType;
  employment_status: EmploymentStatus;
  start_date: string | null;
  probation_end_date: string | null;
  confirmed_on: string | null;
  exit_date: string | null;
  line_manager_id: string | null;
  work_location: string | null;
  profile_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Personal details, only ever sent to the employee themselves or to HR. */
export interface EmployeePersonalDetails {
  date_of_birth: string | null;
  gender: string | null;
  marital_status: string | null;
  personal_email: string | null;
  phone: string | null;
  residential_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  next_of_kin_name: string | null;
  next_of_kin_phone: string | null;
  highest_qualification: string | null;
  professional_body: string | null;
  membership_number: string | null;
}

/** Pay and bank details. Partner grade only. */
export interface EmployeeCompensation {
  user_id: string;
  annual_salary: number | null;
  currency: string;
  pay_frequency: PayFrequency;
  bank_name: string | null;
  bank_branch: string | null;
  account_name: string | null;
  account_number: string | null;
  tax_identification_no: string | null;
  social_security_no: string | null;
  notes: string | null;
  updated_at: string;
}

export interface EmployeeSummary extends EmployeeProfile {
  full_name: string;
  email: string;
  role: Role;
  account_status: "active" | "suspended";
  line_manager_name: string | null;
  open_tasks: number;
  overdue_tasks: number;
  outstanding_documents: number;
  onboarding_items_outstanding: number;
}

export interface PortalDocument {
  id: string;
  kind: DocumentKind;
  category: string | null;
  title: string;
  summary: string | null;
  version: number;
  status: DocumentStatus;
  requires_signature: 0 | 1;
  requires_acknowledgement: 0 | 1;
  audience: DocumentAudience;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  effective_from: string | null;
  position: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A document with its text, plus the viewer's own signature state. */
export interface PortalDocumentDetail extends PortalDocument {
  body: string;
  my_signature: DocumentSignature | null;
  /** Signatures across the firm - HR administrators only. */
  signatures?: DocumentSignature[];
  /** Employees who have not yet responded - HR administrators only. */
  outstanding?: Array<{ user_id: string; full_name: string }>;
}

export interface DocumentSignature {
  id: string;
  document_id: string;
  document_title?: string;
  version: number;
  user_id: string;
  user_name?: string | null;
  action: SignatureAction;
  typed_name: string;
  content_hash: string;
  signed_at: string;
  /**
   * The specimen signature used, if one was.
   *
   * Null for everything signed before signatures were held, and for every
   * acknowledgement - a handbook policy is acknowledged rather than signed. Null also
   * where the specimen has since been deleted: the signature record survives losing
   * its picture, because the evidence around it stands on its own.
   */
  signature_id?: string | null;
}

export interface OnboardingItem {
  id: string;
  user_id: string;
  position: number;
  label: string;
  detail: string | null;
  owner: "employee" | "hr";
  category: string | null;
  /** Which stage of the programme this belongs to. Null on programmes created before
   *  stages existed, which then render as one undated list. */
  stage: Stage | null;
  /** When it falls due, computed from the start date when the programme was created. */
  due_date: string | null;
  is_done: 0 | 1;
  done_at: string | null;
  done_by_name: string | null;
}

export interface EmployeeDocument {
  id: string;
  user_id: string;
  label: string;
  category: string | null;
  url: string;
  visible_to_employee: 0 | 1;
  expires_on: string | null;
  added_by_name: string | null;
  added_at: string;
}

export interface HrEvent {
  id: string;
  subject_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  kind: string;
  detail: string | null;
  created_at: string;
}

/** Everything the employee's own onboarding screen needs. */
export interface MyOnboarding {
  welcome_message: string;
  md_name: string;
  md_title: string;
  firm_name: string;
  profile: EmployeeProfile | null;
  personal: EmployeePersonalDetails | null;
  missing_profile_fields: string[];
  /** The documents this person has attached, by kind. Absent kinds are null. */
  attachments?: Partial<Record<StaffFileKind, StaffAttachment | null>>;
  items: OnboardingItem[];
  /** Documents awaiting the viewer's signature or acknowledgement. */
  outstanding_documents: PortalDocument[];
  completed_documents: Array<PortalDocument & { signed_at: string; action: SignatureAction }>;
  progress: OnboardingProgress;
  /** Every stage of the programme, with its dates and counts. */
  stages: StageProgress[];
  /** Which stage this person has actually got to. */
  current_stage: Stage | null;
  /** True once nothing the first sign-in asks for is outstanding. */
  first_run_complete: boolean;
  missing_bank_fields: string[];
  bank: Record<string, string | null> | null;
  employment_type: string | null;
  /** Which contract template applies to this engagement. */
  contract_template: string;
}

/** The full personnel file, assembled for the HR employee screen. */
export interface EmployeeFile {
  /** The documents this person attached, by kind. Null where the reader may not see them. */
  attachments?: Partial<Record<StaffFileKind, StaffAttachment | null>> | null;
  user: User;
  profile: EmployeeProfile | null;
  personal: EmployeePersonalDetails | null;
  compensation: EmployeeCompensation | null;
  onboarding: OnboardingItem[];
  documents: EmployeeDocument[];
  signatures: DocumentSignature[];
  outstanding_documents: PortalDocument[];
  events: HrEvent[];
  progress: OnboardingProgress;
}

export interface FirmSettings {
  firm_name: string;
  firm_website: string;
  md_name: string;
  md_title: string;
  welcome_message: string;
  /** The firm's logo as a data URI, or "" to use the built-in mark. */
  logo_data_url: string;
  /**
   * The same logo drawn in light ink, for the navy sidebar and sign-in panel.
   * "" means there is only one, and the portal plates the main logo instead.
   */
  logo_dark_data_url: string;
  /** Six-digit hex, or "" for the default. Recolours the whole interface. */
  primary_color: string;
  secondary_color: string;
}

// ---------------------------------------------------------------------------
// Performance reviews
// ---------------------------------------------------------------------------

/** A review as it appears in a list on somebody's file. */
export interface ReviewSummary {
  id: string;
  kind: ReviewKind;
  status: ReviewStatus;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  overall: OverallOutcome | null;
  probation_decision: ProbationDecision | null;
  reviewer_signed_at: string | null;
  employee_signed_at: string | null;
  completed_at: string | null;
  created_at: string;
  reviewer_name: string | null;
}

export interface ReviewRating {
  criterion: string;
  rating: Rating | null;
  comment: string | null;
}

export interface ReviewObjective {
  id: string;
  objective: string;
  target_date: string | null;
  status: ObjectiveStatus;
  assessment?: string | null;
  position: number;
  source_review_id?: string | null;
  assessed_in_id?: string | null;
}

/** One review in full, as the review screen reads it. */
export interface ReviewDetail extends ReviewSummary {
  subject_id: string;
  subject_name: string;
  subject_role: Role;
  reviewer_id: string | null;
  strengths: string | null;
  development: string | null;
  reviewer_comments: string | null;
  employee_comments: string | null;
  probation_extend_to: string | null;
  shared_at: string | null;
  updated_at: string;
  /** The criteria that apply at this person's grade. */
  criteria: Criterion[];
  ratings: ReviewRating[];
  objectives: ReviewObjective[];
}

// ---------------------------------------------------------------------------
// Contract details
// ---------------------------------------------------------------------------

/**
 * One placeholder in a contract template, as the details screen reads it: the
 * registry's description of the field, plus what it currently resolves to for this
 * person and where that value came from.
 */
export interface ResolvedContractField extends ContractField {
  value: string | null;
  origin: "person" | "record" | "firm" | "fallback" | null;
  /**
   * The value exists but is above the reader's grade. Only pay is ever restricted, and
   * only from HR administrators below Partner - who need to know the salary field is
   * filled, not what it says.
   */
  restricted: boolean;
  /**
   * Nobody has to chase this one. It is among the things asked at first sign-in, so it
   * answers itself the first time the person signs in.
   */
  awaiting_employee: boolean;
}

export interface ContractDetails {
  template: ContractTemplate;
  employment_type: EmploymentType;
  fields: ResolvedContractField[];
  /** How many placeholders would still be brackets if the contract were issued today. */
  outstanding: number;
  /** How many of those the person themselves will answer at first sign-in. */
  awaiting_employee: number;
}

/** What a freshly issued copy of a template still needs, reported when it is created. */
export interface ContractMergeResult {
  filled: string[];
  outstanding: string[];
  awaiting_employee: string[];
  /** Placeholders no merge field was ever going to fill: the schedules, and the dates. */
  manual: string[];
}

// ---------------------------------------------------------------------------
// Status reports
// ---------------------------------------------------------------------------

/** A deliverable named in a status report, with whatever was said about it. */
export interface StatusReportTask {
  id: string;
  ref: string;
  title: string;
  status: TaskStatus;
  client_name: string;
  note: string | null;
  /** The earlier of the internal target and the statutory deadline. */
  due_on?: string | null;
  /**
   * 1 where that deadline has gone by. Overdue work must be answered before a report
   * can be filed - the server checks it too, so the form is not the only guard.
   */
  overdue?: 0 | 1;
}

export interface StatusReport {
  id: string;
  user_id?: string;
  /** The reporting day this answers for, not the day it was written. */
  due_on: string;
  /** The first day it covers. Stored, so a later change of schedule cannot re-date it. */
  period_from: string;
  body: string;
  blockers: string | null;
  submitted_at: string;
  updated_at: string;
  tasks: StatusReportTask[];
}

/** Everything the person's own status-report screen needs, in one round trip. */
export interface StatusReportView {
  schedule: ReportSchedule;
  state: ReportState;
  /** What the firm has decided about this person. */
  duty: ReportDuty;
  /** Whether they owe reports at all today. */
  owes: boolean;
  /** The reporting day currently being answered for. */
  due_on: string | null;
  period_from: string | null;
  next_due_on: string | null;
  /** Reporting days that passed without a report, since this person arrived. */
  missed: string[];
  /** The current report, where it has already been written. */
  current: StatusReport | null;
  /** Their own live work, for the reference picker. */
  tasks: StatusReportTask[];
  recent: StatusReport[];
}

/** One person, and whether the firm asks them for status reports. */
export interface ReportDutyRow {
  id: string;
  full_name: string;
  role: Role;
  title: string | null;
  open_tasks: number;
  duty: ReportDuty;
  /** What the setting means for them today - the thing being decided about. */
  owes: boolean;
}

export interface TeamStatusReports {
  schedule: ReportSchedule;
  due_on: string | null;
  period_from: string | null;
  outstanding: number;
  people: Array<{
    id: string;
    full_name: string;
    role: Role;
    open_tasks: number;
    duty: ReportDuty;
    report_id: string | null;
    report?: StatusReport;
  }>;
}

// ---------------------------------------------------------------------------
// Client allocations
// ---------------------------------------------------------------------------

/**
 * One client offered to, or held by, one person.
 *
 * `available_actions` is computed on the server from the same rules the screen would
 * apply, so a button that appears is one the API will accept - and, more importantly,
 * one that does not appear is one nobody can reach by guessing the URL.
 */
export interface ClientAllocation {
  id: string;
  client_id: string;
  client_name: string;
  client_code: string;
  user_id: string;
  user_name: string;
  tier: ClientTier | null;
  status: AllocationStatus;
  offered_by: string | null;
  offered_by_name: string | null;
  offered_at: string;
  note: string | null;
  responded_at: string | null;
  decline_ground: DeclineGround | null;
  decline_reason: string | null;
  ended_at: string | null;
  ended_note: string | null;
  available_actions: AllocationAction[];
}

// ---------------------------------------------------------------------------
// Removing somebody
// ---------------------------------------------------------------------------

/**
 * What removing one person would cost, read before the decision rather than after.
 *
 * `blocked` is non-null where the removal cannot happen at all - your own account, an
 * account senior to you, the last administrator - so the screen says why before anybody
 * types a confirmation rather than at the point of failure.
 */
export interface RemovalPreview {
  user: {
    id: string;
    full_name: string;
    email: string;
    role: Role;
    status: string;
  };
  footprint: RemovalFootprint;
  advice: RemovalAdvice;
  blocked: string | null;
  /** The exact words that have to be typed: the person's own name. */
  confirmation: string;
}


// ---------------------------------------------------------------------------
// Tools and certifications
// ---------------------------------------------------------------------------

export interface PracticeTool {
  id: string;
  name: string;
  category: string | null;
  sign_in_url: string | null;
  position: number;
}

export interface ToolCertification {
  id: string;
  tool_id: string;
  name: string;
  course_url: string | null;
  validity_months: number | null;
  requires_certificate: number;
}

export interface ToolCatalogue {
  tools: PracticeTool[];
  certifications: ToolCertification[];
}

export interface StaffToolLogin {
  tool_id: string;
  username: string;
  issued_at: string | null;
  issued_to: string | null;
}

/** One person's progress on one certification, as the screens receive it. */
export interface StaffCertification {
  id: string;
  certification_id: string;
  certification_name: string;
  tool_name: string;
  course_url: string | null;
  validity_months: number | null;
  requires_certificate: number;
  progress: "assigned" | "in_progress" | "certified";
  due_on: string | null;
  completed_on: string | null;
  expires_on: string | null;
  filename: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  last_reminded_at: string | null;
}

export interface TrainingView {
  tools: PracticeTool[];
  logins: StaffToolLogin[];
  certifications: StaffCertification[];
  /** The server's day, so a screen open past midnight does not disagree with it. */
  today: string;
}

export interface TrainingOverview {
  people: Array<{ id: string; full_name: string; role: Role }>;
  certifications: Array<{
    id: string;
    name: string;
    tool_name: string;
    validity_months: number | null;
  }>;
  progress: Array<{
    id: string;
    user_id: string;
    certification_id: string;
    progress: "assigned" | "in_progress" | "certified";
    due_on: string | null;
    completed_on: string | null;
    expires_on: string | null;
  }>;
  today: string;
}

// ---------------------------------------------------------------------------
// Subscriptions, invoices, and the client's own portal
// ---------------------------------------------------------------------------

import type {
  Assessment,
  Ceiling,
  Criterion as SubscriptionCriterion,
  FeeBasis,
  Figure,
  ServiceState,
} from "./subscriptions";
import type { InvoiceState, Standing, TaxBasis, Totals } from "./invoices";

export interface TierRow {
  tier: ClientTier;
  monthly_fee: number | null;
  /** A starting price below the list price, for the smallest businesses. Null means no range. */
  fee_from: number | null;
  /** A line under the price saying who gets the lower end. */
  fee_note: string | null;
  currency: string;
  summary: string | null;
  /** Who the package is for, in the proposal's own words. */
  ideal_for: string | null;
  position: number;
  active: 0 | 1;
}

/** One line of what a package includes. Sub-items hang off `parent_id`. */
export interface TierInclusion {
  id: string;
  tier: ClientTier;
  label: string;
  parent_id: string | null;
  position: number;
}

export interface AdditionalService {
  id: string;
  name: string;
  summary: string | null;
  fee: number | null;
  fee_basis: FeeBasis;
  currency: string;
  service_line: string | null;
  active: 0 | 1;
  position: number;
}

export interface SubscriptionCatalogue {
  criteria: SubscriptionCriterion[];
  tiers: TierRow[];
  ceilings: Ceiling[];
  services: AdditionalService[];
  /**
   * What each package includes, one row per package per service, with the heading of
   * any included sub-service brought along. Derived from `package_services` and
   * `service_inclusions`; kept in this shape because the package cards and the
   * proposal read it.
   */
  inclusions: TierInclusion[];
  /** The firm's services and sub-services, the catalogue the packages pick from. */
  package_services: PackageService[];
  /** Which package includes which service, as chosen - without implied headings. */
  service_inclusions: ServiceInclusion[];
}

/** A service or sub-service a client gets on top of their package. */
export interface ClientExtraRow {
  id: string;
  service_id: string;
  name: string;
  parent_name: string | null;
  /** The cheapest package that includes it, which is what it is named for. */
  from_tier: ClientTier | null;
  note: string | null;
  granted_at: string;
  granted_by_name: string | null;
  ended_at: string | null;
  ended_reason: string | null;
}

/** A client's subscription with the fee already resolved against the tier. */
export interface ResolvedSubscription {
  client_id: string;
  tier: ClientTier;
  monthly_fee: number | null;
  currency: string;
  started_on: string;
  status: "active" | "paused" | "ended";
  ended_on?: string | null;
  note?: string | null;
  /** What they actually pay: their own rate if set, otherwise the tier's. */
  fee: number | null;
  negotiated: boolean;
}

export interface SubscriptionRow extends ResolvedSubscription {
  client_name: string;
  client_code: string;
  partner_name: string | null;
  figures: Figure[];
  assessment: Assessment;
}

export interface SubscriptionsOverview extends SubscriptionCatalogue {
  subscriptions: SubscriptionRow[];
}

export interface ClientServiceRow {
  id: string;
  name: string;
  status: ServiceState;
  quoted_fee: number | null;
  currency: string;
  note: string | null;
  requested_at: string | null;
  quoted_at: string | null;
  decided_at: string | null;
  delivered_at: string | null;
  requested_by_name?: string | null;
}

export interface ClientLoginRow {
  id: string;
  email: string;
  full_name: string;
  status: "invited" | "active" | "suspended";
  invited_at: string | null;
  accepted_at: string | null;
  last_login_at: string | null;
}

export interface SubscriptionEventRow {
  id: string;
  kind: string;
  from_tier: ClientTier | null;
  to_tier: ClientTier | null;
  from_fee: number | null;
  to_fee: number | null;
  detail: string | null;
  created_at: string;
  actor_name: string | null;
}

/**
 * A discount as a screen reads it. The live one is the row with status 'active'; the
 * rest are the trail, which is why they are never deleted.
 */
export interface ClientDiscountRow {
  id: string;
  kind: DiscountKind;
  value: number;
  applies_to: DiscountScope;
  runs: DiscountRun;
  invoice_count: number | null;
  until_on: string | null;
  used_count: number;
  reason: string | null;
  status: DiscountState;
  created_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  granted_by_name: string | null;
  ended_by_name: string | null;
}

export interface ClientSubscriptionDetail extends SubscriptionCatalogue {
  /** What this client has bought, as opposed to the menu on `services`. */
  client_services: ClientServiceRow[];
  subscription: ResolvedSubscription | null;
  figures: Figure[];
  figure_history: Array<Figure & { recorded_by_name: string | null }>;
  assessment: Assessment | null;
  history: SubscriptionEventRow[];
  logins: ClientLoginRow[];
  /** The live discount first, then the ones that have run their course. */
  discounts: ClientDiscountRow[];
  /** Services from other packages given to this client, live first. */
  extras: ClientExtraRow[];
}

/** What a job for this client can be covered by: their package's lines, or their own requests. */
export interface WorkCover {
  subscription: { tier: ClientTier; label: string } | null;
  included: Array<{ id: string; name: string; parent_name: string | null; note: string | null; extra: boolean }>;
  services: Array<{ id: string; name: string; status: ServiceState }>;
}

// --------------------------------------------------------------------- tax

export interface TaxLineRow {
  id: string;
  name: string;
  rate: number;
  basis: TaxBasis;
  position: number;
  active: 0 | 1;
}

// ----------------------------------------------------------------- invoices

export interface InvoiceSummary {
  id: string;
  number: string;
  client_id: string;
  client_name: string;
  client_code: string;
  state: InvoiceState;
  issued_on: string | null;
  due_on: string;
  currency: string;
  net: number;
  tax_total: number;
  gross: number;
  /** What the client was asked to pay: the total, less anything withheld on its face. */
  balance_due: number;
  withholding_amount: number;
  /** Taken off before tax, so `net` is already net of it. Zero when there was none. */
  discount_amount: number;
  discount_label: string | null;
  period_label: string | null;
  reminders_sent: number;
  last_reminder_at: string | null;
  standing: Standing;
}

export interface InvoiceList {
  invoices: InvoiceSummary[];
  totals: { outstanding: number; overdue: number; awaiting_certificate: number };
}

export interface InvoiceLineRow {
  id: string;
  description: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  source: "subscription" | "service" | "manual";
  subscription_period: string | null;
  /** A fee (1) or a reimbursable passed on at cost (0). Absent on rows a client reads. */
  taxable?: 0 | 1;
}

export interface InvoiceTaxRow {
  name: string;
  rate: number;
  basis?: TaxBasis;
  amount: number;
}

export interface InvoicePaymentRow {
  id: string;
  amount: number;
  withheld: number;
  paid_on: string;
  method: string | null;
  reference: string | null;
  note?: string | null;
  certificate_received: 0 | 1;
  certificate_ref: string | null;
  recorded_by_name?: string | null;
  recorded_at?: string;
}

export interface InvoiceReminderRow {
  step: number;
  days_late: number;
  sent_to: string;
  automatic: 0 | 1;
  sent_at: string;
}

/** One email about an invoice, to one person, with what became of it. */
export interface InvoiceEmailRow {
  id: string;
  kind: "issued" | "resent" | "due_today" | "overdue";
  recipient_email: string;
  recipient_name: string | null;
  cc: string | null;
  status: "sent" | "failed";
  error: string | null;
  automatic: 0 | 1;
  sent_at: string;
  opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  clicked_at: string | null;
  click_count: number;
  /** What it said. Empty for emails sent before wording could be edited. */
  subject: string | null;
  body: string | null;
  attached: 0 | 1;
  sent_by_name: string | null;
}

/** The email an invoice is about to go out with, for the send screen to edit. */
export interface InvoiceEmailDraft {
  kind: "issued" | "resent" | "due_today" | "overdue";
  /** For an overdue reminder: which on the schedule, and how late the invoice is. */
  chasing: { step: number; days_late: number } | null;
  /** Whether this person may make the wording the firm's standard (a Partner). */
  can_save_wording: boolean;
  from_name: string;
  reply_to: string | null;
  /** Whether the portal can send email at all. */
  email_ready: boolean;
  contacts: Array<{ email: string; full_name: string }>;
  cc: string[];
  wording: { subject: string; message: string };
  standard: { subject: string; message: string };
  /** Whether the firm has saved wording of its own in place of the standard. */
  firm_wording: boolean;
  facts: { number: string; firm_name: string; amount_due: string; due_on: string };
  attachment_name: string;
  limits: { subject: number; message: number };
}

/** An invoice email as edited on the send screen. */
export interface InvoiceEmailComposed {
  to: string[];
  cc: string[];
  subject: string;
  message: string;
  attach: boolean;
  save_wording: boolean;
}

/** A client user looking at the invoice in the portal, grouped by person and kind. */
export interface InvoiceViewRow {
  full_name: string | null;
  email: string | null;
  what: "page" | "download";
  first_at: string;
  last_at: string;
  times: number;
}

/**
 * Something done to an invoice that nothing else records: a cancellation, a return to
 * draft, and the date of an earlier issue that going back to draft cleared.
 */
export interface InvoiceEventRow {
  kind: "issued" | "cancelled" | "redrafted";
  detail: string | null;
  at: string;
  actor_name: string | null;
}

export interface InvoiceDetail {
  invoice: InvoiceSummary & {
    note: string | null;
    created_at: string;
    created_by_name: string | null;
    sent_at: string | null;
    voided_at: string | null;
    void_reason: string | null;
  };
  lines: InvoiceLineRow[];
  taxes: InvoiceTaxRow[];
  payments: InvoicePaymentRow[];
  reminders: InvoiceReminderRow[];
  emails: InvoiceEmailRow[];
  views: InvoiceViewRow[];
  events: InvoiceEventRow[];
  standing: Standing;
}

// -------------------------------------------------------- the client portal

export interface ClientPortalUser {
  id: string;
  email: string;
  full_name: string;
  client_name: string;
  client_code: string;
}

/**
 * What a client is told about a discount on their account: what comes off, of what,
 * and for how long. Not who granted it or why - the reason is the firm's note to
 * itself, and can say things like "goodwill after the late filing".
 */
export type ClientFacingDiscount = Pick<
  Discount,
  "kind" | "value" | "applies_to" | "runs" | "invoice_count" | "until_on" | "used_count"
>;

export interface ClientPortalSubscription {
  client: { name: string; code: string };
  /** The live discount on the account, if there is one. */
  discount: ClientFacingDiscount | null;
  /** The firm's services, so the page can draw what this client gets as one tree. */
  package_services: PackageService[];
  service_inclusions: ServiceInclusion[];
  /** What they get on top of their package, live only. */
  extras: Array<Pick<ClientExtraRow, "id" | "service_id" | "name" | "parent_name" | "from_tier">>;
  criteria: SubscriptionCriterion[];
  tiers: TierRow[];
  ceilings: Ceiling[];
  inclusions: TierInclusion[];
  available: AdditionalService[];
  subscription: ResolvedSubscription | null;
  figures: Array<Figure & { recorded_by_name: string | null }>;
  assessment: Assessment | null;
  services: ClientServiceRow[];
}

export interface ClientInvoiceList {
  invoices: Array<{
    id: string;
    number: string;
    state: InvoiceState;
    issued_on: string | null;
    due_on: string;
    currency: string;
    net: number;
    tax_total: number;
    gross: number;
    balance_due: number;
    withholding_amount: number;
    discount_amount: number;
    discount_label: string | null;
    period_label: string | null;
    standing: Standing;
  }>;
  statement: { outstanding: number; overdue: number; count: number };
}

export interface ClientInvoiceDetail {
  invoice: {
    id: string;
    number: string;
    state: InvoiceState;
    issued_on: string | null;
    due_on: string;
    currency: string;
    net: number;
    tax_total: number;
    gross: number;
    balance_due: number;
    withholding_amount: number;
    discount_amount: number;
    discount_label: string | null;
    period_label: string | null;
    note: string | null;
  };
  lines: InvoiceLineRow[];
  taxes: InvoiceTaxRow[];
  payments: InvoicePaymentRow[];
  standing: Standing;
}

/** Re-exported so screens import one place for the shapes they render. */
export type { Totals };


// ------------------------------------------------- growth partners

/** A growth partner as their own portal knows them. */
export interface PartnerSelf {
  id: string;
  email: string;
  full_name: string;
  business_name: string | null;
  /** Their own terms, not the firm's current standard ones. */
  commission_rate: number;
  commission_months: number;
  hold_days: number;
  agreement_signed_at: string | null;
}

export interface ProspectRow {
  id: string;
  business_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  sector: string | null;
  note: string | null;
  stage: ProspectStage;
  registered_on: string;
  hold_until: string;
  hold_extension_note: string | null;
  client_id: string | null;
  won_on: string | null;
  lost_reason: string | null;
}

export interface ProposalRow {
  id: string;
  prospect_id: string;
  reference: string;
  status: "draft" | "sent" | "accepted" | "declined" | "withdrawn";
  tier: ClientTier | null;
  currency: string;
  monthly_fee: number | null;
  discount: number;
  sent_at: string | null;
  viewed_at: string | null;
  decided_at: string | null;
}

export interface CommissionRow {
  id: string;
  client_id: string | null;
  prospect_id?: string | null;
  kind: CommissionKind;
  month_index: number | null;
  reference: string | null;
  basis: number;
  rate: number;
  currency: string;
  amount: number;
  status: CommissionState;
  created_at: string;
  approved_at?: string | null;
  paid_at: string | null;
  paid_reference?: string | null;
  cancelled_reason?: string | null;
  client_name?: string | null;
  invoice_number?: string | null;
  issued_on?: string | null;
}

export interface PartnerPipeline {
  prospects: ProspectRow[];
  proposals: ProposalRow[];
  commissions: CommissionRow[];
  terms: { rate: number; months: number; hold_days: number };
  today: string;
}

export interface PartnerStatement {
  commissions: CommissionRow[];
  totals: Record<string, { earned: number; approved: number; paid: number }>;
  entitlements: Array<{
    client_id: string;
    client_name: string;
    months_earned: number;
    ever_subscribed: boolean;
    description: string;
  }>;
  terms: { rate: number; months: number };
}

/** A growth partner as the firm sees them. */
export interface GrowthPartnerRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  status: PartnerState;
  note: string | null;
  commission_rate: number;
  commission_months: number;
  hold_days: number;
  agreement_signed_at: string | null;
  applied_at: string;
  approved_at: string | null;
  last_login_at: string | null;
  has_password: 0 | 1;
}

export interface GrowthPartnerOverview {
  partners: GrowthPartnerRow[];
  prospects: Array<ProspectRow & { partner_id: string; client_name: string | null }>;
  commissions: Array<CommissionRow & { partner_id: string }>;
  today: string;
}
