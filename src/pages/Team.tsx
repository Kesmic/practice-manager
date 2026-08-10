import { useCallback, useEffect, useState } from "react";
import type { User } from "@shared/types";
import { ROLES, ROLE_LABELS } from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  Avatar,
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  SuccessBanner,
  TextInput,
  options,
} from "../components/ui";
import { formatDate, relativeTime } from "../lib/format";

export function Team() {
  const { user: me } = useSession();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  /**
   * Shown once after an account is created. `invited` says whether the portal managed
   * to email the person, which changes the instruction entirely: either "they have it"
   * or "you must pass this on yourself".
   */
  const [credential, setCredential] = useState<{
    email: string;
    password: string;
    invited: boolean;
    invitationError: string | null;
  } | null>(null);

  const closeCredential = () => {
    const invited = credential?.invited;
    setCredential(null);
    setNotice(
      invited
        ? "Invitation sent. The temporary password was also shown to you in case it does not arrive."
        : "Pass the temporary password on through a secure channel.",
    );
  };

  const load = useCallback(async () => {
    try {
      const { users: result } = await api.users(true);
      setUsers(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load the team.");
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (id: string, changes: Record<string, unknown>) => {
    setError(null);
    try {
      await api.updateUser(id, changes);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not update that account.",
      );
    }
  };

  const reset = async (target: User) => {
    setError(null);
    try {
      const { temporary_password } = await api.resetPassword(target.id);
      // A reset never emails: somebody who has lost their password has often lost
      // access to the mailbox too, and sending a new one there would be no help.
      setCredential({
        email: target.email,
        password: temporary_password,
        invited: false,
        invitationError: "A password reset is always handed over in person.",
      });
      await load();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not reset that password.",
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-title">Team</h1>
          <p className="muted mt-0.5">
            Grades determine who may assign work, review it and sign it off.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setInviting(true)}>
          Add team member
        </button>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      <div className="card">
        {users === null ? (
          <Spinner label="Loading team" />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Grade</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th>Added</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={user.full_name} />
                        <span>
                          <span className="font-medium text-slate-800">
                            {user.full_name}
                          </span>
                          {user.id === me?.id && (
                            <span className="ml-2 text-xs text-slate-400">you</span>
                          )}
                          {user.title && (
                            <p className="text-xs text-slate-500">{user.title}</p>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-xs">{user.email}</td>
                    <td className="whitespace-nowrap">
                      <Select
                        value={user.role}
                        aria-label={`Grade for ${user.full_name}`}
                        className="!py-1 !text-xs"
                        onChange={(event) => void update(user.id, { role: event.target.value })}
                      >
                        {options(ROLES, ROLE_LABELS)}
                      </Select>
                    </td>
                    <td className="whitespace-nowrap">
                      <span
                        className={`pill ${
                          user.status === "active"
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                            : "bg-slate-100 text-slate-500 ring-slate-200"
                        }`}
                      >
                        {user.status === "active" ? "Active" : "Suspended"}
                      </span>
                      {user.must_change_password === 1 && (
                        <span className="ml-1 pill bg-amber-50 text-amber-800 ring-amber-200">
                          Temp password
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {user.last_login_at ? relativeTime(user.last_login_at) : "Never"}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => void reset(user)}
                      >
                        Reset password
                      </button>
                      {user.id !== me?.id && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() =>
                            void update(user.id, {
                              status: user.status === "active" ? "suspended" : "active",
                            })
                          }
                        >
                          {user.status === "active" ? "Suspend" : "Reactivate"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <InviteModal
        open={inviting}
        onClose={() => setInviting(false)}
        onCreated={(email, password, invited, invitationError) => {
          setCredential({ email, password, invited, invitationError });
          setInviting(false);
          void load();
        }}
      />

      {/* Temporary credentials are shown once and never stored in plain text. */}
      <Modal
        open={!!credential}
        title={credential?.invited ? "Account created and invitation sent" : "Temporary password"}
        onClose={closeCredential}
        footer={
          <button type="button" className="btn-primary" onClick={closeCredential}>
            Done
          </button>
        }
      >
        {credential && (
          <div className="space-y-3">
            {credential.invited ? (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
                An invitation has been emailed to <strong>{credential.email}</strong> with
                the temporary password and a link to sign in.
              </p>
            ) : (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                <strong>No email was sent</strong>, so you have to pass these details on
                yourself.
                {credential.invitationError ? ` ${credential.invitationError}` : ""}
              </p>
            )}
            <p className="text-sm text-slate-700">
              The temporary password for <strong>{credential.email}</strong>. They are asked
              to choose their own the first time they sign in.
            </p>
            <p className="select-all rounded-md bg-slate-900 px-3 py-2 font-mono text-sm text-emerald-300">
              {credential.password}
            </p>
            <p className="text-xs text-slate-500">
              Shown once only, whether or not the invitation was sent. Email can be delayed
              or filtered, so keep this to hand until they have signed in.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function InviteModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (
    email: string,
    password: string,
    invited: boolean,
    invitationError: string | null,
  ) => void;
}) {
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "associate",
    title: "",
    send_invitation: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        full_name: "",
        email: "",
        role: "associate",
        title: "",
        send_invitation: true,
      });
      setError(null);
    }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.createUser({
        full_name: form.full_name,
        email: form.email,
        role: form.role,
        title: form.title || null,
        send_invitation: form.send_invitation,
      });
      onCreated(
        result.user.email,
        result.temporary_password ?? "",
        result.invitation_sent,
        result.invitation_error,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not create that account.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add team member"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="invite" className="btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </>
      }
    >
      <form id="invite" onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <Field label="Full name" required>
          {(id) => (
            <TextInput
              id={id}
              required
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
            />
          )}
        </Field>
        <Field label="Email address" required>
          {(id) => (
            <TextInput
              id={id}
              type="email"
              required
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Grade"
          required
          hint="Senior Associate and above may review work. Manager and above may assign and close it."
        >
          {(id) => (
            <Select
              id={id}
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}
            >
              {options(ROLES, ROLE_LABELS)}
            </Select>
          )}
        </Field>
        <Field label="Job title" hint="Shown on their profile - optional.">
          {(id) => (
            <TextInput
              id={id}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Tax Associate"
            />
          )}
        </Field>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-slate-200 p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={form.send_invitation}
            onChange={(event) =>
              setForm({ ...form, send_invitation: event.target.checked })
            }
          />
          <span className="text-sm">
            <span className="font-medium text-slate-800">Email them an invitation</span>
            <span className="hint mt-0.5 block">
              Sent from the firm's own address, with the temporary password and a link to
              sign in. You are shown the password either way, because email can be delayed
              or filtered. Untick this if you would rather hand it over in person.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
