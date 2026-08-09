import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError } from "../lib/api";
import { useSession } from "../lib/auth";
import { ErrorBanner, Field, Spinner, TextInput } from "../components/ui";

export function Login() {
  const { user, loading, signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        <div className="mb-6 text-center">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 text-lg font-bold text-white">
            K
          </span>
          <h1 className="mt-3 text-xl font-semibold text-white">Kesmic Practice Manager</h1>
          <p className="mt-1 text-sm text-brand-200">
            Client deliverables, review and sign-off
          </p>
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

          <p className="text-center text-xs text-slate-500">
            No accounts yet?{" "}
            <Link to="/setup" className="link">
              Set up the first administrator
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
