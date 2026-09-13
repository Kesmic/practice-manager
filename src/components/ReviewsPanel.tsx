/**
 * Somebody's performance reviews, as a list with a way to start a new one.
 *
 * Used on the employee file by whoever may write reviews, and on My details by the
 * person themselves - the same list, with the "start a review" half hidden from anybody
 * the server would refuse anyway.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewObjective, ReviewSummary } from "@shared/types";
import {
  OBJECTIVE_STATUS_LABELS,
  PROBATION_DECISION_LABELS,
  RATING_LABELS,
  RATING_STYLES,
  REVIEW_KINDS,
  REVIEW_KIND_HINTS,
  REVIEW_KIND_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_STYLES,
} from "@shared/performance";
import { ApiRequestError, api } from "../lib/api";
import { formatDate } from "../lib/format";
import { EmptyState, ErrorBanner, Field, Select, Spinner, TextInput, options } from "./ui";

export function ReviewsPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<{
    can_review: boolean;
    reviews: ReviewSummary[];
    open_objectives: ReviewObjective[];
    subject: { full_name: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [kind, setKind] = useState<string>("annual");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.personReviews(userId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load reviews.");
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading reviews" />;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.startReview(userId, { kind, period_label: label || null });
      setStarting(false);
      setLabel("");
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not start it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {data.open_objectives.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h3 className="card-title">Objectives still open</h3>
            <p className="muted text-xs">
              Carried from earlier reviews. The next review is where these get judged.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.open_objectives.map((objective) => (
              <li
                key={objective.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 text-sm text-slate-800">
                  {objective.objective}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {objective.target_date
                    ? `by ${formatDate(objective.target_date)}`
                    : OBJECTIVE_STATUS_LABELS[objective.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-header flex flex-wrap items-center justify-between gap-2">
          <h3 className="card-title">Reviews</h3>
          {data.can_review && !starting && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setStarting(true)}
            >
              Start a review
            </button>
          )}
        </div>

        {starting && (
          <div className="space-y-3 border-b border-slate-100 p-4">
            <Field label="Kind" required hint={REVIEW_KIND_HINTS[kind as "annual"]}>
              {(id) => (
                <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
                  {options(REVIEW_KINDS, REVIEW_KIND_LABELS)}
                </Select>
              )}
            </Field>
            <Field label="Period" hint="What this period is called. FY2026, or the probation window.">
              {(id) => (
                <TextInput
                  id={id}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="FY2026"
                />
              )}
            </Field>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy}
                onClick={() => void start()}
              >
                {busy ? "Starting..." : "Start"}
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setStarting(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {data.reviews.length === 0 ? (
          <EmptyState
            title="No reviews yet"
            description={
              data.can_review
                ? "Start one when a probation period ends or the review year comes round."
                : "Nothing has been recorded yet."
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.reviews.map((review) => (
              <li key={review.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/reviews/${review.id}`} className="link text-sm font-medium">
                      {REVIEW_KIND_LABELS[review.kind]}
                      {review.period_label ? ` · ${review.period_label}` : ""}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {review.reviewer_name ? `Reviewed by ${review.reviewer_name}` : "No reviewer yet"}
                      {review.completed_at && ` · completed ${formatDate(review.completed_at)}`}
                      {review.probation_decision &&
                        ` · ${PROBATION_DECISION_LABELS[review.probation_decision]}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {review.overall && (
                      <span className={`pill ${RATING_STYLES[review.overall]}`}>
                        {RATING_LABELS[review.overall]}
                      </span>
                    )}
                    <span className={`pill ${REVIEW_STATUS_STYLES[review.status]}`}>
                      {REVIEW_STATUS_LABELS[review.status]}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
