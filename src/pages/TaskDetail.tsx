import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReviewPoint, TaskDetail as TaskDetailData } from "@shared/types";
import {
  PRIORITY_LABELS,
  REVIEW_SEVERITIES,
  SEVERITY_LABELS,
  SERVICE_LINE_LABELS,
  STATUS_LABELS,
  availableActions,
  can,
  isDisposed,
  type GateContext,
  type TransitionRule,
  type WorkflowAction,
} from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  Avatar,
  DetailRow,
  DuePill,
  ErrorBanner,
  Field,
  Modal,
  Progress,
  ReviewStatusPill,
  Select,
  SeverityPill,
  Spinner,
  StatusPill,
  SuccessBanner,
  TextArea,
  TextInput,
  options,
} from "../components/ui";
import {
  formatDate,
  formatDateTime,
  formatHours,
  humanise,
  relativeTime,
  today,
} from "../lib/format";

type Tab = "review" | "checklist" | "documents" | "time" | "discussion" | "activity";

export function TaskDetail() {
  const { id = "" } = useParams();
  const { user } = useSession();

  const [data, setData] = useState<TaskDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [pendingAction, setPendingAction] = useState<TransitionRule | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.task(id));
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not load this deliverable.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const gates: GateContext | null = useMemo(() => {
    if (!data) return null;
    return {
      checklist: {
        mandatoryOutstanding: data.checklist.filter(
          (item) => item.mandatory === 1 && item.is_done === 0,
        ).length,
      },
      review: {
        unansweredMustFix: data.review_points.filter(
          (point) => point.severity === "must_fix" && point.status === "open",
        ).length,
        unresolvedMustFix: data.review_points.filter(
          (point) => point.severity === "must_fix" && !isDisposed(point.status),
        ).length,
      },
    };
  }, [data]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data || !gates || !user) return <Spinner label="Loading deliverable" />;

  const { task } = data;
  const actor = { id: user.id, role: user.role };

  /*
   * Split the actions into ones the user can fire now, and ones they are
   * entitled to but that a workflow gate is blocking. Actions denied on grade
   * or segregation-of-duties grounds are hidden entirely rather than shown as
   * permanently disabled buttons.
   */
  const actions = availableActions(task, actor, gates)
    .map(({ rule, permission }) => ({
      rule,
      permission,
      entitled: can(rule.action, task, actor, {}).allowed,
    }))
    .filter((entry) => entry.entitled);

  const runAction = async (rule: TransitionRule, note?: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.transition(task.id, rule.action, note);
      await load();
      setPendingAction(null);
      setNotice(
        result.next_occurrence_id
          ? `${rule.label} recorded. The next period has been created automatically.`
          : `${rule.label} recorded.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "That action could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const openPoints = data.review_points.filter((point) => !isDisposed(point.status));

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">{task.ref}</span>
            <span>·</span>
            <Link to={`/clients/${task.client_id}`} className="link">
              {task.client_code} {task.client_name}
            </Link>
            {task.engagement_name && (
              <>
                <span>·</span>
                <span>{task.engagement_name}</span>
              </>
            )}
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {task.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill status={task.status} />
            <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
              {SERVICE_LINE_LABELS[task.service_line]}
            </span>
            {task.period_label && (
              <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
                {task.period_label}
              </span>
            )}
            {task.review_round > 0 && (
              <span className="pill bg-violet-50 text-violet-700 ring-violet-200">
                Review round {task.review_round}
              </span>
            )}
          </div>
        </div>

        {/* Workflow actions */}
        <div className="flex flex-wrap items-center gap-2">
          {actions.map(({ rule, permission }) => {
            const blocked = !permission.allowed;
            const className =
              rule.intent === "danger"
                ? "btn-danger"
                : rule.intent === "primary"
                  ? "btn-primary"
                  : "btn-secondary";
            return (
              <button
                key={rule.action}
                type="button"
                className={className}
                disabled={blocked || busy}
                title={blocked ? (permission as { reason: string }).reason : rule.hint}
                onClick={() =>
                  rule.requiresNote ? setPendingAction(rule) : void runAction(rule)
                }
              >
                {rule.label}
              </button>
            );
          })}
          {!actions.length && (
            <span className="muted">No actions available to you at this stage.</span>
          )}
        </div>
      </div>

      {/* Explain any blocked action so the user knows what to do next. */}
      {actions
        .filter((entry) => !entry.permission.allowed)
        .map((entry) => (
          <div
            key={entry.rule.action}
            className="rounded-md bg-amber-50 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"
          >
            <span className="font-medium">{entry.rule.label} is blocked:</span>{" "}
            {(entry.permission as { reason: string }).reason}
          </div>
        ))}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ------------------------------------------------------ main column */}
        <div className="space-y-5 lg:col-span-2">
          {task.description && (
            <div className="card p-4">
              <h2 className="card-title mb-2">Scope and instructions</h2>
              <p className="whitespace-pre-wrap text-sm text-slate-700">
                {task.description}
              </p>
            </div>
          )}

          <div className="card">
            <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2">
              {(
                [
                  ["review", `Review points${openPoints.length ? ` (${openPoints.length})` : ""}`],
                  ["checklist", `Procedures (${data.checklist.filter((c) => c.is_done).length}/${data.checklist.length})`],
                  ["documents", `Documents (${data.attachments.length})`],
                  ["time", `Time (${formatHours(task.logged_hours)})`],
                  ["discussion", `Discussion (${data.comments.length})`],
                  ["activity", "Audit trail"],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                    tab === key
                      ? "border-brand-600 text-link"
                      : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {tab === "review" && (
                <ReviewPanel data={data} onChanged={load} setError={setError} />
              )}
              {tab === "checklist" && (
                <ChecklistPanel data={data} onChanged={load} setError={setError} />
              )}
              {tab === "documents" && (
                <DocumentsPanel data={data} onChanged={load} setError={setError} />
              )}
              {tab === "time" && (
                <TimePanel data={data} onChanged={load} setError={setError} />
              )}
              {tab === "discussion" && (
                <DiscussionPanel data={data} onChanged={load} setError={setError} />
              )}
              {tab === "activity" && <ActivityPanel data={data} />}
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------- sidebar */}
        <div className="space-y-5">
          <div className="card p-4">
            <h2 className="card-title mb-2">Assignment</h2>
            <dl className="divide-y divide-slate-100">
              <DetailRow label="Preparer">
                {task.assignee_name ? (
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={task.assignee_name} />
                    {task.assignee_name}
                  </span>
                ) : (
                  <span className="text-amber-700">Unassigned</span>
                )}
              </DetailRow>
              <DetailRow label="Reviewer">
                {task.reviewer_name ?? <span className="text-slate-400">Not named</span>}
              </DetailRow>
              <DetailRow label="Priority">{PRIORITY_LABELS[task.priority]}</DetailRow>
            </dl>
          </div>

          <div className="card p-4">
            <h2 className="card-title mb-2">Timeline</h2>
            <dl className="divide-y divide-slate-100">
              <DetailRow label="Planned start">
                {formatDate(task.planned_start_date)}
              </DetailRow>
              <DetailRow label="Internal target">
                <span className="inline-flex items-center gap-2">
                  {formatDate(task.internal_due_date)}
                  <DuePill date={task.internal_due_date} />
                </span>
              </DetailRow>
              <DetailRow label="Statutory deadline">
                <span className="inline-flex items-center gap-2">
                  {formatDate(task.statutory_due_date)}
                  <DuePill date={task.statutory_due_date} />
                </span>
              </DetailRow>
              {task.submitted_at && (
                <DetailRow label="Last submitted">
                  {formatDateTime(task.submitted_at)}
                </DetailRow>
              )}
              {task.approved_at && (
                <DetailRow label="Approved">{formatDateTime(task.approved_at)}</DetailRow>
              )}
              {task.closed_at && (
                <DetailRow label="Closed">{formatDateTime(task.closed_at)}</DetailRow>
              )}
            </dl>
          </div>

          <div className="card p-4">
            <h2 className="card-title mb-2">Effort</h2>
            <dl className="divide-y divide-slate-100">
              <DetailRow label="Budget">{formatHours(task.budget_hours)}</DetailRow>
              <DetailRow label="Logged">{formatHours(task.logged_hours)}</DetailRow>
              <DetailRow label="Procedures">
                <Progress done={task.checklist_done} total={task.checklist_total} />
              </DetailRow>
            </dl>
          </div>
        </div>
      </div>

      {/* Note prompt for actions that require a reason on the record. */}
      <NoteModal
        rule={pendingAction}
        busy={busy}
        onCancel={() => setPendingAction(null)}
        onConfirm={(note) => pendingAction && void runAction(pendingAction, note)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Note prompt
// ---------------------------------------------------------------------------

function NoteModal({
  rule,
  busy,
  onCancel,
  onConfirm,
}: {
  rule: TransitionRule | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");

  useEffect(() => {
    setNote("");
  }, [rule]);

  if (!rule) return null;

  return (
    <Modal
      open
      title={rule.label}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={rule.intent === "danger" ? "btn-danger" : "btn-primary"}
            disabled={busy || !note.trim()}
            onClick={() => onConfirm(note.trim())}
          >
            {busy ? "Working…" : rule.label}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{rule.hint}</p>
      <Field label="Note for the record" required>
        {(id) => (
          <TextArea
            id={id}
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="This is recorded on the audit trail and shown to the people involved."
          />
        )}
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Review points
// ---------------------------------------------------------------------------

interface PanelProps {
  data: TaskDetailData;
  onChanged: () => Promise<void>;
  setError: (message: string | null) => void;
}

function ReviewPanel({ data, onChanged, setError }: PanelProps) {
  const { user } = useSession();
  const { task } = data;
  const [form, setForm] = useState({ body: "", severity: "must_fix", reference: "" });
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const isPreparer = task.assignee_id === user.id;
  // Whoever may approve may also raise points, which is exactly the rule the
  // server enforces: reviewing grade, and not the preparer.
  const canReview = can("approve", task, { id: user.id, role: user.role }, {}).allowed
    || can("request_rework", task, { id: user.id, role: user.role }, {}).allowed;
  const canRaise = canReview && task.status === "under_review";

  const raise = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.raiseReviewPoint(task.id, {
        body: form.body,
        severity: form.severity,
        reference: form.reference || undefined,
      });
      setForm({ body: "", severity: "must_fix", reference: "" });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not raise the point.");
    } finally {
      setBusy(false);
    }
  };

  const rounds = [...new Set(data.review_points.map((point) => point.round))].sort(
    (a, b) => b - a,
  );

  return (
    <div className="space-y-5">
      {canRaise && (
        <form onSubmit={raise} className="rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">Raise a review point</h3>
          <div className="space-y-3">
            <Field label="Review point" required>
              {(id) => (
                <TextArea
                  id={id}
                  rows={3}
                  required
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  placeholder="State what needs to change and why."
                />
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Severity">
                {(id) => (
                  <Select
                    id={id}
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value })}
                  >
                    {options(REVIEW_SEVERITIES, SEVERITY_LABELS)}
                  </Select>
                )}
              </Field>
              <Field label="Reference" hint="Working paper, schedule or line item.">
                {(id) => (
                  <TextInput
                    id={id}
                    value={form.reference}
                    onChange={(e) => setForm({ ...form, reference: e.target.value })}
                    placeholder="WP 3.2 / Note 14"
                  />
                )}
              </Field>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary btn-sm" disabled={busy}>
                {busy ? "Adding…" : "Add review point"}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Must-fix points have to be answered before resubmission and disposed of before
            approval.
          </p>
        </form>
      )}

      {/* Review round history */}
      {data.reviews.length > 0 && (
        <div className="space-y-2">
          {data.reviews.map((round) => (
            <div key={round.id} className="rounded-md bg-panel p-3 text-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">Round {round.round}</span>
                <span className="text-xs text-slate-500">
                  {round.reviewer_name} · started {relativeTime(round.started_at)}
                  {round.decided_at && ` · decided ${relativeTime(round.decided_at)}`}
                </span>
              </div>
              {round.decision && (
                <p className="mt-1">
                  <span
                    className={`pill ${
                      round.decision === "approved"
                        ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                        : "bg-rose-50 text-rose-700 ring-rose-200"
                    }`}
                  >
                    {round.decision === "approved" ? "Approved" : "Returned for rework"}
                  </span>
                </p>
              )}
              {round.summary && (
                <p className="mt-2 whitespace-pre-wrap text-slate-700">{round.summary}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!data.review_points.length ? (
        <p className="py-6 text-center text-sm text-slate-500">
          No review points have been raised on this deliverable.
        </p>
      ) : (
        rounds.map((round) => (
          <section key={round}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Round {round}
            </h3>
            <ul className="space-y-3">
              {data.review_points
                .filter((point) => point.round === round)
                .map((point) => (
                  <ReviewPointCard
                    key={point.id}
                    point={point}
                    canReview={canReview}
                    isPreparer={isPreparer}
                    onChanged={onChanged}
                    setError={setError}
                  />
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ReviewPointCard({
  point,
  canReview,
  isPreparer,
  onChanged,
  setError,
}: {
  point: ReviewPoint;
  canReview: boolean;
  isPreparer: boolean;
  onChanged: () => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [response, setResponse] = useState("");
  const [waiveNote, setWaiveNote] = useState("");
  const [showWaive, setShowWaive] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (
    input: Parameters<typeof api.actOnReviewPoint>[1],
  ) => {
    setBusy(true);
    setError(null);
    try {
      await api.actOnReviewPoint(point.id, input);
      setResponse("");
      setWaiveNote("");
      setShowWaive(false);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not update the review point.",
      );
    } finally {
      setBusy(false);
    }
  };

  const disposed = isDisposed(point.status);

  return (
    <li className="rounded-md bg-panel p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-slate-500">
            R{point.round}.{point.seq}
          </span>
          <SeverityPill severity={point.severity} />
          <ReviewStatusPill status={point.status} />
        </div>
        <span className="text-xs text-slate-500">
          {point.raised_by_name} · {relativeTime(point.raised_at)}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{point.body}</p>
      {point.reference && (
        <p className="mt-1 text-xs text-slate-500">Reference: {point.reference}</p>
      )}

      {point.response && (
        <div className="mt-3 rounded bg-slate-50 p-2.5 text-sm ring-1 ring-inset ring-slate-200">
          <p className="text-xs font-semibold text-slate-600">
            {point.responded_by_name ?? "Response"}
            {point.responded_at && ` · ${relativeTime(point.responded_at)}`}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{point.response}</p>
        </div>
      )}

      {point.closed_at && (
        <p className="mt-2 text-xs text-slate-500">
          {point.status === "waived" ? "Waived" : "Resolved"} by {point.closed_by_name} ·{" "}
          {relativeTime(point.closed_at)}
        </p>
      )}

      {/* Preparer response */}
      {isPreparer && !disposed && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act({ action: "respond", response });
          }}
        >
          <TextArea
            rows={2}
            required
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            placeholder="Describe what you changed to clear this point."
            aria-label={`Response to review point ${point.round}.${point.seq}`}
          />
          <div className="flex justify-end">
            <button type="submit" className="btn-primary btn-sm" disabled={busy}>
              {point.status === "addressed" ? "Update response" : "Submit response"}
            </button>
          </div>
        </form>
      )}

      {/* Reviewer disposition */}
      {canReview && !disposed && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => void act({ action: "resolve" })}
          >
            Mark resolved
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy}
            onClick={() => setShowWaive((open) => !open)}
          >
            Waive…
          </button>
        </div>
      )}

      {canReview && disposed && (
        <div className="mt-3">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void act({ action: "reopen" })}
          >
            Reopen point
          </button>
        </div>
      )}

      {showWaive && (
        <form
          className="mt-2 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act({ action: "waive", note: waiveNote });
          }}
        >
          <TextArea
            rows={2}
            required
            value={waiveNote}
            onChange={(event) => setWaiveNote(event.target.value)}
            placeholder="Why is this point being waived?"
            aria-label="Reason for waiving"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setShowWaive(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn-danger btn-sm" disabled={busy}>
              Waive point
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

function ChecklistPanel({ data, onChanged, setError }: PanelProps) {
  const { user, can: hasGrade } = useSession();
  const { task } = data;
  const [label, setLabel] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [busy, setBusy] = useState(false);

  const editable =
    task.status !== "closed" &&
    task.status !== "cancelled" &&
    (task.assignee_id === user?.id || hasGrade("manager"));

  const toggle = async (itemId: string, isDone: boolean) => {
    setError(null);
    try {
      await api.updateChecklistItem(task.id, itemId, { is_done: isDone });
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not update that step.",
      );
    }
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addChecklistItem(task.id, label, mandatory);
      setLabel("");
      setMandatory(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not add that step.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (itemId: string) => {
    setError(null);
    try {
      await api.deleteChecklistItem(task.id, itemId);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not remove that step.");
    }
  };

  return (
    <div className="space-y-4">
      {!data.checklist.length && (
        <p className="py-4 text-center text-sm text-slate-500">
          No procedures recorded for this deliverable.
        </p>
      )}

      <ul className="divide-y divide-slate-100">
        {data.checklist.map((item) => (
          <li key={item.id} className="flex items-start gap-3 py-2.5">
            <input
              type="checkbox"
              checked={item.is_done === 1}
              disabled={!editable}
              onChange={(event) => void toggle(item.id, event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-link focus:ring-brand-500"
              aria-label={item.label}
            />
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm ${
                  item.is_done ? "text-slate-400 line-through" : "text-slate-800"
                }`}
              >
                {item.label}
                {item.mandatory === 1 && (
                  <span className="ml-2 pill bg-slate-100 text-slate-600 ring-slate-200">
                    Mandatory
                  </span>
                )}
              </p>
              {item.is_done === 1 && item.done_by_name && (
                <p className="mt-0.5 text-xs text-slate-500">
                  Completed by {item.done_by_name} · {relativeTime(item.done_at)}
                </p>
              )}
            </div>
            {editable && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => void remove(item.id)}
                aria-label={`Remove step: ${item.label}`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {editable && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
          <div className="min-w-56 flex-1">
            <TextInput
              value={label}
              required
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Add a procedure step…"
              aria-label="New procedure step"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={mandatory}
              onChange={(event) => setMandatory(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-link"
            />
            Mandatory
          </label>
          <button type="submit" className="btn-secondary" disabled={busy}>
            Add step
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function DocumentsPanel({ data, onChanged, setError }: PanelProps) {
  const { task } = data;
  const [form, setForm] = useState({ label: "", url: "" });
  const [busy, setBusy] = useState(false);

  const locked = task.status === "closed" || task.status === "cancelled";

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addAttachment(task.id, form);
      setForm({ label: "", url: "" });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not add the link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Working papers stay in the firm's document store. Record the link here so the
        reviewer can find them.
      </p>

      {!data.attachments.length ? (
        <p className="py-4 text-center text-sm text-slate-500">No documents linked yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="link text-sm"
                >
                  {attachment.label}
                </a>
                <p className="truncate text-xs text-slate-500">{attachment.url}</p>
                <p className="text-xs text-slate-400">
                  Added by {attachment.added_by_name} · {relativeTime(attachment.added_at)}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={async () => {
                  setError(null);
                  try {
                    await api.deleteAttachment(attachment.id);
                    await onChanged();
                  } catch (err) {
                    setError(
                      err instanceof ApiRequestError
                        ? err.message
                        : "Could not remove the link.",
                    );
                  }
                }}
                aria-label={`Remove ${attachment.label}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <form onSubmit={add} className="grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-[1fr_2fr_auto]">
          <TextInput
            required
            value={form.label}
            onChange={(event) => setForm({ ...form, label: event.target.value })}
            placeholder="Description"
            aria-label="Document description"
          />
          <TextInput
            required
            type="url"
            value={form.url}
            onChange={(event) => setForm({ ...form, url: event.target.value })}
            placeholder="https://…"
            aria-label="Document URL"
          />
          <button type="submit" className="btn-secondary" disabled={busy}>
            Add link
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

function TimePanel({ data, onChanged, setError }: PanelProps) {
  const { user } = useSession();
  const { task } = data;
  const [form, setForm] = useState({
    work_date: today(),
    hours: "",
    narrative: "",
    billable: true,
  });
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.logTime(task.id, {
        work_date: form.work_date,
        hours: Number(form.hours),
        narrative: form.narrative || undefined,
        billable: form.billable,
      });
      setForm({ work_date: today(), hours: "", narrative: "", billable: true });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not record the time.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto]">
        <TextInput
          type="date"
          required
          max={today()}
          value={form.work_date}
          onChange={(event) => setForm({ ...form, work_date: event.target.value })}
          aria-label="Work date"
        />
        <TextInput
          type="number"
          required
          min="0.25"
          max="24"
          step="0.25"
          value={form.hours}
          onChange={(event) => setForm({ ...form, hours: event.target.value })}
          placeholder="Hours"
          aria-label="Hours"
        />
        <TextInput
          value={form.narrative}
          onChange={(event) => setForm({ ...form, narrative: event.target.value })}
          placeholder="Narrative (what you did)"
          aria-label="Narrative"
        />
        <button type="submit" className="btn-secondary" disabled={busy}>
          Log time
        </button>
      </form>

      {!data.time_entries.length ? (
        <p className="py-4 text-center text-sm text-slate-500">No time recorded yet.</p>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Who</th>
                <th>Narrative</th>
                <th className="text-right">Hours</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.time_entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">{formatDate(entry.work_date)}</td>
                  <td className="whitespace-nowrap">{entry.user_name}</td>
                  <td>
                    {entry.narrative ?? <span className="text-slate-400">-</span>}
                    {entry.billable === 0 && (
                      <span className="ml-2 pill bg-slate-100 text-slate-600 ring-slate-200">
                        Non-billable
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {formatHours(entry.hours)}
                  </td>
                  <td className="text-right">
                    {entry.user_id === user?.id && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={async () => {
                          setError(null);
                          try {
                            await api.deleteTime(entry.id);
                            await onChanged();
                          } catch (err) {
                            setError(
                              err instanceof ApiRequestError
                                ? err.message
                                : "Could not remove the entry.",
                            );
                          }
                        }}
                        aria-label="Remove time entry"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discussion and audit trail
// ---------------------------------------------------------------------------

function DiscussionPanel({ data, onChanged, setError }: PanelProps) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addComment(data.task.id, body);
      setBody("");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not post the comment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {!data.comments.length ? (
        <p className="py-4 text-center text-sm text-slate-500">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <Avatar name={comment.author_name} />
              <div className="min-w-0 flex-1 rounded-md bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
                <p className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">
                    {comment.author_name}
                  </span>{" "}
                  · {relativeTime(comment.created_at)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                  {comment.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2 border-t border-slate-200 pt-3">
        <TextArea
          rows={3}
          required
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a comment for the team…"
          aria-label="New comment"
        />
        <div className="flex justify-end">
          <button type="submit" className="btn-primary btn-sm" disabled={busy}>
            {busy ? "Posting…" : "Post comment"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ActivityPanel({ data }: { data: TaskDetailData }) {
  if (!data.events.length) {
    return <p className="py-4 text-center text-sm text-slate-500">No activity recorded.</p>;
  }

  return (
    <ol className="space-y-3">
      {data.events.map((event) => (
        <li key={event.id} className="flex gap-3 text-sm">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
          <div className="min-w-0">
            <p className="text-slate-800">
              <span className="font-medium">{event.actor_name ?? "System"}</span>{" "}
              {describeEvent(event.kind)}
              {event.from_status && event.to_status && (
                <>
                  {" "}
                  <span className="text-slate-500">
                    ({STATUS_LABELS[event.from_status as keyof typeof STATUS_LABELS] ??
                      humanise(event.from_status)}{" "}
                    →{" "}
                    {STATUS_LABELS[event.to_status as keyof typeof STATUS_LABELS] ??
                      humanise(event.to_status)}
                    )
                  </span>
                </>
              )}
            </p>
            {event.detail && (
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">
                {event.detail}
              </p>
            )}
            <p className="mt-0.5 text-xs text-slate-400">
              {formatDateTime(event.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Turns an event kind into a readable phrase. */
function describeEvent(kind: string): string {
  const map: Record<string, string> = {
    created: "created this deliverable",
    "created:generated": "generated this deliverable from a template",
    "created:recurring": "created this deliverable as the next recurring period",
    updated: "updated the details",
    "recurrence:generated": "generated the next period",
    "attachment:added": "linked a document",
    "attachment:removed": "removed a document link",
    "review_point:raised": "raised a review point",
    "review_point:respond": "responded to a review point",
    "review_point:resolve": "resolved a review point",
    "review_point:waive": "waived a review point",
    "review_point:reopen": "reopened a review point",
    "review_point:edit": "amended a review point",
    "review_point:withdrawn": "withdrew a review point",
  };
  if (map[kind]) return map[kind];
  if (kind.startsWith("workflow:")) {
    const action = kind.slice("workflow:".length) as WorkflowAction;
    const phrases: Partial<Record<WorkflowAction, string>> = {
      activate: "released the deliverable",
      start: "started work",
      await_client: "flagged it as awaiting the client",
      hold: "placed it on hold",
      resume: "resumed work",
      submit: "submitted it for review",
      resubmit: "resubmitted it for review",
      recall: "recalled the submission",
      begin_review: "began the review",
      request_rework: "returned it for rework",
      approve: "approved it",
      close: "closed it",
      reopen: "reopened it",
      cancel: "cancelled it",
    };
    return phrases[action] ?? humanise(action);
  }
  return humanise(kind);
}
