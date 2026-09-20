/**
 * The tools the practice works in, and the certifications it asks people to hold.
 *
 * Maintained here rather than written into the portal. A practice picks up Odoo, drops
 * Sage, and the vendors rename their courses every couple of years - so adding one is
 * this screen, and nothing in the code knows what Xero is.
 */

import { useCallback, useEffect, useState } from "react";
import type { PracticeTool, ToolCertification } from "@shared/types";
import { COMMON_VALIDITY, describeValidity } from "@shared/certifications";
import { ApiRequestError, api } from "../lib/api";
import {
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  SuccessBanner,
  TextInput,
} from "./ui";

export function ToolCatalogueCard({ canEdit }: { canEdit: boolean }) {
  const [tools, setTools] = useState<PracticeTool[] | null>(null);
  const [certs, setCerts] = useState<ToolCertification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingTool, setEditingTool] = useState<PracticeTool | "new" | null>(null);
  const [addingTo, setAddingTo] = useState<PracticeTool | null>(null);
  const [editingCert, setEditingCert] = useState<ToolCertification | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.tools();
      setTools(result.tools);
      setCerts(result.certifications);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load the tools.");
      setTools([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!tools) return <Spinner label="Loading tools" />;

  const removeTool = async (tool: PracticeTool) => {
    const mine = certs.filter((c) => c.tool_id === tool.id);
    const warning =
      mine.length > 0
        ? `Remove ${tool.name}? Its ${mine.length} certification${mine.length === 1 ? "" : "s"} go with it, and so does everybody's progress on them.`
        : `Remove ${tool.name}?`;
    if (!window.confirm(warning)) return;
    try {
      await api.removeTool(tool.id);
      await load();
      setNotice(`${tool.name} removed.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not remove that.");
    }
  };

  const removeCert = async (cert: ToolCertification) => {
    if (!window.confirm(`Remove ${cert.name}? Everybody's progress on it goes too.`)) return;
    try {
      await api.removeCertification(cert.id);
      await load();
      setNotice(`${cert.name} removed.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not remove that.");
    }
  };

  return (
    <div className="space-y-4">
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="card-title">The tools the practice uses</h2>
            <p className="muted mt-0.5">
              Kept here rather than written into the portal, so adding one is this
              screen and nothing else.
            </p>
          </div>
          {canEdit && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditingTool("new")}>
              Add a tool
            </button>
          )}
        </div>

        {!tools.length ? (
          <EmptyState
            title="No tools yet"
            description="Add the accounting and payroll tools the practice works in. Staff logins and certifications hang off these."
          />
        ) : (
          <div className="space-y-3">
            {tools.map((tool) => {
              const mine = certs.filter((c) => c.tool_id === tool.id);
              return (
                <div key={tool.id} className="rounded-md border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{tool.name}</p>
                      <p className="muted mt-0.5">
                        {tool.category ?? "No category"}
                        {tool.sign_in_url && (
                          <>
                            {" · "}
                            <a className="link" href={tool.sign_in_url} target="_blank" rel="noreferrer">
                              {tool.sign_in_url.replace(/^https?:\/\//, "")}
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex gap-2">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingTool(tool)}>
                          Edit
                        </button>
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setAddingTo(tool)}>
                          Add a certification
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-rose-700"
                          onClick={() => void removeTool(tool)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>

                  {mine.length > 0 && (
                    <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                      {mine.map((cert) => (
                        <li key={cert.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                          <span className="min-w-0 text-sm">
                            <span className="text-slate-800 dark:text-slate-200">{cert.name}</span>
                            <span className="muted ml-2">
                              {describeValidity(cert.validity_months)}
                              {cert.requires_certificate ? " · certificate required" : ""}
                            </span>
                          </span>
                          {canEdit && (
                            <span className="flex gap-2">
                              <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingCert(cert)}>
                                Edit
                              </button>
                              <button
                                type="button"
                                className="btn-ghost btn-sm text-rose-700"
                                onClick={() => void removeCert(cert)}
                              >
                                Remove
                              </button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <ToolDialog
        tool={editingTool}
        onClose={() => setEditingTool(null)}
        onSaved={async (message) => {
          setEditingTool(null);
          await load();
          setNotice(message);
        }}
      />
      <CertificationDialog
        tool={addingTo}
        cert={editingCert}
        onClose={() => {
          setAddingTo(null);
          setEditingCert(null);
        }}
        onSaved={async (message) => {
          setAddingTo(null);
          setEditingCert(null);
          await load();
          setNotice(message);
        }}
      />
    </div>
  );
}

function ToolDialog({
  tool,
  onClose,
  onSaved,
}: {
  tool: PracticeTool | "new" | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const [form, setForm] = useState({ name: "", category: "", sign_in_url: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tool) return;
    setForm(
      tool === "new"
        ? { name: "", category: "", sign_in_url: "" }
        : {
            name: tool.name,
            category: tool.category ?? "",
            sign_in_url: tool.sign_in_url ?? "",
          },
    );
    setError(null);
  }, [tool]);

  if (!tool) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (tool === "new") await api.addTool(form);
      else await api.editTool(tool.id, form);
      await onSaved(tool === "new" ? `${form.name} added.` : `${form.name} saved.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={tool === "new" ? "Add a tool" : "Edit the tool"} onClose={onClose}>
      <div className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <Field label="Name" required>
          {(id) => (
            <TextInput
              id={id}
              value={form.name}
              placeholder="Xero"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Category" hint="In your own words: Accounting, Payroll, ERP.">
          {(id) => (
            <TextInput
              id={id}
              value={form.category}
              placeholder="Accounting"
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          )}
        </Field>
        <Field label="Where staff sign in">
          {(id) => (
            <TextInput
              id={id}
              value={form.sign_in_url}
              placeholder="https://login.xero.com"
              onChange={(e) => setForm({ ...form, sign_in_url: e.target.value })}
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy || !form.name.trim()} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CertificationDialog({
  tool,
  cert,
  onClose,
  onSaved,
}: {
  tool: PracticeTool | null;
  cert: ToolCertification | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const [form, setForm] = useState({
    name: "",
    course_url: "",
    validity: "12",
    requires_certificate: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tool && !cert) return;
    setForm(
      cert
        ? {
            name: cert.name,
            course_url: cert.course_url ?? "",
            validity: cert.validity_months ? String(cert.validity_months) : "",
            requires_certificate: cert.requires_certificate === 1,
          }
        : { name: "", course_url: "", validity: "12", requires_certificate: true },
    );
    setError(null);
  }, [tool, cert]);

  if (!tool && !cert) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      course_url: form.course_url,
      validity_months: form.validity === "" ? null : Number(form.validity),
      requires_certificate: form.requires_certificate,
    };
    try {
      if (cert) await api.editCertification(cert.id, body);
      else await api.addCertification(tool!.id, body);
      await onSaved(`${form.name} saved.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={cert ? "Edit the certification" : `Add a certification to ${tool?.name}`} onClose={onClose}>
      <div className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <Field label="Name" required>
          {(id) => (
            <TextInput
              id={id}
              value={form.name}
              placeholder="Xero Advisor Certification"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Where it is taken">
          {(id) => (
            <TextInput
              id={id}
              value={form.course_url}
              placeholder="https://central.xero.com/s/learning"
              onChange={(e) => setForm({ ...form, course_url: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Valid for"
          hint="Xero and QuickBooks both expire after a year. The portal says when somebody's is running out."
        >
          {(id) => (
            <Select
              id={id}
              value={form.validity}
              onChange={(e) => setForm({ ...form, validity: e.target.value })}
            >
              <option value="">Does not expire</option>
              {COMMON_VALIDITY.map((months) => (
                <option key={months} value={String(months)}>
                  {describeValidity(months)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.requires_certificate}
            onChange={(e) => setForm({ ...form, requires_certificate: e.target.checked })}
          />
          <span>
            <strong>A copy of the certificate is needed.</strong> Without it, marking
            the course done is refused - otherwise &ldquo;certified&rdquo; means
            &ldquo;said so&rdquo;.
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy || !form.name.trim()} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
