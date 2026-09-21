/**
 * Where a growth partner signs in, and where somebody applies to become one.
 *
 * Standalone, with no navigation and nothing about the firm's other work, for the reason
 * the client's own sign-in page gives.
 *
 * Every failure reads the same, because the server refuses them all the same way. A
 * wrong password, an unknown address, an application not yet approved and a suspended
 * account are one sentence - saying which would tell a stranger who sells for the firm.
 */

import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError, api } from "../../lib/api";
import { usePartnerSession } from "../../lib/partner-auth";
import {
  ErrorBanner,
  Field,
  Spinner,
  SuccessBanner,
  TextInput,
} from "../../components/ui";
import { AuthShell } from "../../components/AuthShell";

export function PartnerLogin() {
  const { partner, loading, refresh } = usePartnerSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  if (loading) return <Spinner label="Checking your session" />;
  if (partner) {
    const back = (location.state as { from?: string } | null)?.from;
    return <Navigate to={back?.startsWith("/partner") ? back : "/partner"} replace />;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.partnerLogin(email, password);
      await refresh();
      navigate("/partner", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not sign you in just now.",
      );
    } finally {
      setBusy(false);
    }
  };

  /*
   * The same sentence whether or not the address is one the firm holds, shown as it
   * comes back rather than checked here - a form that behaved differently for a real
   * address would undo what the endpoint is careful about.
   */
  const askForLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { message } = await api.partnerForgotPassword(email);
      setSent(message);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not send that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      kicker="Growth partners"
      footer={
        <>
          Not working with us yet?{" "}
          <Link className="link" to="/partner/apply">
            Apply to become a growth partner
          </Link>
          .
        </>
      }
    >
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        {forgot ? "Set a new password" : "Sign in"}
      </h1>
      <p className="muted mb-5 mt-1">
        {forgot
          ? "Tell us the address you use with us and we will send a link."
          : "Your pipeline, your proposals and what you have earned."}
      </p>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {sent && <SuccessBanner message={sent} />}

      <form onSubmit={forgot ? askForLink : submit} className="space-y-4">
        <Field label="Email address">
          {(id) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </Field>

        {!forgot && (
          <Field label="Password">
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
          </Field>
        )}

        <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>
          {busy ? "One moment..." : forgot ? "Send me a link" : "Sign in"}
        </button>

        <button
          type="button"
          className="btn-ghost btn-sm w-full"
          onClick={() => {
            setForgot(!forgot);
            setSent(null);
            setError(null);
          }}
        >
          {forgot ? "Back to signing in" : "Forgotten your password?"}
        </button>
      </form>
    </AuthShell>
  );
}
