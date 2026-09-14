/**
 * Which days of the week the firm requires a status report on.
 *
 * Wednesdays and Fridays is the firm's answer, not the system's. A practice whose
 * filing week runs differently should be able to say so without a deployment, and one
 * that does not want written reports at all should be able to stop asking rather than
 * leaving everybody a permanent red badge they cannot clear.
 */

import { useCallback, useEffect, useState } from "react";
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  describeSchedule,
  type ReportSchedule,
  type Weekday,
} from "@shared/status-reports";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Spinner } from "./ui";

export function StatusReportPolicyCard({ canEdit }: { canEdit: boolean }) {
  const [schedule, setSchedule] = useState<ReportSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSchedule((await api.statusReportPolicy()).schedule);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load the schedule.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!schedule) {
    return error ? (
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
    ) : (
      <Spinner label="Loading the reporting schedule" />
    );
  }

  const save = async (next: ReportSchedule) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveStatusReportPolicy(next);
      setSchedule(result.schedule);
      setNotice(
        result.schedule.enabled
          ? `Reports are now due ${describeSchedule(result.schedule)}.`
          : "Status reports are switched off.",
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save that schedule.",
      );
    } finally {
      setBusy(false);
    }
  };

  const toggleDay = (day: Weekday) => {
    const days = schedule.days.includes(day)
      ? schedule.days.filter((d) => d !== day)
      : [...schedule.days, day].sort((a, b) => a - b);
    setSchedule({ ...schedule, days });
  };

  return (
    <section className="card space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Status reports</h2>
        <p className="text-sm text-slate-600">
          Everybody carrying client work writes one short report per reporting day,
          covering all of it. Each report answers for the days since the previous one,
          so the days tile the calendar with none falling into two reports or into none.
        </p>
      </header>

      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-slate-200 p-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          disabled={!canEdit || busy}
          checked={schedule.enabled}
          onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
        />
        <span className="text-sm">
          <span className="font-medium text-slate-800">Require written status reports</span>
          <span className="hint mt-0.5 block">
            Switched off, nobody is asked and nobody carries an outstanding count. The
            reports already written are kept.
          </span>
        </span>
      </label>

      <fieldset className="space-y-2" disabled={!canEdit || !schedule.enabled}>
        <legend className="text-sm font-medium text-slate-800">Which days</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => {
            const on = schedule.days.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                aria-pressed={on}
                disabled={!canEdit || !schedule.enabled || busy}
                className={`rounded-full px-3 py-1.5 text-sm ring-1 transition-colors ${
                  on
                    ? "bg-brand-600 text-white ring-brand-600"
                    : "bg-white text-slate-600 ring-slate-300 hover:text-slate-900"
                }`}
              >
                {WEEKDAY_LABELS[day]}
              </button>
            );
          })}
        </div>
        <p className="hint">
          {schedule.enabled && schedule.days.length
            ? `Reports are due ${describeSchedule(schedule)}.`
            : "Choose at least one day."}
        </p>
      </fieldset>

      {canEdit ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={busy || (schedule.enabled && !schedule.days.length)}
            onClick={() => void save(schedule)}
          >
            {busy ? "Saving…" : "Save the reporting schedule"}
          </button>
          {notice ? <span className="text-sm text-emerald-700">{notice}</span> : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Changing the reporting days changes what the whole firm is asked for, so it is
          restricted to Partner grade.
        </p>
      )}
    </section>
  );
}
