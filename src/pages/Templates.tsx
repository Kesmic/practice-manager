import { useEffect, useState } from "react";
import type {
  ChecklistTemplateItem,
  ClientSummary,
  TaskTemplate,
  User,
} from "@shared/types";
import {
  MIN_REVIEWER_ROLE,
  PRIORITIES,
  PRIORITY_LABELS,
  RECURRENCES,
  RECURRENCE_LABELS,
  ROLE_LABELS,
  SERVICE_LINES,
  SERVICE_LINE_LABELS,
  atLeast,
} from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  SuccessBanner,
  TextArea,
  TextInput,
  options,
} from "../components/ui";
import { formatHours } from "../lib/format";

export function Templates() {
  const { can } = useSession();
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState<TaskTemplate | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  // `null` means the editor is closed; "new" means create; otherwise edit that one.
  const [editing, setEditing] = useState<TaskTemplate | "new" | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  const reload = (inactive = includeInactive) =>
    api
      .templates(inactive)
      .then((res) => setTemplates(res.templates))
      .catch((err) => {
        setError(err instanceof ApiRequestError ? err.message : "Could not load templates.");
        setTemplates([]);
      });

  useEffect(() => {
    void api
      .templates()
      .then((res) => setTemplates(res.templates))
      .catch((err) => {
        setError(err instanceof ApiRequestError ? err.message : "Could not load templates.");
        setTemplates([]);
      });
  /*
    Fetched independently rather than with Promise.all. Clients and job templates are
    areas the firm can close to a grade, and one refusal in an all() takes the other
    lists down with it, emptying lists the person is still entitled to.
  */
    void api
      .clients({ status: "active" })
      .then((res) => setClients(res.clients))
      .catch(() => setClients([]));
    void api
      .users()
      .then((res) => setUsers(res.users))
      .catch(() => setUsers([]));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="section-title">Job templates</h1>
          <p className="muted mt-0.5">
            Standard procedures and statutory deadline rules for recurring compliance work.
            Generate a filing calendar across many clients at once.
          </p>
        </div>
        {can("manager") && (
          <div className="flex shrink-0 items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => {
                  setIncludeInactive(e.target.checked);
                  void reload(e.target.checked);
                }}
              />
              Show retired
            </label>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => setEditing("new")}
            >
              New template
            </button>
          </div>
        )}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {templates === null ? (
        <Spinner label="Loading templates" />
      ) : !templates.length ? (
        <div className="card">
          <EmptyState title="No templates configured" />
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((template) => (
            <div key={template.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">{template.name}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
                      {SERVICE_LINE_LABELS[template.service_line]}
                    </span>
                    <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
                      {RECURRENCE_LABELS[template.default_recurrence]}
                    </span>
                    {template.due_date_rule && (
                      <span className="pill bg-brand-50 text-brand-800 ring-brand-200">
                        Due day {template.due_date_rule.day}
                        {template.due_date_rule.month_offset > 0 &&
                          `, +${template.due_date_rule.month_offset}mo after period end`}
                      </span>
                    )}
                    {template.budget_hours && (
                      <span className="text-xs text-slate-500">
                        Budget {formatHours(template.budget_hours)}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">
                      {template.checklist.length} procedure(s)
                    </span>
                    {template.active === 0 && (
                      <span className="pill bg-rose-50 text-rose-700 ring-rose-200">
                        Retired
                      </span>
                    )}
                  </div>
                  {template.description && (
                    <p className="mt-2 max-w-3xl text-sm text-slate-600">
                      {template.description}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() =>
                      setExpanded((current) => (current === template.id ? null : template.id))
                    }
                  >
                    {expanded === template.id ? "Hide procedures" : "View procedures"}
                  </button>
                  {can("manager") && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setEditing(template)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => setGenerating(template)}
                        disabled={template.active === 0}
                        title={
                          template.active === 0
                            ? "Retired templates cannot generate new jobs."
                            : undefined
                        }
                      >
                        Generate jobs
                      </button>
                    </>
                  )}
                </div>
              </div>

              {expanded === template.id && (
                <ol className="mt-4 space-y-1.5 border-t border-slate-200 pt-3">
                  {template.checklist.map((item, index) => (
                    <li key={index} className="flex gap-2 text-sm text-slate-700">
                      <span className="text-slate-400 tabular-nums">{index + 1}.</span>
                      <span>
                        {item.label}
                        {item.mandatory && (
                          <span className="ml-2 pill bg-slate-100 text-slate-600 ring-slate-200">
                            Mandatory
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}

      <TemplateModal
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null);
          setNotice(message);
          await reload();
        }}
      />

      <GenerateModal
        template={generating}
        clients={clients}
        users={users}
        onClose={() => setGenerating(null)}
        onDone={(message) => {
          setNotice(message);
          setGenerating(null);
        }}
      />
    </div>
  );
}

function GenerateModal({
  template,
  clients,
  users,
  onClose,
  onDone,
}: {
  template: TaskTemplate | null;
  clients: ClientSummary[];
  users: User[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [periodEnd, setPeriodEnd] = useState("");
  const [periods, setPeriods] = useState("1");
  const [assigneeId, setAssigneeId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected([]);
    setPeriodEnd("");
    setPeriods("1");
    setAssigneeId("");
    setReviewerId("");
    setError(null);
  }, [template]);

  if (!template) return null;

  const recurring = template.default_recurrence !== "none";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.generateFromTemplate(template.id, {
        client_ids: selected,
        period_end: periodEnd,
        periods: Number(periods),
        assignee_id: assigneeId || null,
        reviewer_id: reviewerId || null,
      });
      const parts = [`Created ${result.created.length} deliverable(s).`];
      if (result.skipped.length) {
        parts.push(`${result.skipped.length} already existed and were skipped.`);
      }
      onDone(parts.join(" "));
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? [err.message, err.detail].filter(Boolean).join(" ")
          : "Could not generate the deliverables.",
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const total = selected.length * Math.max(Number(periods) || 1, 1);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Generate: ${template.name}`}
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="generate-jobs"
            className="btn-primary"
            disabled={busy || !selected.length || !periodEnd}
          >
            {busy ? "Generating…" : `Generate ${total || ""} deliverable(s)`}
          </button>
        </>
      }
    >
      <form id="generate-jobs" onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
          Deadlines are derived from the period end using this template's rule
          {template.due_date_rule
            ? `: day ${template.due_date_rule.day} of the month ${
                template.due_date_rule.month_offset === 0
                  ? "the period ends"
                  : `+${template.due_date_rule.month_offset} after period end`
              }, with the internal target set ${template.internal_lead_days} days earlier.`
            : ". This template has no deadline rule, so no dates will be set."}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="First period end"
            required
            hint="The last day of the period being reported on."
          >
            {(id) => (
              <TextInput
                id={id}
                type="date"
                required
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Number of periods"
            hint={
              recurring
                ? `Consecutive ${RECURRENCE_LABELS[template.default_recurrence].toLowerCase()} periods.`
                : "One-off template - only a single period can be generated."
            }
          >
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min="1"
                max="24"
                disabled={!recurring}
                value={periods}
                onChange={(event) => setPeriods(event.target.value)}
              />
            )}
          </Field>
          <Field label="Assign all to (preparer)">
            {(id) => (
              <Select
                id={id}
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
              >
                <option value="">Leave unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} - {ROLE_LABELS[user.role]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reviewer">
            {(id) => (
              <Select
                id={id}
                value={reviewerId}
                onChange={(event) => setReviewerId(event.target.value)}
              >
                <option value="">Assign later</option>
                {users
                  .filter(
                    (user) => atLeast(user.role, MIN_REVIEWER_ROLE) && user.id !== assigneeId,
                  )
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name} - {ROLE_LABELS[user.role]}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">Clients ({selected.length} selected)</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setSelected(clients.map((client) => client.id))}
              >
                Select all
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setSelected([])}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md ring-1 ring-inset ring-slate-200">
            {!clients.length ? (
              <p className="p-4 text-sm text-slate-500">No active clients on file.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {clients.map((client) => (
                  <li key={client.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selected.includes(client.id)}
                        onChange={() => toggle(client.id)}
                        className="h-4 w-4 rounded border-slate-300 text-link"
                      />
                      <span className="font-mono text-xs text-slate-500">{client.code}</span>
                      <span className="text-slate-800">{client.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/** A blank template, so creating and editing use exactly the same form. */
const EMPTY: Omit<TaskTemplate, "id" | "created_at"> = {
  name: "",
  service_line: "tax_compliance",
  task_type: "",
  description: "",
  default_priority: "normal",
  default_recurrence: "monthly",
  budget_hours: null,
  checklist: [],
  due_date_rule: null,
  internal_lead_days: 5,
  active: 1,
};

/**
 * Creating and modifying a job template.
 *
 * One form for both, because the fields are identical and two forms drift apart.
 * The statutory deadline is deliberately expressed the way the tax rules are
 * written - so many months after the period ends, on such a day - rather than as a
 * fixed date, which is what lets one template generate a whole year of filings.
 */
function TemplateModal({
  target,
  onClose,
  onSaved,
}: {
  target: TaskTemplate | "new" | null;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const creating = target === "new";
  const [form, setForm] = useState(EMPTY);
  const [hasDeadline, setHasDeadline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reload the form whenever a different template is opened.
  useEffect(() => {
    if (!target) return;
    setError(null);
    if (target === "new") {
      setForm(EMPTY);
      setHasDeadline(false);
    } else {
      const { id: _id, created_at: _created, ...rest } = target;
      setForm({ ...rest, task_type: rest.task_type ?? "", description: rest.description ?? "" });
      setHasDeadline(Boolean(target.due_date_rule));
    }
  }, [target]);

  if (!target) return null;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setItem = (index: number, patch: Partial<ChecklistTemplateItem>) =>
    setForm((prev) => ({
      ...prev,
      checklist: prev.checklist.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));

  const move = (index: number, by: number) =>
    setForm((prev) => {
      const next = [...prev.checklist];
      const to = index + by;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return { ...prev, checklist: next };
    });

  const rule = form.due_date_rule ?? { month_offset: 1, day: 15 };

  const save = async () => {
    if (!form.name.trim()) {
      setError("Give the template a name.");
      return;
    }
    const checklist = form.checklist.filter((item) => item.label.trim() !== "");
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        service_line: form.service_line,
        task_type: form.task_type || null,
        description: form.description || null,
        default_priority: form.default_priority,
        default_recurrence: form.default_recurrence,
        budget_hours: form.budget_hours,
        internal_lead_days: form.internal_lead_days,
        checklist,
        due_date_rule: hasDeadline ? rule : null,
        active: form.active === 1,
      };
      if (creating) {
        await api.createTemplate(payload);
        await onSaved(`"${form.name.trim()}" created.`);
      } else {
        await api.updateTemplate((target as TaskTemplate).id, payload);
        await onSaved(`"${form.name.trim()}" saved.`);
      }
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save the template.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={creating ? "New job template" : "Edit job template"}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : creating ? "Create template" : "Save changes"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <Field label="Name" required hint="What this job is called on a work list.">
          {(id) => (
            <TextInput
              id={id}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="VAT return - monthly"
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Service line">
            {(id) => (
              <Select
                id={id}
                value={form.service_line}
                onChange={(e) => set("service_line", e.target.value as typeof form.service_line)}
              >
                {options(SERVICE_LINES, SERVICE_LINE_LABELS)}
              </Select>
            )}
          </Field>
          <Field label="How often" hint="Recurring jobs roll forward when closed.">
            {(id) => (
              <Select
                id={id}
                value={form.default_recurrence}
                onChange={(e) =>
                  set("default_recurrence", e.target.value as typeof form.default_recurrence)
                }
              >
                {options(RECURRENCES, RECURRENCE_LABELS)}
              </Select>
            )}
          </Field>
          <Field label="Default priority">
            {(id) => (
              <Select
                id={id}
                value={form.default_priority}
                onChange={(e) =>
                  set("default_priority", e.target.value as typeof form.default_priority)
                }
              >
                {options(PRIORITIES, PRIORITY_LABELS)}
              </Select>
            )}
          </Field>
          <Field label="Short label" hint="Optional, e.g. VAT, PAYE. Shown on lists.">
            {(id) => (
              <TextInput
                id={id}
                value={form.task_type ?? ""}
                onChange={(e) => set("task_type", e.target.value)}
                placeholder="VAT"
              />
            )}
          </Field>
          <Field label="Budget hours" hint="Leave blank if you do not budget this job.">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min={0}
                step="0.5"
                value={form.budget_hours ?? ""}
                onChange={(e) =>
                  set("budget_hours", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            )}
          </Field>
          <Field
            label="Internal target, days early"
            hint="How far before the statutory deadline the work is due internally."
          >
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min={0}
                max={365}
                value={form.internal_lead_days}
                onChange={(e) => set("internal_lead_days", Number(e.target.value) || 0)}
              />
            )}
          </Field>
        </div>

        <Field label="Description">
          {(id) => (
            <TextArea
              id={id}
              rows={2}
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What this job covers, and anything the preparer should know before starting."
            />
          )}
        </Field>

        {/* ------------------------------------------------ statutory deadline */}
        <div className="rounded-md bg-slate-100 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={hasDeadline}
              onChange={(e) => {
                setHasDeadline(e.target.checked);
                set("due_date_rule", e.target.checked ? rule : null);
              }}
            />
            This job has a statutory filing deadline
          </label>
          {hasDeadline ? (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Months after the period ends">
                  {(id) => (
                    <TextInput
                      id={id}
                      type="number"
                      min={0}
                      max={24}
                      value={rule.month_offset}
                      onChange={(e) =>
                        set("due_date_rule", {
                          ...rule,
                          month_offset: Number(e.target.value) || 0,
                        })
                      }
                    />
                  )}
                </Field>
                <Field label="On day of the month">
                  {(id) => (
                    <TextInput
                      id={id}
                      type="number"
                      min={1}
                      max={31}
                      value={rule.day}
                      onChange={(e) =>
                        set("due_date_rule", { ...rule, day: Number(e.target.value) || 1 })
                      }
                    />
                  )}
                </Field>
              </div>
              <p className="hint mt-2">
                For a July period ending 31 July, this gives{" "}
                <strong>
                  day {rule.day} of{" "}
                  {rule.month_offset === 0
                    ? "the same month"
                    : `${rule.month_offset} month${rule.month_offset === 1 ? "" : "s"} later`}
                </strong>
                . A day beyond the end of a short month is pulled back to the last day.
              </p>
            </>
          ) : (
            <p className="hint mt-1">
              Leave this off for internal work with no filing date, such as management
              accounts or a client onboarding.
            </p>
          )}
        </div>

        {/* ---------------------------------------------------------- procedures */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="label mb-0">Procedures</span>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() =>
                set("checklist", [...form.checklist, { label: "", mandatory: false }])
              }
            >
              + Add a procedure
            </button>
          </div>
          {form.checklist.length === 0 ? (
            <p className="hint">
              None yet. These become the tick-list on every job made from this template.
            </p>
          ) : (
            <ol className="space-y-2">
              {form.checklist.map((item, index) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="mt-2 w-5 shrink-0 text-right text-xs text-slate-400 tabular-nums">
                    {index + 1}.
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <TextInput
                      value={item.label}
                      onChange={(e) => setItem(index, { label: e.target.value })}
                      placeholder="Agree the VAT control account to the ledger"
                    />
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={Boolean(item.mandatory)}
                        onChange={(e) => setItem(index, { mandatory: e.target.checked })}
                      />
                      Must be ticked before the job can be submitted
                    </label>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      title="Move up"
                      aria-label={`Move procedure ${index + 1} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => move(index, 1)}
                      disabled={index === form.checklist.length - 1}
                      title="Move down"
                      aria-label={`Move procedure ${index + 1} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-rose-700"
                      onClick={() =>
                        set(
                          "checklist",
                          form.checklist.filter((_, i) => i !== index),
                        )
                      }
                      aria-label={`Remove procedure ${index + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {!creating && (
          <label className="flex cursor-pointer items-start gap-2 rounded-md bg-slate-100 p-3 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.active === 0}
              onChange={(e) => set("active", e.target.checked ? 0 : 1)}
            />
            <span>
              <strong>Retire this template.</strong> It stops appearing when new work is
              created and cannot generate jobs, but every job already made from it carries
              on untouched. Nothing is deleted.
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}
