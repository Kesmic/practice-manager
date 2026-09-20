/**
 * What a member of staff has been given, and what the firm has asked them to pass.
 *
 * Deliberately not a table. This is a short list of things somebody has to do, and the
 * one that is late should look different from across the room - so the outstanding
 * ones lead, each as a card with the action on it, and the ones already passed sit
 * quietly underneath.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { StaffCertification, TrainingView } from "@shared/types";
import { certState, describeValidity } from "@shared/certifications";
import { ACCEPT_ATTRIBUTE, describeSize, whyNotAcceptable } from "@shared/staff-files";
import { ApiRequestError, api } from "../lib/api";
import { formatDate } from "../lib/format";
import { CertStatus } from "../components/CertStatus";
import { EmptyState, ErrorBanner, Spinner, SuccessBanner } from "../components/ui";

export function MyTraining() {
  const [view, setView] = useState<TrainingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.myTraining());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load your training.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) {
    return error ? <ErrorBanner error={error} /> : <Spinner label="Loading your training" />;
  }

  const outstanding = view.certifications.filter(
    (c) => certState(c, view.today) !== "certified",
  );
  const done = view.certifications.filter((c) => certState(c, view.today) === "certified");
  const myLogins = view.logins
    .map((login) => ({ login, tool: view.tools.find((t) => t.id === login.tool_id) }))
    .filter((row) => row.tool);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">My training</h1>
        <p className="text-sm text-slate-600">
          The tools you have been given, and the certifications the firm has asked you
          to hold.
        </p>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {myLogins.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title">Your logins</h2>
          <dl className="mt-3 divide-y divide-slate-100">
            {myLogins.map(({ login, tool }) => (
              <div key={login.tool_id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <dt className="font-medium text-slate-800 dark:text-slate-200">{tool!.name}</dt>
                <dd className="text-right">
                  <span className="font-mono text-xs">{login.username}</span>
                  {tool!.sign_in_url && (
                    <a
                      className="link ml-3 text-xs"
                      href={tool!.sign_in_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Sign in
                    </a>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="hint mt-3">
            Your password was sent to you when the login was made. The portal keeps no
            copy - if you have lost it, reset it at the tool or ask a Partner.
          </p>
        </section>
      )}

      {!view.certifications.length ? (
        <EmptyState
          title="Nothing has been asked of you yet"
          description="When the firm asks you to take a certification it will appear here, with the course and the date it is wanted by."
        />
      ) : (
        <>
          {outstanding.map((cert) => (
            <OutstandingCard
              key={cert.id}
              cert={cert}
              today={view.today}
              onChanged={async (message) => {
                await load();
                setNotice(message);
              }}
              setError={setError}
            />
          ))}

          {done.length > 0 && (
            <section className="card p-5">
              <h2 className="card-title">Passed</h2>
              <ul className="mt-3 divide-y divide-slate-100">
                {done.map((cert) => (
                  <li key={cert.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {cert.certification_name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {cert.tool_name}
                        {cert.completed_on ? ` · passed ${formatDate(cert.completed_on)}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {cert.filename && (
                        <a className="link text-xs" href={api.myCertificateUrl(cert.id)} target="_blank" rel="noreferrer">
                          {cert.filename}
                        </a>
                      )}
                      <CertStatus record={cert} today={view.today} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One certification still to do.
 *
 * The state decides how loud it is: something overdue gets an amber card, everything
 * else the ordinary one. Three actions, and which are offered depends on where they
 * are - "I have started" disappears once they have.
 */
function OutstandingCard({
  cert,
  today,
  onChanged,
  setError,
}: {
  cert: StaffCertification;
  today: string;
  onChanged: (message: string) => Promise<void> | void;
  setError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const state = certState(cert, today);
  const loud = state === "overdue";

  const mark = async (progress: "in_progress" | "certified") => {
    setBusy(true);
    setError(null);
    try {
      await api.setMyCertificationProgress(cert.id, { progress });
      await onChanged(
        progress === "certified"
          ? `${cert.certification_name} recorded as passed.`
          : `${cert.certification_name} marked as started.`,
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not update that.");
    } finally {
      setBusy(false);
    }
  };

  const attach = async (file: File | undefined) => {
    if (!file) return;
    const refusal = whyNotAcceptable({ type: file.type, size: file.size });
    if (refusal) {
      setError(refusal);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.uploadCertificate(cert.id, file);
      await onChanged(`Certificate attached to ${cert.certification_name}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not attach that.");
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };

  return (
    <section
      className={`card space-y-3 p-5 ${
        loud ? "border-amber-300 bg-amber-50/60 dark:bg-amber-900/10" : ""
      }`}
    >
      <input
        ref={picker}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(e) => void attach(e.target.files?.[0])}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="card-title">{cert.certification_name}</h2>
          <p className="muted mt-0.5">
            {cert.tool_name} · {describeValidity(cert.validity_months)}
          </p>
        </div>
        <CertStatus record={cert} today={today} />
      </div>

      {cert.filename && (
        <p className="text-sm text-slate-600">
          Attached:{" "}
          <a className="link" href={api.myCertificateUrl(cert.id)} target="_blank" rel="noreferrer">
            {cert.filename}
          </a>{" "}
          <span className="text-xs text-slate-500">
            ({describeSize(cert.size_bytes ?? 0)})
          </span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {cert.course_url && (
          <a className="btn-primary btn-sm" href={cert.course_url} target="_blank" rel="noreferrer">
            Take the course
          </a>
        )}
        {cert.requires_certificate ? (
          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => picker.current?.click()}>
            {cert.filename ? "Replace my certificate" : "Attach my certificate"}
          </button>
        ) : null}
        {cert.progress === "assigned" && (
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void mark("in_progress")}>
            I have started
          </button>
        )}
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void mark("certified")}>
          I have passed it
        </button>
      </div>

      {cert.requires_certificate && !cert.filename && (
        <p className="hint">
          The firm keeps a copy of what you passed, so attach the certificate before
          marking this done.
        </p>
      )}
    </section>
  );
}
