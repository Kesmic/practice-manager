import { useEffect, useState } from "react";
import type { ClientFile, FileKind } from "@shared/files";
import {
  FILE_CATEGORY_SUGGESTIONS,
  FILE_KINDS,
  FILE_KIND_LABELS,
  FILE_LIMITS,
  FILE_PROVIDER_LABELS,
  FILE_PROVIDER_STYLES,
  checkFileUrl,
  groupClientFiles,
  providerFromUrl,
} from "@shared/files";
import type { EngagementSummary } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { formatDate } from "../lib/format";
import { EmptyState, Field, Modal, Select, TextArea, TextInput } from "./ui";

/**
 * The client file: where this client's documents are, rather than the documents.
 *
 * The firm keeps its working papers in SharePoint, and that is the right place for
 * them: the retention rules, the version history and the permissions are already
 * decided there. What was missing was the index. Which folder is this client's? Where
 * is last year's computation? This answers that, and hands the person a link.
 *
 * Two things it deliberately does not do, both signposted in the interface because a
 * silent version of either would mislead somebody:
 *
 * - It does not check that a link still works. If a document moves, the portal will
 *   not know until a person clicks and finds out.
 * - It does not grant access to anything. Following a link means signing in to
 *   Microsoft or Google as yourself, with whatever the firm gave you there.
 */
