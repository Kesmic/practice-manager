import { useState } from "react";
import { ROLE_LABELS } from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  DetailRow,
  ErrorBanner,
  Field,
  SuccessBanner,
  TextInput,
} from "../components/ui";
import { formatDate } from "../lib/format";

export function Account() {
  const { user, refresh } = useSession();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.next !== form.confirm) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await api.changePassword(form.current, form.next);
      setForm({ current: "", next: "", confirm: "" });
      setDone("Your password has been changed. Other sessions have been signed out.");
      await refresh();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not change your password.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="section-title">Your account</h1>

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

      <form onSubmit={submit} className="card space-y-4 p-5">
        <h2 className="card-title">Change password</h2>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <SuccessBanner message={done} onDismiss={() => setDone(null)} />

        <Field label="Current password" required>
          {(id) => (
            <TextInput
              id={id}
              type="password"
              required
              autoComplete="current-password"
              value={form.current}
              onChange={set("current")}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="New password"
            required
            hint="At least 12 characters, mixing three character types."
          >
            {(id) => (
              <TextInput
                id={id}
                type="password"
                required
                autoComplete="new-password"
                value={form.next}
                onChange={set("next")}
              />
            )}
          </Field>
          <Field label="Confirm new password" required>
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

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </div>
  );
}
