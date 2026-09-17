import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { EmployeeSummary } from "@shared/types";
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUS_STYLES,
  type EmploymentStatus,
} from "@shared/hr";
import { ROLE_LABELS } from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  Avatar,
  EmptyState,
  ErrorBanner,
  Select,
  SuccessBanner,
  Spinner,
  TextInput,
  options,
} from "../components/ui";
import { formatDate, percent } from "../lib/format";
import { RemovePersonDialog } from "../components/RemovePersonDialog";

type Tab = "directory" | "onboarding";

export function People() {
  const { can, user: me } = useSession();
  // The same grade the removal endpoints require, so the button is never offered to
  // somebody the server will refuse.
  const canRemove = can("partner");
  const [tab, setTab] = useState<Tab>("directory");
  const [employees, setEmployees] = useState<EmployeeSummary[] | null>(null);
  const [onboarding, setOnboarding] = useState<Array<Record<string, unknown>> | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.employees({
        q: search || undefined,
        employment_status: status || undefined,
      });
      setEmployees(res.employees);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load the team.");
      setEmployees([]);
    }
  }, [search, status]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    if (tab !== "onboarding" || onboarding || !can("partner")) return;
    void api
      .onboardingOverview()
      .then((res) => setOnboarding(res.employees))
      .catch(() => setOnboarding([]));
  }, [tab, onboarding, can]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="section-title">People</h1>
        <p className="muted mt-0.5">
          Employment records, onboarding progress and outstanding document
          acknowledgements.
        </p>
      </div>

      {can("partner") && (
        <div className="flex gap-1 border-b border-slate-200">
          {(
            [
              ["directory", "Directory"],
              ["onboarding", "Onboarding progress"],
            ] as Array<[Tab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-brand-600 text-link"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {tab === "directory" ? (
        <>
          <div className="card grid gap-3 p-3 sm:grid-cols-3">
            <TextInput
              placeholder="Search name, email or staff number…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search people"
            />
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              aria-label="Employment status"
            >
              <option value="">Any employment status</option>
              {options(EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABELS)}
            </Select>
          </div>

          <div className="card">
            {employees === null ? (
              <Spinner label="Loading people" />
            ) : !employees.length ? (
              <EmptyState title="No matching employees" />
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Staff no.</th>
                      <th>Job title</th>
                      <th>Department</th>
                      <th>Grade</th>
                      <th>Status</th>
                      <th>Started</th>
                      <th className="text-right">Open work</th>
                      <th className="text-right">Docs due</th>
                      {canRemove ? <th className="text-right">Remove</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((person) => (
                      <tr key={person.user_id}>
                        <td className="whitespace-nowrap">
                          <Link
                            to={`/people/${person.user_id}`}
                            className="inline-flex items-center gap-2"
                          >
                            <Avatar name={person.full_name} />
                            <span>
                              <span className="font-medium text-link hover:underline">
                                {person.full_name}
                              </span>
                              <p className="text-xs text-slate-500">{person.email}</p>
                            </span>
                          </Link>
                        </td>
                        <td className="whitespace-nowrap font-mono text-xs">
                          {person.staff_no ?? "-"}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {person.job_title ?? "-"}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {person.department ?? "-"}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {ROLE_LABELS[person.role]}
                        </td>
                        <td className="whitespace-nowrap">
                          {person.employment_status ? (
                            <span
                              className={`pill ${
                                EMPLOYMENT_STATUS_STYLES[
                                  person.employment_status as EmploymentStatus
                                ]
                              }`}
                            >
                              {
                                EMPLOYMENT_STATUS_LABELS[
                                  person.employment_status as EmploymentStatus
                                ]
                              }
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {formatDate(person.start_date)}
                        </td>
                        <td className="text-right tabular-nums">{person.open_tasks}</td>
                        <td className="text-right tabular-nums">
                          {person.outstanding_documents > 0 ? (
                            <span className="font-semibold text-amber-700">
                              {person.outstanding_documents}
                            </span>
                          ) : (
                            "0"
                          )}
                        </td>
                        {/*
                          * Removing somebody is offered here, on the list of people,
                          * because that is where an administrator looks for it. It was
                          * only under Accounts and grades, which is a true description
                          * of that screen and no help at all to somebody who wants to
                          * delete an account created by mistake.
                          */}
                        {canRemove ? (
                          <td className="whitespace-nowrap text-right">
                            {person.user_id === me?.id ? (
                              <span className="text-xs text-slate-400">You</span>
                            ) : (
                              <button
                                type="button"
                                className="btn-ghost btn-sm text-rose-700"
                                onClick={() => setRemoving(person.user_id)}
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="card">
          {onboarding === null ? (
            <Spinner label="Loading onboarding progress" />
          ) : !onboarding.length ? (
            <EmptyState title="Nobody is currently being onboarded" />
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Job title</th>
                    <th>Started</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th className="text-right">Steps</th>
                    <th className="text-right">Docs outstanding</th>
                    <th>Details on file</th>
                  </tr>
                </thead>
                <tbody>
                  {onboarding.map((row) => {
                    const progress = row.progress as { fraction: number; complete: boolean };
                    return (
                      <tr key={String(row.user_id)}>
                        <td className="whitespace-nowrap">
                          <Link to={`/people/${row.user_id}`} className="link">
                            {String(row.full_name)}
                          </Link>
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {(row.job_title as string) ?? "-"}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {formatDate(row.start_date as string)}
                        </td>
                        <td className="whitespace-nowrap">
                          {row.employment_status ? (
                            <span
                              className={`pill ${
                                EMPLOYMENT_STATUS_STYLES[
                                  row.employment_status as EmploymentStatus
                                ]
                              }`}
                            >
                              {
                                EMPLOYMENT_STATUS_LABELS[
                                  row.employment_status as EmploymentStatus
                                ]
                              }
                            </span>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="min-w-32">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className={`h-full rounded-full ${
                                  progress.complete ? "bg-emerald-500" : "bg-brand-500"
                                }`}
                                style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-slate-500">
                              {percent(progress.fraction)}
                            </span>
                          </div>
                        </td>
                        <td className="text-right tabular-nums text-xs">
                          {String(row.items_done)}/{String(row.items_total)}
                        </td>
                        <td className="text-right tabular-nums">
                          {Number(row.documents_outstanding) > 0 ? (
                            <span className="font-semibold text-amber-700">
                              {String(row.documents_outstanding)}
                            </span>
                          ) : (
                            "0"
                          )}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {row.profile_completed_at ? (
                            <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">
                              Complete
                            </span>
                          ) : (
                            <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
                              Outstanding
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <RemovePersonDialog
        userId={removing}
        onClose={() => setRemoving(null)}
        onRemoved={async (message) => {
          setRemoving(null);
          await load();
          setNotice(message);
        }}
      />
    </div>
  );
}
