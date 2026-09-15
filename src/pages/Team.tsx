import { useCallback, useEffect, useState } from "react";
import type { User } from "@shared/types";
import { ROLES, ROLE_LABELS } from "@shared/workflow";
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  type EmploymentType,
} from "@shared/hr";
import { isEngagedNotEmployed } from "@shared/onboarding";
import { ContractDetailsCard } from "../components/ContractDetailsCard";
import { RemovePersonDialog } from "../components/RemovePersonDialog";
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

/** An account that has just been created, and what still has to happen to it. */
interface CreatedAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  invited: boolean;
  invitationError: string | null;
  /** False where the employment record could not be written; see InviteModal. */
  recordSaved: boolean;
  /**
   * True for a new account, false for a password reset. The two share this dialog, and
   * only one of them has contract details still to fill in.
   */
  justCreated: boolean;
}

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
  const [credential, setCredential] = useState<CreatedAccount | null>(null);
  /**
   * The person whose contract details are being filled in, straight after their account
   * was created. Kept apart from `credential` so that dismissing the one-time password
   * does not dismiss the form as well - the password must not stay on screen while
   * somebody works through twenty fields.
   */
  const [detailing, setDetailing] = useState<CreatedAccount | null>(null);
  /** The person whose name, address or title is being edited. */
  const [editing, setEditing] = useState<User | null>(null);
  /** The account being removed, by id - the row is re-read fresh by the dialog. */
  const [removing, setRemoving] = useState<string | null>(null);

  const closeCredential = () => {
    const invited = credential?.invited;
    setCredential(null);
    setNotice(
      invited
        ? "Invitation sent. The temporary password was also shown to you in case it does not arrive."
        : "Pass the temporary password on through a secure channel.",
    );
  };

  /**
   * Straight from the one-time password to the contract details, in one flow.
   *
   * Filling these in is not a separate administrative errand: the values are what
   * completes the person's contract, and the moment somebody has them all to hand is
   * the moment they are setting the person up. Offered as a second step rather than a
   * longer create form, so the temporary password is not left on screen while
   * somebody works through twenty fields.
   */
  const openDetails = () => {
    if (credential) setDetailing(credential);
    setCredential(null);
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
        id: target.id,
        name: target.full_name,
        email: target.email,
        password: temporary_password,
        invited: false,
        invitationError: "A password reset is always handed over in person.",
        // Nothing was created, so there is no next step to offer.
        recordSaved: true,
        justCreated: false,
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
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => setEditing(user)}
                      >
                        Edit
                      </button>
                      {user.id !== me?.id && (
                        <>
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
                          <button
                            type="button"
                            className="btn-ghost btn-sm text-rose-700"
                            onClick={() => setRemoving(user.id)}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EditPersonModal
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null);
          await load();
          setNotice(message);
        }}
      />

      <RemovePersonDialog
        userId={removing}
        onClose={() => setRemoving(null)}
        onRemoved={async (message) => {
          setRemoving(null);
          await load();
          setNotice(message);
        }}
      />

      <InviteModal
        open={inviting}
        onClose={() => setInviting(false)}
        onCreated={(created) => {
          setCredential(created);
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
          <>
            <button type="button" className="btn-secondary" onClick={closeCredential}>
              Done
            </button>
            {credential?.justCreated ? (
              <button type="button" className="btn-primary" onClick={openDetails}>
                Next: contract details
              </button>
            ) : null}
          </>
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
            {credential.justCreated && !credential.recordSaved ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>The employment record did not save.</strong> The account is fine,
                but set their employment type and start date on their record before
                starting onboarding - the programme and the contract both depend on them.
              </p>
            ) : null}
            {credential.justCreated ? (
              <p className="text-sm text-slate-600">
                Next, the details that complete their contract. Anything you do not have
                is asked of them when they first sign in, so you can leave it blank.
              </p>
            ) : null}
          </div>
        )}
      </Modal>

      {/*
        The contract details for somebody just created. Given its own dialog rather than
        a redirect to their personnel file so the administrator finishes what they
        started here, and can still see the list of people behind it.
      */}
      <Modal
        open={!!detailing}
        title={detailing ? `Contract details for ${detailing.name}` : "Contract details"}
        onClose={() => setDetailing(null)}
        footer={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setDetailing(null)}
          >
            Done
          </button>
        }
      >
        {detailing ? (
          <ContractDetailsCard
            userId={detailing.id}
            personName={detailing.name}
            onSaved={(message) => setNotice(message)}
          />
        ) : null}
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
  onCreated: (created: CreatedAccount) => void;
}) {
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "associate",
    title: "",
    employment_type: "permanent",
    start_date: "",
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
        employment_type: "permanent",
        start_date: "",
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
      /*
       * The employment record is written straight after the account rather than left
       * for somebody to fill in later, because these two fields decide everything that
       * follows: which onboarding programme the person gets, which of the two contract
       * templates they are issued, and what date every stage of their programme falls
       * due. Left blank, the programme has no dates and the contract is the wrong one.
       *
       * A failure here does not fail the whole thing. The account exists and the
       * temporary password has to reach the administrator either way - losing it
       * because a start date would not save would be a much worse outcome than an
       * employment record they can complete on the next screen.
       */
      let recordSaved = true;
      try {
        await api.updateEmployee(result.user.id, {
          employment_type: form.employment_type,
          start_date: form.start_date || null,
          job_title: form.title || null,
        });
      } catch {
        recordSaved = false;
      }

      onCreated({
        id: result.user.id,
        name: result.user.full_name,
        email: result.user.email,
        password: result.temporary_password ?? "",
        invited: result.invitation_sent,
        invitationError: result.invitation_error,
        recordSaved,
        justCreated: true,
      });
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

        {/*
          These two are not optional in the way a job title is. The employment type
          decides which onboarding programme the person is given and which of the two
          contract templates they are issued; the start date is what every stage of that
          programme is counted from. Left blank, the programme has no dates at all.
        */}
        <Field
          label="Employment type"
          required
          hint="Decides their onboarding programme and which contract they are issued."
        >
          {(id) => (
            <Select
              id={id}
              value={form.employment_type}
              onChange={(event) =>
                setForm({ ...form, employment_type: event.target.value })
              }
            >
              {options(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS)}
            </Select>
          )}
        </Field>
        <p className="-mt-2 text-xs text-slate-500">
          {isEngagedNotEmployed(form.employment_type as EmploymentType)
            ? "An Associate Consultant is engaged under a contract for services: they are issued the Associate Consultant Agreement, invoice for their fee, and are not registered for payroll."
            : "An employee is issued a contract of employment and registered for PAYE and SSNIT."}
        </p>
        <Field
          label="Start date"
          required
          hint="Every stage of their onboarding is dated from this."
        >
          {(id) => (
            <TextInput
              id={id}
              type="date"
              value={form.start_date}
              onChange={(event) => setForm({ ...form, start_date: event.target.value })}
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

/**
 * Editing somebody's name, sign-in address or title.
 *
 * The address is the part that needed care. It is the sign-in identifier, so changing it
 * is not the same kind of edit as changing a job title: it has to stay unique, the
 * person has to be able to get back in, and a change nobody sees at the old address is
 * also how an account is quietly taken over. The server emails both addresses; the
 * dialog says so before the change is made rather than after, because somebody about to
 * type a colleague's new address should know the old one will hear about it.
 *
 * Grade and status are not here. They are edited in the table, one click, where they can
 * be seen next to everybody else's.
 */
function EditPersonModal({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState({ full_name: "", email: "", title: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({
        full_name: user.full_name,
        email: user.email,
        title: user.title ?? "",
      });
      setError(null);
    }
  }, [user]);

  if (!user) return null;

  const emailChanging = form.email.trim().toLowerCase() !== user.email.toLowerCase();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.updateUser(user.id, {
        full_name: form.full_name,
        email: form.email,
        title: form.title || null,
      });
      await onSaved(
        result.email_changed
          ? `Saved. ${form.full_name} now signs in as ${result.email_changed.to}, and both addresses have been told.`
          : `Saved ${form.full_name}'s details.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save those details.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Edit ${user.full_name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-person" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="edit-person" className="space-y-4" onSubmit={submit}>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <Field label="Full name" required hint="Their contract is signed against this name.">
          {(id) => (
            <TextInput
              id={id}
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
            />
          )}
        </Field>

        <Field label="Email address" required hint="This is what they sign in with.">
          {(id) => (
            <TextInput
              id={id}
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          )}
        </Field>

        {emailChanging ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            They will sign in with the new address from now on. Both the old and the new
            address are told, so a change they did not expect reaches them somewhere they
            can still read.
          </p>
        ) : null}

        <Field label="Job title" hint="Shown on their profile - optional.">
          {(id) => (
            <TextInput
              id={id}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
