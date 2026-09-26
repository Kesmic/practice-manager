/**
 * Thin fetch wrapper for the Worker API.
 *
 * Every call is same-origin and relies on the session cookie, so there is no
 * token handling here. Errors are normalised into `ApiRequestError` so screens
 * can show the server's own message - those messages are written to be read by
 * the person using the system, not just by a developer.
 */

import type { ErasePreview, EraseScope } from "@shared/erase";
import type { Visibility } from "@shared/visibility";
import type { StaffAttachment, StaffFileKind } from "@shared/staff-files";
import type { SignatureSpecimen } from "@shared/signatures";
import type { CriterionUnit, FeeBasis, ServiceState } from "@shared/subscriptions";
import type { TaxBasis, Totals } from "@shared/invoices";

/** A line typed onto an invoice by hand. */
export interface ManualInvoiceLine {
  description: string;
  quantity: number;
  unit_amount: number;
  /** False for a reimbursable passed on at cost: no tax, nothing withheld. */
  taxable: boolean;
}
import type { DiscountKind, DiscountRun, DiscountScope } from "@shared/discounts";
import type { Currency } from "@shared/money";
import type { ProspectStage, PartnerState } from "@shared/growth-partners";
import type { ProposalDocument } from "@shared/proposal-document";
import type {
  AdditionalService,
  ClientInvoiceDetail,
  ClientInvoiceList,
  ClientPortalSubscription,
  ClientPortalUser,
  ClientSubscriptionDetail,
  WorkCover,
  GrowthPartnerOverview,
  InvoiceDetail,
  InvoiceList,
  PartnerPipeline,
  PartnerSelf,
  PartnerStatement,
  SubscriptionCatalogue,
  SubscriptionsOverview,
  TaxLineRow,
  TierInclusion,
  TierRow,
} from "@shared/types";
import type { StaffEmailPolicy } from "@shared/staff-email";
import type {
  ToolCatalogue,
  TrainingOverview,
  TrainingView,
} from "@shared/types";
import type { TwoFactorStatus } from "@shared/twofactor";
import type { DeviceTrustPolicy, TrustedDevice } from "@shared/device-trust";
import type { ReviewDetail, ReviewObjective, ReviewSummary } from "@shared/types";
import type { IdlePolicy } from "@shared/session-policy";
import type { Attention } from "@shared/attention";
import type {
  AllocationStatus,
  ClientTier,
  DeclineGround,
} from "@shared/allocations";
import type { ContractField } from "@shared/contract-fields";
import type { FirstRunState, FirstRunStep } from "@shared/first-run";
import type { DirectoryEntry } from "@shared/directory";
import type { Removal, RemovalFootprint } from "@shared/removal";
import type { ReportDuty, ReportSchedule } from "@shared/status-reports";
import type {
  ChecklistItem,
  DocumentSignature,
  EmployeeCompensation,
  EmployeeFile,
  EmployeeSummary,
  FirmSettings,
  MyOnboarding,
  OnboardingItem,
  ClientAllocation,
  ContractDetails,
  ReportDutyRow,
  RemovalPreview,
  ContractMergeResult,
  PortalDocument,
  StatusReport,
  StatusReportView,
  TeamStatusReports,
  PortalDocumentDetail,
  Client,
  ClientRequestSummary,
  ClientSummary,
  Dashboard,
  Engagement,
  EngagementSummary,
  Notification,
  Reports,
  ReviewPoint,
  TaskAttachment,
  TaskComment,
  TaskDetail,
  TaskSummary,
  TaskTemplate,
  TimeEntry,
  User,
} from "@shared/types";
import type { Role, WorkflowAction } from "@shared/workflow";
import type { IntakeForm, IntakeLink, IntakeService } from "@shared/intake";
import type { ClientFile } from "@shared/files";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const { method = "GET", body } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiRequestError(
      0,
      "Could not reach the server. Check your connection and try again.",
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const data = payload as { error?: string; detail?: string } | null;
    throw new ApiRequestError(
      response.status,
      data?.error ?? `Request failed (${response.status}).`,
      data?.detail,
    );
  }

  return payload as T;
}

const qs = (params: Record<string, string | number | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
};

// ---------------------------------------------------------------------------

export interface SessionResponse {
  user: User | null;
  /** What this person still owes before the portal opens up. */
  first_run?: FirstRunState;
  /**
   * The next of those, or null when there is nothing outstanding. Computed by the
   * server from the same module its own gates use, so the browser cannot route somebody
   * to a screen the server was not going to let them past.
   */
  next_first_run_step?: FirstRunStep | null;
  unread_notifications?: number;
  /** Per-destination counts for the sidebar badges. */
  attention?: Attention;
  /** The firm's inactivity setting, so the browser knows what to count down to. */
  idle_policy?: IdlePolicy;
  /** True when the session just ended because the portal was left idle. */
  idled?: boolean;
}

/** What the password step returns when the account has a second factor. */
export interface LoginChallenge {
  token: string;
  expires_at: string;
  /** The way in. Always just the authenticator app. */
  methods: Array<"totp">;
  /**
   * The ways back in, for somebody who cannot produce a code. Security questions sit
   * here rather than beside the app on purpose: they are a recovery route, and neither
   * they nor a recovery code will remember a device.
   */
  recovery_methods: Array<"questions" | "recovery">;
  recovery_remaining: number;
  /**
   * The security questions to put to this person, empty unless the firm allows them and
   * this person has saved a set. Sent with the challenge rather than fetched separately:
   * an endpoint handing out somebody's questions for an email address alone would be a
   * way to learn things about them without ever knowing their password.
   */
  questions: Array<{ id: string; question: string }>;
  /** Whether to offer "remember this device", and for how long. */
  device_trust: { offered: boolean; days: number };
}

