/**
 * Accepting an invitation by choosing a password.
 *
 * The firm never learns what is typed here. Nobody sets a temporary password on a
 * client's behalf, which is the difference between this and how staff accounts start.
 *
 * The link works once and expires. A stale one says so plainly and tells them what to do
 * about it, because the alternative is somebody staring at a dead page.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiRequestError, api } from "../../lib/api";
import { useClientSession } from "../../lib/client-auth";
import { ErrorBanner, Field, Spinner, TextInput } from "../../components/ui";

export function ClientInvitation() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { refresh } = useClientSession();

  const [who, setWho] = useState<{ full_name: string; client_name: string } | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setWho(await api.clientInvitation(token));
    } catch (err) {
      setDead(
        err instanceof ApiRequestError
          ? err.message
          : "This link is not valid. Please ask us for a new one.",
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (dead) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="section-title">That link has expired</h1>
          <p className="muted mt-2">{dead}</p>
        </div>
      </div>
    );
  }

  if (!who) return <Spinner label="Checking your link" />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== again) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.acceptClientInvitation(token, password);
      await refresh();
      navigate("/client", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not set your password.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="section-title">Choose a password</h1>
        <p className="muted mt-1 mb-5">
          Welcome, {who.full_name}. This is for the {who.client_name} account. Nobody here
          will ever see what you type.
        </p>

        <form onSubmit={submit} className="card space-y-4 p-5">
          {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

          <Field label="New password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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

          <button type="submit" className="btn-primary w-full" disabled={busy || !password}>
            {busy ? "Setting it..." : "Set my password and sign in"}
          </button>

          <p className="hint">
            This link works once. Once you have set a password, use the sign-in page.
          </p>
        </form>
      </div>
    </div>
  );
}
