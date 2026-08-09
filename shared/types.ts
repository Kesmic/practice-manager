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

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  title: string | null;
  status: "active" | "suspended";
  must_change_password: 0 | 1;
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
  in_rework: number;
  overdue: number;
  due_this_week: number;
  unread_notifications: number;
}

export interface Dashboard {
  stats: DashboardStats;
  my_tasks: TaskSummary[];
  awaiting_my_review: TaskSummary[];
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
