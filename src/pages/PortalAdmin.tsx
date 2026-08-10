import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FirmSettings, PortalDocument, User } from "@shared/types";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_STYLES,
  type DocumentKind,
} from "@shared/hr";
import { ApiRequestError, api } from "../lib/api";
import { applyBranding, isHexColour } from "../lib/branding";
import { useFirm } from "../lib/firm";
import { Markdown } from "../components/Markdown";
import {
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  SuccessBanner,
  TextArea,
  TextInput,
  options,
} from "../components/ui";
import { formatDate } from "../lib/format";

type Tab = "documents" | "welcome" | "appearance";

/** Authoring surface for the handbook, contracts and the welcome message. */
export function PortalAdmin() {
  const [tab, setTab] = useState<Tab>("documents");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">Portal administration</h1>
        <p className="muted mt-0.5">
          The handbook, contracts, the welcome message new joiners see first, and how
          the portal looks.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["documents", "Documents and handbook"],
            ["welcome", "Welcome message and firm details"],
            ["appearance", "Logo and colours"],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-brand-600 text-link"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {tab === "documents" ? (
        <DocumentsAdmin setError={setError} setNotice={setNotice} />
      ) : tab === "appearance" ? (
        <AppearanceAdmin setError={setError} setNotice={setNotice} />
      ) : (
        <WelcomeAdmin setError={setError} setNotice={setNotice} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DocumentsAdmin({
  setError,
  setNotice,
}: {
  setError: (m: string | null) => void;
  setNotice: (m: string | null) => void;
}) {
  const [documents, setDocuments] = useState<PortalDocument[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [editing, setEditing] = useState<PortalDocument | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.documents({});
      setDocuments(res.documents);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load documents.");
      setDocuments([]);
    }
  }, [setError]);

  useEffect(() => {
    void load();
    void api
      .users()
      .then((res) => setUsers(res.users))
      .catch(() => setUsers([]));
  }, [load]);

  const setStatus = async (
    doc: PortalDocument,
    status: "draft" | "published" | "archived",
  ) => {
    setError(null);
    try {
      await api.setDocumentStatus(doc.id, status);
      setNotice(
        status === "published"
          ? `“${doc.title}” is published. Staff have been notified where a response is needed.`
          : `“${doc.title}” is now ${status}.`,
      );
      await load();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not change the status.",
      );
    }
  };

  if (documents === null) return <Spinner label="Loading documents" />;

  const byKind = DOCUMENT_KINDS.map((kind) => ({
    kind,
    docs: documents.filter((doc) => doc.kind === kind),
  })).filter((group) => group.docs.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="muted">
          {documents.filter((d) => d.status === "draft").length} draft(s) ·{" "}
          {documents.filter((d) => d.status === "published").length} published
        </p>
        <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
          New document
        </button>
      </div>

      {!documents.length ? (
        <div className="card">
          <EmptyState title="No documents yet" />
        </div>
      ) : (
        byKind.map(({ kind, docs }) => (
          <section key={kind} className="card">
            <div className="card-header">
              <h2 className="card-title">{DOCUMENT_KIND_LABELS[kind]}s</h2>
              <span className="muted">{docs.length}</span>
            </div>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Audience</th>
                    <th>Response</th>
                    <th>Status</th>
                    <th>Version</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr key={doc.id}>
                      <td className="min-w-48">
                        <Link to={`/documents/${doc.id}`} className="link">
                          {doc.title}
                        </Link>
                        {doc.summary && (
                          <p className="text-xs text-slate-500">{doc.summary}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {doc.category ?? "-"}
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {doc.audience === "all"
                          ? "Everyone"
                          : (doc.assigned_user_name ?? "One employee")}
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {doc.requires_signature
                          ? "Signature"
                          : doc.requires_acknowledgement
                            ? "Acknowledgement"
                            : "None"}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={`pill ${DOCUMENT_STATUS_STYLES[doc.status]}`}>
                          {DOCUMENT_STATUS_LABELS[doc.status]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap text-center tabular-nums text-xs">
                        {doc.version}
                        {doc.published_at && (
                          <p className="text-slate-400">
                            {formatDate(doc.published_at)}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setEditing(doc)}
                        >
                          Edit
                        </button>
                        {doc.status !== "published" ? (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => void setStatus(doc, "published")}
                          >
                            Publish
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => void setStatus(doc, "archived")}
                          >
                            Archive
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <DocumentEditor
        target={editing}
        users={users}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setNotice(message);
          setEditing(null);
          await load();
        }}
        setError={setError}
      />
    </div>
  );
}

function DocumentEditor({
  target,
  users,
  onClose,
  onSaved,
  setError,
}: {
  target: PortalDocument | "new" | null;
  users: User[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const [form, setForm] = useState({
    kind: "policy" as DocumentKind,
    category: "",
    title: "",
    summary: "",
    body: "",
    audience: "all",
    assigned_user_id: "",
    requires_signature: false,
    requires_acknowledgement: true,
    effective_from: "",
  });
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingBody, setLoadingBody] = useState(false);

  // Load the existing text - list responses deliberately omit document bodies.
  useEffect(() => {
    if (!target) return;
    if (target === "new") {
      setForm({
        kind: "policy",
        category: "",
        title: "",
        summary: "",
        body: "",
        audience: "all",
        assigned_user_id: "",
        requires_signature: false,
        requires_acknowledgement: true,
        effective_from: "",
      });
      setPreview(false);
      return;
    }
    setLoadingBody(true);
    void api
      .document(target.id)
      .then((res) => {
        setForm({
          kind: res.document.kind,
          category: res.document.category ?? "",
          title: res.document.title,
          summary: res.document.summary ?? "",
          body: res.document.body,
          audience: res.document.audience,
          assigned_user_id: res.document.assigned_user_id ?? "",
          requires_signature: res.document.requires_signature === 1,
          requires_acknowledgement: res.document.requires_acknowledgement === 1,
          effective_from: res.document.effective_from ?? "",
        });
      })
      .catch((err) =>
        setError(
          err instanceof ApiRequestError ? err.message : "Could not load the document.",
        ),
      )
      .finally(() => setLoadingBody(false));
  }, [target, setError]);

  if (!target) return null;
  const isNew = target === "new";
  const isPublished = !isNew && target.status === "published";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        kind: form.kind,
        category: form.category || null,
        title: form.title,
        summary: form.summary || null,
        body: form.body,
        audience: form.audience,
        assigned_user_id: form.audience === "individual" ? form.assigned_user_id : null,
        requires_signature: form.requires_signature,
        requires_acknowledgement: form.requires_acknowledgement,
        effective_from: form.effective_from || null,
      };
      if (isNew) {
        await api.createDocument(payload);
        await onSaved("Document created as a draft. Publish it when it is ready.");
      } else {
        await api.updateDocument(target.id, payload);
        await onSaved(
          isPublished
            ? "Document amended. Its version has been raised, so staff will be asked to acknowledge it again."
            : "Draft saved.",
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? [err.message, err.detail].filter(Boolean).join(" ")
          : "Could not save the document.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? "New document" : `Edit: ${target.title}`}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="doc-form" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : isNew ? "Create draft" : "Save"}
          </button>
        </>
      }
    >
      {loadingBody ? (
        <Spinner label="Loading document" />
      ) : (
        <form id="doc-form" onSubmit={submit} className="space-y-4">
          {isPublished && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
              This document is published. Changing its text raises the version and asks
              everyone to acknowledge it again. Existing signatures are kept as a record of
              the earlier version.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Kind" required>
              {(id) => (
                <Select
                  id={id}
                  value={form.kind}
                  onChange={(e) =>
                    setForm({ ...form, kind: e.target.value as DocumentKind })
                  }
                >
                  {options(DOCUMENT_KINDS, DOCUMENT_KIND_LABELS)}
                </Select>
              )}
            </Field>
            <Field label="Category" hint="Groups policies in the handbook.">
              {(id) => (
                <TextInput
                  id={id}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Professional conduct"
                />
              )}
            </Field>
            <Field label="Effective from">
              {(id) => (
                <TextInput
                  id={id}
                  type="date"
                  value={form.effective_from}
                  onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
                />
              )}
            </Field>
          </div>

          <Field label="Title" required>
            {(id) => (
              <TextInput
                id={id}
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            )}
          </Field>

          <Field label="Summary" hint="One line, shown in the handbook listing.">
            {(id) => (
              <TextInput
                id={id}
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Audience" required>
              {(id) => (
                <Select
                  id={id}
                  value={form.audience}
                  onChange={(e) => setForm({ ...form, audience: e.target.value })}
                >
                  <option value="all">Everyone at the firm</option>
                  <option value="individual">One named employee</option>
                </Select>
              )}
            </Field>
            {form.audience === "individual" && (
              <Field label="Employee" required>
                {(id) => (
                  <Select
                    id={id}
                    required
                    value={form.assigned_user_id}
                    onChange={(e) =>
                      setForm({ ...form, assigned_user_id: e.target.value })
                    }
                  >
                    <option value="">Select an employee…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="label">Response required</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="response"
                checked={form.requires_signature}
                onChange={() =>
                  setForm({
                    ...form,
                    requires_signature: true,
                    requires_acknowledgement: false,
                  })
                }
                className="h-4 w-4 border-slate-300 text-link"
              />
              Signature - for contracts and binding terms
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="response"
                checked={form.requires_acknowledgement && !form.requires_signature}
                onChange={() =>
                  setForm({
                    ...form,
                    requires_signature: false,
                    requires_acknowledgement: true,
                  })
                }
                className="h-4 w-4 border-slate-300 text-link"
              />
              Acknowledgement - for handbook policies
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="response"
                checked={!form.requires_signature && !form.requires_acknowledgement}
                onChange={() =>
                  setForm({
                    ...form,
                    requires_signature: false,
                    requires_acknowledgement: false,
                  })
                }
                className="h-4 w-4 border-slate-300 text-link"
              />
              None - reference only
            </label>
          </fieldset>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label mb-0">Body (markdown)</span>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setPreview((open) => !open)}
              >
                {preview ? "Edit" : "Preview"}
              </button>
            </div>
            {preview ? (
              <div className="max-h-80 overflow-y-auto rounded-md bg-panel px-4 py-3 ring-1 ring-inset ring-slate-300">
                <Markdown>{form.body || "_Nothing to preview yet._"}</Markdown>
              </div>
            ) : (
              <TextArea
                rows={16}
                required
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="font-mono text-xs"
                placeholder={"## Section heading\n\nParagraph text.\n\n- A bullet\n- Another bullet"}
              />
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function WelcomeAdmin({
  setError,
  setNotice,
}: {
  setError: (m: string | null) => void;
  setNotice: (m: string | null) => void;
}) {
  const [settings, setSettings] = useState<FirmSettings | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .settings()
      .then((res) => setSettings(res.settings))
      .catch((err) =>
        setError(
          err instanceof ApiRequestError ? err.message : "Could not load settings.",
        ),
      );
  }, [setError]);

  if (!settings) return <Spinner label="Loading settings" />;

  const set = (key: keyof FirmSettings) => (value: string) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <form
      className="card space-y-5 p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const res = await api.updateSettings(settings);
          setSettings(res.settings);
          setNotice("Saved. New joiners will see this on their onboarding page.");
        } catch (err) {
          setError(
            err instanceof ApiRequestError ? err.message : "Could not save the settings.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Firm name">
          {(id) => (
            <TextInput
              id={id}
              value={settings.firm_name}
              onChange={(e) => set("firm_name")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Firm website">
          {(id) => (
            <TextInput
              id={id}
              value={settings.firm_website}
              onChange={(e) => set("firm_website")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Managing Director name" hint="Signed at the foot of the welcome.">
          {(id) => (
            <TextInput
              id={id}
              value={settings.md_name}
              onChange={(e) => set("md_name")(e.target.value)}
              placeholder="Your name"
            />
          )}
        </Field>
        <Field label="Title">
          {(id) => (
            <TextInput
              id={id}
              value={settings.md_title}
              onChange={(e) => set("md_title")(e.target.value)}
            />
          )}
        </Field>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label mb-0">Welcome message (markdown)</span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setPreview((open) => !open)}
          >
            {preview ? "Edit" : "Preview"}
          </button>
        </div>
        {preview ? (
          <div className="rounded-md bg-panel px-4 py-3 ring-1 ring-inset ring-slate-300">
            <Markdown>{settings.welcome_message || "_Nothing to preview yet._"}</Markdown>
          </div>
        ) : (
          <TextArea
            rows={16}
            value={settings.welcome_message}
            onChange={(e) => set("welcome_message")(e.target.value)}
            className="text-sm"
          />
        )}
        <p className="hint">
          This is the first thing a new joiner reads. Write it in your own voice - a
          seeded draft is provided, but it will read better rewritten.
        </p>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

/** Largest logo accepted, before base64 encoding inflates it by about a third. */
const MAX_LOGO_BYTES = 280 * 1024;

/**
 * The firm's logo and its two colours.
 *
 * Changes preview live - the whole interface recolours as the pickers move - so
 * the choice is made against the real thing rather than a swatch. Nothing is
 * stored until Save, and leaving without saving restores what was there.
 */
function AppearanceAdmin({
  setError,
  setNotice,
}: {
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
}) {
  const { refresh } = useFirm();
  const [settings, setSettings] = useState<FirmSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((res) => setSettings(res.settings))
      .catch((err) =>
        setError(
          err instanceof ApiRequestError ? err.message : "Could not load settings.",
        ),
      );
  }, [setError]);

  // Whatever was previewed but not saved is discarded on the way out.
  useEffect(() => () => void refresh(), [refresh]);

  if (!settings) return <Spinner label="Loading appearance" />;

  const preview = (next: FirmSettings) => {
    setSettings(next);
    applyBranding(next);
  };

  const pickColour = (key: "primary_color" | "secondary_color") => (value: string) =>
    preview({ ...settings, [key]: value });

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That is not an image. Choose a PNG, JPEG, SVG or WebP file.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(
        `That image is ${Math.round(file.size / 1024)} kB. Please use one under ${Math.round(
          MAX_LOGO_BYTES / 1024,
        )} kB - a logo does not need to be large, and every page load carries it.`,
      );
      return;
    }
    setError(null);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("The file could not be read."));
      reader.readAsDataURL(file);
    });
    setSettings({ ...settings, logo_data_url: dataUrl });
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    for (const key of ["primary_color", "secondary_color"] as const) {
      if (settings[key] && !isHexColour(settings[key])) {
        setError("Colours must look like #1a2b3c.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateSettings({
        logo_data_url: settings.logo_data_url,
        primary_color: settings.primary_color,
        secondary_color: settings.secondary_color,
      });
      setSettings(res.settings);
      await refresh();
      setNotice("Saved. Everyone sees this the next time they load the portal.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save the appearance.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card space-y-6 p-5" onSubmit={save}>
      <div>
        <span className="label">Logo</span>
        <div className="flex flex-wrap items-center gap-4">
          <img
            src={settings.logo_data_url || "/icon.svg"}
            alt=""
            className="h-16 w-16 rounded-md bg-slate-100 object-contain p-1 ring-1 ring-slate-200"
          />
          <div className="flex flex-wrap gap-2">
            <label className="btn-secondary btn-sm cursor-pointer">
              Choose an image
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => void chooseFile(e.target.files?.[0])}
              />
            </label>
            {settings.logo_data_url && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setSettings({ ...settings, logo_data_url: "" })}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <p className="hint">
          Shown beside the firm name in the sidebar and on the sign-in screen. A square
          image works best. Keep it under 280 kB - it is not a photograph, and every
          page load carries it.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ColourField
          label="Primary colour"
          hint="Buttons, links, the sidebar and anything the eye should go to first."
          value={settings.primary_color}
          onChange={pickColour("primary_color")}
        />
        <ColourField
          label="Secondary colour"
          hint="Progress bars and supporting highlights. Choose something that sits beside the primary rather than competing with it."
          value={settings.secondary_color}
          onChange={pickColour("secondary_color")}
        />
      </div>

      <div className="rounded-md bg-slate-100 p-4">
        <p className="label">Preview</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary btn-sm">
            Primary action
          </button>
          <button type="button" className="btn-secondary btn-sm">
            Secondary
          </button>
          <span className="pill bg-brand-50 text-link ring-brand-200">Status</span>
          <span className="pill bg-accent-50 text-accent-800 ring-accent-200">
            Secondary
          </span>
          <a href="#preview" className="link text-sm" onClick={(e) => e.preventDefault()}>
            A link
          </a>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full w-2/3 rounded-full bg-accent-500" />
        </div>
        <p className="hint mt-2">
          The rest of the portal has already changed too - look at the sidebar. Nothing
          is saved until you press Save, and leaving this page undoes it.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save appearance"}
        </button>
      </div>
    </form>
  );
}

/** A colour picker with the hex value beside it, because both are useful. */
function ColourField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="color"
            value={isHexColour(value) ? value : "#255291"}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-12 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label={label}
          />
          <TextInput
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#255291"
            spellCheck={false}
          />
        </div>
      )}
    </Field>
  );
}
