import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MyOnboarding } from "@shared/types";
import { PROFILE_FIELD_LABELS, requiredAction } from "@shared/hr";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { Markdown } from "../components/Markdown";
import {
  EmptyState,
  ErrorBanner,
  Spinner,
  SuccessBanner,
} from "../components/ui";
import { formatDate, percent, relativeTime } from "../lib/format";

/**
 * The new joiner's home: the welcome message, the documents they must sign or
 * acknowledge, their own onboarding steps, and what the firm still owes them.
 */
export function Onboarding() {
  const { user } = useSession();
  const [data, setData] = useState<MyOnboarding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.myOnboarding());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your onboarding.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data || !user) return <Spinner label="Loading your onboarding" />;

  const toggle = async (id: string, isDone: boolean) => {
    setError(null);
    try {
      await api.setOnboardingItem(id, isDone);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not update that step.",
      );
    }
  };

  const myItems = data.items.filter((item) => item.owner === "employee");
  const hrItems = data.items.filter((item) => item.owner === "hr");
  const { progress } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="section-title">Welcome to {data.firm_name}</h1>
        <p className="muted mt-0.5">
          {progress.complete
            ? "Your onboarding is complete. Thank you."
            : "Work through the steps below. You can come back to this page at any time."}
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {/* Progress */}
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800">
            Onboarding progress
          </span>
          <span className="text-sm font-semibold tabular-nums text-slate-700">
            {percent(progress.fraction)}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all ${
              progress.complete ? "bg-emerald-500" : "bg-brand-500"
            }`}
            style={{ width: `${Math.round(progress.fraction * 100)}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center text-xs">
          <div>
            <p className="font-semibold tabular-nums text-slate-800">
              {progress.items_done}/{progress.items_total}
            </p>
            <p className="text-slate-500">Your steps</p>
          </div>
          <div>
            <p className="font-semibold tabular-nums text-slate-800">
              {progress.documents_done}/{progress.documents_total}
            </p>
            <p className="text-slate-500">Documents signed</p>
          </div>
          <div>
            <p className="font-semibold text-slate-800">
              {progress.profile_complete ? "Complete" : "Outstanding"}
            </p>
            <p className="text-slate-500">Your details</p>
          </div>
        </div>
      </div>

      {/* Welcome message */}
      {data.welcome_message.trim() && (
        <section className="card p-5">
          <Markdown>{data.welcome_message}</Markdown>
          {data.md_name && (
            <p className="mt-4 border-t border-slate-200 pt-3 text-sm">
              <span className="font-semibold text-slate-800">{data.md_name}</span>
              <span className="text-slate-500"> · {data.md_title}</span>
            </p>
          )}
        </section>
      )}

      {/* Documents awaiting signature */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Documents to read and sign</h2>
          <span className="muted">{data.outstanding_documents.length} outstanding</span>
        </div>
        {!data.outstanding_documents.length ? (
          <EmptyState
            title="Nothing outstanding"
            description="You have responded to every document currently issued to you."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.outstanding_documents.map((doc) => {
              const action = requiredAction(doc);
              return (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{doc.title}</p>
                    {doc.summary && (
                      <p className="mt-0.5 text-xs text-slate-500">{doc.summary}</p>
                    )}
                    <p className="mt-1 flex items-center gap-2 text-xs">
                      {doc.kind === "contract" && (
                        <span className="pill bg-rose-50 text-rose-700 ring-rose-200">
                          Contract
                        </span>
                      )}
                      <span className="text-slate-500">
                        {action === "signed"
                          ? "Signature required"
                          : "Acknowledgement required"}
                      </span>
                    </p>
                  </div>
                  <Link to={`/documents/${doc.id}`} className="btn-primary btn-sm shrink-0">
                    Read and {action === "signed" ? "sign" : "acknowledge"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Personal details */}
      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="card-title">Your personal details</h2>
            <p className="muted mt-0.5">
              {data.missing_profile_fields.length === 0
                ? "All the details we need are on file."
                : `Still needed: ${data.missing_profile_fields
                    .map((field) => PROFILE_FIELD_LABELS[field] ?? field)
                    .join(", ")}.`}
            </p>
          </div>
          <Link to="/my-profile" className="btn-secondary btn-sm shrink-0">
            {data.missing_profile_fields.length === 0
              ? "Review details"
              : "Complete details"}
          </Link>
        </div>
      </section>

      {/* Employee steps */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Your steps</h2>
          <span className="muted">
            {myItems.filter((item) => item.is_done).length}/{myItems.length} done
          </span>
        </div>
        {!myItems.length ? (
          <EmptyState
            title="No onboarding steps yet"
            description="Your onboarding programme has not been started. A partner will set it up."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {myItems.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={item.is_done === 1}
                  onChange={(event) => void toggle(item.id, event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-link"
                  aria-label={item.label}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${
                      item.is_done ? "text-slate-400 line-through" : "text-slate-800"
                    }`}
                  >
                    {item.label}
                  </p>
                  {item.detail && (
                    <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
                  )}
                  {item.is_done === 1 && item.done_at && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      Completed {relativeTime(item.done_at)}
                    </p>
                  )}
                </div>
                {item.category && (
                  <span className="pill shrink-0 bg-slate-100 text-slate-600 ring-slate-200">
                    {item.category}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What the firm owes the new joiner */}
      {hrItems.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">What we are doing for you</h2>
            <span className="muted">
              {hrItems.filter((item) => item.is_done).length}/{hrItems.length} done
            </span>
          </div>
          <ul className="divide-y divide-slate-100">
            {hrItems.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    item.is_done ? "bg-emerald-500" : "bg-slate-300"
                  }`}
                  aria-hidden="true"
                />
                <p
                  className={`text-sm ${
                    item.is_done ? "text-slate-400" : "text-slate-700"
                  }`}
                >
                  {item.label}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Signed documents */}
      {data.completed_documents.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Your signed documents</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.completed_documents.map((doc) => (
              <li
                key={`${doc.id}-${doc.version}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <Link to={`/documents/${doc.id}`} className="link text-sm">
                  {doc.title}
                </Link>
                <span className="text-xs text-slate-500">
                  {doc.action === "signed" ? "Signed" : "Acknowledged"}{" "}
                  {formatDate(doc.signed_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
