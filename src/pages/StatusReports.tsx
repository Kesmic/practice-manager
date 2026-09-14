/**
 * Writing the twice-weekly status report, and - for whoever supervises - reading them.
 *
 * One report per person per reporting day, covering everything assigned to them, with
 * the deliverables it concerns picked from a list of their own work. A report per
 * deliverable would ask somebody carrying nine open jobs to write nine reports twice a
 * week, and a reporting requirement that costs that much is one people learn to satisfy
 * without saying anything.
 *
 * The screen is built around the one question the writer has: what am I answering for?
 * Not "today", but a named reporting day and the days it covers - so somebody filing on
 * Thursday can see they are filing Wednesday's report, late, rather than being quietly
 * re-dated to today.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { StatusReport, StatusReportView, TeamStatusReports } from "@shared/types";
import { describeSchedule } from "@shared/status-reports";
import { ApiRequestError, api } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/format";
import { useSession } from "../lib/auth";
import {
  EmptyState,
  ErrorBanner,
  Field,
  Spinner,
  SuccessBanner,
  TextArea,
} from "../components/ui";
import { StatusPill } from "../components/ui";

export function StatusReports() {
  const { can } = useSession();
  const [view, setView] = useState<StatusReportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.myStatusReport());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your reports.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) {
    return error ? (
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
    ) : (
      <Spinner label="Loading status reports" />
    );
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Status reports</h1>
        <p className="text-sm text-slate-600">
          A short written account of your work, due{" "}
          <strong>{describeSchedule(view.schedule)}</strong>. One report covers
          everything assigned to you - name the deliverables it concerns rather than
          writing one report each.
        </p>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {view.schedule.enabled ? (
        <ReportForm
          view={view}
          onSaved={async (message) => {
            setNotice(message);
            await load();
          }}
          setError={setError}
        />
      ) : (
        <EmptyState
          title="Status reports are switched off"
          description="The firm is not asking for written status reports at the moment."
        />
      )}

      {view.missed.length ? <Missed days={view.missed} /> : null}

      <PastReports reports={view.recent} currentDueOn={view.due_on} />

      {can("senior_associate") ? <TeamPanel /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Writing one
// ---------------------------------------------------------------------------

function ReportForm({
  view,
  onSaved,
  setError,
}: {
  view: StatusReportView;
  onSaved: (message: string) => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const current = view.current;
  const [body, setBody] = useState(current?.body ?? "");
  const [blockers, setBlockers] = useState(current?.blockers ?? "");
  const [chosen, setChosen] = useState<string[]>(
    current?.tasks.map((t) => t.id) ?? [],
  );
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const t of current?.tasks ?? []) if (t.note) out[t.id] = t.note;
    return out;
  });
  const [busy, setBusy] = useState(false);

  /*
   * A deliverable named in the report that is no longer in the dropdown - because it
   * was approved or closed since - must still be listed. Dropping it would quietly
   * remove something the person said, and the tick beside it is how they remove it.
   */
  const options = useMemo(() => {
    const known = new Map(view.tasks.map((t) => [t.id, t]));
    for (const t of current?.tasks ?? []) if (!known.has(t.id)) known.set(t.id, t);
    return [...known.values()];
  }, [view.tasks, current]);

  if (!view.due_on) {
    return (
      <EmptyState
        title="Nothing due"
        description="There is no reporting day to file against at the moment."
      />
    );
  }

  const submit = async () => {
    if (!body.trim()) {
      setError("Write something about the period before submitting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.submitStatusReport({
        body,
        blockers: blockers.trim() || null,
        tasks: chosen.map((id) => ({ task_id: id, note: notes[id]?.trim() || null })),
      });
      await onSaved(
        current
          ? `Your report for ${formatDate(view.due_on)} has been updated.`
          : `Your report for ${formatDate(view.due_on)} has been submitted.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not submit that report.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-4">
      <Banner
        state={view.state}
        dueOn={view.due_on}
        from={view.period_from}
        nextDueOn={view.next_due_on}
      />

      <Field
        label="What happened, and where each job stands"
        required
        hint="Enough that somebody picking this up cold would know what to do next."
      >
        {(id) => (
          <TextArea
            id={id}
            rows={7}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Progress since the last report, what is finished, what is next."
          />
        )}
      </Field>

      <Field
        label="Anything in your way"
        hint="Read first by whoever can clear it. Leave it empty if there is nothing."
      >
        {(id) => (
          <TextArea
            id={id}
            rows={3}
            value={blockers}
            onChange={(e) => setBlockers(e.target.value)}
            placeholder="Waiting on records from the client, a query for a partner, a conflict of deadlines."
          />
        )}
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800">
          Deliverables this report concerns
        </legend>
        <p className="hint">
          Your own open work. Tick the ones this report is about; add a line against any
          you want to say something specific on.
        </p>
        {!options.length ? (
          <p className="text-sm text-slate-500">
            Nothing is assigned to you at the moment, so there is nothing to reference.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {options.map((task) => {
              const ticked = chosen.includes(task.id);
              return (
                <li key={task.id} className="space-y-2 p-3">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={ticked}
                      onChange={(e) =>
                        setChosen((c) =>
                          e.target.checked
                            ? [...c, task.id]
                            : c.filter((id) => id !== task.id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-medium text-slate-800">{task.ref}</span>{" "}
                      <span className="text-slate-700">{task.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{task.client_name}</span>
                        <StatusPill status={task.status} />
                      </span>
                    </span>
                  </label>
                  {ticked ? (
                    <TextArea
                      rows={2}
                      aria-label={`Note on ${task.ref}`}
                      value={notes[task.id] ?? ""}
                      onChange={(e) =>
                        setNotes((n) => ({ ...n, [task.id]: e.target.value }))
                      }
                      placeholder={`Where ${task.ref} stands - optional.`}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : current ? "Update this report" : "Submit this report"}
        </button>
        {current ? (
          <span className="text-xs text-slate-500">
            Submitted {formatDateTime(current.submitted_at)}. You can amend it until the
            next reporting day.
          </span>
        ) : null}
      </div>
    </section>
  );
}

/**
 * What the person is answering for, and whether they are late.
 *
 * "Due" and "overdue" get different words on purpose. One is a task for today; the
 * other is a failure that somebody may ask about, and a screen that calls both of them
 * "due" is no help in telling them apart.
 */
function Banner({
  state,
  dueOn,
  from,
  nextDueOn,
}: {
  state: StatusReportView["state"];
  dueOn: string;
  from: string | null;
  nextDueOn: string | null;
}) {
  const period =
    from && from !== dueOn
      ? `covering ${formatDate(from)} to ${formatDate(dueOn)}`
      : `for ${formatDate(dueOn)}`;

  if (state === "submitted") {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        Your report {period} is in.{" "}
        {nextDueOn ? `The next one is due ${formatDate(nextDueOn)}.` : null}
      </p>
    );
  }
  if (state === "overdue") {
    return (
      <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
        <strong>Your report for {formatDate(dueOn)} is late.</strong> It{" "}
        {from && from !== dueOn
          ? `covers ${formatDate(from)} to ${formatDate(dueOn)}`
          : "covers that day"}
        , and filing it now still records it against {formatDate(dueOn)}.
      </p>
    );
  }
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <strong>Due today.</strong> This report is {period}.
    </p>
  );
}

function Missed({ days }: { days: string[] }) {
  return (
    <section className="card space-y-2">
      <h2 className="text-sm font-semibold text-rose-800">
        {days.length} reporting {days.length === 1 ? "day" : "days"} went by without a
        report
      </h2>
      <p className="text-sm text-slate-600">
        {days.map(formatDate).join(", ")}. These cannot be filed now - the current
        report is the one above. Say what happened in it if it matters.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reading them back
// ---------------------------------------------------------------------------

function PastReports({
  reports,
  currentDueOn,
}: {
  reports: StatusReport[];
  currentDueOn: string | null;
}) {
  const past = reports.filter((r) => r.due_on !== currentDueOn);
  if (!past.length) return null;

  return (
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">Your earlier reports</h2>
      <ul className="space-y-3">
        {past.map((report) => (
          <li key={report.id} className="rounded-md border border-slate-200 p-3">
            <ReportBody report={report} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReportBody({ report }: { report: StatusReport }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-800">
        {formatDate(report.due_on)}
        {report.period_from && report.period_from !== report.due_on ? (
          <span className="font-normal text-slate-500">
            {" "}
            - covering {formatDate(report.period_from)} to {formatDate(report.due_on)}
          </span>
        ) : null}
      </p>
      <p className="whitespace-pre-wrap text-sm text-slate-700">{report.body}</p>
      {report.blockers ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>In the way:</strong> {report.blockers}
        </p>
      ) : null}
      {report.tasks?.length ? (
        <ul className="space-y-1 text-sm">
          {report.tasks.map((task) => (
            <li key={task.id}>
              <Link className="link" to={`/tasks/${task.id}`}>
                {task.ref}
              </Link>{" "}
              <span className="text-slate-600">{task.title}</span>
              {task.note ? (
                <span className="block text-slate-600">{task.note}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Who has reported and who has not, for the reporting day just passed.
 *
 * The people who owe one come first, because that is the half of the answer a
 * supervisor cannot get from reading what arrived.
 */
function TeamPanel() {
  const [team, setTeam] = useState<TeamStatusReports | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setTeam(await api.teamStatusReports());
      } catch {
        setTeam(null);
      }
    })();
  }, []);

  if (!team || !team.due_on) return null;

  return (
    <section className="card space-y-3">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">
          The team&rsquo;s reports for {formatDate(team.due_on)}
        </h2>
        <p className="text-sm text-slate-600">
          {team.outstanding === 0
            ? "Everybody carrying work has reported."
            : `${team.outstanding} ${team.outstanding === 1 ? "person has" : "people have"} not reported.`}
        </p>
      </header>
      <ul className="divide-y divide-slate-100">
        {team.people.map((person) => (
          <li key={person.id} className="py-3">
            <p className="text-sm font-medium text-slate-800">
              {person.full_name}
              {!person.report_id ? (
                <span className="ml-2 rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
                  No report
                </span>
              ) : null}
            </p>
            {person.report ? (
              <div className="mt-2">
                <ReportBody report={person.report} />
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                {person.open_tasks} open{" "}
                {person.open_tasks === 1 ? "deliverable" : "deliverables"}.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
