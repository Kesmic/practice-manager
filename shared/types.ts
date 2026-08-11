/**
 * Wire types shared between the Worker API and the React client.
 * These mirror the D1 schema in `migrations/`.
 */

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
  service_line: ServiceLine;
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
}

export interface OnboardingItem {
  id: string;
  user_id: string;
  position: number;
  label: string;
  detail: string | null;
  owner: "employee" | "hr";
  category: string | null;
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
  items: OnboardingItem[];
  /** Documents awaiting the viewer's signature or acknowledgement. */
  outstanding_documents: PortalDocument[];
  completed_documents: Array<PortalDocument & { signed_at: string; action: SignatureAction }>;
  progress: OnboardingProgress;
}

/** The full personnel file, assembled for the HR employee screen. */
export interface EmployeeFile {
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