export function ClientFileCard({
  clientId,
  files,
  engagements,
  onChanged,
  setError,
}: {
  clientId: string;
  files: ClientFile[];
  engagements: EngagementSummary[];
  onChanged: () => Promise<void> | void;
  setError: (message: string | null) => void;
}) {
  const { can } = useSession();
  const [editing, setEditing] = useState<ClientFile | "new" | null>(null);
  const [removing, setRemoving] = useState<ClientFile | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = groupClientFiles(files);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await api.removeClientFile(removing.id);
      setRemoving(null);
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not remove that entry.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header flex-wrap gap-2">
        <div>
          <h2 className="card-title">Client file</h2>
          <p className="hint mt-0.5">
            Links to this client's folders and documents, wherever your firm keeps them.
            Nothing is stored in the portal.
          </p>
        </div>
        <button type="button" className="btn-primary btn-sm" onClick={() => setEditing("new")}>
          Add a link
        </button>
      </div>

      {!files.length ? (
        <EmptyState
          title="Nothing filed yet"
          description="Add the client's SharePoint folder first, then individual documents as you produce them. The portal keeps the index; your document store keeps the documents."
        />
      ) : (
        <div className="divide-y divide-slate-100">
          {groups.map((group) => (
            <div key={group.heading} className="px-4 py-3 sm:px-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {group.heading}
              </p>
              <ul className="mt-2 space-y-2">
                {group.files.map((file) => (
                  <li key={file.id} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <a
                        href={file.url}
                        target="_blank"
                        // noreferrer as well as noopener: the link leaves the firm's
                        // systems, and the referrer would carry the portal's address.
                        rel="noreferrer"
                        className="link break-words font-medium"
                      >
                        {file.kind === "folder" ? "📁 " : ""}
                        {file.title}
                      </a>
                      <p className="text-xs text-slate-500">
                        <span className={`pill mr-1.5 ${FILE_PROVIDER_STYLES[file.provider]}`}>
                          {FILE_PROVIDER_LABELS[file.provider]}
                        </span>
                        {file.period_label && <span className="mr-1.5">{file.period_label}</span>}
                        {file.engagement_name && (
                          <span className="mr-1.5">{file.engagement_name}</span>
                        )}
                        <span className="text-slate-400">
                          added {formatDate(file.created_at)}
                          {file.added_by_name ? ` by ${file.added_by_name}` : ""}
                        </span>
                      </p>
                      {file.notes && (
                        <p className="mt-0.5 text-xs text-slate-600">{file.notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => setEditing(file)}
                      >
                        Edit
                      </button>
                      {can("manager") && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setRemoving(file)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <FileEditor
        clientId={clientId}
        target={editing}
        engagements={engagements}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await onChanged();
        }}
        setError={setError}
      />

      <Modal
        open={removing !== null}
        title="Remove this link?"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRemoving(null)}>
              Keep it
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => void remove()}
              disabled={busy}
            >
              Remove the link
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          This removes <strong>the link</strong> from the client file. It does not delete
          anything in SharePoint, OneDrive or Google Drive, and nobody's access changes.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Worth doing when a document has genuinely moved. A client file with things
          quietly missing from it is worse than one with something stale in it, which is
          why this needs Manager grade.
        </p>
      </Modal>
    </section>
  );
}

interface FormState {
  kind: FileKind;
  title: string;
  url: string;
  category: string;
  period_label: string;
  notes: string;
  engagement_id: string;
}

const EMPTY: FormState = {
  kind: "document",
  title: "",
  url: "",
  category: "",
  period_label: "",
  notes: "",
  engagement_id: "",
};

function FileEditor({
  clientId,
  target,
  engagements,
  onClose,
  onSaved,
  setError,
}: {
  clientId: string;
  target: ClientFile | "new" | null;
  engagements: EngagementSummary[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [urlProblem, setUrlProblem] = useState<string | null>(null);

  useEffect(() => {
    if (target === "new" || target === null) {
      setForm(EMPTY);
    } else {
      setForm({
        kind: target.kind,
        title: target.title,
        url: target.url,
        category: target.category ?? "",
        period_label: target.period_label ?? "",
        notes: target.notes ?? "",
        engagement_id: target.engagement_id ?? "",
      });
    }
    setUrlProblem(null);
  }, [target]);

  if (target === null) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Checked as it is typed, using the same function the server uses, so the message is
  // the same in both places and nobody fills in the rest of the form for nothing.
  const onUrlChange = (value: string) => {
    set("url", value);
    if (!value.trim()) {
      setUrlProblem(null);
      return;
    }
    const check = checkFileUrl(value);
    setUrlProblem(check.ok ? null : check.reason);
  };

  const detected = form.url.trim() ? providerFromUrl(form.url) : null;

  const save = async () => {
    const check = checkFileUrl(form.url);
    if (!check.ok) {
      setUrlProblem(check.reason);
      return;
    }
    if (!form.title.trim()) {
      setError("Give it a title, so colleagues know what they are opening.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        kind: form.kind,
        title: form.title.trim(),
        url: form.url.trim(),
        category: form.category.trim() || null,
        period_label: form.period_label.trim() || null,
        notes: form.notes.trim() || null,
        engagement_id: form.engagement_id || null,
      };
      if (target === "new") await api.addClientFile(clientId, payload);
      else await api.updateClientFile(target.id, payload);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save that link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={target === "new" ? "Add a link to the client file" : "Edit this link"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void save()}
            disabled={busy || Boolean(urlProblem)}
          >
            {busy ? "Saving…" : target === "new" ? "Add it" : "Save"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Link"
          required
          hint="In SharePoint, open the folder or document, press Share or Copy link, and paste it here. Use a link your colleagues can already open."
        >
          {(id) => (
            <>
              <TextInput
                id={id}
                value={form.url}
                maxLength={FILE_LIMITS.url}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="https://kesmic.sharepoint.com/sites/Clients/..."
              />
              {urlProblem ? (
                <p className="mt-1 text-xs text-rose-700">{urlProblem}</p>
              ) : (
                detected && (
                  <p className="mt-1 text-xs text-slate-500">
                    Recognised as <strong>{FILE_PROVIDER_LABELS[detected]}</strong>.
                    {detected === "other" &&
                      " That is fine, it just will not be labelled as one of the three."}
                  </p>
                )
              )}
            </>
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What is it?" required>
            {(id) => (
              <Select
                id={id}
                value={form.kind}
                onChange={(e) => set("kind", e.target.value as FileKind)}
              >
                {FILE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {FILE_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Period" hint="Optional. 2025, or Year ended 31 Dec 2025.">
            {(id) => (
              <TextInput
                id={id}
                value={form.period_label}
                maxLength={FILE_LIMITS.period_label}
                onChange={(e) => set("period_label", e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Title"
          required
          hint="What a colleague needs to recognise it. Not the file name if the file name is unhelpful."
        >
          {(id) => (
            <TextInput
              id={id}
              value={form.title}
              maxLength={FILE_LIMITS.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder={
                form.kind === "folder" ? "Client folder" : "Corporate tax computation"
              }
            />
          )}
        </Field>

        <Field
          label="Filed under"
          hint="Groups it on the client file. Type your own, or pick one of these."
        >
          {(id) => (
            <>
              <TextInput
                id={id}
                value={form.category}
                maxLength={FILE_LIMITS.category}
                list="client-file-categories"
                onChange={(e) => set("category", e.target.value)}
              />
              <datalist id="client-file-categories">
                {FILE_CATEGORY_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </>
          )}
        </Field>

        {engagements.length > 0 && (
          <Field
            label="Belongs to an engagement"
            hint="Optional. Use it when the document is part of one piece of business rather than the client's file as a whole."
          >
            {(id) => (
              <Select
                id={id}
                value={form.engagement_id}
                onChange={(e) => set("engagement_id", e.target.value)}
              >
                <option value="">The client generally</option>
                {engagements.map((engagement) => (
                  <option key={engagement.id} value={engagement.id}>
                    {engagement.code} · {engagement.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field label="Note" hint="Optional. Anything a colleague opening this should know.">
          {(id) => (
            <TextArea
              id={id}
              rows={2}
              value={form.notes}
              maxLength={FILE_LIMITS.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          )}
        </Field>

        <p className="hint">
          The portal stores the link and nothing else. It does not copy the document, it
          cannot check the link still works, and it grants nobody access: whoever clicks
          it signs in to SharePoint as themselves.
        </p>
      </div>
    </Modal>
  );
}
