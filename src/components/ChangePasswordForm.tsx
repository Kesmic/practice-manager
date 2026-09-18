/**
 * Choosing a new password.
 *
 * Extracted so it can be shown in two places without being written twice: on the
 * account screen, where somebody changes their password because they want to, and
 * inside the first-run dialog, where a new joiner replaces the temporary one they were
 * emailed. The rules and the wording are the same in both, which is the point of it
 * being one component.
 *
 * `onChanged` is what differs. On the account screen it refreshes the session and
 * leaves the person where they are. In the first run it advances them to the next step,
 * which is what closes the dialog.
 */

import { useState } from "react";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Field, SuccessBanner, TextInput } from "./ui";

export function ChangePasswordForm({
  onChanged,
  /** Shown when the change succeeds. Left out where something else marks the moment. */
  successMessage = "Your password has been changed. Other sessions have been signed out.",
  submitLabel = "Change password",
  framed = true,
}: {
  onChanged: () => Promise<void> | void;
  successMessage?: string | null;
  submitLabel?: string;
  /** False inside a dialog, which supplies its own surface. */
  framed?: boolean;
}) {
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
      if (successMessage) setDone(successMessage);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not change your password.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={framed ? "card space-y-4 p-5" : "space-y-4"}>
      {framed && <h2 className="card-title">Change password</h2>}
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
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
