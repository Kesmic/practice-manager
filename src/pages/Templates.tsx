import { useEffect, useState } from "react";
import type { ClientSummary, TaskTemplate, User } from "@shared/types";
import {
  MIN_REVIEWER_ROLE,
  RECURRENCE_LABELS,
  ROLE_LABELS,
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
  TextInput,
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

  useEffect(() => {
    void api
      .templates()
      .then((res) => setTemplates(res.templates))
      .catch((err) => {
        setError(err instanceof ApiRequestError ? err.message : "Could not load templates.");
        setTemplates([]);
      });
    void Promise.all([api.clients({ status: "active" }), api.users()])
      .then(([clientRes, userRes]) => {
        setClients(clientRes.clients);
        setUsers(userRes.users);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="section-title">Job templates</h1>
        <p className="muted mt-0.5">
          Standard procedures and statutory deadline rules for recurring compliance work.
          Generate a filing calendar across many clients at once.
        </p>
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
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={() => setGenerating(template)}
                    >
                      Generate jobs
                    </button>
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
                : "One-off template — only a single period can be generated."
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
                    {user.full_name} — {ROLE_LABELS[user.role]}
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
                      {user.full_name} — {ROLE_LABELS[user.role]}
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
                        className="h-4 w-4 rounded border-slate-300 text-brand-600"
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
