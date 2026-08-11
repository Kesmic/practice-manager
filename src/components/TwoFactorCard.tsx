/**
 * Setting up, and living with, a second factor.
 *
 * The enrolment is three steps and the screen shows one at a time, because the failure
 * this is guarding against is somebody scanning the square, closing the dialog, and
 * having neither a working app entry nor the recovery codes. So: scan, prove it works,
 * then save the codes, and the codes are shown only after the code has verified.
 */

import { useCallback, useEffect, useState } from "react";
import { ROLE_LABELS } from "@shared/workflow";
import {
  ENROLMENT_STEPS,
  KNOWN_APPS,
  TWOFACTOR_OFF,
  type TwoFactorStatus,
} from "@shared/twofactor";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { formatDateTime } from "../lib/format";
import { ErrorBanner, Field, Spinner, TextInput } from "./ui";

type Stage =
  | { kind: "idle" }
  | {
      kind: "enrolling";
      secret: string;
      secretGrouped: string;
      qrSvg: string | null;
      uri: string;
    }
  | { kind: "codes"; codes: string[]; reason: "enrolled" | "reissued" };

export function TwoFactorCard({
  setNotice,
}: {
  setNotice: (message: string | null) => void;
}) {
  const { user, refresh } = useSession();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const load = useCallback(() => {
    void api
      .twoFactor()
      .then((res) => setStatus(res.two_factor))
      .catch(() => setStatus(null));
  }, []);

  useEffect(load, [load]);

  if (!user) return null;
  if (!status) return <Spinner label="Loading sign-in security" />;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? [err.message, err.detail].filter(Boolean).join(" ")
          : "That did not work.",
      );
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    act(async () => {
      const res = await api.startTwoFactor();
      setStage({
        kind: "enrolling",
        secret: res.secret,
        secretGrouped: res.secret_grouped,
        qrSvg: res.qr_svg,
        uri: res.uri,
      });
      setCode("");
      setShowSecret(false);
    });

  const confirm = () =>
    act(async () => {
      const res = await api.confirmTwoFactor(code);
      setStatus(res.two_factor);
      setStage({ kind: "codes", codes: res.recovery_codes, reason: "enrolled" });
      setCode("");
      // The confinement for a required grade lifts the moment this succeeds, so the
      // sidebar and every screen need to hear about it.
      await refresh();
    });

  const reissue = () =>
    act(async () => {
      const res = await api.newRecoveryCodes(code);
      setStage({ kind: "codes", codes: res.recovery_codes, reason: "reissued" });
      setCode("");
      load();
    });

  const disable = () =>
    act(async () => {
      const res = await api.disableTwoFactor(code);
      setStatus(res.two_factor);
      setStage({ kind: "idle" });
      setCode("");
      setNotice("Two-step sign-in is off. Your password alone will sign you in.");
    });

  // ------------------------------------------------------------------ the codes
  if (stage.kind === "codes") {
    return (
      <section className="card space-y-4 p-5 ring-1 ring-amber-300">
        <div>
          <h2 className="card-title">
            {stage.reason === "enrolled"
              ? "Two-step sign-in is on. Save these."
              : "Your new recovery codes"}
          </h2>
          <p className="muted mt-1">
            Ten codes, each of which works once, for the day you do not have your phone.
            This is the only time they are shown: they are stored as one-way hashes, so
            nobody can produce them again, including whoever runs the firm.
          </p>
        </div>

        <ul className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-4 font-mono text-sm">
          {stage.codes.map((one) => (
            <li key={one} className="tabular-nums tracking-wide">
              {one}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(stage.codes.join("\n"));
              setNotice("Recovery codes copied.");
            }}
          >
            Copy all
          </button>
          <button type="button" className="btn-secondary" onClick={() => window.print()}>
            Print
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setStage({ kind: "idle" });
              load();
            }}
          >
            I have saved them
          </button>
        </div>
        <p className="muted">
          Somewhere that is not the phone holding the app: a password manager, or paper in
          a locked drawer. Both on the same phone is one lost phone away from no way in.
        </p>
      </section>
    );
  }

  // --------------------------------------------------------------- enrolling
  if (stage.kind === "enrolling") {
    return (
      <section className="card space-y-4 p-5">
        <div>
          <h2 className="card-title">Set up two-step sign-in</h2>
          <ol className="muted mt-2 list-decimal space-y-1 pl-5">
            {ENROLMENT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {stage.qrSvg ? (
            /*
              The SVG comes from our own Worker and is built from a module grid, not from
              anything a user typed, so there is no untrusted markup in it. It is set as
              HTML rather than an <img> so it stays crisp and needs no data URI.
            */
            <div
              className="shrink-0 rounded-md bg-white p-2 ring-1 ring-slate-200"
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: stage.qrSvg }}
            />
          ) : (
            <p className="muted">
              The square could not be drawn for this address. Type the key in instead.
            </p>
          )}

          <div className="min-w-0 flex-1 space-y-3">
            <p className="muted">
              Any of these will do: {KNOWN_APPS.join(", ")}.
            </p>
            <div>
              <p className="text-sm font-medium text-slate-800">
                Or type this key in by hand
              </p>
              {showSecret ? (
                <p className="mt-1 break-all rounded-md bg-slate-50 p-2 font-mono text-sm tracking-wide">
                  {stage.secretGrouped}
                </p>
              ) : (
                <button
                  type="button"
                  className="btn-ghost btn-sm mt-1"
                  onClick={() => setShowSecret(true)}
                >
                  Show the key
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <Field
            label="The six-digit code your app now shows"
            required
            hint="This is what proves the app and the portal agree, before you rely on it."
          >
            {(id) => (
              <TextInput
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="input max-w-40 text-center text-lg tracking-[0.3em]"
              />
            )}
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || code.replace(/\D/g, "").length !== 6}
              onClick={() => void confirm()}
            >
              {busy ? "Checking..." : "Turn on two-step sign-in"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setStage({ kind: "idle" });
                setError(null);
                load();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </section>
    );
  }

  // -------------------------------------------------------------------- idle
  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="card-title">Two-step sign-in</h2>
          <p className="muted mt-1">
            A six-digit code from your phone, as well as your password. It is what stops a
            stolen password from being enough.
          </p>
        </div>
        <span
          className={`pill ${
            status.enabled
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : status.required
                ? "bg-rose-50 text-rose-700 ring-rose-200"
                : "bg-slate-100 text-slate-600 ring-slate-200"
          }`}
        >
          {status.enabled ? "On" : status.required ? "Required, not set up" : "Off"}
        </span>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {status.required && !status.enabled && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          Two-step sign-in is required at {ROLE_LABELS[user.role]} grade in this firm.
          Until you set it up you can reach this screen and nothing else.
        </p>
      )}

      {!status.secrets_encrypted && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-inset ring-slate-200">
          On this deployment the secret is stored as it is, because PASSWORD_PEPPER is not
          set. Two-step sign-in still works; setting that secret in Cloudflare would also
          encrypt these at rest.
        </p>
      )}

      {status.enabled ? (
        <>
          <dl className="divide-y divide-slate-100 text-sm">
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-slate-500">Set up</dt>
              <dd>{status.confirmed_at ? formatDateTime(status.confirmed_at) : "-"}</dd>
            </div>
            <div className="flex justify-between gap-3 py-2">
              <dt className="text-slate-500">Recovery codes left</dt>
              <dd
                className={
                  status.recovery_remaining <= 2 ? "font-semibold text-amber-700" : ""
                }
              >
                {status.recovery_remaining} of 10
              </dd>
            </div>
          </dl>

          {status.recovery_remaining <= 2 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
              You are nearly out of recovery codes. Issue a fresh set while you still have
              your phone.
            </p>
          )}

          <div className="border-t border-slate-200 pt-4">
            <Field
              label="A current code from your app"
              hint="Needed for anything below, so that somebody who finds your screen unlocked cannot change it."
            >
              {(id) => (
                <TextInput
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="input max-w-40 text-center text-lg tracking-[0.3em]"
                />
              )}
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || code.replace(/\D/g, "").length !== 6}
                onClick={() => void reissue()}
              >
                New recovery codes
              </button>
              {!status.required && (
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy || code.replace(/\D/g, "").length !== 6}
                  onClick={() => void disable()}
                >
                  Turn off
                </button>
              )}
            </div>
            {status.required && (
              <p className="muted mt-2">
                It cannot be turned off at your grade. If you are changing phones, a
                Partner resets it for you and you set it up again.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            {status.pending
              ? "You started setting this up and did not finish, so it is not in force. Starting again issues a new key."
              : status.policy === TWOFACTOR_OFF
                ? "Nobody at the firm is obliged to use this, but it is the single best thing you can do for the security of your own account."
                : `Required at ${ROLE_LABELS[status.policy as keyof typeof ROLE_LABELS] ?? status.policy} grade and above in this firm.`}
          </p>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void start()}
          >
            {status.pending ? "Start again" : "Set up two-step sign-in"}
          </button>
        </>
      )}
    </section>
  );
}