export const api = {
  // ------------------------------------------------------------------- auth
  session: () => request<SessionResponse>("/api/auth/me"),

  /**
   * The password step. A `user` means straight in; a `challenge` means this account has
   * a second factor and nothing is signed in yet.
   */
  login: (email: string, password: string) =>
    request<{ user: User | null; challenge?: LoginChallenge }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    }),

  /** The second step, with either an app code or a recovery code. */
  completeLogin: (input: {
    challenge: string;
    code?: string;
    recovery_code?: string;
    /** Keyed by question id. All of them, or none: a partial set is refused. */
    answers?: Record<string, string>;
    remember_device?: boolean;
  }) =>
    request<{
      user: User;
      used_recovery_code?: boolean;
      recovery_codes_remaining?: number;
      used_security_questions?: boolean;
      /** True when "remember this device" was ticked but the route taken cannot. */
      device_not_remembered?: boolean;
    }>("/api/auth/2fa", { method: "POST", body: input }),

  // ------------------------------------------- security questions and devices
  securityQuestions: () =>
    request<{
      allowed: boolean;
      questions: Array<{ id: string; question: string }>;
      suggested: string[];
      min: number;
      max: number;
      answers_keyed: boolean;
    }>("/api/2fa/questions"),

  saveSecurityQuestions: (
    entries: Array<{ question: string; answer: string }>,
    code: string,
  ) =>
    request<{
      ok: true;
      questions: Array<{ id: string; question: string }>;
      two_factor: TwoFactorStatus;
    }>("/api/2fa/questions", { method: "PUT", body: { entries, code } }),

  clearSecurityQuestions: () =>
    request<{ ok: true; two_factor: TwoFactorStatus }>("/api/2fa/questions", {
      method: "DELETE",
    }),

  trustedDevices: () =>
    request<{ policy: DeviceTrustPolicy; devices: TrustedDevice[] }>("/api/2fa/devices"),

  forgetDevice: (id: string) =>
    request<{ ok: true; devices: TrustedDevice[] }>(`/api/2fa/devices/${id}`, {
      method: "DELETE",
    }),

  forgetAllDevices: () =>
    request<{ ok: true; devices: TrustedDevice[] }>("/api/2fa/devices/forget-all", {
      method: "POST",
    }),

  setSecurityQuestionsPolicy: (enabled: boolean) =>
    request<{
      enabled: boolean;
      people_with_questions: number;
      note: string;
    }>("/api/2fa/questions-policy", { method: "PUT", body: { enabled } }),

  setDeviceTrustPolicy: (input: { enabled: boolean; days?: number }) =>
    request<{ policy: DeviceTrustPolicy; devices_forgotten?: boolean }>(
      "/api/device-trust",
      { method: "PUT", body: input },
    ),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  bootstrap: (input: {
    secret: string;
    email: string;
    full_name: string;
    password: string;
  }) => request<{ ok: true }>("/api/auth/bootstrap", { method: "POST", body: input }),

  // ------------------------------------------------------------ push
  pushKey: () => request<{ configured: boolean; public_key: string | null }>("/api/push/key"),
  pushDevices: () => request<{ devices: number }>("/api/push/subscriptions"),
  savePushSubscription: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<void>("/api/push/subscriptions", { method: "PUT", body }),
  removePushSubscription: (endpoint: string) =>
    request<void>("/api/push/subscriptions", { method: "DELETE", body: { endpoint } }),
  sendTestPush: () => request<{ sent: number }>("/api/push/test", { method: "POST" }),

  setEmailNotifications: (enabled: boolean) =>
    request<{ email_notifications: boolean }>("/api/me/preferences", {
      method: "PATCH",
      body: { email_notifications: enabled },
    }),

  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: true }>("/api/auth/password", {
      method: "POST",
      body: { current_password, new_password },
    }),

  // ------------------------------------------------------- two-step sign-in

  twoFactor: () => request<{ two_factor: TwoFactorStatus }>("/api/2fa"),

  /** Begins enrolment. The secret is returned here and nowhere else, ever. */
  startTwoFactor: () =>
    request<{
      secret: string;
      secret_grouped: string;
      uri: string;
      qr_svg: string | null;
      issuer: string;
      account: string;
    }>("/api/2fa/start", { method: "POST" }),

  /** Confirms it with a code, and returns the recovery codes once. */
  confirmTwoFactor: (code: string) =>
    request<{ ok: true; recovery_codes: string[]; two_factor: TwoFactorStatus }>(
      "/api/2fa/confirm",
      { method: "POST", body: { code } },
    ),

  newRecoveryCodes: (code: string) =>
    request<{ ok: true; recovery_codes: string[] }>("/api/2fa/recovery-codes", {
      method: "POST",
      body: { code },
    }),

  disableTwoFactor: (code: string) =>
    request<{ ok: true; two_factor: TwoFactorStatus }>("/api/2fa/disable", {
      method: "POST",
      body: { code },
    }),

  setSessionPolicy: (input: { enabled: boolean; idle_minutes?: number }) =>
    request<{ idle: IdlePolicy }>("/api/session-policy", {
      method: "PUT",
      body: input,
    }),

  updateOwnBank: (input: Record<string, unknown>) =>
    request<{ bank: Record<string, string | null> }>("/api/me/bank", {
      method: "PATCH",
      body: input,
    }),

  // --------------------------------------------------- performance reviews
  personReviews: (userId: string) =>
    request<{
      subject: { id: string; full_name: string; role: Role };
      can_review: boolean;
      reviews: ReviewSummary[];
      open_objectives: ReviewObjective[];
    }>(`/api/people/${userId}/reviews`),

  startReview: (userId: string, input: Record<string, unknown>) =>
    request<{ review: ReviewDetail }>(`/api/people/${userId}/reviews`, {
      method: "POST",
      body: input,
    }),

  review: (id: string) =>
    request<{ review: ReviewDetail; can_write: boolean; is_subject: boolean }>(
      `/api/reviews/${id}`,
    ),

  updateReview: (id: string, input: Record<string, unknown>) =>
    request<{ review: ReviewDetail }>(`/api/reviews/${id}`, {
      method: "PATCH",
      body: input,
    }),

  rateReview: (id: string, criterion: string, input: { rating?: string | null; comment?: string | null }) =>
    request<{ review: ReviewDetail }>(`/api/reviews/${id}/ratings/${criterion}`, {
      method: "PUT",
      body: input,
    }),

  addObjective: (id: string, input: Record<string, unknown>) =>
    request<{ review: ReviewDetail }>(`/api/reviews/${id}/objectives`, {
      method: "POST",
      body: input,
    }),

  updateObjective: (id: string, objectiveId: string, input: Record<string, unknown>) =>
    request<{ review: ReviewDetail }>(`/api/reviews/${id}/objectives/${objectiveId}`, {
      method: "PATCH",
      body: input,
    }),

  removeObjective: (id: string, objectiveId: string) =>
    request<{ review: ReviewDetail }>(`/api/reviews/${id}/objectives/${objectiveId}`, {
      method: "DELETE",
    }),

  shareReview: (id: string) =>
    request<{ review: ReviewDetail }>(`/api/reviews/${id}/share`, {
      method: "POST",
      body: {},
    }),

  recallReview: (id: string) =>
    request<{ review: ReviewDetail }>(`/api/reviews/${id}/recall`, {
      method: "POST",
      body: {},
    }),

  respondToReview: (id: string, input: { comments?: string | null; sign?: boolean }) =>
    request<{ review: ReviewDetail }>(`/api/reviews/${id}/respond`, {
      method: "POST",
      body: input,
    }),

  myReviews: () =>
    request<{
      writing: Array<ReviewSummary & { subject_name: string }>;
      awaiting_my_signature: Array<ReviewSummary & { reviewer_name: string | null }>;
    }>("/api/me/reviews"),

  performanceOverview: () =>
    request<{
      people: Array<{
        id: string;
        full_name: string;
        role: Role;
        employment_status: string | null;
        probation_end_date: string | null;
        confirmed_on: string | null;
        completed: number;
        last_review_at: string | null;
        in_progress: string | null;
      }>;
    }>("/api/performance/overview"),

  twoFactorOverview: () =>
    request<{
      policy: string;
      security_questions: { enabled: boolean; people_with_questions: number };
      device_trust: { policy: DeviceTrustPolicy; devices_remembered: number };
      idle: IdlePolicy;
      outstanding: number;
      people: Array<{
        id: string;
        full_name: string;
        email: string;
        role: Role;
        enabled: boolean;
        required: boolean;
        confirmed_at: string | null;
        recovery_remaining: number;
      }>;
    }>("/api/2fa/overview"),

  setTwoFactorPolicy: (minimum: string) =>
    request<{
      policy: string;
      covered_grades: Role[];
      not_yet_enrolled: number;
      applies_to_self: boolean;
    }>("/api/2fa/policy", { method: "PUT", body: { minimum } }),

  resetTwoFactorFor: (userId: string) =>
    request<{
      ok: true;
      was_enrolled: boolean;
      must_enrol_again: boolean;
      message: string;
    }>(`/api/users/${userId}/2fa/reset`, { method: "POST" }),

  // ------------------------------------------------------------------ users
  users: (includeSuspended = false) =>
    request<{ users: User[] }>(
      `/api/users${includeSuspended ? "?include_suspended=1" : ""}`,
    ),

  createUser: (input: Record<string, unknown>) =>
    request<{
      user: User;
      temporary_password: string | null;
      invitation_sent: boolean;
      invitation_error: string | null;
    }>("/api/users", { method: "POST", body: input }),

  updateUser: (id: string, input: Record<string, unknown>) =>
    request<{
      user: User;
      /** Set only when the sign-in address actually changed, so the screen can say so. */
      email_changed: { from: string; to: string } | null;
    }>(`/api/users/${id}`, { method: "PATCH", body: input }),

  resetPassword: (id: string) =>
    request<{ temporary_password: string }>(`/api/users/${id}/reset-password`, {
      method: "POST",
    }),

  // ---------------------------------------------------------------- clients
  clients: (params: Record<string, string | undefined> = {}) =>
    request<{ clients: ClientSummary[] }>(`/api/clients${qs(params)}`),

  client: (id: string) =>
    request<{
      client: ClientSummary;
      engagements: EngagementSummary[];
      tasks: TaskSummary[];
      files: ClientFile[];
    }>(`/api/clients/${id}`),

  // ------------------------------------------------------------ client file
  /**
   * Links to documents in SharePoint, OneDrive or Google Drive. The portal holds the
   * reference; the document stays where the firm keeps it.
   */
  clientFiles: (clientId: string) =>
    request<{ files: ClientFile[] }>(`/api/clients/${clientId}/files`),

  addClientFile: (clientId: string, input: Record<string, unknown>) =>
    request<{ file: ClientFile }>(`/api/clients/${clientId}/files`, {
      method: "POST",
      body: input,
    }),

  updateClientFile: (id: string, input: Record<string, unknown>) =>
    request<{ file: ClientFile }>(`/api/client-files/${id}`, {
      method: "PATCH",
      body: input,
    }),

  /** Removes the reference only. The document itself is untouched. */
  removeClientFile: (id: string) =>
    request<void>(`/api/client-files/${id}`, { method: "DELETE" }),

  createClient: (input: Record<string, unknown>) =>
    request<{ client: Client }>("/api/clients", { method: "POST", body: input }),

  updateClient: (id: string, input: Record<string, unknown>) =>
    request<{ client: Client }>(`/api/clients/${id}`, {
      method: "PATCH",
      body: input,
    }),

  // ------------------------------------------------------------ engagements
  engagements: (params: Record<string, string | undefined> = {}) =>
    request<{ engagements: EngagementSummary[] }>(`/api/engagements${qs(params)}`),

  createEngagement: (input: Record<string, unknown>) =>
    request<{ engagement: Engagement }>("/api/engagements", {
      method: "POST",
      body: input,
    }),

  updateEngagement: (id: string, input: Record<string, unknown>) =>
    request<{ engagement: Engagement }>(`/api/engagements/${id}`, {
      method: "PATCH",
      body: input,
    }),

  // ------------------------------------------------------------------ tasks
  tasks: (params: Record<string, string | number | undefined> = {}) =>
    request<{ tasks: TaskSummary[] }>(`/api/tasks${qs(params)}`),

  task: (id: string) => request<TaskDetail>(`/api/tasks/${id}`),

  createTask: (input: Record<string, unknown>) =>
    request<{ task: TaskSummary }>("/api/tasks", { method: "POST", body: input }),

  updateTask: (id: string, input: Record<string, unknown>) =>
    request<{ task: TaskSummary }>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: input,
    }),

  transition: (id: string, action: WorkflowAction, note?: string) =>
    request<{ task: TaskSummary; next_occurrence_id: string | null }>(
      `/api/tasks/${id}/transition`,
      { method: "POST", body: { action, note } },
    ),

  // -------------------------------------------------------------- checklist
  addChecklistItem: (taskId: string, label: string, mandatory: boolean) =>
    request<{ item: ChecklistItem }>(`/api/tasks/${taskId}/checklist`, {
      method: "POST",
      body: { label, mandatory },
    }),

  updateChecklistItem: (
    taskId: string,
    itemId: string,
    input: { is_done?: boolean; label?: string },
  ) =>
    request<{ item: ChecklistItem }>(`/api/tasks/${taskId}/checklist/${itemId}`, {
      method: "PATCH",
      body: input,
    }),

  deleteChecklistItem: (taskId: string, itemId: string) =>
    request<{ ok: true }>(`/api/tasks/${taskId}/checklist/${itemId}`, {
      method: "DELETE",
    }),

  // ----------------------------------------------------------- review points
  raiseReviewPoint: (
    taskId: string,
    input: { body: string; severity: string; reference?: string },
  ) =>
    request<{ review_point: ReviewPoint }>(`/api/tasks/${taskId}/review-points`, {
      method: "POST",
      body: input,
    }),

  actOnReviewPoint: (
    pointId: string,
    input: {
      action: "respond" | "resolve" | "waive" | "reopen" | "edit";
      response?: string;
      note?: string;
      body?: string;
      severity?: string;
    },
  ) =>
    request<{ review_point: ReviewPoint }>(`/api/review-points/${pointId}`, {
      method: "PATCH",
      body: input,
    }),

  deleteReviewPoint: (pointId: string) =>
    request<{ ok: true }>(`/api/review-points/${pointId}`, { method: "DELETE" }),

  // --------------------------------------------------- comments, docs, time
  addComment: (taskId: string, body: string) =>
    request<{ comment: TaskComment }>(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      body: { body },
    }),

  addAttachment: (taskId: string, input: { label: string; url: string; kind?: string }) =>
    request<{ attachment: TaskAttachment }>(`/api/tasks/${taskId}/attachments`, {
      method: "POST",
      body: input,
    }),

  deleteAttachment: (id: string) =>
    request<{ ok: true }>(`/api/attachments/${id}`, { method: "DELETE" }),

  logTime: (
    taskId: string,
    input: { work_date: string; hours: number; narrative?: string; billable?: boolean },
  ) =>
    request<{ time_entry: TimeEntry }>(`/api/tasks/${taskId}/time`, {
      method: "POST",
      body: input,
    }),

  deleteTime: (id: string) =>
    request<{ ok: true }>(`/api/time/${id}`, { method: "DELETE" }),

  // -------------------------------------------------------------- templates
  templates: (includeInactive = false) =>
    request<{ templates: TaskTemplate[] }>(
      `/api/templates${includeInactive ? "?include_inactive=1" : ""}`,
    ),

  createTemplate: (input: Record<string, unknown>) =>
    request<{ template: TaskTemplate }>("/api/templates", {
      method: "POST",
      body: input,
    }),

  updateTemplate: (id: string, input: Record<string, unknown>) =>
    request<{ template: TaskTemplate }>(`/api/templates/${id}`, {
      method: "PATCH",
      body: input,
    }),

  generateFromTemplate: (id: string, input: Record<string, unknown>) =>
    request<{
      created: Array<{ id: string; ref: string; client: string; period: string }>;
      skipped: Array<{ client: string; period: string }>;
    }>(`/api/templates/${id}/generate`, { method: "POST", body: input }),

  // ---------------------------------------------------------- client intake
  /** Public: checks a link is live and says which of the two forms to show. */
  intakeForm: (kind: string, token: string) =>
    request<{ form: IntakeForm }>(
      `/api/intake/${encodeURIComponent(kind)}/${encodeURIComponent(token)}`,
    ),

  /** Public: sends a request. Answers with the reference and nothing else. */
  submitIntake: (kind: string, token: string, input: Record<string, unknown>) =>
    request<{ reference: string }>(
      `/api/intake/${encodeURIComponent(kind)}/${encodeURIComponent(token)}`,
      { method: "POST", body: input },
    ),

  clientRequests: (params: Record<string, string | undefined> = {}) =>
    request<{ requests: ClientRequestSummary[]; open: number }>(
      `/api/client-requests${qs(params)}`,
    ),

  updateClientRequest: (id: string, input: Record<string, unknown>) =>
    request<{ request: ClientRequestSummary }>(`/api/client-requests/${id}`, {
      method: "PATCH",
      body: input,
    }),

  acceptClientRequest: (id: string, input: Record<string, unknown> = {}) =>
    request<{
      request: ClientRequestSummary;
      client_id: string;
      created_client: boolean;
    }>(`/api/client-requests/${id}/accept`, { method: "POST", body: input }),

  intakeLinks: () => request<{ links: IntakeLink[] }>("/api/intake-links"),

  /**
   * What the Worker can see of the email settings. The key is never returned, only
   * whether one is present and how long it is.
   */
  emailStatus: () =>
    request<{
      email: {
        configured: boolean;
        provider: string;
        provider_known: boolean;
        from: string;
        from_address: string;
        portal_url: string;
        key_present: boolean;
        key_length: number;
        problems: string[];
      };
      firm_name: string;
      recipients: { active: number; opted_in: number };
    }>("/api/email/status"),

  /** Sends a test message to your own address and reports what the provider said. */
  sendTestEmail: () =>
    request<{ sent: boolean; status: number | null; detail: string; to: string }>(
      "/api/email/test",
      { method: "POST" },
    ),

  // ---------------------------------------------------------- who sees what

  visibility: () => request<{ visibility: Visibility }>("/api/visibility"),

  setVisibility: (input: Visibility) =>
    request<{ visibility: Visibility; changed_by: string }>("/api/visibility", {
      method: "PUT",
      body: input,
    }),

  // ------------------------------------------------------------- erasing data

  /** Counts what a period would remove. Changes nothing. */
  erasePreview: (input: { from: string; to: string; scopes: EraseScope[] }) =>
    request<{ preview: ErasePreview }>("/api/erase/preview", {
      method: "POST",
      body: input,
    }),

  /**
   * Erases it. `expected_total` is the total the preview showed: the Worker refuses
   * if the figure has moved, so a stale preview cannot authorise a bigger deletion.
   */
  erase: (input: {
    from: string;
    to: string;
    scopes: EraseScope[];
    reason: string;
    confirm: string;
    expected_total: number;
  }) =>
    request<{
      erased: {
        id: string;
        range: { from: string; to: string };
        removed: Record<string, number>;
        total: number;
      };
    }>("/api/erase", { method: "POST", body: input }),

  erasures: () =>
    request<{
      erasures: Array<{
        id: string;
        actor_name: string;
        actor_email: string;
        period_from: string;
        period_to: string;
        scopes: string;
        removed: string;
        total_removed: number;
        reason: string;
        created_at: string;
      }>;
    }>("/api/erasures"),

  intakeServices: () =>
    request<{ services: IntakeService[]; customised: boolean }>("/api/intake-services"),

  setIntakeServices: (services: IntakeService[]) =>
    request<{ services: IntakeService[]; customised: boolean }>("/api/intake-services", {
      method: "PUT",
      body: { services },
    }),

  resetIntakeServices: () =>
    request<{ services: IntakeService[]; customised: boolean }>("/api/intake-services", {
      method: "DELETE",
    }),

  /**
   * Issues a contract or form for one employee, from a template. The copy requires a
   * signature unless told otherwise, since being signed is the point of issuing it.
   */
  copyDocumentFor: (
    id: string,
    assignedUserId: string,
    title?: string,
    options: { kind?: string; requires_signature?: boolean } = {},
  ) =>
    request<{ document: PortalDocument; merge: ContractMergeResult }>(
      `/api/documents/${id}/copy-for`,
      {
        method: "POST",
        body: { assigned_user_id: assignedUserId, title, ...options },
      },
    ),

  /**
   * Where to download somebody's signed copy of a document.
   *
   * A plain URL rather than a fetch: the response carries Content-Disposition, so
   * letting the browser follow it gives a real download with the right filename.
   * Fetching it into a blob would work too, and would throw away the filename the
   * server chose.
   */
  signedCopyUrl: (documentId: string, userId?: string) =>
    `/api/documents/${documentId}/signed-copy${
      userId ? `?user_id=${encodeURIComponent(userId)}` : ""
    }`,

  // ------------------------------------------------------------- directory
  /**
   * The firm-wide staff directory. Everybody appears; what is said about them depends
   * on the reader's grade.
   */
  directory: (q?: string) =>
    request<{ people: DirectoryEntry[]; can_open_records: boolean }>(
      `/api/directory${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),

  // ------------------------------------------------- tools and certifications

  tools: () => request<ToolCatalogue>("/api/tools"),
  addTool: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/tools", { method: "POST", body }),
  editTool: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/tools/${id}`, { method: "PATCH", body }),
  removeTool: (id: string) =>
    request<void>(`/api/tools/${id}`, { method: "DELETE" }),
  addCertification: (toolId: string, body: Record<string, unknown>) =>
    request<{ id: string }>(`/api/tools/${toolId}/certifications`, { method: "POST", body }),
  editCertification: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/certifications/${id}`, { method: "PATCH", body }),
  removeCertification: (id: string) =>
    request<void>(`/api/certifications/${id}`, { method: "DELETE" }),

  myTraining: () => request<TrainingView>("/api/me/training"),
  employeeTraining: (userId: string) =>
    request<TrainingView>(`/api/employees/${userId}/training`),
  trainingOverview: () => request<TrainingOverview>("/api/training/overview"),

  issueToolLogin: (
    userId: string,
    body: { tool_id: string; username: string; password?: string; send_to?: string; notify: boolean },
  ) =>
    request<{
      tool: string;
      username: string;
      sent_to: string | null;
      notified: boolean;
      notify_error: string | null;
    }>(`/api/employees/${userId}/tool-logins`, { method: "POST", body }),

  clearToolLogin: (userId: string, toolId: string) =>
    request<void>(`/api/employees/${userId}/tool-logins/${toolId}`, { method: "DELETE" }),

  assignCertification: (userId: string, body: { certification_id: string; due_on?: string | null }) =>
    request<{ id: string }>(`/api/employees/${userId}/certifications`, { method: "POST", body }),

  setCertificationProgress: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/staff-certifications/${id}`, { method: "PATCH", body }),

  setMyCertificationProgress: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/me/certifications/${id}`, { method: "PATCH", body }),

  unassignCertification: (id: string) =>
    request<void>(`/api/staff-certifications/${id}`, { method: "DELETE" }),

  remindCertification: (id: string) =>
    request<{ sent_to: string; copied_to: string }>(
      `/api/staff-certifications/${id}/remind`,
      { method: "POST" },
    ),

  /** Its own fetch, because the body is the file itself. */
  uploadCertificate: async (id: string, file: File) => {
    const response = await fetch(`/api/me/certifications/${id}/certificate`, {
      method: "PUT",
      headers: { "Content-Type": file.type, "X-Filename": encodeURIComponent(file.name) },
      body: file,
      credentials: "same-origin",
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { error?: string }) : null;
    if (!response.ok) {
      throw new ApiRequestError(
        response.status,
        payload?.error ?? `Could not attach that file (${response.status}).`,
      );
    }
    return payload;
  },

  myCertificateUrl: (id: string) => `/api/me/certifications/${id}/certificate`,
  certificateUrl: (id: string) => `/api/staff-certifications/${id}/certificate`,

  // ------------------------------------------------------------ staff email

  staffEmail: () =>
    request<{
      policy: StaffEmailPolicy;
      host_label: string;
      admin_url: string;
      configured: boolean;
    }>("/api/staff-email"),

  saveStaffEmail: (policy: StaffEmailPolicy) =>
    request<{
      policy: StaffEmailPolicy;
      host_label: string;
      admin_url: string;
      configured: boolean;
    }>("/api/staff-email", { method: "PUT", body: policy }),

  issueWorkEmail: (
    userId: string,
    input: { address: string; password?: string; send_to?: string; notify: boolean },
  ) =>
    request<{
      work_email: string;
      host: string;
      sent_to: string | null;
      notified: boolean;
      notify_error: string | null;
    }>(`/api/employees/${userId}/work-email`, { method: "POST", body: input }),

  clearWorkEmail: (userId: string) =>
    request<{ cleared: true }>(`/api/employees/${userId}/work-email`, {
      method: "DELETE",
    }),

  // ------------------------------------------------------------ attachments

  /**
   * Attaches one of the person's own documents.
   *
   * Its own fetch rather than `request`, because the body is the file itself. Sending
   * it as JSON would mean base64, which inflates a 10 MB photograph by a third for no
   * gain, and a multipart form would mean a parser on the other side for a format with
   * exactly one use here.
   */
  uploadStaffFile: async (kind: StaffFileKind, file: File) => {
    let response: Response;
    try {
      response = await fetch(`/api/me/files/${kind}`, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          // Encoded, because a header may only carry Latin-1 and filenames do not.
          "X-Filename": encodeURIComponent(file.name),
        },
        body: file,
        credentials: "same-origin",
      });
    } catch {
      throw new ApiRequestError(0, "Could not reach the server. Check your connection.");
    }
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { error?: string; detail?: string }) : null;
    if (!response.ok) {
      throw new ApiRequestError(
        response.status,
        payload?.error ?? `Could not attach that file (${response.status}).`,
        payload?.detail,
      );
    }
    return payload as { attached: StaffAttachment };
  },

  removeStaffFile: (kind: StaffFileKind) =>
    request<void>(`/api/me/files/${kind}`, { method: "DELETE" }),

  // ------------------------------------------------------------- signatures
  /** What the person has on file to sign with, if anything. */
  mySignature: () =>
    request<{ signature: SignatureSpecimen | null }>("/api/me/signature"),

  /** Uploads a new specimen. The old one is retired, never overwritten. */
  uploadSignature: async (file: File) => {
    let response: Response;
    try {
      response = await fetch("/api/me/signature", {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
        credentials: "same-origin",
      });
    } catch {
      throw new ApiRequestError(0, "Could not reach the server. Check your connection.");
    }
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { error?: string; detail?: string }) : null;
    if (!response.ok) {
      throw new ApiRequestError(
        response.status,
        payload?.error ?? `Could not upload that image (${response.status}).`,
        payload?.detail,
      );
    }
    return payload as { signature: SignatureSpecimen; replaced: boolean };
  },

  removeSignature: () => request<void>("/api/me/signature", { method: "DELETE" }),

  /**
   * The image itself, put straight into an `img` rather than fetched.
   *
   * By specimen id, because a signed document shows the signature that was used on it
   * and not whatever the person has uploaded since.
   */
  signatureImageUrl: (signatureId: string) => `/api/signatures/${signatureId}`,

  /** Opened in a new tab rather than fetched: the response is a download. */
  myStaffFileUrl: (kind: StaffFileKind) => `/api/me/files/${kind}`,
  employeeStaffFileUrl: (userId: string, kind: StaffFileKind) =>
    `/api/employees/${userId}/files/${kind}`,

  // ------------------------------------------------- subscriptions (the firm)
  subscriptionCatalogue: () => request<SubscriptionCatalogue>("/api/subscription-catalogue"),

  addCriterion: (body: { name: string; unit: CriterionUnit; how_measured?: string }) =>
    request<{ id: string }>("/api/subscription-criteria", { method: "POST", body }),
  editCriterion: (id: string, body: { name: string; how_measured?: string }) =>
    request<void>(`/api/subscription-criteria/${id}`, { method: "PATCH", body }),
  removeCriterion: (id: string, confirm = false) =>
    request<void>(`/api/subscription-criteria/${id}${confirm ? "?confirm=yes" : ""}`, {
      method: "DELETE",
    }),

  saveTier: (
    tier: ClientTier,
    body: {
      monthly_fee: number | null;
      fee_from: number | null;
      fee_note: string;
      currency: Currency;
      summary: string;
      ideal_for: string;
      ceilings: Record<string, number | null>;
    },
  ) => request<void>(`/api/subscription-tiers/${tier}`, { method: "PATCH", body }),

  // ------------------------------------------- services and what packages include
  addPackageService: (body: { name: string; parent_id?: string | null }) =>
    request<{ id: string }>("/api/package-services", { method: "POST", body }),
  updatePackageService: (
    id: string,
    body: { name?: string; position?: number; active?: boolean },
  ) => request<void>(`/api/package-services/${id}`, { method: "PATCH", body }),
  deletePackageService: (id: string) =>
    request<void>(`/api/package-services/${id}`, { method: "DELETE" }),
  reorderPackageServices: (parentId: string | null, ids: string[]) =>
    request<void>("/api/package-services/order", {
      method: "PUT",
      body: { parent_id: parentId, ids },
    }),
  savePackageServices: (tier: ClientTier, services: Array<{ id: string; note: string | null }>) =>
    request<void>(`/api/subscription-tiers/${tier}/services`, {
      method: "PUT",
      body: { services },
    }),
  giveExtra: (clientId: string, body: { service_id: string; note?: string }) =>
    request<{ id: string }>(`/api/clients/${clientId}/extras`, { method: "POST", body }),
  endExtra: (id: string, reason: string) =>
    request<void>(`/api/extras/${id}/end`, { method: "POST", body: { reason } }),

  addService: (body: {
    name: string;
    summary?: string;
    fee: number | null;
    fee_basis: FeeBasis;
    currency?: Currency;
    service_line?: string;
  }) => request<{ id: string }>("/api/additional-services", { method: "POST", body }),
  editService: (
    id: string,
    body: {
      name: string;
      summary?: string;
      fee: number | null;
      fee_basis: FeeBasis;
      currency?: Currency;
      service_line?: string;
      active?: boolean;
    },
  ) => request<void>(`/api/additional-services/${id}`, { method: "PATCH", body }),

  /*
   * Discounts. Granting one is Partner business and the Worker says so again; this is
   * only the shape of the request.
   */
  grantDiscount: (
    clientId: string,
    body: {
      kind: DiscountKind;
      value: number;
      applies_to: DiscountScope;
      runs: DiscountRun;
      invoice_count?: number | null;
      until_on?: string | null;
      reason?: string;
    },
  ) => request<{ id: string }>(`/api/clients/${clientId}/discounts`, { method: "POST", body }),

  endDiscount: (id: string, reason: string) =>
    request<void>(`/api/discounts/${id}/end`, { method: "POST", body: { reason } }),

  subscriptions: () => request<SubscriptionsOverview>("/api/subscriptions"),
  /** What a job for this client can be covered by. Open to anybody who can raise a job. */
  workCover: (clientId: string) =>
    request<WorkCover>(`/api/clients/${clientId}/work-cover`),
  clientSubscription: (clientId: string) =>
    request<ClientSubscriptionDetail>(`/api/clients/${clientId}/subscription`),
  saveClientSubscription: (
    clientId: string,
    body: {
      tier: ClientTier;
      monthly_fee: number | null;
      currency?: Currency;
      started_on?: string;
      note?: string;
      status?: "active" | "paused" | "ended";
    },
  ) => request<{ ok: true }>(`/api/clients/${clientId}/subscription`, { method: "PUT", body }),

  recordFigures: (clientId: string, body: { as_of: string; values: Record<string, number>; note?: string }) =>
    request<{ recorded: number }>(`/api/clients/${clientId}/figures`, { method: "POST", body }),

  addClientService: (
    clientId: string,
    body: { service_id?: string; name?: string; quoted_fee?: number | null; status?: string; note?: string },
  ) => request<{ id: string }>(`/api/clients/${clientId}/services`, { method: "POST", body }),
  moveClientService: (
    id: string,
    body: { status: ServiceState; quoted_fee?: number | null; note?: string },
  ) => request<void>(`/api/client-services/${id}`, { method: "PATCH", body }),

  // ------------------------------------------------------------ client logins
  inviteClientUser: (clientId: string, body: { email: string; full_name: string }) =>
    request<{ id: string; invitation_url: string }>(`/api/clients/${clientId}/logins`, {
      method: "POST",
      body,
    }),
  reinviteClientUser: (id: string) =>
    request<{ invitation_url: string }>(`/api/client-logins/${id}/reinvite`, { method: "POST" }),
  setClientUserStatus: (id: string, status: "active" | "suspended") =>
    request<void>(`/api/client-logins/${id}`, { method: "PATCH", body: { status } }),
  removeClientUser: (id: string) =>
    request<void>(`/api/client-logins/${id}`, { method: "DELETE" }),

  // ------------------------------------------------------------------ tax
  taxLines: () => request<{ tax_lines: TaxLineRow[]; example: Totals }>("/api/tax-lines"),
  addTaxLine: (body: { name: string; rate: number; basis: TaxBasis }) =>
    request<{ id: string }>("/api/tax-lines", { method: "POST", body }),
  editTaxLine: (
    id: string,
    body: { name: string; rate: number; basis: TaxBasis; position?: number; active?: boolean },
  ) => request<void>(`/api/tax-lines/${id}`, { method: "PATCH", body }),
  removeTaxLine: (id: string) => request<void>(`/api/tax-lines/${id}`, { method: "DELETE" }),

  // -------------------------------------------------------------- invoices
  invoices: (state?: string) =>
    request<InvoiceList>(`/api/invoices${state ? `?state=${state}` : ""}`),
  invoice: (id: string) => request<InvoiceDetail>(`/api/invoices/${id}`),
  raiseInvoice: (
    clientId: string,
    body: {
      period?: string;
      due_on?: string;
      include_services?: boolean;
      note?: string;
      /** Lines typed by hand. `taxable` false is a reimbursable passed on at cost. */
      lines?: ManualInvoiceLine[];
      /** For an invoice made only of typed lines: what it is in. */
      currency?: Currency;
    },
  ) => request<{ id: string; number: string }>(`/api/clients/${clientId}/invoices`, {
    method: "POST",
    body,
  }),
  addInvoiceLine: (id: string, line: ManualInvoiceLine) =>
    request<InvoiceDetail>(`/api/invoices/${id}/lines`, { method: "POST", body: line }),
  removeInvoiceLine: (lineId: string) =>
    request<InvoiceDetail>(`/api/invoice-lines/${lineId}`, { method: "DELETE" }),
  sendInvoice: (id: string) =>
    request<{ sent_to: string[]; failed: Array<{ email: string; error: string }> }>(
      `/api/invoices/${id}/send`,
      { method: "POST" },
    ),
  resendInvoice: (id: string, alsoTo?: string) =>
    request<{ sent_to: string[]; failed: Array<{ email: string; error: string }> }>(
      `/api/invoices/${id}/resend`,
      { method: "POST", body: { also_to: alsoTo || undefined } },
    ),
  redraftInvoice: (id: string) =>
    request<InvoiceDetail>(`/api/invoices/${id}/redraft`, { method: "POST" }),
  deleteInvoice: (id: string, reason: string) =>
    request<void>(`/api/invoices/${id}`, { method: "DELETE", body: { reason } }),
  voidInvoice: (id: string, reason: string) =>
    request<void>(`/api/invoices/${id}/void`, { method: "POST", body: { reason } }),
  recordPayment: (
    id: string,
    body: {
      amount: number;
      withheld: number;
      paid_on?: string;
      method?: string;
      reference?: string;
      certificate_received?: boolean;
      certificate_ref?: string;
      note?: string;
    },
  ) => request<{ state: string }>(`/api/invoices/${id}/payments`, { method: "POST", body }),
  setCertificate: (paymentId: string, body: { certificate_received: boolean; certificate_ref?: string }) =>
    request<void>(`/api/invoice-payments/${paymentId}`, { method: "PATCH", body }),
  removePayment: (paymentId: string) =>
    request<void>(`/api/invoice-payments/${paymentId}`, { method: "DELETE" }),
  remindInvoice: (id: string) =>
    request<{ sent: boolean; step?: number }>(`/api/invoices/${id}/remind`, { method: "POST" }),

  // ------------------------------------------------- the client's own portal
  // ------------------------------------------------------- growth partners
  //
  // A third set of calls, against a third session. Nothing here touches the staff or
  // client endpoints, and nothing there touches these.

  partnerLogin: (email: string, password: string) =>
    request<{ ok: true }>("/api/partner/login", { method: "POST", body: { email, password } }),
  partnerLogout: () => request<{ ok: true }>("/api/partner/logout", { method: "POST" }),
  partnerSession: () => request<{ partner: PartnerSelf }>("/api/partner/session"),

  partnerForgotPassword: (email: string) =>
    request<{ ok: true; message: string }>("/api/partner/forgot-password", {
      method: "POST",
      body: { email },
    }),
  partnerInvitation: (token: string) =>
    request<{ full_name: string; email: string }>(
      `/api/partner/invitation/${encodeURIComponent(token)}`,
    ),
  acceptPartnerInvitation: (token: string, password: string) =>
    request<{ ok: true }>(`/api/partner/invitation/${encodeURIComponent(token)}`, {
      method: "POST",
      body: { password },
    }),
  partnerChangePassword: (current: string, password: string) =>
    request<void>("/api/partner/password", { method: "POST", body: { current, password } }),

  partnerAgreement: () =>
    request<{
      agreement: {
        id: string;
        title: string;
        body: string;
        status: "issued" | "signed" | "superseded";
        issued_at: string;
        signed_at: string | null;
        typed_name: string | null;
        commission_rate: number;
        commission_months: number;
        hold_days: number;
        has_signature: boolean;
      } | null;
      full_name: string;
    }>("/api/partner/agreement"),

  /* The image itself as the body, the way a staff specimen is uploaded. */
  uploadPartnerSignature: async (file: File) => {
    const response = await fetch("/api/partner/agreement/signature", {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
      credentials: "same-origin",
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({ error: "Upload failed." }));
      throw new ApiRequestError(
        response.status,
        (problem as { error?: string }).error ?? "Upload failed.",
      );
    }
  },

  signPartnerAgreement: (typedName: string) =>
    request<{ signed_at: string }>("/api/partner/agreement/sign", {
      method: "POST",
      body: { typed_name: typedName },
    }),

  partnerPipeline: () => request<PartnerPipeline>("/api/partner/prospects"),
  partnerStatement: () => request<PartnerStatement>("/api/partner/statement"),
  partnerPackages: () =>
    request<{
      tiers: TierRow[];
      inclusions: TierInclusion[];
      services: AdditionalService[];
    }>("/api/partner/packages"),

  registerProspect: (body: {
    business_name: string;
    contact_name?: string;
    contact_email?: string;
    contact_phone?: string;
    sector?: string;
    note?: string;
  }) => request<{ id: string }>("/api/partner/prospects", { method: "POST", body }),

  moveProspect: (
    id: string,
    body: { stage?: ProspectStage; note?: string; lost_reason?: string },
  ) => request<void>(`/api/partner/prospects/${id}`, { method: "PATCH", body }),

  createProposal: (
    prospectId: string,
    body: {
      tier: ClientTier | null;
      currency: Currency;
      monthly_fee: number | null;
      discount: number;
      prepared_for?: string;
      address?: string;
      salutation?: string;
      note?: string;
      lines?: Array<{ description: string; frequency: string; amount: number }>;
    },
  ) =>
    request<{ id: string; reference: string }>(
      `/api/partner/prospects/${prospectId}/proposals`,
      { method: "POST", body },
    ),
  sendProposal: (id: string) =>
    request<{ link: string }>(`/api/partner/proposals/${id}/send`, { method: "POST" }),
  withdrawProposal: (id: string) =>
    request<void>(`/api/partner/proposals/${id}/withdraw`, { method: "POST" }),

  // ------------------------------------------- the firm's side of partners

  growthPartners: () => request<GrowthPartnerOverview>("/api/growth-partners"),
  addPartner: (body: {
    full_name: string;
    email: string;
    phone?: string;
    business_name?: string;
    commission_rate: number;
    commission_months: number;
    hold_days: number;
  }) =>
    request<{ id: string; invitation_url: string }>("/api/growth-partners", {
      method: "POST",
      body,
    }),
  setPartnerStatus: (id: string, status: PartnerState, reason?: string) =>
    request<void>(`/api/growth-partners/${id}/status`, {
      method: "POST",
      body: { status, reason },
    }),
  invitePartner: (id: string) =>
    request<{ invitation_url: string }>(`/api/growth-partners/${id}/invite`, {
      method: "POST",
    }),
  extendHold: (prospectId: string, days: number, reason: string) =>
    request<{ hold_until: string }>(`/api/prospects/${prospectId}/extend-hold`, {
      method: "POST",
      body: { days, reason },
    }),
  markProspectWon: (prospectId: string, clientId: string, wonOn?: string) =>
    request<{ ok: true }>(`/api/prospects/${prospectId}/won`, {
      method: "POST",
      body: { client_id: clientId, won_on: wonOn },
    }),
  approveCommission: (id: string) =>
    request<void>(`/api/commissions/${id}/approve`, { method: "POST" }),
  cancelCommission: (id: string, reason: string) =>
    request<void>(`/api/commissions/${id}/cancel`, { method: "POST", body: { reason } }),
  payCommission: (id: string, reference?: string) =>
    request<void>(`/api/commissions/${id}/paid`, { method: "POST", body: { reference } }),

  // --------------------------------------------- what a prospect can reach

  readProposal: (token: string) =>
    request<{ id: string; reference: string; status: string; document: ProposalDocument }>(
      `/api/proposals/${encodeURIComponent(token)}`,
    ),
  decideProposal: (token: string, decision: "accepted" | "declined", reason?: string) =>
    request<void>(`/api/proposals/${encodeURIComponent(token)}/decide`, {
      method: "POST",
      body: { decision, reason },
    }),

  clientLogin: (email: string, password: string) =>
    request<{ ok: true }>("/api/client/login", { method: "POST", body: { email, password } }),
  clientLogout: () => request<{ ok: true }>("/api/client/logout", { method: "POST" }),

  /**
   * Asks for a reset link.
   *
   * The answer is the same sentence whether or not that address has an account, so the
   * caller cannot learn anything from it - and must not try to.
   */
  clientForgotPassword: (email: string) =>
    request<{ ok: true; message: string }>("/api/client/forgot-password", {
      method: "POST",
      body: { email },
    }),
  clientSession: () => request<{ user: ClientPortalUser }>("/api/client/session"),
  clientInvitation: (token: string) =>
    request<{ full_name: string; email: string; client_name: string }>(
      `/api/client/invitation/${encodeURIComponent(token)}`,
    ),
  acceptClientInvitation: (token: string, password: string) =>
    request<{ ok: true }>(`/api/client/invitation/${encodeURIComponent(token)}`, {
      method: "POST",
      body: { password },
    }),
  changeClientPassword: (current: string, password: string) =>
    request<void>("/api/client/password", { method: "POST", body: { current, password } }),
  /*
   * A question, not a change. The Worker notifies whoever holds the client and touches
   * nothing about what they are on.
   */
  clientAskAboutPackage: (tier: ClientTier) =>
    request<void>("/api/client/package-enquiry", { method: "POST", body: { tier } }),

  clientMySubscription: () => request<ClientPortalSubscription>("/api/client/subscription"),
  clientAskForService: (serviceId: string, note?: string) =>
    request<{ id: string }>("/api/client/services", {
      method: "POST",
      body: { service_id: serviceId, note },
    }),
  clientMoveService: (id: string, status: "agreed" | "declined") =>
    request<void>(`/api/client/services/${id}`, { method: "PATCH", body: { status } }),
  clientMyInvoices: () => request<ClientInvoiceList>("/api/client/invoices"),
  clientMyInvoice: (id: string) => request<ClientInvoiceDetail>(`/api/client/invoices/${id}`),

  // -------------------------------------------------------------- removals
  /** What removing this person would cost. Changes nothing; safe to call freely. */
  removalPreview: (userId: string) =>
    request<RemovalPreview>(`/api/users/${userId}/removal`),

  /**
   * Removes somebody. `retire` keeps the anonymised row so the client work stays
   * complete; `erase` really deletes it, cascades and all.
   */
  removeUser: (userId: string, removal: Removal, confirmation: string) =>
    request<{ removed: Removal; footprint: RemovalFootprint }>(`/api/users/${userId}`, {
      method: "DELETE",
      body: { removal, confirmation },
    }),

  templateRemovalPreview: (id: string) =>
    request<{
      template: { id: string; name: string; active: boolean };
      deliverables: number;
      open_deliverables: number;
      confirmation: string;
    }>(`/api/templates/${id}/removal`),

  deleteTemplate: (id: string) =>
    request<{ deleted: string; deliverables_kept: number }>(`/api/templates/${id}`, {
      method: "DELETE",
    }),

  // ----------------------------------------------------- client allocations
  /** The person's own clients: what they hold, and what they have been offered. */
  myAllocations: () =>
    request<{ allocations: ClientAllocation[]; on_associate_agreement: boolean }>(
      "/api/me/allocations",
    ),

  clientAllocations: (clientId: string) =>
    request<{ allocations: ClientAllocation[] }>(`/api/clients/${clientId}/allocations`),

  allocations: (status?: AllocationStatus) =>
    request<{ allocations: ClientAllocation[] }>(
      `/api/allocations${status ? `?status=${status}` : ""}`,
    ),

  /*
   * No tier. It is read off the client's subscription by the Worker, because the
   * package a client is on decides the associate's fee under Schedule 2 and there is
   * one place that is set.
   */
  offerClient: (
    clientId: string,
    input: { user_id: string; note?: string | null },
  ) =>
    request<{ allocation: ClientAllocation }>(`/api/clients/${clientId}/allocations`, {
      method: "POST",
      body: input,
    }),

  acceptAllocation: (id: string) =>
    request<{ allocation: ClientAllocation }>(`/api/allocations/${id}/accept`, {
      method: "POST",
      body: {},
    }),

  /**
   * Declining, on a named ground. `outcome` says whether the record counts it against
   * them - the operative half of clause 8.2, said back to the person who used it.
   */
  declineAllocation: (id: string, ground: DeclineGround, reason: string | null) =>
    request<{ allocation: ClientAllocation; outcome: string }>(
      `/api/allocations/${id}/decline`,
      { method: "POST", body: { ground, reason } },
    ),

  withdrawAllocation: (id: string, note?: string | null) =>
    request<{ allocation: ClientAllocation }>(`/api/allocations/${id}/withdraw`, {
      method: "POST",
      body: { note },
    }),

  endAllocation: (id: string, note?: string | null) =>
    request<{ allocation: ClientAllocation }>(`/api/allocations/${id}/end`, {
      method: "POST",
      body: { note },
    }),

  // -------------------------------------------------------- status reports
  /** The person's own report: which one is current, and what they may reference. */
  myStatusReport: () => request<StatusReportView>("/api/me/status-report"),

  /** Writes the current report, or amends it if one is already in. */
  submitStatusReport: (input: {
    body: string;
    blockers: string | null;
    tasks: Array<{ task_id: string; note: string | null }>;
  }) =>
    request<{ report: StatusReport }>("/api/me/status-report", {
      method: "POST",
      body: input,
    }),

  /** Who has reported and who has not, for the reporting day just passed. */
  teamStatusReports: (dueOn?: string) =>
    request<TeamStatusReports>(
      `/api/status-reports${dueOn ? `?due_on=${encodeURIComponent(dueOn)}` : ""}`,
    ),

  /** One person's reports, for them and whoever supervises them. */
  statusReportsFor: (userId: string) =>
    request<{ reports: StatusReport[] }>(`/api/employees/${userId}/status-reports`),

  statusReportPolicy: () =>
    request<{ schedule: ReportSchedule }>("/api/status-report-policy"),

  /** Everybody, and whether the firm asks them for status reports. */
  statusReportDuties: () =>
    request<{ schedule: ReportSchedule; people: ReportDutyRow[] }>(
      "/api/status-report-duties",
    ),

  setStatusReportDuty: (userId: string, duty: ReportDuty) =>
    request<{ duty: ReportDuty }>(`/api/employees/${userId}/status-report-duty`, {
      method: "PATCH",
      body: { duty },
    }),

  saveStatusReportPolicy: (schedule: ReportSchedule) =>
    request<{ schedule: ReportSchedule }>("/api/status-report-policy", {
      method: "PUT",
      body: schedule,
    }),

  // ------------------------------------------------------ contract details
  /** The firm's standard terms, the same in every contract it issues. */
  contractDefaults: () =>
    request<{ values: Record<string, string>; fields: ContractField[] }>(
      "/api/contract-defaults",
    ),

  saveContractDefaults: (values: Record<string, string>) =>
    request<{ values: Record<string, string> }>("/api/contract-defaults", {
      method: "PUT",
      body: { values },
    }),

  /** What one person's contract would say today, placeholder by placeholder. */
  contractDetails: (userId: string) =>
    request<ContractDetails>(`/api/employees/${userId}/contract-details`),

  saveContractDetails: (userId: string, values: Record<string, string>) =>
    request<{ ok: true }>(`/api/employees/${userId}/contract-details`, {
      method: "PUT",
      body: { values },
    }),

  rotateIntakeLink: (kind: string) =>
    request<{ link: IntakeLink }>(`/api/intake-links/${kind}/rotate`, {
      method: "POST",
    }),

  // --------------------------------------------------------------- insights
  dashboard: () => request<Dashboard>("/api/dashboard"),

  reports: () => request<Reports>("/api/reports"),

  notifications: (unreadOnly = false) =>
    request<{ notifications: Notification[] }>(
      `/api/notifications${unreadOnly ? "?unread=1" : ""}`,
    ),

  markNotificationsRead: (ids?: string[]) =>
    request<{ unread_notifications: number }>("/api/notifications/read", {
      method: "POST",
      body: { ids: ids ?? [] },
    }),

  // ------------------------------------------------------- employee portal
  settings: () => request<{ settings: FirmSettings }>("/api/settings"),

  updateSettings: (input: Partial<FirmSettings>) =>
    request<{ settings: FirmSettings }>("/api/settings", {
      method: "PATCH",
      body: input,
    }),

  myProfile: () =>
    request<{
      profile: Record<string, string | null> | null;
      missing_profile_fields: string[];
    }>("/api/me/profile"),

  updateMyProfile: (input: Record<string, unknown>) =>
    request<{
      profile: Record<string, string | null> | null;
      missing_profile_fields: string[];
    }>("/api/me/profile", { method: "PATCH", body: input }),

  myOnboarding: () => request<MyOnboarding>("/api/me/onboarding"),

  setOnboardingItem: (id: string, isDone: boolean) =>
    request<{ item: OnboardingItem }>(`/api/onboarding-items/${id}`, {
      method: "PATCH",
      body: { is_done: isDone },
    }),

  employees: (params: Record<string, string | undefined> = {}) =>
    request<{ employees: EmployeeSummary[]; can_administer: boolean }>(
      `/api/employees${qs(params)}`,
    ),

  employee: (id: string) => request<EmployeeFile>(`/api/employees/${id}`),

  updateEmployee: (id: string, input: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/employees/${id}`, { method: "PATCH", body: input }),

  updateCompensation: (id: string, input: Record<string, unknown>) =>
    request<{ compensation: EmployeeCompensation }>(
      `/api/employees/${id}/compensation`,
      { method: "PATCH", body: input },
    ),

  startOnboarding: (id: string) =>
    request<{ ok: true; created: number }>(`/api/employees/${id}/onboarding`, {
      method: "POST",
    }),

  addOnboardingItem: (id: string, input: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/employees/${id}/onboarding-items`, {
      method: "POST",
      body: input,
    }),

  addEmployeeDocument: (id: string, input: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/employees/${id}/documents`, {
      method: "POST",
      body: input,
    }),

  onboardingOverview: () =>
    request<{ employees: Array<Record<string, unknown>> }>("/api/onboarding"),

  // ------------------------------------------------------- portal documents
  documents: (params: Record<string, string | undefined> = {}) =>
    request<{ documents: Array<PortalDocument & { my_action: string | null; my_signed_at: string | null }> }>(
      `/api/documents${qs(params)}`,
    ),

  document: (id: string) =>
    request<{
      document: PortalDocumentDetail;
      my_signature: DocumentSignature | null;
      /** What they have on file to sign with; null where none is needed. */
      my_signature_specimen: SignatureSpecimen | null;
      signatures?: DocumentSignature[];
      outstanding?: Array<{ user_id: string; full_name: string }>;
    }>(`/api/documents/${id}`),

  signDocument: (id: string, typedName: string) =>
    request<{ signature: DocumentSignature }>(`/api/documents/${id}/sign`, {
      method: "POST",
      body: { typed_name: typedName },
    }),

  createDocument: (input: Record<string, unknown>) =>
    request<{ document: PortalDocument }>("/api/documents", {
      method: "POST",
      body: input,
    }),

  updateDocument: (id: string, input: Record<string, unknown>) =>
    request<{ document: PortalDocument }>(`/api/documents/${id}`, {
      method: "PATCH",
      body: input,
    }),

  setDocumentStatus: (id: string, status: "draft" | "published" | "archived") =>
    request<{ document: PortalDocument }>(`/api/documents/${id}/publish`, {
      method: "POST",
      body: { status },
    }),
};
