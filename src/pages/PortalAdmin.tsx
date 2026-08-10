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
import { deriveLightInk, whyNotDerivable } from "../lib/logo";
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
  /** The template being copied for one person, if any. */
  const [issuing, setIssuing] = useState<PortalDocument | null>(null);

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
                        {/*
                          A contract is per person, so the seeded one is a template and
                          this is how it gets used: copy it for somebody, fill in their
                          terms, publish it to them alone. Offered on contracts and
                          letters, not on handbook policies, which are one text for
                          everybody and are published as they stand.
                        */}
                        {(doc.kind === "contract" || doc.kind === "form") && (
                          <button
                            type="button"
                            className="btn-ghost btn-sm"
                            onClick={() => setIssuing(doc)}
                          >
                            Issue to someone
                          </button>
                        )}
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

      <IssueDialog
        template={issuing}
        users={users}
        onClose={() => setIssuing(null)}
        onIssued={async (message) => {
          setNotice(message);
          setIssuing(null);
          await load();
        }}
        setError={setError}
      />
    </div>
  );
}

/**
 * Copies a contract or letter for one employee.
 *
 * This is the answer to a fair question: why can an administrator not simply publish
 * the contract? Because a contract is not one document. Each employee's differs in
 * title, salary, start date and notice period, and publishing one to everybody would
 * ask each of them to sign somebody else's terms. So the seeded contract stays an
 * unpublished template and is copied per person from here. The template is never
 * altered, so it stays reusable, and each copy is its own record with its own
 * signature and its own version history.
 */
