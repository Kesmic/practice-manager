/**
 * Where a client signs in.
 *
 * Standalone, with no navigation and nothing about the firm's other work, for the reason
 * shared/intake.ts gives about the public intake page: the portal should not tell
 * somebody outside the firm what it holds.
 *
 * Every failure reads the same, because the server refuses them all the same way - a
 * wrong password, an unknown address, an invitation not yet accepted and a suspended
 * account are one sentence. Saying which would tell a stranger whose addresses the firm
 * holds, and therefore who its clients are.
 */

import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError, api } from "../../lib/api";
import { useClientSession } from "../../lib/client-auth";
import { ErrorBanner, Field, Spinner, TextInput } from "../../components/ui";

export function ClientLogin() {
  const { user, loading, refresh } = useClientSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner label="Checking your session" />;
  if (user) {
    const back = (location.state as { from?: string } | null)?.from;
    return <Navigate to={back && back.startsWith("/client") ? back : "/client"} replace />;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.clientLogin(email, password);
      await refresh();
      navigate("/client", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not sign you in just now.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="section-title">Sign in</h1>
        <p className="muted mt-1 mb-5">
          For businesses we act for. Your accountant here will have sent you a link to set
          your password.
        </p>

        <form onSubmit={submit} className="card space-y-4 p-5">
          {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

          <Field label="Email" required>
            {(id) => (
              <TextInput
                id={id}
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>

          <Field label="Password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>

          <button
            type="submit"
            className="btn-primary w-full"
            disabled={busy || !email.trim() || !password}
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <p className="hint text-center">
            Forgotten your password, or never set one? Ask us and we will send you a fresh
            link.
          </p>
        </form>
      </div>
    </div>
  );
}
