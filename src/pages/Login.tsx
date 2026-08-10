import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError } from "../lib/api";
import { useSession } from "../lib/auth";
import { FirmLogo, useFirm } from "../lib/firm";
import { ErrorBanner, Field, Spinner, TextInput } from "../components/ui";

export function Login() {
  const { user, loading, signIn } = useSession();
  const { branding } = useFirm();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReset, setShowReset] = useState(false);

  if (loading) return <Spinner label="Checking your session" />;
  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/login" ? from : "/"} replace />;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Sign-in failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <FirmLogo className="h-14 w-14 bg-panel/10 p-1.5" labelled />
          <h1 className="mt-3 text-xl font-semibold text-white">{branding.firm_name}</h1>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          <Field label="Email address" required>
            {(id) => (
              <TextInput
                id={id}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@kesmic.org"
              />
            )}
          </Field>

          <Field label="Password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div className="text-center text-xs text-slate-500">
            <button
              type="button"
              className="link"
              onClick={() => setShowReset((open) => !open)}
              aria-expanded={showReset}
            >
              Forgotten your password?
            </button>
            {showReset && (
              <p className="mt-2 rounded-md bg-slate-100 p-3 text-left leading-relaxed">
                Ask an administrator to reset it. They can issue you a new temporary
                password from <strong>Accounts and grades</strong>, which you will be
                asked to replace with one of your own the first time you sign in. For
                your security it has to be passed to you by phone or in person, not by
                email.
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
