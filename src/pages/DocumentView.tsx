import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { DocumentSignature, PortalDocumentDetail } from "@shared/types";
import {
  ACTION_DONE,
  ACTION_VERB,
  ATTESTATION,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_STYLES,
  requiredAction,
} from "@shared/hr";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { Markdown } from "../components/Markdown";
import {
  ErrorBanner,
  Field,
  Spinner,
  SuccessBanner,
  TextInput,
} from "../components/ui";
import { formatDate, formatDateTime } from "../lib/format";

/**
 * Reads a single portal document and, where required, captures the employee's
 * acknowledgement or signature.
 *
 * The signing control stays disabled until the reader has actually scrolled to
 * the end of the text. That is a deliberately mild friction: it does not prove
 * comprehension, but it stops a one-click "agree" on a contract the employee has
 * not scrolled past the first screen of.
 */
export function DocumentView() {
  const { id = "" } = useParams();
  const { user, can } = useSession();

  const [data, setData] = useState<{
    document: PortalDocumentDetail;
    my_signature: DocumentSignature | null;
    signatures?: DocumentSignature[];
    outstanding?: Array<{ user_id: string; full_name: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.document(id));
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load the document.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mark as read once the end of the document scrolls into view.
  useEffect(() => {
    const node = bodyRef.current;
    if (!node || !data) return;

    const check = () => {
      const rect = node.getBoundingClientRect();
      // The bottom of the text has passed the bottom of the viewport.
      if (rect.bottom <= window.innerHeight + 80) setReadToEnd(true);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [data]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data || !user) return <Spinner label="Loading document" />;

  const { document: doc, my_signature: mine } = data;
  const action = requiredAction(doc);

  const sign = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signDocument(doc.id, typedName);
      setNotice(
        action === "signed"
          ? "Your signature has been recorded."
          : "Your acknowledgement has been recorded.",
      );
      setTypedName("");
      setConfirmed(false);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not record your response.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link to="/handbook" className="text-xs text-slate-500 hover:text-brand-700">
          ← Back to the handbook
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
            {DOCUMENT_KIND_LABELS[doc.kind]}
          </span>
          {doc.category && (
            <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
              {doc.category}
            </span>
          )}
          <span className={`pill ${DOCUMENT_STATUS_STYLES[doc.status]}`}>
            {DOCUMENT_STATUS_LABELS[doc.status]}
          </span>
          <span className="text-xs text-slate-500">Version {doc.version}</span>
          {doc.effective_from && (
            <span className="text-xs text-slate-500">
              Effective {formatDate(doc.effective_from)}
            </span>
          )}
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
          {doc.title}
        </h1>
        {doc.summary && <p className="muted mt-1">{doc.summary}</p>}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {mine && (
        <div className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">
          <p className="font-medium">
            {ACTION_DONE[mine.action]} on {formatDateTime(mine.signed_at)}
          </p>
          <p className="mt-0.5 text-xs">
            Recorded against version {mine.version}, signed as “{mine.typed_name}”.
          </p>
        </div>
      )}

      <article ref={bodyRef} className="card px-5 py-5">
        <Markdown>{doc.body}</Markdown>
      </article>

      {/* Signature capture */}
      {action && !mine && (
        <form onSubmit={sign} className="card space-y-4 p-5">
          <h2 className="card-title">
            {ACTION_VERB[action]} this {doc.kind === "contract" ? "contract" : "policy"}
          </h2>

          {!readToEnd && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              Please scroll to the end of the document before signing.
            </p>
          )}

          <label className="flex items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!readToEnd}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600"
            />
            <span>{ATTESTATION[action]}</span>
          </label>

          <Field
            label="Type your full name to sign"
            required
            hint={`It must match the name on your account: ${user.full_name}`}
          >
            {(fieldId) => (
              <TextInput
                id={fieldId}
                required
                autoComplete="off"
                disabled={!confirmed}
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                placeholder={user.full_name}
              />
            )}
          </Field>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              The date, time and a fingerprint of this exact text are recorded with your
              signature.
            </p>
            <button
              type="submit"
              className="btn-primary shrink-0"
              disabled={busy || !confirmed || !typedName.trim()}
            >
              {busy ? "Recording…" : ACTION_VERB[action]}
            </button>
          </div>
        </form>
      )}

      {!action && (
        <p className="muted">
          This document is for reference. No signature or acknowledgement is required.
        </p>
      )}

      {/* HR compliance view */}
      {can("partner") && data.signatures && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Compliance record</h2>
            <span className="muted">
              {data.outstanding?.length ?? 0} outstanding
            </span>
          </div>

          {data.outstanding && data.outstanding.length > 0 && (
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Not yet responded (version {doc.version})
              </p>
              <p className="text-sm text-slate-700">
                {data.outstanding.map((person) => person.full_name).join(", ")}
              </p>
            </div>
          )}

          {!data.signatures.length ? (
            <p className="px-4 py-4 text-sm text-slate-500">
              No responses recorded yet.
            </p>
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Action</th>
                    <th>Version</th>
                    <th>Signed as</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.signatures.map((signature) => (
                    <tr key={signature.id}>
                      <td className="whitespace-nowrap">{signature.user_name}</td>
                      <td className="whitespace-nowrap text-xs">
                        {ACTION_DONE[signature.action]}
                      </td>
                      <td className="whitespace-nowrap text-center tabular-nums">
                        {signature.version}
                        {signature.version !== doc.version && (
                          <span
                            className="ml-1 pill bg-amber-50 text-amber-800 ring-amber-200"
                            title="Signed against an earlier version of this document"
                          >
                            superseded
                          </span>
                        )}
                      </td>
                      <td className="text-xs">{signature.typed_name}</td>
                      <td className="whitespace-nowrap text-xs">
                        {formatDateTime(signature.signed_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