function IssueDialog({
  template,
  users,
  onClose,
  onIssued,
  setError,
}: {
  template: PortalDocument | null;
  users: User[];
  onClose: () => void;
  onIssued: (message: string) => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUserId("");
    setTitle("");
  }, [template]);

  if (!template) return null;

  const person = users.find((u) => u.id === userId);
  const suggested = person
    ? `${template.title.replace(/\s*\(template\)\s*$/i, "")} - ${person.full_name}`
    : "";

  const issue = async () => {
    if (!userId) {
      setError("Choose who this copy is for.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // An issued contract files under Contracts, not under Form / template where the
      // source lives, so it appears where anyone would look for it.
      const res = await api.copyDocumentFor(template.id, userId, title || undefined, {
        kind: template.category === "Contracts" ? "contract" : template.kind,
      });
      await onIssued(
        `Created “${res.document.title}” as a draft for ${person?.full_name ?? "them"}. Edit it, then publish it to them.`,
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not create that copy.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`Issue “${template.title}”`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void issue()}
            disabled={busy}
          >
            {busy ? "Creating…" : "Create the copy"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          This makes a <strong>draft copy</strong> for one person, addressed to them
          alone. The template is left exactly as it is, so you can issue it again to the
          next joiner. Fill in their terms in the copy, then publish it to them.
        </p>

        <Field label="Who is it for?" required>
          {(id) => (
            <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose an employee</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.email})
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Title for their copy"
          hint={
            suggested
              ? `Left blank, it will be called "${suggested}".`
              : "Left blank, their name is added to the template's title."
          }
        >
          {(id) => (
            <TextInput
              id={id}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={suggested}
            />
          )}
        </Field>

        {template.kind === "contract" && (
          <p className="hint">
            A contract copy always requires a signature, whatever the template says.
          </p>
        )}
      </div>
    </Modal>
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
  /**
   * Whether the dark-background logo currently in the form was made from the main
   * one rather than uploaded. Only used to label it honestly - nothing about it is
   * different once saved, and it can be replaced or removed like any upload.
   */
  const [madeForYou, setMadeForYou] = useState(false);

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

  const chooseFile =
    (key: "logo_data_url" | "logo_dark_data_url") => async (file: File | undefined) => {
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

      if (key === "logo_dark_data_url") {
        setMadeForYou(false);
        setSettings({ ...settings, logo_dark_data_url: dataUrl });
        return;
      }

      // A firm uploading its logo should not have to think about dark backgrounds at
      // all. Where the artwork allows it, the white version is made here and now, so
      // the common case needs one upload and shows no plate anywhere. An uploaded
      // dark version is never overwritten - only one that was made here, or none.
      const replaceable = !settings.logo_dark_data_url || madeForYou;
      if (!replaceable) {
        setSettings({ ...settings, logo_data_url: dataUrl });
        return;
      }
      try {
        const { derived } = await deriveLightInk(dataUrl);
        setMadeForYou(Boolean(derived));
        setSettings({
          ...settings,
          logo_data_url: dataUrl,
          logo_dark_data_url: derived ?? "",
        });
      } catch {
        // Nothing about this is essential; the plate is a perfectly good fallback.
        setMadeForYou(false);
        setSettings({ ...settings, logo_data_url: dataUrl });
      }
    };

  /**
   * Offered when the main logo is already saved and the dark slot is empty, which is
   * every firm that uploaded a logo before this existed.
   */
  const makeDarkVersion = async () => {
    setError(null);
    try {
      const { derived, analysis } = await deriveLightInk(settings.logo_data_url);
      if (!derived) {
        setError(whyNotDerivable(analysis));
        return;
      }
      setMadeForYou(true);
      setSettings({ ...settings, logo_dark_data_url: derived });
      setNotice("Made. Look at the preview, and press Save appearance to keep it.");
    } catch {
      setError("That logo could not be read well enough to make a white version.");
    }
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
        logo_dark_data_url: settings.logo_dark_data_url,
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
      {/*
        Two slots, because one file cannot serve both. The portal has light pages and
        dark ones - the sidebar and the sign-in panel are navy whatever the theme, and
        in dark mode everything is dark. Dark artwork is unreadable there.

        Ordinarily nobody has to think about the second slot: uploading the first fills
        it automatically with a white version of the same artwork (see lib/logo.ts),
        which is what a designer would supply. Where that cannot be done safely - a
        logo with colour in it, or a file with no transparency - the slot stays empty
        and the portal sets the dark artwork on a white plate instead. That is
        readable in every theme and shows as a box, and the preview says so rather
        than leaving it to be discovered.
      */}
      <div className="grid gap-5 sm:grid-cols-2">
        <LogoSlot
          label="Logo"
          hint="For light pages. Your normal artwork, usually dark ink."
          value={settings.logo_data_url}
          onChoose={chooseFile("logo_data_url")}
          onClear={() => {
            setMadeForYou(false);
            setSettings({
              ...settings,
              logo_data_url: "",
              // A version made from a logo that is no longer there is just confusing.
              logo_dark_data_url: madeForYou ? "" : settings.logo_dark_data_url,
            });
          }}
          surface="light"
        />
        <LogoSlot
          label="Logo for dark backgrounds"
          hint="The same logo in white, for the sidebar, the sign-in panel and dark mode."
          value={settings.logo_dark_data_url}
          onChoose={chooseFile("logo_dark_data_url")}
          onClear={() => {
            setMadeForYou(false);
            setSettings({ ...settings, logo_dark_data_url: "" });
          }}
          surface="dark"
          fallback={settings.logo_data_url}
          madeForYou={madeForYou}
          onMake={settings.logo_data_url ? makeDarkVersion : undefined}
        />
      </div>

      <p className="hint">
        <strong>Save your logo as a PNG with a transparent background.</strong> A file
        that carries its own white rectangle shows as a white block wherever the page
        behind it is not white, and the white version cannot be made from it.
        <br />
        <strong>A wide logo is fine</strong>, and usually better: the height is fixed
        and the width follows your artwork. If your logo already includes the firm's
        name, the portal stops printing the name beside it so it is not said twice.
        <br />
        Two other things worth doing to the file first:{" "}
        <strong>crop the empty space</strong> from around the artwork, since the portal
        cannot tell padding from the logo and will shrink the whole thing to fit; and
        keep it under 280 kB, because every page load carries it.
      </p>

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

/**
 * One logo upload with a preview on the surface that logo is actually for, so the
 * administrator judges it against a navy panel rather than against white.
 *
 * The dark slot also shows what happens when it is left empty: the light-page logo
 * on a white plate. That is the fallback, and seeing it is the clearest argument for
 * filling the slot.
 */
function LogoSlot({
  label,
  hint,
  value,
  onChoose,
  onClear,
  surface,
  fallback = "",
  madeForYou = false,
  onMake,
}: {
  label: string;
  hint: string;
  value: string;
  onChoose: (file: File | undefined) => void | Promise<void>;
  onClear: () => void;
  surface: "light" | "dark";
  fallback?: string;
  /** True when this slot holds a version the portal made rather than an upload. */
  madeForYou?: boolean;
  /** Offered when the slot is empty and a version could be made from the main logo. */
  onMake?: () => void | Promise<void>;
}) {
  const plated = surface === "dark" && !value && Boolean(fallback);
  const shown = value || (plated ? fallback : "");

  const image = (
    <img
      src={shown || "/icon.svg"}
      alt=""
      className={`h-9 object-contain object-left ${shown ? "w-auto max-w-[12rem]" : "aspect-square"}`}
    />
  );

  return (
    <div>
      <span className="label">{label}</span>
      <div
        className={`flex min-h-[4.5rem] items-center rounded-md px-3 py-2 ${
          surface === "dark"
            ? "bg-brand-900"
            : "bg-white ring-1 ring-slate-200"
        }`}
      >
        {plated ? (
          <span className="inline-flex items-center rounded-lg bg-white p-2 shadow-sm">
            <img src={fallback} alt="" className="h-7 w-auto max-w-[11rem] object-contain" />
          </span>
        ) : (
          image
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <label className="btn-secondary btn-sm cursor-pointer">
          {value ? "Replace" : "Choose an image"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(e) => void onChoose(e.target.files?.[0])}
          />
        </label>
        {!value && onMake && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => void onMake()}>
            Make one from my logo
          </button>
        )}
        {value && (
          <button type="button" className="btn-ghost btn-sm" onClick={onClear}>
            Remove
          </button>
        )}
      </div>
      <p className="hint">
        {hint}
        {madeForYou && (
          <>
            {" "}
            <strong>The portal made this one from your logo.</strong> Replace it if you
            have a white version of your own.
          </>
        )}
        {plated && (
          <>
            {" "}
            <strong>Empty, so your logo is being set on a white panel here</strong> to
            keep it readable in every theme. Upload a white version, or press Make one
            from my logo, and the panel disappears.
          </>
        )}
      </p>
    </div>
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
