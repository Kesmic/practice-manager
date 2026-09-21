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
import { SignatureCard } from "../components/SignatureCard";
import {
  ErrorBanner,
  Field,
  Spinner,
  SuccessBanner,
  TextInput,
} from "../components/ui";
import { formatDate, formatDateTime } from "../lib/format";
import { needsSignatureImage, type SignatureSpecimen } from "@shared/signatures";

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
    /** What they have on file to sign with; null for an acknowledgement. */
    my_signature_specimen: SignatureSpecimen | null;
    signatures?: DocumentSignature[];
    outstanding?: Array<{ user_id: string; full_name: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);
  const [specimen, setSpecimen] = useState<SignatureSpecimen | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const fresh = await api.document(id);
      setData(fresh);
      setSpecimen(fresh.my_signature_specimen);
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
        <Link to="/handbook" className="text-xs text-slate-500 hover:text-link">
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
          {/*
            On white whatever the theme: it was written in ink on paper, and a dark
            background turns it into a smudge.
          */}
          {mine.signature_id && (
            <img
              src={api.signatureImageUrl(mine.signature_id)}
              alt="Your signature"
              className="mt-2 max-h-16 max-w-[14rem] rounded bg-white object-contain object-left-bottom p-1"
            />
          )}
          {/*
            A plain link rather than a button that fetches. The response carries
            Content-Disposition, so following it downloads the file under the name the
            server chose; pulling it into a blob would throw that name away.
          */}
          <a
            className="mt-2 inline-block text-xs font-medium underline"
            href={api.signedCopyUrl(doc.id)}
          >
            Download your signed copy
          </a>
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
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-link"
            />
            <span>{ATTESTATION[action]}</span>
          </label>

          {/*
           * A contract carries the person's signature; a policy acknowledgement does
           * not. Offered here rather than only on the account page because this is
           * where somebody finds out they need one, and sending them away to another
           * screen mid-contract is how a signature does not get given today.
           */}
          {needsSignatureImage(doc) && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <p className="mb-1 text-sm font-medium text-slate-800 dark:text-slate-200">
                Your signature
              </p>
              <p className="mb-3 text-xs text-slate-500">
                {/*
                  "this document" rather than "this contract": a contract is the
                  common case but not the only one - an annual declaration is signed
                  too, and telling somebody it is a contract is worse than saying
                  nothing about what it is.
                */}
                {specimen
                  ? "This is what will appear on the signed copy."
                  : "Upload an image of your signature. It will appear on the signed copy above your typed name."}
              </p>
              <SignatureCard
                signature={specimen}
                onChanged={setSpecimen}
                framed={false}
              />
            </div>
          )}

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
                disabled={!confirmed || (needsSignatureImage(doc) && !specimen)}
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                placeholder={user.full_name}
              />
            )}
          </Field>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              The date, time and a fingerprint of this exact text are recorded with your
              {needsSignatureImage(doc) ? " signature and the image of it" : " signature"}.
            </p>
            <button
              type="submit"
              className="btn-primary shrink-0"
              disabled={
                busy ||
                !confirmed ||
                !typedName.trim() ||
                (needsSignatureImage(doc) && !specimen)
              }
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
                      <td className="text-xs">
                        {signature.typed_name}
                        {signature.signature_id && (
                          <img
                            src={api.signatureImageUrl(signature.signature_id)}
                            alt={`Signature of ${signature.user_name ?? "this person"}`}
                            className="mt-1 max-h-10 max-w-[9rem] rounded bg-white object-contain object-left-bottom p-0.5"
                          />
                        )}
                      </td>
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
