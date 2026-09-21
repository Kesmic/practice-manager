/**
 * The picture of somebody's signature: uploading one, seeing it, replacing it.
 *
 * Used in two places that want the same control for different reasons. On the account
 * page it is housekeeping - set this up once, before anybody asks you for it. On a
 * contract it is in the way of signing, because a contract will not record a signature
 * without one.
 *
 * Replacing is deliberately undramatic and the note says why: a new signature applies
 * to what you sign next, and changes nothing you have already signed. Somebody whose
 * signature has changed, or who uploaded a bad photograph of it, should not have to
 * wonder whether fixing it quietly restates their contract.
 */

import { useEffect, useRef, useState } from "react";
import {
  SIGNATURE_ACCEPT,
  SIGNATURE_MAX_BYTES,
  describeSize,
  whyNotASignature,
  type SignatureSpecimen,
} from "@shared/signatures";
import { ApiRequestError, api } from "../lib/api";
import { formatDate } from "../lib/format";

export function SignatureCard({
  signature,
  onChanged,
  /** A card on the account page; bare inside a form that is already a card. */
  framed = true,
}: {
  signature: SignatureSpecimen | null;
  onChanged: (signature: SignatureSpecimen | null) => Promise<void> | void;
  framed?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    /*
     * Checked here so somebody finds out before the upload rather than after, and again
     * on the server, because a check only the browser makes is not a check.
     */
    const refusal = whyNotASignature({ type: file.type, size: file.size });
    if (refusal) {
      setError(refusal);
      if (picker.current) picker.current.value = "";
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { signature: saved } = await api.uploadSignature(file);
      await onChanged(saved);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not upload that image.",
      );
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.removeSignature();
      await onChanged(null);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not remove that.",
      );
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="space-y-3">
      <input
        ref={picker}
        type="file"
        accept={SIGNATURE_ACCEPT}
        className="hidden"
        onChange={(e) => void choose(e.target.files?.[0])}
      />

      {signature ? (
        <>
          {/*
           * On white whatever the theme, because that is the paper it was written on
           * and a dark background turns a black-ink signature into a smudge.
           */}
          <div className="flex items-end rounded-md border border-slate-200 bg-white px-4 py-3">
            <img
              src={api.signatureImageUrl(signature.id)}
              alt="Your signature"
              className="max-h-20 max-w-[18rem] object-contain object-left-bottom"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs text-slate-500">
              Uploaded {formatDate(signature.uploaded_at)} ·{" "}
              {describeSize(signature.size_bytes)}
            </span>
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy}
                onClick={() => picker.current?.click()}
              >
                Replace
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm text-rose-700"
                disabled={busy}
                onClick={() => void remove()}
              >
                Remove
              </button>
            </span>
          </div>
          <p className="hint">
            Replacing this applies to what you sign next. Documents you have already
            signed keep the signature you signed them with.
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            {busy ? "Uploading..." : "Upload my signature"}
          </button>
          <p className="hint">
            Sign a blank sheet of paper and photograph it, or sign on a touchscreen and
            save the picture. PNG, JPEG or WebP, up to{" "}
            {describeSize(SIGNATURE_MAX_BYTES)}. Only you and a Partner can see it.
          </p>
        </>
      )}

      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );

  if (!framed) return body;

  return (
    <section className="card p-5">
      <h2 className="card-title">My signature</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600 dark:text-slate-400">
        Used on contracts you sign in the portal, so the copy you can download looks
        signed rather than typed.
      </p>
      {body}
    </section>
  );
}

/**
 * The same card, fetching the specimen itself.
 *
 * For the account page, where nothing else on the page needed to know about signatures
 * and threading the fetch through it would be ceremony for one consumer.
 */
export function MySignatureCard() {
  const [signature, setSignature] = useState<SignatureSpecimen | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void api
      .mySignature()
      .then((r) => {
        if (live) setSignature(r.signature);
      })
      .catch(() => {
        /* Shown as "none on file", which is what somebody can act on. */
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!loaded) return null;
  return <SignatureCard signature={signature} onChanged={setSignature} />;
}
