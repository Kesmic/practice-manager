import { useEffect, useState } from "react";
import type { Reports as ReportsData } from "@shared/types";
import {
  ROLE_LABELS,
  SERVICE_LINE_LABELS,
  STATUS_LABELS,
  type TaskStatus,
} from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { EmptyState, ErrorBanner, Spinner } from "../components/ui";
import { formatHours, percent } from "../lib/format";

export function Reports() {
  const [data, setData] = useState<ReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .reports()
      .then(setData)
      .catch((err) => {
        setError(err instanceof ApiRequestError ? err.message : "Could not load reports.");
      });
  }, []);

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Building reports" />;

  const totalTasks = data.status_counts.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">Practice reports</h1>
        <p className="muted mt-0.5">
          Where the work sits, who is carrying it, and how cleanly it passes review.
        </p>
      </div>

      {/* ------------------------------------------------------- pipeline */}
      <section className="card p-4">
        <h2 className="card-title mb-3">Work in progress by stage</h2>
        {!totalTasks ? (
          <EmptyState title="No deliverables on file yet" />
        ) : (
          <div className="space-y-2">
            {data.status_counts
              .slice()
              .sort((a, b) => b.count - a.count)
              .map((row) => (
                <div key={row.status} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-sm text-slate-600">
                    {STATUS_LABELS[row.status as TaskStatus] ?? row.status}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full rounded bg-brand-500"
                      style={{ width: `${(row.count / totalTasks) * 100}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-sm tabular-nums text-slate-700">
                    {row.count}
                  </span>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- workload */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Workload by person</h2>
        </div>
        {!data.workload.length ? (
          <EmptyState title="No active team members" />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Grade</th>
                  <th className="text-right">Open</th>
                  <th className="text-right">Overdue</th>
                  <th className="text-right">In review</th>
                  <th className="text-right">Budget</th>
                  <th className="text-right">Logged</th>
                  <th className="text-right">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {data.workload.map((row) => (
                  <tr key={row.user_id}>
                    <td className="whitespace-nowrap font-medium text-slate-800">
                      {row.full_name}
                    </td>
                    <td className="whitespace-nowrap text-xs">{ROLE_LABELS[row.role]}</td>
                    <td className="text-right tabular-nums">{row.open_tasks}</td>
                    <td className="text-right tabular-nums">
                      {row.overdue_tasks > 0 ? (
                        <span className="font-semibold text-rose-700">
                          {row.overdue_tasks}
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="text-right tabular-nums">{row.in_review}</td>
                    <td className="text-right tabular-nums">
                      {formatHours(row.budget_hours)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatHours(row.logged_hours)}
                    </td>
                    <td className="text-right tabular-nums">
                      {row.budget_hours > 0
                        ? percent(row.logged_hours / row.budget_hours)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* -------------------------------------------------- service lines */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Service line summary</h2>
        </div>
        {!data.service_lines.length ? (
          <EmptyState title="No deliverables on file yet" />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Service line</th>
                  <th className="text-right">Open</th>
                  <th className="text-right">Overdue</th>
                  <th className="text-right">Closed</th>
                  <th className="text-right">Hours logged</th>
                </tr>
              </thead>
              <tbody>
                {data.service_lines.map((row) => (
                  <tr key={row.service_line}>
                    <td className="whitespace-nowrap">
                      {SERVICE_LINE_LABELS[row.service_line] ?? row.service_line}
                    </td>
                    <td className="text-right tabular-nums">{row.open_tasks}</td>
                    <td className="text-right tabular-nums">
                      {row.overdue_tasks > 0 ? (
                        <span className="font-semibold text-rose-700">
                          {row.overdue_tasks}
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="text-right tabular-nums">{row.closed_tasks}</td>
                    <td className="text-right tabular-nums">
                      {formatHours(row.logged_hours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------- review quality */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Review quality by preparer</h2>
        </div>
        {!data.review_quality.length ? (
          <EmptyState
            title="No completed reviews yet"
            description="Once deliverables have been through review, first-pass rates appear here."
          />
        ) : (
          <>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Preparer</th>
                    <th className="text-right">Reviewed rounds</th>
                    <th className="text-right">Returned for rework</th>
                    <th className="text-right">Must-fix points answered</th>
                    <th className="text-right">First-pass rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.review_quality.map((row) => (
                    <tr key={row.user_id}>
                      <td className="whitespace-nowrap font-medium text-slate-800">
                        {row.full_name}
                      </td>
                      <td className="text-right tabular-nums">{row.submissions}</td>
                      <td className="text-right tabular-nums">{row.rework_rounds}</td>
                      <td className="text-right tabular-nums">{row.must_fix_points}</td>
                      <td className="text-right tabular-nums">
                        <span
                          className={
                            row.first_pass_rate >= 0.8
                              ? "font-semibold text-emerald-700"
                              : row.first_pass_rate >= 0.5
                                ? "font-semibold text-amber-700"
                                : "font-semibold text-rose-700"
                          }
                        >
                          {percent(row.first_pass_rate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              First-pass rate is the share of a preparer's reviewed deliverables that were
              never returned for rework. Read it alongside budget and complexity rather than
              on its own.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
