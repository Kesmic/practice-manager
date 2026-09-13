/**
 * The devices this person has told the portal to remember.
 *
 * The list is the whole point of the feature being safe. "Remember this device" is a
 * standing permission to skip the second step, and a standing permission nobody can see
 * or withdraw is not a permission, it is a hole. So: every device, when it was last
 * used, when it runs out, and a way to forget any of them or all of them at once.
 */

import { useCallback, useEffect, useState } from "react";
import type { DeviceTrustPolicy, TrustedDevice } from "@shared/device-trust";
import { ApiRequestError, api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { ErrorBanner, Spinner } from "./ui";

export function TrustedDevicesCard({
  setNotice,
}: {
  setNotice: (message: string | null) => void;
}) {
  const [policy, setPolicy] = useState<DeviceTrustPolicy | null>(null);
  const [devices, setDevices] = useState<TrustedDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.trustedDevices();
      setPolicy(result.policy);
      setDevices(result.devices);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!devices || !policy) return <Spinner label="Loading remembered devices" />;

  /*
    Hidden only when the firm has switched it off AND nothing is remembered. A firm that
    turns it off mid-flight has every device dropped by that same endpoint, but if any
    row somehow survives, the person whose account it is must still be able to see it.
  */
  if (!policy.enabled && devices.length === 0) return null;

  const act = async (run: () => Promise<{ devices: TrustedDevice[] }>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      setDevices((await run()).devices);
      setNotice(message);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not update your devices.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <h2 className="text-base font-semibold text-slate-900">Remembered devices</h2>
      <p className="muted mt-1">
        {policy.enabled
          ? `Devices you have chosen to remember skip the second step for ${policy.days} days. Your password is still asked for every time.`
          : "The firm no longer remembers devices. Everything below has stopped being used."}
      </p>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {devices.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          No devices are remembered. You are asked for your second factor every time you
          sign in, which is the safest way to leave it.
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-slate-200">
            {devices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {device.label}
                    {device.current && (
                      <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-normal text-emerald-700 ring-1 ring-emerald-200">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    Last used {formatDateTime(device.last_used_at)} - stops being
                    remembered {formatDateTime(device.expires_at)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => api.forgetDevice(device.id),
                      `${device.label} will be asked for your second factor again.`,
                    )
                  }
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="btn-secondary btn-sm mt-3"
            disabled={busy}
            onClick={() =>
              act(
                () => api.forgetAllDevices(),
                "Every remembered device has been forgotten, including this one.",
              )
            }
          >
            Forget every device
          </button>
          <p className="hint mt-2">
            Do this if a device has been lost, sold or handed on. Changing your password
            does it automatically.
          </p>
        </>
      )}
    </section>
  );
}
