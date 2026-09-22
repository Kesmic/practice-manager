/**
 * A growth partner's own details, and their password.
 *
 * Deliberately thin. The terms they work under are shown because they are the thing a
 * partner most often wants to check, and they are not editable here - they are what the
 * firm agreed with them, and a screen that let either side change them alone would be
 * worse than a telephone call.
 */

import { useState } from "react";
import { ApiRequestError, api } from "../../lib/api";
import { usePartnerSession } from "../../lib/partner-auth";
import {
  ErrorBanner,
  Field,
  Spinner,
  SuccessBanner,
  TextInput,
} from "../../components/ui";
import { formatDate } from "../../lib/format";

export function PartnerAccount() {
  const { partner } = usePartnerSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!partner) return <Spinner label="Loading your details" />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (next !== again) {
      setError("The two new passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.partnerChangePassword(current, next);
      setDone("Password changed. Every other device of yours has been signed out.");
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not change it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="section-title">My details</h1>

      <section className="card p-5">
        <h2 className="card-title">You</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd className="font-medium text-slate-800">{partner.full_name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium text-slate-800">{partner.email}</dd>
          </div>
          {partner.business_name && (
            <div>
              <dt className="text-slate-500">Business</dt>
              <dd className="font-medium text-slate-800">{partner.business_name}</dd>
            </div>
          )}
          <div>
            <dt className="text-slate-500">Engagement signed</dt>
            <dd className="font-medium text-slate-800">
              {partner.agreement_signed_at
                ? formatDate(partner.agreement_signed_at)
                : "Not yet"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="card p-5">
        <h2 className="card-title">Your terms</h2>
        <p className="muted mt-1">
          What we agreed with you. These are yours and do not change when our standard
          terms do.
        </p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Commission</dt>
            <dd className="text-lg font-semibold text-slate-900">
              {partner.commission_rate}%
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Billed months</dt>
            <dd className="text-lg font-semibold text-slate-900">
              {partner.commission_months}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Hold on a registration</dt>
            <dd className="text-lg font-semibold text-slate-900">
              {partner.hold_days} days
            </dd>
          </div>
        </dl>
      </section>

      <section className="card p-5">
        <h2 className="card-title">Change your password</h2>
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {done && <SuccessBanner message={done} onDismiss={() => setDone(null)} />}
        <form onSubmit={submit} className="mt-3 max-w-sm space-y-4">
          <Field label="Your current password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="New password" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Again" required>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                required
              />
            )}
          </Field>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Changing it..." : "Change my password"}
          </button>
        </form>
      </section>
    </div>
  );
}
