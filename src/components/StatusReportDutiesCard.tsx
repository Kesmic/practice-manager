/**
 * Who the firm asks for a status report.
 *
 * The schedule above says *when* reports are due. This says *who* owes them, and it is
 * the firm's to decide person by person - a Partner who carries no deliverables but runs
 * three engagements may well owe one, and somebody on a fixed routine may not.
 *
 * One screen listing everybody, rather than a setting buried on each personnel file.
 * The question is "who reports", and answering it by opening forty records in turn is
 * how a firm ends up not knowing.
 *
 * Three settings rather than a tick box, because "not required" and "not required yet"
 * are different facts:
 *
 * - **While carrying client work** - the default, and the behaviour the firm already
 *   had. A new joiner starts reporting when somebody assigns them a deliverable,
 *   without anybody remembering to turn it on.
 * - **Always** - whether or not they hold deliverables.
 * - **Never** - not asked, and never counted as behind.
 *
 * Beside each row is what the setting means for them **today**, because "while carrying
 * client work" does not tell an administrator whether this particular person is
 * currently being asked, and that is the thing they are deciding about.
 */

import { useCallback, useEffect, useState } from "react";
import {
  DUTY_HINTS,
  DUTY_LABELS,
  REPORT_DUTIES,
  describeSchedule,
  type ReportDuty,
  type ReportSchedule,
} from "@shared/status-reports";
import type { ReportDutyRow } from "@shared/types";
import { ROLE_LABELS } from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { Avatar, ErrorBanner, Spinner } from "./ui";

export function StatusReportDutiesCard({ canEdit }: { canEdit: boolean }) {
  const [people, setPeople] = useState<ReportDutyRow[] | null>(null);
  const [schedule, setSchedule] = useState<ReportSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.statusReportDuties();
      setPeople(result.people);
      setSchedule(result.schedule);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load who reports.",
      );
      setPeople([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!people || !schedule) {
    return error ? (
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
    ) : (
      <Spinner label="Loading who reports" />
    );
  }

  const set = async (person: ReportDutyRow, duty: ReportDuty) => {
    setBusy(person.id);
    setError(null);
    try {
      await api.setStatusReportDuty(person.id, duty);
      await load();
      setNotice(
        duty === "never"
          ? `${person.full_name} will not be asked for status reports.`
          : duty === "always"
            ? `${person.full_name} will be asked every reporting day.`
            : `${person.full_name} will be asked while they are carrying client work.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not change that setting.",
      );
    } finally {
      setBusy(null);
    }
  };

  const asked = people.filter((p) => p.owes).length;

  return (
    <section className="card space-y-4">
      <header className="space-y-1 p-4 pb-0">
        <h2 className="text-lg font-semibold text-slate-900">Who reports</h2>
        <p className="text-sm text-slate-600">
          {schedule.enabled ? (
            <>
              <strong>{asked}</strong> of {people.length}{" "}
              {people.length === 1 ? "person is" : "people are"} being asked, due{" "}
              {describeSchedule(schedule)}.
            </>
          ) : (
            "Status reports are switched off above, so nobody is being asked at the moment. These settings are kept."
          )}
        </p>
      </header>

      {error ? (
        <div className="px-4">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        </div>
      ) : null}

      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {people.map((person) => (
          <li
            key={person.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar name={person.full_name} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800">
                  {person.full_name}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {person.title ?? ROLE_LABELS[person.role]} ·{" "}
                  {person.open_tasks === 0
                    ? "no open deliverables"
                    : `${person.open_tasks} open ${person.open_tasks === 1 ? "deliverable" : "deliverables"}`}
                </span>
              </span>
            </span>

            <span className="flex items-center gap-3">
              {/*
                What the setting means for them today. "While carrying client work" does
                not tell an administrator whether this person is currently being asked,
                which is the thing they are deciding about.
              */}
              <span
                className={`pill ${
                  person.owes
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-slate-100 text-slate-500 ring-slate-200"
                }`}
              >
                {person.owes ? "Asked" : "Not asked"}
              </span>

              <span className="flex gap-1" role="group" aria-label={`Status reports for ${person.full_name}`}>
                {REPORT_DUTIES.map((duty) => {
                  const on = person.duty === duty;
                  return (
                    <button
                      key={duty}
                      type="button"
                      title={DUTY_HINTS[duty]}
                      aria-pressed={on}
                      disabled={!canEdit || busy === person.id}
                      onClick={() => void set(person, duty)}
                      className={`rounded-full px-3 py-1 text-xs ring-1 transition-colors ${
                        on
                          ? "bg-brand-600 text-white ring-brand-600"
                          : "bg-white text-slate-600 ring-slate-300 hover:text-slate-900"
                      }`}
                    >
                      {DUTY_LABELS[duty]}
                    </button>
                  );
                })}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {notice ? (
        <p className="px-4 pb-4 text-sm text-emerald-700">{notice}</p>
      ) : !canEdit ? (
        <p className="px-4 pb-4 text-sm text-slate-500">
          Changing who reports is restricted to Partner grade.
        </p>
      ) : null}
    </section>
  );
}
