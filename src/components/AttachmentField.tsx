/**
 * Attaching one of the two documents a member of staff holds on their own record.
 *
 * Replaces the box that used to ask for a link. Asking a new joiner for a SharePoint
 * link to their passport, on a morning when they have not been given anywhere to upload
 * one, is asking them to solve the firm's filing problem before they have a desk - so
 * they attach the photograph that is already on their phone.
 *
 * A link is still accepted, because some people have one and because somebody whose
 * certificate lives in the firm's document store should not be made to download and
 * re-upload it. It is the second option rather than the first.
 */

import { useRef, useState } from "react";
import {
  ACCEPT_ATTRIBUTE,
  MAX_BYTES,
  describeSize,
  isAttachment,
  whyNotAcceptable,
  type StaffAttachment,
  type StaffFileKind,
} from "@shared/staff-files";
import { ApiRequestError, api } from "../lib/api";
import { formatDate } from "../lib/format";
import { TextInput } from "./ui";

export function AttachmentField({
  kind,
  value,
  attached,
  onChange,
  onAttachmentChanged,
}: {
  kind: StaffFileKind;
  /** The profile column: either `portal:<id>` or a link somebody pasted. */
  value: string;
  attached: StaffAttachment | null;
  onChange: (value: string) => void;
  onAttachmentChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const holdsFile = isAttachment(value) && attached;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    // Checked here so somebody finds out before a slow upload, and again on the server,
    // because a check only the browser makes is not a check.
    const refusal = whyNotAcceptable({ type: file.type, size: file.size });
    if (refusal) {
      setError(refusal);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.uploadStaffFile(kind, file);
      await onAttachmentChanged();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not attach that file.",
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
      await api.removeStaffFile(kind);
      onChange("");
      await onAttachmentChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not remove that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={picker}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(e) => void choose(e.target.files?.[0])}
      />

      {holdsFile ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:bg-slate-800/40">
          <a
            className="link text-sm font-medium"
            href={api.myStaffFileUrl(kind)}
            target="_blank"
            rel="noreferrer"
          >
            {attached.filename}
          </a>
          <span className="text-xs text-slate-500">
            {describeSize(attached.size_bytes)} · attached{" "}
            {formatDate(attached.uploaded_at)}
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
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            {busy ? "Attaching..." : "Choose a file"}
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setPasting((p) => !p)}
          >
            {pasting ? "Attach a file instead" : "Paste a link instead"}
          </button>
        </div>
      )}

      {!holdsFile && pasting && (
        <TextInput
          value={value}
          placeholder="https://..."
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      <p className="hint">
        A photograph or a scan - PDF, JPEG, PNG, WebP or HEIC, up to{" "}
        {describeSize(MAX_BYTES)}. Only you and a Partner can open it.
      </p>

      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}
