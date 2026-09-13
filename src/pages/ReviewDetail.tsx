/**
 * One performance review, from both sides.
 *
 * The same screen serves the reviewer writing it and the person reading it, because they
 * are looking at the same document and splitting them into two pages would be how the
 * two versions quietly diverge. What differs is which parts are editable, and that is
 * decided by the server and reported back as `can_write` and `is_subject`.
 *
 * The employee's comment box is the part worth being careful about. It sits below the
 * reviewer's judgement rather than beside it, and it says plainly that signing means
 * having read the review and not having agreed with it - because a signature block that
 * implies consent it did not get is worse than no signature at all.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { ReviewDetail as Review } from "@shared/types";
import {
  OBJECTIVE_STATUSES,
  OBJECTIVE_STATUS_LABELS,
  OVERALL_OUTCOMES,
  PROBATION_DECISIONS,
  PROBATION_DECISION_HINTS,
  PROBATION_DECISION_LABELS,
  RATINGS,
  RATING_HINTS,
  RATING_LABELS,
  RATING_STYLES,
  REVIEW_KIND_LABELS,
  REVIEW_STATUS_LABELS,
  REVIEW_STATUS_STYLES,
  describeShareProblem,
  type Rating,
} from "@shared/performance";
import { ApiRequestError, api } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/format";
import {
  ErrorBanner,
  Field,
  Select,
  Spinner,
  SuccessBanner,
  TextArea,
  TextInput,
  options,
} from "../components/ui";

export function ReviewDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [review, setReview] = useState<Review | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [isSubject, setIsSubject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.review(id);
      setReview(res.review);
      setCanWrite(res.can_write);
      setIsSubject(res.is_subject);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load it.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<{ review: Review }>, message?: string) => {
    setBusy(true);
    setError(null);
    try {
      setReview((await work()).review);
      if (message) setNotice(message);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (error && !review) return <ErrorBanner error={error} />;
  if (!review) return <Spinner label="Loading the review" />;

  const locked = review.status === "complete";
  const editable = canWrite && review.status === "draft";
  const shareProblem = describeShareProblem({
    kind: review.kind,
    overall: review.overall,
    ratings: review.ratings,
    applicable: review.criteria,
    probation_decision: review.probation_decision,
    probation_extend_to: review.probation_extend_to,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="link mb-2 inline-flex items-center gap-1 text-xs"
        >
          <span aria-hidden="true">&larr;</span> Back
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="section-title">{REVIEW_KIND_LABELS[review.kind]}</h1>
            <p className="muted mt-0.5">
              {review.subject_name}
              {review.period_label ? ` · ${review.period_label}` : ""}
              {review.reviewer_name ? ` · reviewed by ${review.reviewer_name}` : ""}
            </p>
          </div>
          <span className={`pill ${REVIEW_STATUS_STYLES[review.status]}`}>
            {REVIEW_STATUS_LABELS[review.status]}
          </span>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {review.status === "shared" && isSubject && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
          This review is with you. Read it, add anything you want on the record, and sign
          to confirm you have seen it.
        </div>
      )}

      {/* ------------------------------------------------------------ period */}
      {editable && (
        <section className="card space-y-3 p-4">
          <h2 className="card-title">Period under review</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Label">
              {(fid) => (
                <TextInput
                  id={fid}
                  defaultValue={review.period_label ?? ""}
                  placeholder="FY2026"
                  onBlur={(e) =>
                    void run(() => api.updateReview(id, { period_label: e.target.value }))
                  }
                />
              )}
            </Field>
            <Field label="From">
              {(fid) => (
                <TextInput
                  id={fid}
                  type="date"
                  defaultValue={review.period_start ?? ""}
                  onChange={(e) =>
                    void run(() => api.updateReview(id, { period_start: e.target.value }))
                  }
                />
              )}
            </Field>
            <Field label="To">
              {(fid) => (
                <TextInput
                  id={fid}
                  type="date"
                  defaultValue={review.period_end ?? ""}
                  onChange={(e) =>
                    void run(() => api.updateReview(id, { period_end: e.target.value }))
                  }
                />
              )}
            </Field>
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- ratings */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Assessment</h2>
          <p className="muted text-xs">
            Rated against what this grade requires, not against colleagues.
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {review.criteria.map((criterion) => {
            const current = review.ratings.find((r) => r.criterion === criterion.key);
            return (
              <li key={criterion.key} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {criterion.label}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{criterion.detail}</p>
                  </div>
                  {editable ? (
                    <Select
                      className="input w-44 shrink-0"
                      value={current?.rating ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        void run(() =>
                          api.rateReview(id, criterion.key, {
                            rating: e.target.value || null,
                            comment: current?.comment ?? null,
                          }),
                        )
                      }
                    >
                      <option value="">Not yet rated</option>
                      {options(RATINGS, RATING_LABELS)}
                    </Select>
                  ) : current?.rating ? (
                    <span className={`pill shrink-0 ${RATING_STYLES[current.rating]}`}>
                      {RATING_LABELS[current.rating]}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-slate-400">Not rated</span>
                  )}
                </div>

                {editable && current?.rating && (
                  <p className="mt-1 text-xs text-slate-500">
                    {RATING_HINTS[current.rating as Rating]}
                  </p>
                )}

                {editable ? (
                  <TextArea
                    rows={2}
                    className="input mt-2"
                    placeholder={
                      current?.rating === "below"
                        ? "Required: what has to change, and by when."
                        : "Evidence for this rating."
                    }
                    defaultValue={current?.comment ?? ""}
                    onBlur={(e) =>
                      void run(() =>
                        api.rateReview(id, criterion.key, {
                          rating: current?.rating ?? null,
                          comment: e.target.value || null,
                        }),
                      )
                    }
                  />
                ) : (
                  current?.comment && (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">
                      {current.comment}
                    </p>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ---------------------------------------------------------- narrative */}
      <section className="card space-y-4 p-4">
        <h2 className="card-title">Overall</h2>
        {editable ? (
          <>
            <Field label="Overall outcome" required>
              {(fid) => (
                <Select
                  id={fid}
                  value={review.overall ?? ""}
                  onChange={(e) =>
                    void run(() => api.updateReview(id, { overall: e.target.value || null }))
                  }
                >
                  <option value="">Choose...</option>
                  {options(OVERALL_OUTCOMES, RATING_LABELS)}
                </Select>
              )}
            </Field>
            <Field label="What went well">
              {(fid) => (
                <TextArea
                  id={fid}
                  rows={3}
                  defaultValue={review.strengths ?? ""}
                  onBlur={(e) =>
                    void run(() => api.updateReview(id, { strengths: e.target.value }))
                  }
                />
              )}
            </Field>
            <Field label="What needs to improve">
              {(fid) => (
                <TextArea
                  id={fid}
                  rows={3}
                  defaultValue={review.development ?? ""}
                  onBlur={(e) =>
                    void run(() => api.updateReview(id, { development: e.target.value }))
                  }
                />
              )}
            </Field>
          </>
        ) : (
          <dl className="space-y-3 text-sm">
            <Readout label="Overall">
              {review.overall ? (
                <span className={`pill ${RATING_STYLES[review.overall]}`}>
                  {RATING_LABELS[review.overall]}
                </span>
              ) : (
                "-"
              )}
            </Readout>
            <Readout label="What went well">{review.strengths ?? "-"}</Readout>
            <Readout label="What needs to improve">{review.development ?? "-"}</Readout>
          </dl>
        )}
      </section>

      {/* --------------------------------------------------------- probation */}
      {review.kind === "probation" && (
        <section className="card space-y-3 p-4">
          <h2 className="card-title">Probation decision</h2>
          {editable ? (
            <>
              <Field label="Decision" required>
                {(fid) => (
                  <Select
                    id={fid}
                    value={review.probation_decision ?? ""}
                    onChange={(e) =>
                      void run(() =>
                        api.updateReview(id, { probation_decision: e.target.value || null }),
                      )
                    }
                  >
                    <option value="">Choose...</option>
                    {options(PROBATION_DECISIONS, PROBATION_DECISION_LABELS)}
                  </Select>
                )}
              </Field>
              {review.probation_decision && (
                <p className="rounded-md bg-slate-50 p-2.5 text-xs text-slate-600 ring-1 ring-slate-200">
                  {PROBATION_DECISION_HINTS[review.probation_decision]}
                </p>
              )}
              {review.probation_decision === "extend" && (
                <Field label="Extended to" required>
                  {(fid) => (
                    <TextInput
                      id={fid}
                      type="date"
                      defaultValue={review.probation_extend_to ?? ""}
                      onChange={(e) =>
                        void run(() =>
                          api.updateReview(id, { probation_extend_to: e.target.value }),
                        )
                      }
                    />
                  )}
                </Field>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-700">
              {review.probation_decision
                ? PROBATION_DECISION_LABELS[review.probation_decision]
                : "Not decided"}
              {review.probation_extend_to &&
                ` · to ${formatDate(review.probation_extend_to)}`}
            </p>
          )}
        </section>
      )}

      {/* -------------------------------------------------------- objectives */}
      <ObjectivesSection
        review={review}
        editable={editable}
        busy={busy}
        run={run}
        id={id}
      />

      {/* ---------------------------------------------------- employee's half */}
      <section className="card space-y-3 p-4">
        <h2 className="card-title">{review.subject_name}&rsquo;s comments</h2>
        {isSubject && review.status === "shared" ? (
          <EmployeeResponse id={id} review={review} busy={busy} run={run} />
        ) : review.employee_comments ? (
          <p className="whitespace-pre-wrap text-sm text-slate-700">
            {review.employee_comments}
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            {review.status === "draft"
              ? "They will be able to add their own comments once this is shared with them."
              : "Nothing added."}
          </p>
        )}
      </section>

      {/* ------------------------------------------------------- signatures */}
      <section className="card p-4">
        <h2 className="card-title mb-2">Signatures</h2>
        <dl className="divide-y divide-slate-100 text-sm">
          <Readout label="Reviewer">
            {review.reviewer_signed_at
              ? `${review.reviewer_name ?? "Reviewer"} · ${formatDateTime(review.reviewer_signed_at)}`
              : "Not signed"}
          </Readout>
          <Readout label="Employee">
            {review.employee_signed_at
              ? `${review.subject_name} · ${formatDateTime(review.employee_signed_at)}`
              : "Not signed"}
          </Readout>
        </dl>
        {locked && (
          <p className="hint mt-3">
            Both parties have signed, so this review can no longer be changed by anybody.
            Record anything further in a new review.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------ actions */}
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          {review.status === "draft" && (
            <>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || Boolean(shareProblem)}
                onClick={() =>
                  void run(
                    () => api.shareReview(id),
                    `Sent to ${review.subject_name}. They will be asked to read it and sign.`,
                  )
                }
              >
                Sign and send to {review.subject_name.split(" ")[0]}
              </button>
              {shareProblem && (
                <p className="text-xs text-amber-700">{shareProblem}</p>
              )}
            </>
          )}
          {review.status === "shared" && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api.recallReview(id),
                  "Taken back for amendment. It is recorded on the HR trail that it was withdrawn.",
                )
              }
            >
              Recall for amendment
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-slate-800">{children}</dd>
    </div>
  );
}

/**
 * Objectives, which are the half of a review that does something afterwards.
 *
 * Ones carried in from an earlier review are judged here; new ones are set for the
 * period ahead. Both live in the same list because to the person reading it they are one
 * conversation.
 */
function ObjectivesSection({
  review,
  editable,
  busy,
  run,
  id,
}: {
  review: Review;
  editable: boolean;
  busy: boolean;
  run: (w: () => Promise<{ review: Review }>, m?: string) => Promise<void>;
  id: string;
}) {
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState("");

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Objectives</h2>
        <p className="muted text-xs">
          What has to be true by the next review. Specific enough to be judged.
        </p>
      </div>

      {review.objectives.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-slate-500">
          None set.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {review.objectives.map((objective) => (
            <li key={objective.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm text-slate-800">
                  {objective.objective}
                  {objective.target_date && (
                    <span className="ml-2 text-xs text-slate-500">
                      by {formatDate(objective.target_date)}
                    </span>
                  )}
                </p>
                {editable ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Select
                      className="input w-32"
                      value={objective.status}
                      disabled={busy}
                      onChange={(e) =>
                        void run(() =>
                          api.updateObjective(id, objective.id, { status: e.target.value }),
                        )
                      }
                    >
                      {options(OBJECTIVE_STATUSES, OBJECTIVE_STATUS_LABELS)}
                    </Select>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() => api.removeObjective(id, objective.id))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="pill shrink-0 bg-slate-100 text-slate-600 ring-slate-200">
                    {OBJECTIVE_STATUS_LABELS[objective.status]}
                  </span>
                )}
              </div>
              {objective.assessment && (
                <p className="mt-1 text-sm text-slate-600">{objective.assessment}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-4">
          <div className="min-w-48 flex-1">
            <Field label="New objective">
              {(fid) => (
                <TextInput
                  id={fid}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="No statutory filing missed without a week's notice"
                />
              )}
            </Field>
          </div>
          <Field label="By">
            {(fid) => (
              <TextInput
                id={fid}
                type="date"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            )}
          </Field>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !draft.trim()}
            onClick={() =>
              void run(() =>
                api.addObjective(id, {
                  objective: draft,
                  target_date: target || null,
                }),
              ).then(() => {
                setDraft("");
                setTarget("");
              })
            }
          >
            Add
          </button>
        </div>
      )}
    </section>
  );
}

/** The employee's own words, and their signature. */
function EmployeeResponse({
  id,
  review,
  busy,
  run,
}: {
  id: string;
  review: Review;
  busy: boolean;
  run: (w: () => Promise<{ review: Review }>, m?: string) => Promise<void>;
}) {
  const [text, setText] = useState(review.employee_comments ?? "");

  return (
    <>
      <TextArea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Anything you want recorded alongside this review, including where you see it differently."
      />
      <p className="hint">
        These are your words. Nobody else can edit them, and they stay on the file whether
        you agree with the review or not.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() =>
            void run(
              () => api.respondToReview(id, { comments: text }),
              "Saved. You can keep editing until you sign.",
            )
          }
        >
          Save my comments
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() =>
            void run(
              () => api.respondToReview(id, { comments: text, sign: true }),
              "Signed. The review is now complete and cannot be changed.",
            )
          }
        >
          Sign to confirm I have read it
        </button>
      </div>
      <p className="hint">
        Signing records that you have <strong>read</strong> the review. It is not an
        agreement with it - your comments above are where disagreement belongs.
      </p>
    </>
  );
}
