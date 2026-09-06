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
import type { TwoFactorStatus } from "@shared/twofactor";
import type { DeviceTrustPolicy, TrustedDevice } from "@shared/device-trust";
import type { IdlePolicy } from "@shared/session-policy";
import type {
  ChecklistItem,
  DocumentSignature,
  EmployeeCompensation,
  EmployeeFile,
  EmployeeSummary,
  FirmSettings,
  MyOnboarding,
  OnboardingItem,
  PortalDocument,
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
  unread_notifications?: number;
  /** The firm's inactivity setting, so the browser knows what to count down to. */
  idle_policy?: IdlePolicy;
  /** True when the session just ended because the portal was left idle. */
  idled?: boolean;
}

/** What the password step returns when the account has a second factor. */
export interface LoginChallenge {
  token: string;
  expires_at: string;
  methods: Array<"totp" | "questions" | "recovery">;
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
    request<{ user: User }>(`/api/users/${id}`, { method: "PATCH", body: input }),

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
    request<{ document: PortalDocument }>(`/api/documents/${id}/copy-for`, {
      method: "POST",
      body: { assigned_user_id: assignedUserId, title, ...options },
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
