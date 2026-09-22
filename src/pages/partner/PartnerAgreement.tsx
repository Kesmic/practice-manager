/**
 * The engagement a growth partner reads and signs.
 *
 * Shown on their own page, because it is the first thing they have to do and the thing
 * that gates everything else: nothing is registered or proposed in the firm's name
 * before it is signed.
 *
 * Three things it is careful about, each borrowed from how staff sign a contract:
 *
 * **They read it here, in full.** Not a summary with a link to the document - the
 * document, on the page, above the box they type into.
 *
 * **The name must be theirs.** It is checked against their account, and the page says
 * which name to type rather than refusing afterwards.
 *
 * **They sign with a signature.** A picture of their own, which appears on the copy,
 * because a document that only records a typed name does not look like a signed
 * instrument to anybody they have to show it to.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SIGNATURE_ACCEPT, whyNotASignature } from "@shared/signatures";
import { ApiRequestError, api } from "../../lib/api";
import { usePartnerSession } from "../../lib/partner-auth";
import { Markdown } from "../../components/Markdown";
import {
  ErrorBanner,
  Field,
  Spinner,
  SuccessBanner,
  TextInput,
} from "../../components/ui";
import { formatDate } from "../../lib/format";

interface Agreement {
  id: string;
  title: string;
  body: string;
  status: "issued" | "signed" | "superseded";
  issued_at: string;
  signed_at: string | null;
  typed_name: string | null;
  commission_rate: number;
  commission_months: number;
  hold_days: number;
  has_signature: boolean;
}

export function PartnerAgreement() {
  const { refresh } = usePartnerSession();
  const [data, setData] = useState<{ agreement: Agreement | null; full_name: string } | null>(
    null,
  );
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.partnerAgreement();
      setData(next);
      setTyped((current) => current || "");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your engagement.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading your engagement" />;
  if (!data.agreement) {
    return (
      <div className="card p-6 text-center">
        <h2 className="card-title">Nothing to sign</h2>
        <p className="muted mt-1">
          We have not issued you an engagement. Tell us, and we will put that right.
        </p>
      </div>
    );
  }

  const agreement = data.agreement;
  const signed = agreement.status === "signed";

  const upload = async (chosen: File) => {
    const refusal = whyNotASignature({ type: chosen.type, size: chosen.size });
    if (refusal) {
      setError(refusal);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.uploadPartnerSignature(chosen);
      setNotice("Signature uploaded. Now type your name below and sign.");
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not upload that.");
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.signPartnerAgreement(typed);
      setNotice("Signed. You can register a business and start selling now.");
      await load();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not sign it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">{agreement.title}</h1>
        <p className="muted mt-1">
          {signed
            ? `Signed ${formatDate(agreement.signed_at ?? "")}. This is your copy.`
            : "Read this and sign it. Nothing can be registered or proposed in our name until it is signed."}
        </p>
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {notice && <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />}

      {/* The terms in it, said once in plain figures above the text. */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { k: "Commission", v: `${agreement.commission_rate}%` },
          { k: "Billed months", v: String(agreement.commission_months) },
          { k: "Hold on a registration", v: `${agreement.hold_days} days` },
        ].map((item) => (
          <div key={item.k} className="lift card p-4">
            <p className="text-xs uppercase tracking-wider text-slate-500">{item.k}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              {item.v}
            </p>
          </div>
        ))}
      </div>

      <section className="card p-5">
        <Markdown className="prose-welcome max-h-[60vh] overflow-auto pr-2">
          {agreement.body}
        </Markdown>
      </section>

      {signed ? (
        <section className="card p-5">
          <h2 className="card-title">Your copy</h2>
          <p className="muted mt-1">
            Signed as <strong>{agreement.typed_name}</strong> on{" "}
            {formatDate(agreement.signed_at ?? "")}. The copy carries your signature, the
            text as it stood, and a fingerprint of it.
          </p>
          <a className="btn-secondary mt-3 inline-block" href="/api/partner/agreement/copy">
            Download my copy
          </a>
        </section>
      ) : (
        <section className="card p-5">
          <h2 className="card-title">Sign it</h2>

          <div className="mt-3 space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-800">
                1. Your signature
                {agreement.has_signature && (
                  <span className="pill ml-2 bg-emerald-50 text-emerald-800 ring-emerald-200">
                    Uploaded
                  </span>
                )}
              </p>
              <p className="hint">
                A photograph of your signature on paper, or one drawn on a touchscreen
                and saved. PNG, JPEG or WebP.
              </p>
              {agreement.has_signature && (
                <img
                  src="/api/partner/agreement/signature"
                  alt="Your signature"
                  className="mt-2 max-h-20 rounded border border-slate-200 bg-white p-2"
                />
              )}
              <input
                ref={file}
                type="file"
                accept={SIGNATURE_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) void upload(chosen);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn-secondary btn-sm mt-2"
                disabled={busy}
                onClick={() => file.current?.click()}
              >
                {agreement.has_signature ? "Use a different image" : "Upload my signature"}
              </button>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-800">2. Your name</p>
              <Field
                label={`Type ${data.full_name}`}
                hint="It has to match the name on your account. Tell us if that name is wrong and we will change it before you sign."
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                  />
                )}
              </Field>
            </div>

            <button
              type="button"
              className="btn-primary"
              disabled={busy || !agreement.has_signature || !typed.trim()}
              onClick={() => void sign()}
            >
              {busy ? "Signing..." : "Sign this engagement"}
            </button>
            {!agreement.has_signature && (
              <p className="hint">Upload your signature first.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
