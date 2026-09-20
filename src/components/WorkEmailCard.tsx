/**
 * Somebody's work email address, as an administrator manages it.
 *
 * The mailbox is created at the host, not here. So this card does the other half: it
 * offers the address the firm's pattern suggests, records the one actually used, and
 * sends the person the details over a channel they can read - which is never the
 * mailbox itself, because they cannot open it yet.
 *
 * The temporary password is typed in and passed straight through. It is put in the
 * message, shown back once, and then gone; nothing stores it. So "send it again" asks
 * for the password again rather than quietly re-sending one the portal kept, which it
 * did not.
 */

import { useCallback, useEffect, useState } from "react";
import {
  hostAdminUrl,
  hostLabel,
  isConfigured,
  isOnFirmDomain,
  suggestAddress,
  whyNotAnAddress,
  type StaffEmailPolicy,
} from "@shared/staff-email";
import { ApiRequestError, api } from "../lib/api";
import { formatDate } from "../lib/format";
import {
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Spinner,
  SuccessBanner,
  TextInput,
} from "./ui";

interface Issued {
  work_email: string | null;
  work_email_host: string | null;
  work_email_issued_at: string | null;
  work_email_issued_to: string | null;
}

export function WorkEmailCard({
  userId,
  fullName,
  personalEmail,
  current,
  onChanged,
}: {
  userId: string;
  fullName: string;
  /** Where the details go. Their own address, never the mailbox being created. */
  personalEmail: string;
  current: Issued;
  onChanged: () => Promise<void> | void;
}) {
  const [policy, setPolicy] = useState<StaffEmailPolicy | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPolicy((await api.staffEmail()).policy);
    } catch {
      setPolicy(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!policy) return <Spinner label="Loading work email" />;

  if (!isConfigured(policy)) {
    return (
      <EmptyState
        title="Staff email is not set up"
        description="A Partner sets the host and the domain under Portal settings, Staff email. Until then the portal does not offer work addresses."
      />
    );
  }

  const label = hostLabel(policy);
  const adminUrl = hostAdminUrl(policy);

  const clear = async () => {
    setError(null);
    try {
      await api.clearWorkEmail(userId);
      await onChanged();
      setNotice(`Removed from ${fullName}'s record. The mailbox itself is untouched.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not remove that.");
    }
  };

  return (
    <div className="space-y-4">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="card-title">Work email</h2>
            <p className="muted mt-0.5">{label}</p>
          </div>
          {current.work_email ? (
            <span className="pill bg-emerald-50 text-emerald-700">On record</span>
          ) : (
            <span className="pill bg-slate-100 text-slate-600">Not set up</span>
          )}
        </div>

        {current.work_email ? (
          <dl className="divide-y divide-slate-100">
            <Row label="Address">
              <span className="font-mono text-sm">{current.work_email}</span>
            </Row>
            <Row label="Host">{current.work_email_host ?? label}</Row>
            <Row label="Details sent">
              {current.work_email_issued_at ? (
                <>
                  {formatDate(current.work_email_issued_at)} to{" "}
                  {current.work_email_issued_to}
                </>
              ) : (
                <span className="text-slate-500">
                  Not sent - the address is recorded but nobody has been told.
                </span>
              )}
            </Row>
          </dl>
        ) : (
          <p className="text-sm text-slate-600">
            Nothing recorded. Create the mailbox
            {adminUrl ? (
              <>
                {" "}
                at the{" "}
                <a className="link" href={adminUrl} target="_blank" rel="noreferrer">
                  {label} admin centre
                </a>
              </>
            ) : (
              <> at {label}</>
            )}
            , then record the details here so {fullName.split(" ")[0]} is told.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(true)}>
            {current.work_email ? "Send the details again" : "Record the address"}
          </button>
          {current.work_email && (
            <button type="button" className="btn-ghost btn-sm text-rose-700" onClick={() => void clear()}>
              Remove from the record
            </button>
          )}
        </div>

        <p className="hint">
          The portal never creates, changes or deletes a mailbox. Removing somebody from
          the portal leaves their mailbox exactly as it is, for the firm to deal with at
          the host.
        </p>
      </section>

      <IssueDialog
        open={open}
        onClose={() => setOpen(false)}
        userId={userId}
        fullName={fullName}
        personalEmail={personalEmail}
        policy={policy}
        current={current.work_email}
        onIssued={async (message) => {
          setOpen(false);
          await onChanged();
          setNotice(message);
        }}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  );
}

/**
 * Recording the address and handing it over.
 *
 * The address is prefilled from the firm's pattern the first time and from what is
 * already on record afterwards. Both refusals that matter - a malformed address, and a
 * destination on the firm's own domain - are shown here before anything is sent, and
 * repeated by the server, which is the one that counts.
 */
function IssueDialog({
  open,
  onClose,
  userId,
  fullName,
  personalEmail,
  policy,
  current,
  onIssued,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  fullName: string;
  personalEmail: string;
  policy: StaffEmailPolicy;
  current: string | null;
  onIssued: (message: string) => Promise<void> | void;
}) {
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ address: string; password: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setAddress(current ?? suggestAddress(fullName, policy));
    setPassword("");
    /*
     * Only offered when it is somewhere they could actually read. A person whose
     * account address is already on the firm's domain has no personal address on file,
     * and prefilling it would open this dialog with a refusal already showing and a
     * disabled button - which reads as the portal being broken rather than as a field
     * waiting to be filled in.
     */
    setSendTo(personalEmail && !isOnFirmDomain(personalEmail, policy) ? personalEmail : "");
    setNotify(true);
    setError(null);
    setIssued(null);
  }, [open, current, fullName, policy, personalEmail]);

  if (!open) return null;

  const addressProblem = address ? whyNotAnAddress(address) : null;
  const sendingHome = notify && sendTo ? isOnFirmDomain(sendTo, policy) : false;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.issueWorkEmail(userId, {
        address,
        password: password || undefined,
        send_to: sendTo || undefined,
        notify,
      });
      /*
       * Shown here rather than closing straight away. The portal keeps no copy of the
       * password, so this is the only time anybody sees it - closing on success would
       * take it away with nowhere to get it back from.
       */
      setIssued({ address: result.work_email, password });
      if (!result.notified && notify) {
        setError(
          `The address is recorded, but the message could not be sent: ${result.notify_error ?? "unknown error"}. Pass the details on yourself.`,
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
      <Modal open title={`${fullName.split(" ")[0]} is set up`} onClose={() => void onIssued(`Work email recorded for ${fullName}.`)}>
        <div className="space-y-4">
          <div className="rounded-md bg-slate-50 p-4 dark:bg-slate-800/40">
            <dl className="space-y-1 text-sm">
              <Row label="Address">
                <span className="font-mono">{issued.address}</span>
              </Row>
              {issued.password && (
                <Row label="Temporary password">
                  <span className="font-mono">{issued.password}</span>
                </Row>
              )}
            </dl>
          </div>
          <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            <strong>This is the only time the portal shows this.</strong> It keeps no
            copy of the password. If this closes before you have passed it on, reset it
            at the host and record it again.
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={() => void onIssued(`Work email recorded for ${fullName}.`)}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title="Record the work email" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Create the mailbox at {hostLabel(policy)} first. Then put the address and the
          temporary password here, and the portal will pass them on.
        </p>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <Field label="Work email address" required>
          {(id) => (
            <TextInput
              id={id}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={`name@${policy.domain}`}
            />
          )}
        </Field>
        {addressProblem && <p className="text-sm text-rose-700">{addressProblem}</p>}

        <Field
          label="Temporary password"
          hint="Leave empty to hand it over yourself. The portal never stores it either way."
        >
          {(id) => (
            <TextInput id={id} value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>

        <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          <span>
            <strong>Email the details.</strong> To a personal address - they cannot read
            the new mailbox yet.
          </span>
        </label>

        {notify && (
          <>
            <Field label="Send to" required>
              {(id) => (
                <TextInput id={id} value={sendTo} onChange={(e) => setSendTo(e.target.value)} />
              )}
            </Field>
            {sendingHome && (
              <p className="text-sm text-rose-700">
                That address is on the firm&rsquo;s own domain, so the message would go
                to a mailbox they cannot open. Use a personal address.
              </p>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !address || Boolean(addressProblem) || sendingHome}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : notify ? "Record and send" : "Record"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
