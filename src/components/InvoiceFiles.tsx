/**
 * The papers attached to an invoice, and which of them the client can see.
 *
 * As in Xero: attach a receipt, a timesheet, an acknowledgement; tick "Show to client"
 * on the ones the client should have. A shared file appears under the invoice in the
 * client's portal and is offered for the invoice email; an unshared one stays the
 * firm's. Nothing is shared unless somebody ticks it.
 */

import { useRef, useState } from "react";
import {
  INVOICE_FILE_ACCEPT,
  MAX_INVOICE_FILES,
  describeFileSize,
  whyNotInvoiceFile,
} from "@shared/invoice-files";
import type { InvoiceFileRow } from "@shared/types";
import { useDialogs } from "../lib/dialogs";
import { ApiRequestError, api } from "../lib/api";
import { formatDateTime } from "../lib/format";

export function InvoiceFiles({
  invoiceId,
  files: initial,
  isDraft,
  canEdit,
}: {
  invoiceId: string;
  files: InvoiceFileRow[];
  isDraft: boolean;
  canEdit: boolean;
}) {
  const [files, setFiles] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shareNew, setShareNew] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const dialogs = useDialogs();

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setProblem(null);
    const chosen = [...list];
    const refusal = chosen.map((f) => whyNotInvoiceFile({ type: f.type, name: f.name, size: f.size })).find(Boolean);
    if (refusal) {
      setProblem(refusal);
      return;
    }
    if (files.length + chosen.length > MAX_INVOICE_FILES) {
      setProblem(`An invoice holds at most ${MAX_INVOICE_FILES} files.`);
      return;
    }
    setBusy(true);
    try {
      for (const file of chosen) {
        const r = await api.attachInvoiceFile(invoiceId, file, shareNew);
        setFiles(r.files);
      }
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Could not attach that file.");
    } finally {
      setBusy(false);
    }
  };

  // The tick moves at once and is put back if the change does not save, so the box
  // never sits unticked for the second the server takes to agree.
  const share = async (file: InvoiceFileRow, shared: boolean) => {
    setProblem(null);
    const flag = shared ? 1 : 0;
    setFiles((fs) => fs.map((f) => (f.id === file.id ? { ...f, shared: flag } : f)));
    try {
      setFiles((await api.shareInvoiceFile(file.id, shared)).files);
    } catch (err) {
      setFiles((fs) => fs.map((f) => (f.id === file.id ? { ...f, shared: file.shared } : f)));
      setProblem(err instanceof ApiRequestError ? err.message : "Could not change that.");
    }
  };

  const remove = async (file: InvoiceFileRow) => {
    const ok = await dialogs.confirm(
      file.shared
        ? `${file.filename} is shared with the client. Removing it takes it out of their portal too.`
        : `${file.filename} will be removed from this invoice.`,
      { title: "Remove this file?", confirmLabel: "Remove it", danger: true },
    );
    if (!ok) return;
    setProblem(null);
    try {
      await api.removeInvoiceFile(file.id);
      setFiles((fs) => fs.filter((f) => f.id !== file.id));
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : "Could not remove that.");
    }
  };

  const sharedCount = files.filter((f) => f.shared).length;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="card-title">Files</h2>
        {files.length > 0 && (
          <span className="text-xs text-slate-500">
            {sharedCount
              ? `${sharedCount} of ${files.length} shown to the client${isDraft ? " once it is issued" : ""}`
              : "None shown to the client"}
          </span>
        )}
      </div>

      {files.length === 0 ? (
        <p className="muted mt-1 text-sm">
          Receipts, timesheets and anything else that explains this bill. You choose, file by
          file, whether the client sees it.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
              <a className="link min-w-0 flex-1 break-words" href={api.invoiceFileUrl(f.id)}>
                <span aria-hidden="true">📎</span> {f.filename}
              </a>
              <span className="text-xs text-slate-500">
                {describeFileSize(f.size_bytes)} · {f.uploaded_by_name ?? "someone"}, {formatDateTime(f.uploaded_at)}
              </span>
              {canEdit ? (
                <>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={f.shared === 1}
                      onChange={(e) => void share(f, e.target.checked)}
                    />
                    Show to client
                  </label>
                  <button type="button" className="text-xs text-rose-700 hover:underline" onClick={() => void remove(f)}>
                    Remove
                  </button>
                </>
              ) : (
                f.shared === 1 && (
                  <span className="pill bg-emerald-50 text-emerald-800 ring-emerald-200">Shown to client</span>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy || files.length >= MAX_INVOICE_FILES}
            onClick={() => picker.current?.click()}
          >
            {busy ? "Attaching…" : "Attach files"}
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={shareNew} onChange={(e) => setShareNew(e.target.checked)} />
            Show new files to the client
          </label>
          <input
            ref={picker}
            type="file"
            multiple
            accept={INVOICE_FILE_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="text-xs text-slate-500">
            PDF, pictures, Word, Excel or CSV, up to {describeFileSize(10 * 1024 * 1024)} each.
          </span>
        </div>
      )}
      {problem && (
        <p className="mt-2 text-sm text-rose-700" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
