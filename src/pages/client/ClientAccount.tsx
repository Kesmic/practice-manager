/**
 * A client changing their own password.
 *
 * Changing it ends every other session of theirs - which is what somebody doing this
 * because they think a device is compromised actually wants. The one they are using
 * survives, so they are not signed out of the act of securing themselves.
 */

import { useState } from "react";
import { ApiRequestError, api } from "../../lib/api";
import { useClientSession } from "../../lib/client-auth";
import {
  DetailRow,
  ErrorBanner,
  Field,
  SuccessBanner,
  TextInput,
} from "../../components/ui";

export function ClientAccount() {
  const { user } = useClientSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next !== again) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.changeClientPassword(current, next);
      setDone("Your password has been changed. Any other device is now signed out.");
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not change your password.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="section-title">My details</h1>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {done && <SuccessBanner message={done} onDismiss={() => setDone(null)} />}

      <div className="card p-5">
        <dl className="divide-y divide-slate-100">
          <DetailRow label="Name">{user.full_name}</DetailRow>
          <DetailRow label="Email">{user.email}</DetailRow>
          <DetailRow label="Business">{user.client_name}</DetailRow>
        </dl>
      </div>

      <form onSubmit={submit} className="card space-y-4 p-5">
        <h2 className="card-title">Change my password</h2>

        <Field label="Current password" required>
          {(id) => (
            <TextInput
              id={id}
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field label="New password" required>
          {(id) => (
            <TextInput
              id={id}
              type="password"
              required
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <Field label="Again" required>
          {(id) => (
            <TextInput
              id={id}
              type="password"
              required
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          )}
        </Field>

        <button type="submit" className="btn-primary" disabled={busy || !current || !next}>
          {busy ? "Changing..." : "Change my password"}
        </button>
        <p className="hint">
          Changing this signs you out everywhere else, but not here.
        </p>
      </form>
    </div>
  );
}
