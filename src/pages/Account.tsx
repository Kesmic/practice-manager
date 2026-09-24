import { useCallback, useEffect, useState } from "react";
import { ROLE_LABELS } from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { currentSubscription, disablePush, enablePush, pushSupported } from "../lib/push";
import { useSession } from "../lib/auth";
import { DetailRow, ErrorBanner, SuccessBanner } from "../components/ui";
import { formatDate } from "../lib/format";
import { TwoFactorCard } from "../components/TwoFactorCard";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { SecurityQuestionsCard } from "../components/SecurityQuestionsCard";
import { TrustedDevicesCard } from "../components/TrustedDevicesCard";
import { MySignatureCard } from "../components/SignatureCard";

export function Account() {
  const { user, refresh } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  /*
    Bumped whenever the second factor changes, which re-mounts the two cards below it.
    Enrolling or disabling the app clears saved questions and every remembered device,
    and a screen still listing them afterwards would tell somebody they have protection
    they no longer have.
  */
  const [factorsVersion, setFactorsVersion] = useState(0);
  const bumpFactors = () => setFactorsVersion((n) => n + 1);

  if (!user) return null;

  /*
   * Held as an element so it can sit in two places. During the password step it goes
   * straight under the banner, because that is the one thing the person has been sent
   * here to do; the rest of the time it keeps its usual place at the foot of the page.
   */
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/*
        Shown above the heading rather than below it. Somebody who has just filled in
        twenty onboarding fields and been moved here needs to know why they are on a
        different screen before they read anything else on it.
      */}
      <h1 className="section-title">Your account</h1>

      {/*
        At page level rather than inside one card. The cards below all report through
        these - two-step, security questions, remembered devices, email - and each
        carrying its own banner put the message in whichever part of the page somebody
        had just scrolled away from.
      */}
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={done} onDismiss={() => setDone(null)} />

      {/* The banner above already says this while they are being walked through it. */}
      {user.must_change_password === 1 && (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          You are signed in with a temporary password. Set a new one before continuing.
        </div>
      )}

      <div className="card p-5">
        <dl className="divide-y divide-slate-100">
          <DetailRow label="Name">{user.full_name}</DetailRow>
          <DetailRow label="Email">{user.email}</DetailRow>
          <DetailRow label="Grade">{ROLE_LABELS[user.role]}</DetailRow>
          {user.title && <DetailRow label="Title">{user.title}</DetailRow>}
          <DetailRow label="Account created">{formatDate(user.created_at)}</DetailRow>
        </dl>
      </div>

      {/*
        Above the security cards rather than below them: this is the one thing here that
        somebody is likely to be sent to the page for, having found out mid-contract
        that they need it.
      */}
      <MySignatureCard />

      <TwoFactorCard setNotice={setDone} onChanged={bumpFactors} />

      {/*
        Keyed on a counter bumped whenever the second factor changes, so enrolling or
        disabling the app re-reads both of these. Enrolment clears saved questions and
        every remembered device, and a screen still showing them afterwards would be
        telling somebody they have protection they no longer have.
      */}
      <SecurityQuestionsCard
        key={`questions-${factorsVersion}`}
        onChanged={bumpFactors}
        setNotice={setDone}
      />
      <TrustedDevicesCard key={`devices-${factorsVersion}`} setNotice={setDone} />

      <div className="card space-y-3 p-5">
        <h2 className="card-title">Notifications</h2>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={user?.email_notifications === 1}
            onChange={async (event) => {
              const enabled = event.target.checked;
              setError(null);
              try {
                await api.setEmailNotifications(enabled);
                await refresh();
                setDone(
                  enabled
                    ? "You will be emailed about the deliverables you are involved in."
                    : "Email turned off. The portal inbox still shows everything.",
                );
              } catch (err) {
                setError(
                  err instanceof ApiRequestError
                    ? err.message
                    : "Could not change that setting.",
                );
              }
            }}
          />
          <span>
            <strong>Email me about my work.</strong> When someone comments on a
            deliverable you are involved in, or its status changes, send me an email as
            well as an inbox message. You count as involved if you are doing it,
            reviewing it, created it, or have commented on it.
          </span>
        </label>
        <PushCard setNotice={setDone} setError={setError} />
        <p className="hint">
          Turning this off never affects the portal inbox, which always shows
          everything. If your firm has not set email up yet, nothing is sent either
          way.
        </p>
      </div>

      <ChangePasswordForm onChanged={refresh} />
    </div>
  );
}

/**
 * Push notifications on this device.
 *
 * Per device, because that is how browsers do it: a phone and a laptop are enrolled
 * separately. The card reads the browser's own state - enrolled here or not - rather
 * than a flag on the account, so it is never out of step with what the device will
 * actually do.
 */
function PushCard({
  setNotice,
  setError,
}: {
  setNotice: (message: string) => void;
  setError: (message: string | null) => void;
}) {
  const supported = pushSupported();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [devices, setDevices] = useState(0);
  const [busy, setBusy] = useState(false);
  const blocked = supported && Notification.permission === "denied";

  const refreshPush = useCallback(async () => {
    try {
      const [key, count, subscription] = await Promise.all([
        api.pushKey(),
        api.pushDevices(),
        currentSubscription(),
      ]);
      setConfigured(key.configured);
      setDevices(count.devices);
      setEnrolled(Boolean(subscription));
    } catch {
      setConfigured(false);
    }
  }, []);

  useEffect(() => {
    if (supported) void refreshPush();
  }, [supported, refreshPush]);

  const run = async (what: () => Promise<void>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await what();
      await refreshPush();
      setNotice(message);
    } catch (err) {
      setError(
        err instanceof ApiRequestError || err instanceof Error
          ? err.message
          : "Could not change that.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return (
      <p className="hint border-t border-slate-200 pt-3">
        This browser cannot show push notifications. On an iPhone, add the portal to
        the home screen first and open it from there.
      </p>
    );
  }

  return (
    <div className="border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 text-sm text-slate-700">
          <strong>Push notifications on this device.</strong>{" "}
          {configured === false
            ? "Not set up on this portal yet - an administrator needs to add the push keys."
            : blocked
              ? "Blocked in this browser. Allow notifications for the portal in the browser's site settings, then turn it on here."
              : enrolled
                ? "On. Anything that lands in your inbox is shown here, even with the portal closed."
                : "Off. Turn it on to be told here when something lands in your inbox."}
          {devices > 0 && (
            <span className="text-slate-500">
              {" "}
              {devices} device{devices === 1 ? "" : "s"} enrolled.
            </span>
          )}
        </div>
        {configured && !blocked && (
          <div className="flex gap-2">
            {enrolled ? (
              <>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const { sent } = await api.sendTestPush();
                      if (!sent) throw new Error("Nothing was sent. Try turning it off and on again.");
                    }, "A test notification is on its way.")
                  }
                >
                  Send a test
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => void run(disablePush, "Push turned off on this device.")}
                >
                  Turn off
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={busy}
                onClick={() => void run(enablePush, "Push turned on for this device.")}
              >
                Turn on
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
