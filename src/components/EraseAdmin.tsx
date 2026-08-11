/**
 * Erasing a period of data.
 *
 * The screen is deliberately slow to use. You pick the dates, tick what to include,
 * press Check, read what would go, say why, and type a word. Every one of those steps
 * exists because the alternative to a tool like this is somebody editing the database
 * by hand, and the failure that matters is not "this took six clicks" but "we deleted
 * the wrong year and did not notice for a month".
 */

import { useCallback, useEffect, useState } from "react";
import {
  AUDIT_SCOPES,
  ERASE_CONFIRMATION,
  ERASE_SCOPES,
  ERASE_SCOPE_DETAIL,
  ERASE_SCOPE_LABELS,
  NEVER_ERASED,
  type ErasePreview,
  type EraseScope,
} from "@shared/erase";
import { ApiRequestError, api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { ErrorBanner, Field, TextArea, TextInput } from "./ui";

export function EraseAdmin({
  setError,
  setNotice,
}: {
  setError: (m: string | null) => void;
  setNotice: (m: string | null) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [scopes, setScopes] = useState<EraseScope[]>(["closed_deliverables"]);
  const [preview, setPreview] = useState<ErasePreview | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [checking, setChecking] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [log, setLog] = useState<Awaited<ReturnType<typeof api.erasures>>["erasures"]>(
    [],
  );

  const loadLog = useCallback(() => {
    void api
      .erasures()
      .then((res) => setLog(res.erasures))
      .catch(() => setLog([]));
  }, []);

  useEffect(loadLog, [loadLog]);

  // Any change to what is being erased invalidates the preview it was based on.
  const invalidate = () => {
    setPreview(null);
    setConfirm("");
  };

  const toggle = (scope: EraseScope) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
    invalidate();
  };

  const check = async () => {
    setChecking(true);
    setLocalError(null);
    setPreview(null);
    try {
      const res = await api.erasePreview({ from, to, scopes });
      setPreview(res.preview);
    } catch (err) {
      setLocalError(
        err instanceof ApiRequestError
          ? [err.message, err.detail].filter(Boolean).join(" ")
          : "Could not work out what that period contains.",
      );
    } finally {
      setChecking(false);
    }
  };

  const run = async () => {
    if (!preview) return;
    setErasing(true);
    setLocalError(null);
    try {
      const res = await api.erase({
        from,
        to,
        scopes,
        reason,
        confirm,
        expected_total: preview.total,
      });
      setNotice(
        `${res.erased.total} record(s) erased for ${res.erased.range.from} to ${res.erased.range.to}. The erasure itself is on the record below.`,
      );
      setError(null);
      setPreview(null);
      setConfirm("");
      setReason("");
      loadLog();
    } catch (err) {
      setLocalError(
        err instanceof ApiRequestError
          ? [err.message, err.detail].filter(Boolean).join(" ")
          : "Nothing was erased.",
      );
    } finally {
      setErasing(false);
    }
  };

  const ready =
    Boolean(preview) &&
    preview!.total > 0 &&
    reason.trim().length >= 4 &&
    confirm === ERASE_CONFIRMATION;

  return (
    <div className="space-y-5">
      <ErrorBanner error={localError} onDismiss={() => setLocalError(null)} />

      <section className="card p-4">
        <h2 className="card-title">Choose a period</h2>
        <p className="muted mb-3 mt-0.5">
          Both dates count as inside the period. A deliverable is placed by the period
          it relates to, not by when it was last touched, so erasing 2019 means the 2019
          work wherever it was finished.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  invalidate();
                }}
              />
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  invalidate();
                }}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="card-title">Choose what to include</h2>
        <div className="mt-3 space-y-3">
          {ERASE_SCOPES.map((scope) => {
            const audit = AUDIT_SCOPES.includes(scope);
            return (
              <label
                key={scope}
                className={`flex cursor-pointer gap-3 rounded-md border p-3 ${
                  audit ? "border-amber-300 bg-amber-50/40" : "border-slate-200"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={scopes.includes(scope)}
                  onChange={() => toggle(scope)}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">
                    {ERASE_SCOPE_LABELS[scope]}
                    {audit && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                        audit trail
                      </span>
                    )}
                  </span>
                  <span className="muted mt-0.5 block">{ERASE_SCOPE_DETAIL[scope]}</span>
                </span>
              </label>
            );
          })}
        </div>

        <button
          type="button"
          className="btn-secondary mt-4"
          disabled={checking || !from || !to || !scopes.length}
          onClick={() => void check()}
        >
          {checking ? "Checking..." : "Check what this would erase"}
        </button>
      </section>

      {/* Nothing can be erased before this has been read. */}
      {preview && (
        <section className="card p-4 ring-1 ring-amber-300">
          <h2 className="card-title">
            What would go, for {preview.range.from} to {preview.range.to}
          </h2>

          {preview.total === 0 ? (
            <p className="muted mt-2">
              Nothing in that period matches what you ticked. Nothing to erase.
            </p>
          ) : (
            <>
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {preview.rows.map((row) => (
                    <tr key={row.scope}>
                      <td className="py-2 pr-3">
                        {ERASE_SCOPE_LABELS[row.scope]}
                        {row.spared && (
                          <span className="muted block">
                            {row.spared.count} more in these dates {row.spared.reason}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {row.count}
                        {row.cascade ? (
                          <span className="muted block font-normal">
                            plus {row.cascade} attached record(s)
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300">
                    <td className="py-2 font-semibold">Total</td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {preview.total}
                    </td>
                  </tr>
                </tbody>
              </table>

              {preview.warnings.map((warning) => (
                <p
                  key={warning}
                  className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  {warning}
                </p>
              ))}

              <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                <Field
                  label="Why is this being erased?"
                  hint="Kept on the record. An unexplained gap in the records is worse than no gap."
                >
                  {(id) => (
                    <TextArea
                      id={id}
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. 2018 returns archived with the client's own accountant"
                    />
                  )}
                </Field>
                <Field label={`Type ${ERASE_CONFIRMATION} to confirm`}>
                  {(id) => (
                    <TextInput
                      id={id}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="off"
                    />
                  )}
                </Field>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={!ready || erasing}
                  onClick={() => void run()}
                >
                  {erasing
                    ? "Erasing..."
                    : `Erase ${preview.total} record(s), permanently`}
                </button>
                <p className="muted">
                  This cannot be undone from inside the portal. If the figure above has
                  changed since you checked, the erasure is refused rather than run.
                </p>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card p-4">
        <h2 className="card-title">What this can never erase</h2>
        <dl className="mt-2 divide-y divide-slate-100">
          {NEVER_ERASED.map((item) => (
            <div key={item.what} className="py-2">
              <dt className="text-sm font-medium text-slate-800">{item.what}</dt>
              <dd className="muted">{item.why}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card p-4">
        <h2 className="card-title">Erasures so far</h2>
        {log.length === 0 ? (
          <p className="muted mt-2">Nothing has been erased.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">By</th>
                  <th className="py-1 pr-3">Period</th>
                  <th className="py-1 pr-3 text-right">Records</th>
                  <th className="py-1">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {log.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="py-2 pr-3">{row.actor_name}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {row.period_from} to {row.period_to}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.total_removed}
                    </td>
                    <td className="py-2">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
