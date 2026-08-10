import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { ErrorBanner, Field, TextInput } from "../components/ui";

/**
 * One-time first-run screen. The Worker refuses this endpoint once any user
 * exists, and requires the BOOTSTRAP_SECRET set during deployment, so this page
 * is safe to leave reachable.
 */
export function Setup() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [form, setForm] = useState({
    secret: "",
    full_name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.password !== form.confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.bootstrap({
        secret: form.secret,
        email: form.email,
        full_name: form.full_name,
        password: form.password,
      });
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Setup failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 px-4 py-10">
      <div className="w-full max-w-lg">
        <h1 className="mb-1 text-center text-xl font-semibold text-white">
          First-run setup
        </h1>
        <p className="mb-6 text-center text-sm text-white/60">
          Create the initial administrator account for this deployment.
        </p>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          <Field
            label="Bootstrap secret"
            required
            hint="The value set with `wrangler secret put BOOTSTRAP_SECRET` during deployment."
          >
            {(id) => (
              <TextInput
                id={id}
                type="password"
                required
                value={form.secret}
                onChange={set("secret")}
              />
            )}
          </Field>

          <Field label="Full name" required>
            {(id) => (
              <TextInput
                id={id}
                required
                value={form.full_name}
                onChange={set("full_name")}
                placeholder="Michael Kesseh"
              />
            )}
          </Field>

          <Field label="Email address" required>
            {(id) => (
              <TextInput
                id={id}
                type="email"
                required
                autoComplete="username"
                value={form.email}
                onChange={set("email")}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Password"
              required
              hint="At least 12 characters, mixing three character types."
            >
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.password}
                  onChange={set("password")}
                />
              )}
            </Field>
            <Field label="Confirm password" required>
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={set("confirm")}
                />
              )}
            </Field>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Creating account…" : "Create administrator"}
          </button>

          <p className="text-center text-xs text-slate-500">
            Already set up?{" "}
            <Link to="/login" className="link">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
