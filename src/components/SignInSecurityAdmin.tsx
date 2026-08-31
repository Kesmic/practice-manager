/**
 * Who at the firm must use two-step sign-in, and who has.
 *
 * The list matters as much as the setting. Turning the policy on tells you nothing about
 * whether it took effect: what tells you that is a column of names with "not set up"
 * against some of them, and those people being confined to their account screen until
 * they do.
 */

import { useCallback, useEffect, useState } from "react";
import { ROLE_LABELS, ROLES, type Role } from "@shared/workflow";
import {
  RECOMMENDED_TWOFACTOR_MIN_ROLE,
  TWOFACTOR_OFF,
} from "@shared/twofactor";
import {
  IDLE_MINUTE_CHOICES,
  IDLE_OFF,
  IDLE_WARNING_SECONDS,
} from "@shared/session-policy";
import {
  TRUSTED_DEVICES_OFF,
  TRUSTED_DEVICE_DAY_CHOICES,
} from "@shared/second-factor-options";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { formatDateTime } from "../lib/format";
import { ErrorBanner, Modal, Select, Spinner } from "./ui";

type Overview = Awaited<ReturnType<typeof api.twoFactorOverview>>;

export function SignInSecurityAdmin({
  setError,
  setNotice,
}: {
  setError: (m: string | null) => void;
  setNotice: (m: string | null) => void;
}) {
  const { user, refresh } = useSession();
  const [data, setData] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<Overview["people"][number] | null>(null);
  /** The inactivity setting being edited: "off", or a number of minutes as a string. */
  const [idleDraft, setIdleDraft] = useState<string>("");
  /** The remembered-device setting: "off", or a number of days as a string. */
  const [deviceDraft, setDeviceDraft] = useState<string>("");

  const load = useCallback(() => {
    void api
      .twoFactorOverview()
      .then((res) => {
        setData(res);
        setDraft(res.policy);
        setIdleDraft(res.idle.enabled ? String(res.idle.minutes) : IDLE_OFF);
        setDeviceDraft(
          res.devices.enabled ? String(res.devices.days) : TRUSTED_DEVICES_OFF,
        );
      })
      .catch((err) =>
        setLocalError(
          err instanceof ApiRequestError ? err.message : "Could not load this.",
        ),
      );
  }, []);

  useEffect(load, [load]);

  if (!data) return <Spinner label="Loading sign-in security" />;

  const save = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      const res = await api.setTwoFactorPolicy(draft);
      setNotice(
        res.policy === TWOFACTOR_OFF
          ? "Two-step sign-in is now optional for everyone. Anyone who has set it up keeps it."
          : `Two-step sign-in is now required at ${ROLE_LABELS[res.policy as Role]} grade and above.` +
            (res.applies_to_self && !data.people.find((p) => p.id === user?.id)?.enabled
              ? " That includes you, so set yours up under My account before doing anything else."
              : ""),
      );
      setError(null);
      load();
    } catch (err) {
      setLocalError(
        err instanceof ApiRequestError ? err.message : "Could not save the policy.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveIdle = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      const res = await api.setSessionPolicy(
        idleDraft === IDLE_OFF
          ? { enabled: false }
          : { enabled: true, idle_minutes: Number.parseInt(idleDraft, 10) },
      );
      setNotice(
        res.idle.enabled
          ? `Sessions will now end after ${res.idle.minutes} minutes of inactivity. Everyone gets a warning ${IDLE_WARNING_SECONDS} seconds before, with a chance to stay signed in.`
          : "Sessions will no longer end through inactivity. They still expire on their own after a week, and signing out still works.",
      );
      setError(null);
      // Picked up by everyone else's browser on their next request, and by this one now.
      await refresh();
      load();
    } catch (err) {
      setLocalError(
        err instanceof ApiRequestError ? err.message : "Could not save that.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveDevices = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      const off = deviceDraft === TRUSTED_DEVICES_OFF;
      const res = await api.setDevicePolicy(
        off ? { enabled: false } : { enabled: true, days: Number(deviceDraft) },
      );
      setNotice(
        res.devices.enabled
          ? `A device can now skip the code for ${res.devices.days} days once somebody asks it to.`
          : "Every sign-in will ask for a code again, including on devices that were already remembered.",
      );
      setError(null);
      load();
    } catch (err) {
      setLocalError(
        err instanceof ApiRequestError ? err.message : "Could not save that.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveQuestions = async (enabled: boolean) => {
    setBusy(true);
    setLocalError(null);
    try {
      const res = await api.setQuestionPolicy(enabled);
      setNotice(
        res.questions.enabled
          ? "Secret questions are now allowed. Each person sets their own two, on their account screen."
          : res.people_with_questions > 0
            ? `Secret questions are off. ${res.people_with_questions} ${res.people_with_questions === 1 ? "person has" : "people have"} questions stored, which are now unusable but not deleted.`
            : "Secret questions are off. A code or a recovery code is the only way past the second step.",
      );
      setError(null);
      load();
    } catch (err) {
      setLocalError(
        err instanceof ApiRequestError ? err.message : "Could not save that.",
      );
    } finally {
      setBusy(false);
    }
  };

  const doReset = async (person: Overview["people"][number]) => {
    setBusy(true);
    setLocalError(null);
    try {
      const res = await api.resetTwoFactorFor(person.id);
      setNotice(res.message);
      setError(null);
      setResetting(null);
      load();
    } catch (err) {
      setLocalError(
        err instanceof ApiRequestError ? err.message : "Could not reset it.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <ErrorBanner error={localError} onDismiss={() => setLocalError(null)} />

      <section className="card p-4">
        <h2 className="card-title">Sign out after inactivity</h2>
        <p className="muted mb-3 mt-0.5">
          Ends a session that has been left untouched, so a screen open on an unattended
          desk cannot be used by whoever sits down next. Everyone gets a warning{" "}
          {IDLE_WARNING_SECONDS} seconds before, with a button to stay signed in, so
          nobody loses work they were part-way through.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              End the session after
            </span>
            <Select
              value={idleDraft}
              onChange={(e) => setIdleDraft(e.target.value)}
              className="input w-64"
            >
              <option value={IDLE_OFF}>Never, unless they sign out</option>
              {IDLE_MINUTE_CHOICES.map((minutes) => (
                <option key={minutes} value={String(minutes)}>
                  {minutes} minutes of inactivity
                </option>
              ))}
            </Select>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={
              busy ||
              idleDraft ===
                (data.idle.enabled ? String(data.idle.minutes) : IDLE_OFF)
            }
            onClick={() => void saveIdle()}
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>

        <p className="muted mt-3">
          {data.idle.enabled
            ? `Currently ${data.idle.minutes} minutes. Enforced by the server as well as the browser, so a tab closed without signing out is finished too.`
            : "Currently off. A session then lasts until the person signs out, or a week passes."}
        </p>
      </section>

      <section className="card p-4">
        <h2 className="card-title">Who must use two-step sign-in</h2>
        <p className="muted mb-3 mt-0.5">
          A six-digit code from an authenticator app, as well as a password. Everyone at
          the grade you choose and above is required to set it up; anyone below may still
          choose to.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Required from
            </span>
            <Select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="input w-64"
            >
              <option value={TWOFACTOR_OFF}>Nobody is required to</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]} and above
                </option>
              ))}
            </Select>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || draft === data.policy}
            onClick={() => void save()}
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>

        {data.policy === TWOFACTOR_OFF && (
          /*
            Off is the state a deployment starts in, on purpose: a policy that switched
            itself on during a migration would have confined every partner at the firm
            with no warning. So the recommendation is made here, in words, rather than
            being imposed.
          */
          <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
            Nobody is required to use two-step sign-in at the moment. The recommendation
            is <strong>{ROLE_LABELS[RECOMMENDED_TWOFACTOR_MIN_ROLE]} and above</strong>:
            those grades can reach every client file and every pay record, so a password
            on its own is the whole of what protects them.
          </p>
        )}

        {data.outstanding > 0 && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
            {data.outstanding} {data.outstanding === 1 ? "person is" : "people are"}{" "}
            required to use it and have not set it up. They can sign in, and can reach
            their own account screen and nothing else until they do.
          </p>
        )}

        <p className="muted mt-3">
          Nobody is locked out by this. Someone who has not enrolled is confined to
          setting it up, which is why turning it on does not stop the firm working.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="card-title">Letting a device skip the code</h2>
        <p className="muted mb-3 mt-0.5">
          After somebody signs in with a code, they can ask that machine not to want one
          again for a while. The factor was still presented: what is kept is a note that
          it was, bound to that one account, and it expires.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Remember a device for
            </span>
            <Select
              value={deviceDraft}
              onChange={(e) => setDeviceDraft(e.target.value)}
              className="input w-64"
            >
              <option value={TRUSTED_DEVICES_OFF}>Never, always ask for a code</option>
              {TRUSTED_DEVICE_DAY_CHOICES.map((days) => (
                <option key={days} value={String(days)}>
                  {days} days
                </option>
              ))}
            </Select>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={
              busy ||
              deviceDraft ===
                (data.devices.enabled ? String(data.devices.days) : TRUSTED_DEVICES_OFF)
            }
            onClick={() => void saveDevices()}
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>

        <p className="muted mt-3">
          {data.devices.enabled
            ? `Currently ${data.devices.days} days. Everyone can see and drop their own remembered devices on their account screen, which is what somebody does when a laptop goes missing.`
            : "Currently off. Every sign-in asks for a code."}
        </p>
        <p className="muted mt-1 text-xs">
          Switching this off also forgets every device already remembered, so it takes
          effect at once rather than only for future sign-ins.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="card-title">Secret questions instead of a code</h2>
        <p className="muted mb-3 mt-0.5">
          Two questions somebody sets for themselves and answers when their phone is not
          to hand. Both answers must be right, and the same limit of five attempts
          applies.
        </p>

        {/*
          The warning is the point of this card. A firm turning this on should know what
          they are trading, and know it before they click rather than afterwards.
        */}
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <strong>This is weaker than a code, and the difference is not small.</strong> A
          code needs the phone in somebody's hand. An answer needs a fact, and facts about
          the people at a firm named on its own website are often reachable by a stranger,
          and nearly always by a colleague. A stolen phone is replaced in an afternoon; a
          leaked fact is leaked for good. Anyone who sets questions is told to pick
          answers that are memorable rather than true.
        </p>

        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={data.questions.enabled}
            disabled={busy}
            onChange={(e) => void saveQuestions(e.target.checked)}
          />
          <span>
            Let people answer secret questions instead of a code
            <span className="muted mt-0.5 block">
              {data.questions.enabled
                ? "On. Anyone with a second factor can set two questions on their account screen."
                : "Off. A code or a recovery code is the only way past the second step."}
            </span>
          </span>
        </label>

        <p className="muted mt-3 text-xs">
          Turning this off leaves anybody's questions stored but unusable, so switching it
          off to think about it does not destroy everyone's setup. Each person can delete
          their own.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="card-title">Where everyone stands</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-3">Name</th>
                <th className="py-1 pr-3">Grade</th>
                <th className="py-1 pr-3">Two-step</th>
                <th className="py-1 pr-3">Set up</th>
                <th className="py-1 pr-3 text-right">Recovery codes</th>
                <th className="py-1 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.people.map((person) => (
                <tr key={person.id}>
                  <td className="py-2 pr-3">
                    {person.full_name}
                    {person.id === user?.id && (
                      <span className="muted"> (you)</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {ROLE_LABELS[person.role]}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {person.enabled ? (
                      <span className="text-emerald-700">On</span>
                    ) : person.required ? (
                      <span className="font-medium text-rose-700">Required, not set up</span>
                    ) : (
                      <span className="text-slate-400">Off</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {person.confirmed_at ? formatDateTime(person.confirmed_at) : "-"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {person.enabled ? `${person.recovery_remaining} of 10` : "-"}
                  </td>
                  <td className="py-2 text-right">
                    {person.enabled && person.id !== user?.id && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => setResetting(person)}
                      >
                        Reset
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted mt-3">
          You cannot reset your own. That is deliberate: a Partner who could would have a
          way past their own second factor needing nothing but their password. Use a
          recovery code, or ask another Partner.
        </p>
      </section>

      <Modal
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
        title={resetting ? `Reset two-step sign-in for ${resetting.full_name}` : ""}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setResetting(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={() => resetting && void doReset(resetting)}
            >
              {busy ? "Resetting..." : "Reset it"}
            </button>
          </>
        }
      >
        {resetting && (
          <div className="space-y-3 text-sm">
            <p>
              This removes {resetting.full_name}'s authenticator app enrolment and all of
              their unused recovery codes.
            </p>
            <p>
              They will then sign in with their password alone
              {resetting.required
                ? ", and will be asked to set two-step sign-in up again before they can do anything else."
                : ", and may set it up again whenever they choose."}
            </p>
            <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-inset ring-amber-200">
              Only do this once you are satisfied the person asking is really them. A
              phone call you initiated to a number you already had is the usual test; a
              request by email is not, because email is what an attacker would have.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
