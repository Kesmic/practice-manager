import { useEffect, useMemo, useState } from "react";
import type { ClientSummary, EngagementSummary, TaskTemplate, User } from "@shared/types";
import {
  MIN_REVIEWER_ROLE,
  PRIORITIES,
  PRIORITY_LABELS,
  RECURRENCES,
  RECURRENCE_LABELS,
  SERVICE_LINES,
  SERVICE_LINE_LABELS,
  ROLE_LABELS,
  atLeast,
  type ServiceLine,
} from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { ErrorBanner, Field, Modal, Select, TextArea, TextInput, options } from "./ui";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (taskId: string) => void;
  /** Pre-selects a client and hides the picker, for use from a client page. */
  fixedClientId?: string;
  clients: ClientSummary[];
  users: User[];
  templates: TaskTemplate[];
}

const blank = {
  client_id: "",
  engagement_id: "",
  template_id: "",
  title: "",
  description: "",
  service_line: "tax_compliance" as ServiceLine,
  task_type: "",
  priority: "normal",
  assignee_id: "",
  reviewer_id: "",
  period_label: "",
  period_end: "",
  planned_start_date: "",
  internal_due_date: "",
  statutory_due_date: "",
  budget_hours: "",
  recurrence: "none",
  status: "not_started",
};

