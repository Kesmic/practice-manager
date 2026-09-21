/**
 * Applying to sell for the firm.
 *
 * Open to anybody, and it gets you nothing on its own: what it writes has no password
 * and cannot sign in. The firm reads the list, admits who it wants to work with, and
 * only then does a link go out. So this form is a way onto a list rather than a foothold
 * in the portal, and it says so plainly rather than implying an account is waiting.
 *
 * The answer is the same whether or not the address has already applied - two different
 * answers would tell somebody who already sells for the firm.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError, api } from "../../lib/api";
import {
  ErrorBanner,
  Field,
  SuccessBanner,
  TextArea,
  TextInput,
} from "../../components/ui";
import { AuthShell } from "../../components/AuthShell";
import { COMMISSION_MONTHS, COMMISSION_RATE } from "@shared/growth-partners";

export function PartnerApply() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { message } = await api.partnerApply({
        full_name: fullName,
        email,
        phone: phone || undefined,
        business_name: businessName || undefined,
        note: note || undefined,
      });
      setDone(message);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not send that.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthShell kicker="Growth partners">
        <SuccessBanner message={done} />
        <p className="muted mt-4">
          There is nothing to sign in to yet. When we have agreed to work
          together we will email you a link to set a password.
        </p>
        <Link className="link mt-4 inline-block" to="/partner/login">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      kicker="Growth partners"
      wide
      footer={
        <>
          Already working with us?{" "}
          <Link className="link" to="/partner/login">
            Sign in
          </Link>
          .
        </>
      }
    >
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Sell with us
      </h1>
      <p className="muted mt-1">
        Growth partners do not simply make introductions. You run the whole
        thing in consultation with us - the pitch, the proposal, getting the
        engagement signed - and we come in when a meeting needs somebody from
        the firm. You earn {COMMISSION_RATE}% of what the client pays us for
        their first {COMMISSION_MONTHS} billed months, and a month a client
        pauses is not one of them.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          {
            head: "Register a business",
            body: "Tell us who you are working on and it is yours for ninety days. Nobody else can register the same company while your hold runs.",
          },
          {
            head: "Propose and close",
            body: "Build a proposal from our packages, send it, and follow it through to the engagement letter.",
          },
          {
            head: "See what you have earned",
            body: "Every month a client of yours is billed, what it earned you, and where the payment has got to.",
          },
        ].map((card) => (
          <div
            key={card.head}
            className="lift card p-4 ring-1 ring-inset ring-slate-200 hover:ring-brand-300"
          >
            <h2 className="text-sm font-semibold text-slate-900">
              {card.head}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{card.body}</p>
          </div>
        ))}
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <form
        onSubmit={submit}
        className="mt-5 space-y-4 border-t border-slate-200 pt-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name">
            {(id) => (
              <TextInput
                id={id}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Email address">
            {(id) => (
              <TextInput
                id={id}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}
          </Field>
          <Field
            label="Telephone"
            hint="Optional, but it is how we would reach you first."
          >
            {(id) => (
              <TextInput
                id={id}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Business name"
            hint="If you sell through a company of your own."
          >
            {(id) => (
              <TextInput
                id={id}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="What you would bring"
          hint="The kind of businesses you deal with, and anything you would want us to know."
        >
          {(id) => (
            <TextArea
              id={id}
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>

        <button type="submit" className="btn-primary w-full py-2.5 sm:w-auto" disabled={busy}>
          {busy ? "Sending..." : "Send my application"}
        </button>
        <p className="hint">
          Applying does not create an account. Somebody here reads every one of
          these.
        </p>
      </form>
    </AuthShell>
  );
}
