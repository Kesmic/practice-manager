/**
 * Sign in.
 *
 * A two-panel layout: the firm's own side on the left, the form on the right.
 * The left panel exists to answer "am I in the right place?" before anyone types
 * anything - the firm's logo and name at a size you cannot mistake, and a plain
 * statement of what the portal is. It collapses away below large screens, where a
 * decorative panel would only push the form under the fold.
 *
 * Deliberate details, each of which earns its place:
 *
 * - The logo is the firm's uploaded one, falling back to the product mark.
 * - Show/hide on the password, because a long typed password with no way to check
 *   it is the most common reason people fail to sign in.
 * - A caps-lock warning, for the same reason.
 * - The appearance control is available *before* signing in, since someone who
 *   needs dark mode needs it on this page too.
 * - No "create an account" anywhere: accounts are issued by the firm, and saying
 *   so plainly is kinder than letting someone hunt for a sign-up link.
 */

import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiRequestError } from "../lib/api";
import { useSession } from "../lib/auth";
import { FirmLogo, useFirm } from "../lib/firm";
import { ThemeToggle } from "../components/ThemeToggle";
import { ErrorBanner, Field, Spinner, TextInput } from "../components/ui";

/** What the portal is for, said once, without salesmanship. */
const ASSURANCES = [
  {
    title: "Client work, start to sign-off",
    body: "Deliverables, deadlines, review points and approval - with a record of who did what.",
  },
  {
    title: "Your employment, in one place",
    body: "Your contract, the handbook, your own details and everything you have signed.",
  },
  {
    title: "Confidential by design",
    body: "You see the clients and records your role requires, and nothing beyond them.",
  },
];

export function Login() {
  const { user, loading, signIn } = useSession();
  const { branding } = useFirm();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
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
        err instanceof ApiRequestError ? err.message : "Sign-in failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-page lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ------------------------------------------------------- the firm's side */}
      <aside className="relative hidden overflow-hidden bg-brand-900 lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:p-12">
        {/*
          Two soft washes of the firm's own colours. Kept very low contrast: this
          panel sits behind a logo and text, and a busy background would fight
          both. Pointer-events off so it can never intercept a click.
        */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-500/25 blur-3xl" />
          <div className="absolute -bottom-32 right-[-10%] h-[28rem] w-[28rem] rounded-full bg-accent-500/20 blur-3xl" />
        </div>

        <div className="relative flex items-center gap-3">
          <FirmLogo className="h-12 w-12 bg-white/10 p-1.5" labelled />
          <div className="leading-tight">
            <p className="text-base font-semibold text-white">{branding.firm_name}</p>
            <p className="text-xs uppercase tracking-[0.18em] text-white/50">
              Practice Manager
            </p>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            The firm's work, its records and its people - behind one sign-in.
          </h2>
          <ul className="mt-8 space-y-5">
            {ASSURANCES.map((item) => (
              <li key={item.title} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10"
                >
                  <svg
                    viewBox="0 0 20 20"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m5 10.5 3.5 3.5L15 6" className="text-emerald-400" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-white/60">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">
          {branding.firm_name}
          {branding.firm_name && " · "}
          Staff access only. Activity in the portal is recorded.
        </p>
      </aside>

      {/* ------------------------------------------------------------- the form */}
      <main className="flex min-h-screen flex-col px-5 py-8 sm:px-10 lg:justify-center lg:px-14">
        <div className="mb-8 flex w-full items-start justify-between gap-3 lg:absolute lg:right-8 lg:top-6 lg:mb-0 lg:w-auto">
          {/* On small screens the logo has no left panel to live in. */}
          <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
            <FirmLogo className="h-10 w-10" labelled />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-slate-900">
                {branding.firm_name}
              </p>
              <p className="text-[11px] uppercase tracking-wider text-slate-500">
                Practice Manager
              </p>
            </div>
          </div>
          <ThemeToggle compact />
        </div>

        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="muted mt-1">Use the work email address the firm set up for you.</p>

          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            <ErrorBanner error={error} onDismiss={() => setError(null)} />

            <Field label="Email address" required>
              {(id) => (
                <TextInput
                  id={id}
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@kesmic.org"
                />
              )}
            </Field>

            <Field label="Password" required>
              {(id) => (
                <div className="relative">
                  <TextInput
                    id={id}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) =>
                      setCapsLock(e.getModifierState?.("CapsLock") ?? false)
                    }
                    className="input pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-700"
                    aria-pressed={showPassword}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              )}
            </Field>

            {capsLock && (
              <p className="flex items-center gap-1.5 text-xs text-amber-800">
                <span aria-hidden>⚠</span> Caps Lock is on.
              </p>
            )}

            <button type="submit" className="btn-primary w-full py-2.5" disabled={busy}>
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
                  your security it has to reach you by phone or in person, not by email.
                </p>
              )}
            </div>
          </form>

          <p className="mt-10 border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500">
            Accounts are issued by the firm - there is nothing to sign up for. If you are
            new and have not been given one, speak to whoever is handling your onboarding.
          </p>
        </div>
      </main>
    </div>
  );
}