export function NewTaskModal({
  open,
  onClose,
  onCreated,
  fixedClientId,
  clients,
  users,
  templates,
}: Props) {
  const { can } = useSession();
  const [form, setForm] = useState({ ...blank, client_id: fixedClientId ?? "" });
  const [engagements, setEngagements] = useState<EngagementSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSupervisor = can("manager");

  useEffect(() => {
    if (open) setForm({ ...blank, client_id: fixedClientId ?? "" });
  }, [open, fixedClientId]);

  // Engagements are per-client, so reload whenever the client changes.
  useEffect(() => {
    if (!form.client_id) {
      setEngagements([]);
      return;
    }
    let cancelled = false;
    api
      .engagements({ client_id: form.client_id })
      .then((res) => {
        if (!cancelled) setEngagements(res.engagements);
      })
      .catch(() => {
        if (!cancelled) setEngagements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.client_id]);

  const reviewers = useMemo(
    () => users.filter((u) => atLeast(u.role, MIN_REVIEWER_ROLE)),
    [users],
  );

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /** Applying a template fills the title, service line, budget and recurrence. */
  const applyTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    setForm((prev) => ({
      ...prev,
      template_id: templateId,
      ...(template
        ? {
            title: prev.title || template.name,
            service_line: template.service_line,
            task_type: template.task_type ?? "",
            description: template.description ?? "",
            priority: template.default_priority,
            recurrence: template.default_recurrence,
            budget_hours: template.budget_hours ? String(template.budget_hours) : "",
          }
        : {}),
    }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { task } = await api.createTask({
        client_id: form.client_id,
        engagement_id: form.engagement_id || null,
        template_id: form.template_id || null,
        title: form.title,
        description: form.description || null,
        service_line: form.service_line,
        task_type: form.task_type || null,
        priority: form.priority,
        assignee_id: form.assignee_id || null,
        reviewer_id: form.reviewer_id || null,
        period_label: form.period_label || null,
        period_end: form.period_end || null,
        planned_start_date: form.planned_start_date || null,
        internal_due_date: form.internal_due_date || null,
        statutory_due_date: form.statutory_due_date || null,
        budget_hours: form.budget_hours || null,
        recurrence: form.recurrence,
        status: isSupervisor ? form.status : "draft",
      });
      onCreated(task.id);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? [err.message, err.detail].filter(Boolean).join(" ")
          : "Could not create the deliverable.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New deliverable"
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="new-task-form"
            className="btn-primary"
            disabled={busy}
          >
            {busy ? "Creating…" : "Create deliverable"}
          </button>
        </>
      }
    >
      <form id="new-task-form" onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {!isSupervisor && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
            At your grade this is created as a draft. A manager or partner releases it to
            the assigned associate.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {!fixedClientId && (
            <Field label="Client" required>
              {(id) => (
                <Select
                  id={id}
                  required
                  value={form.client_id}
                  onChange={(e) => set("client_id")(e.target.value)}
                >
                  <option value="">Select a client…</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.code} — {client.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <Field label="Engagement" hint="Optional — links the job to a signed engagement.">
            {(id) => (
              <Select
                id={id}
                value={form.engagement_id}
                onChange={(e) => set("engagement_id")(e.target.value)}
                disabled={!form.client_id}
              >
                <option value="">No engagement</option>
                {engagements.map((engagement) => (
                  <option key={engagement.id} value={engagement.id}>
                    {engagement.code} — {engagement.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Start from a template"
            hint="Copies the standard procedures into the checklist."
          >
            {(id) => (
              <Select
                id={id}
                value={form.template_id}
                onChange={(e) => applyTemplate(e.target.value)}
              >
                <option value="">Blank deliverable</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Title" required>
          {(id) => (
            <TextInput
              id={id}
              required
              value={form.title}
              onChange={(e) => set("title")(e.target.value)}
              placeholder="Monthly VAT Return — Mar 2026"
            />
          )}
        </Field>

        <Field label="Scope and instructions">
          {(id) => (
            <TextArea
              id={id}
              rows={3}
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="What the associate needs to know to complete this deliverable."
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Service line" required>
            {(id) => (
              <Select
                id={id}
                value={form.service_line}
                onChange={(e) => set("service_line")(e.target.value)}
              >
                {options(SERVICE_LINES, SERVICE_LINE_LABELS)}
              </Select>
            )}
          </Field>
          <Field label="Priority">
            {(id) => (
              <Select
                id={id}
                value={form.priority}
                onChange={(e) => set("priority")(e.target.value)}
              >
                {options(PRIORITIES, PRIORITY_LABELS)}
              </Select>
            )}
          </Field>
          <Field label="Recurrence" hint="Recurring jobs roll forward when closed.">
            {(id) => (
              <Select
                id={id}
                value={form.recurrence}
                onChange={(e) => set("recurrence")(e.target.value)}
              >
                {options(RECURRENCES, RECURRENCE_LABELS)}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Assign to (preparer)">
            {(id) => (
              <Select
                id={id}
                value={form.assignee_id}
                onChange={(e) => set("assignee_id")(e.target.value)}
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} — {ROLE_LABELS[user.role]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Reviewer"
            hint="Senior Associate grade or above, and not the preparer."
          >
            {(id) => (
              <Select
                id={id}
                value={form.reviewer_id}
                onChange={(e) => set("reviewer_id")(e.target.value)}
              >
                <option value="">Assign later</option>
                {reviewers
                  .filter((user) => user.id !== form.assignee_id)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name} — {ROLE_LABELS[user.role]}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Period" hint="e.g. Mar 2026, FY2026">
            {(id) => (
              <TextInput
                id={id}
                value={form.period_label}
                onChange={(e) => set("period_label")(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Period end"
            hint="Last day of the period reported on. Used to roll recurring jobs forward."
          >
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={form.period_end}
                onChange={(e) => set("period_end")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Planned start">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={form.planned_start_date}
                onChange={(e) => set("planned_start_date")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Internal target">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={form.internal_due_date}
                onChange={(e) => set("internal_due_date")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Statutory deadline">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={form.statutory_due_date}
                onChange={(e) => set("statutory_due_date")(e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Budget hours">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min="0"
                step="0.5"
                value={form.budget_hours}
                onChange={(e) => set("budget_hours")(e.target.value)}
              />
            )}
          </Field>
          {isSupervisor && (
            <Field
              label="Create as"
              hint="Released work is visible to the associate immediately."
            >
              {(id) => (
                <Select
                  id={id}
                  value={form.status}
                  onChange={(e) => set("status")(e.target.value)}
                >
                  <option value="not_started">Released — not started</option>
                  <option value="draft">Draft — release later</option>
                </Select>
              )}
            </Field>
          )}
        </div>
      </form>
    </Modal>
  );
}
