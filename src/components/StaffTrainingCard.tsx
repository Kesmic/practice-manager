/**
 * One person's logins and certifications, as an administrator manages them.
 *
 * The portal does not create accounts at Xero or Intuit and does not mark anybody's
 * course complete on their behalf. What it does is record who was given what, ask for
 * the courses the firm wants, chase the ones that are late, and keep the certificate.
 */

import { useCallback, useEffect, useState } from "react";
import type { ToolCatalogue, TrainingView } from "@shared/types";
import { describeValidity } from "@shared/certifications";
import { describeSize } from "@shared/staff-files";
import { ApiRequestError, api } from "../lib/api";
import { formatDate } from "../lib/format";
import { CertStatus } from "./CertStatus";
import {
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  SuccessBanner,
  TextInput,
} from "./ui";

export function StaffTrainingCard({
  userId,
  fullName,
}: {
  userId: string;
  fullName: string;
}) {
  const [view, setView] = useState<TrainingView | null>(null);
  const [catalogue, setCatalogue] = useState<ToolCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [training, cat] = await Promise.all([api.employeeTraining(userId), api.tools()]);
      setView(training);
      setCatalogue(cat);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load training.");
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view || !catalogue) return <Spinner label="Loading training" />;

  if (!catalogue.tools.length) {
    return (
      <EmptyState
        title="No tools set up yet"
        description="A Partner adds the practice's tools and their certifications under Portal settings, Tools and certifications."
      />
    );
  }

  const first = fullName.split(" ")[0];
  const loginFor = (toolId: string) => view.logins.find((l) => l.tool_id === toolId);

  const remind = async (id: string, name: string) => {
    setError(null);
    try {
      const result = await api.remindCertification(id);
      await load();
      setNotice(`Reminder about ${name} sent to ${result.sent_to}, copied to ${result.copied_to}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not send that.");
    }
  };

  const unassign = async (id: string, name: string) => {
    if (!window.confirm(`Stop asking ${first} to take ${name}?`)) return;
    try {
      await api.unassignCertification(id);
      await load();
      setNotice(`${first} is no longer asked to take ${name}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not do that.");
    }
  };

  return (
    <div className="space-y-4">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      <section className="card space-y-3 p-5">
        <div>
          <h2 className="card-title">Logins to the practice&rsquo;s accounts</h2>
          <p className="muted mt-0.5">
            You invite them at the tool, then record it here so they are told. The
            portal never holds the password.
          </p>
        </div>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Signs in as</th>
                <th>Details sent</th>
                <th className="text-right">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {catalogue.tools.map((tool) => {
                const login = loginFor(tool.id);
                return (
                  <tr key={tool.id}>
                    <td className="whitespace-nowrap font-medium">{tool.name}</td>
                    <td className="font-mono text-xs">
                      {login?.username ?? <span className="text-slate-400">-</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {login?.issued_at ? (
                        <>
                          {formatDate(login.issued_at)}
                          <span className="block text-slate-500">to {login.issued_to}</span>
                        </>
                      ) : login ? (
                        <span className="text-slate-500">Recorded, not sent</span>
                      ) : (
                        <span className="text-slate-400">Not issued</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setIssuing(tool.id)}>
                        {login ? "Send again" : "Record a login"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="card-title">Certifications</h2>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setAssigning(true)}>
            Ask {first} to take one
          </button>
        </div>

        {!view.certifications.length ? (
          <EmptyState
            title="Nothing asked of them yet"
            description={`${first} has not been asked to take any of the practice's certifications.`}
          />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Certification</th>
                  <th>Status</th>
                  <th>Certificate</th>
                  <th className="text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {view.certifications.map((cert) => (
                  <tr key={cert.id}>
                    <td>
                      <span className="font-medium">{cert.certification_name}</span>
                      <span className="block text-xs text-slate-500">
                        {cert.tool_name} · {describeValidity(cert.validity_months)}
                      </span>
                    </td>
                    <td>
                      <CertStatus record={cert} today={view.today} />
                    </td>
                    <td className="text-xs">
                      {cert.filename ? (
                        <>
                          <a className="link" href={api.certificateUrl(cert.id)} target="_blank" rel="noreferrer">
                            {cert.filename}
                          </a>
                          <span className="block text-slate-500">
                            {describeSize(cert.size_bytes ?? 0)} · {formatDate(cert.uploaded_at)}
                          </span>
                        </>
                      ) : cert.requires_certificate ? (
                        <span className="text-slate-500">Awaiting</span>
                      ) : (
                        <span className="text-slate-400">Not needed</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {cert.progress !== "certified" && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => void remind(cert.id, cert.certification_name)}
                        >
                          Remind
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-rose-700"
                        onClick={() => void unassign(cert.id, cert.certification_name)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          A reminder goes to the person and copies you, so there is a record of the
          chase that you can point at later.
        </p>
      </section>

      <IssueLoginDialog
        toolId={issuing}
        tool={catalogue.tools.find((t) => t.id === issuing) ?? null}
        existing={issuing ? (loginFor(issuing)?.username ?? "") : ""}
        userId={userId}
        onClose={() => setIssuing(null)}
        onDone={async (message) => {
          setIssuing(null);
          await load();
          setNotice(message);
        }}
      />

      <AssignDialog
        open={assigning}
        userId={userId}
        firstName={first}
        catalogue={catalogue}
        already={view.certifications.map((c) => c.certification_id)}
        onClose={() => setAssigning(false)}
        onDone={async (message) => {
          setAssigning(false);
          await load();
          setNotice(message);
        }}
      />
    </div>
  );
}

function IssueLoginDialog({
  toolId,
  tool,
  existing,
  userId,
  onClose,
  onDone,
}: {
  toolId: string | null;
  tool: { name: string } | null;
  existing: string;
  userId: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void> | void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    if (!toolId) return;
    setUsername(existing);
    setPassword("");
    setNotify(true);
    setError(null);
    setIssued(null);
  }, [toolId, existing]);

  if (!toolId || !tool) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.issueToolLogin(userId, {
        tool_id: toolId,
        username,
        password: password || undefined,
        notify,
      });
      setIssued({ username: result.username, password });
      if (notify && !result.notified) {
        setError(
          `Recorded, but the message could not be sent: ${result.notify_error ?? "unknown"}. Pass the details on yourself.`,
        );
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not record that.");
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <Modal open title={`${tool.name} login recorded`} onClose={() => void onDone(`${tool.name} login recorded.`)}>
        <div className="space-y-4">
          <div className="rounded-md bg-slate-50 p-4 text-sm dark:bg-slate-800/40">
            <p>
              Signs in as <span className="font-mono">{issued.username}</span>
            </p>
            {issued.password && (
              <p className="mt-1">
                Temporary password <span className="font-mono">{issued.password}</span>
              </p>
            )}
          </div>
          <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <strong>Shown once.</strong> The portal keeps no copy of the password. If
            this closes before you have passed it on, reset it at {tool.name}.
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={() => void onDone(`${tool.name} login recorded.`)}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title={`Record a ${tool.name} login`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Invite them at {tool.name} first. Then put the details here and the portal
          will pass them on.
        </p>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <Field label="Signs in as" required>
          {(id) => <TextInput id={id} value={username} onChange={(e) => setUsername(e.target.value)} />}
        </Field>
        <Field
          label="Temporary password"
          hint="Leave empty to hand it over yourself. The portal never stores it either way."
        >
          {(id) => <TextInput id={id} value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>
            <strong>Email the details</strong> to their work address.
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy || !username.trim()} onClick={() => void submit()}>
            {busy ? "Saving…" : "Record"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AssignDialog({
  open,
  userId,
  firstName,
  catalogue,
  already,
  onClose,
  onDone,
}: {
  open: boolean;
  userId: string;
  firstName: string;
  catalogue: ToolCatalogue;
  already: string[];
  onClose: () => void;
  onDone: (message: string) => Promise<void> | void;
}) {
  const [certId, setCertId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available = catalogue.certifications.filter((c) => !already.includes(c.id));

  useEffect(() => {
    if (!open) return;
    setCertId(available[0]?.id ?? "");
    setDueOn("");
    setError(null);
    // available is derived; recomputing it in the dependency list would reset the
    // form on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const toolName = (toolId: string) =>
    catalogue.tools.find((t) => t.id === toolId)?.name ?? "";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.assignCertification(userId, { certification_id: certId, due_on: dueOn || null });
      const name = available.find((c) => c.id === certId)?.name ?? "the certification";
      await onDone(`${firstName} has been asked to take ${name}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not do that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Ask ${firstName} to take a certification`} onClose={onClose}>
      <div className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {!available.length ? (
          <p className="text-sm text-slate-600">
            {firstName} has already been asked to take every certification the practice
            has. Add more under Portal settings, Tools and certifications.
          </p>
        ) : (
          <>
            <Field label="Certification" required>
              {(id) => (
                <Select id={id} value={certId} onChange={(e) => setCertId(e.target.value)}>
                  {available.map((cert) => (
                    <option key={cert.id} value={cert.id}>
                      {toolName(cert.tool_id)} — {cert.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Due by" hint="Optional. Without one, nothing is ever counted as overdue.">
              {(id) => (
                <TextInput id={id} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
              )}
            </Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy || !certId} onClick={() => void submit()}>
            {busy ? "Saving…" : "Ask them"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
