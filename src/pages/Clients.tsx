import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ClientSummary, User } from "@shared/types";
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  RISK_RATINGS,
  ROLE_LABELS,
  atLeast,
} from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Select,
  Spinner,
  TextArea,
  TextInput,
  options,
} from "../components/ui";
import { humanise } from "../lib/format";

export function Clients() {
  const { can } = useSession();
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { clients: result } = await api.clients({
        q: search || undefined,
        status: status || undefined,
      });
      setClients(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load clients.");
      setClients([]);
    }
  }, [search, status]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    void api
      .users()
      .then((res) => setUsers(res.users))
      .catch(() => setUsers([]));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-title">Clients</h1>
          <p className="muted mt-0.5">
            {clients ? `${clients.length} client(s)` : "Loading…"}
          </p>
        </div>
        {can("manager") && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            New client
          </button>
        )}
      </div>

      <div className="card grid gap-3 p-3 sm:grid-cols-3">
        <TextInput
          placeholder="Search name, code or TIN…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search clients"
        />
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Client status"
        >
          <option value="">Any status</option>
          {options(CLIENT_STATUSES, CLIENT_STATUS_LABELS)}
        </Select>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="card">
        {clients === null ? (
          <Spinner label="Loading clients" />
        ) : !clients.length ? (
          <EmptyState
            title="No clients yet"
            description="Add your first client to start scheduling deliverables."
          />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Partner</th>
                  <th>Manager</th>
                  <th>Risk</th>
                  <th>Status</th>
                  <th className="text-right">Open</th>
                  <th className="text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <td className="whitespace-nowrap font-mono text-xs">{client.code}</td>
                    <td className="min-w-48">
                      <Link to={`/clients/${client.id}`} className="link">
                        {client.name}
                      </Link>
                      {client.industry && (
                        <p className="text-xs text-slate-500">{client.industry}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {ENTITY_TYPE_LABELS[client.entity_type]}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {client.partner_name ?? <span className="text-slate-400">-</span>}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {client.manager_name ?? <span className="text-slate-400">-</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      <span
                        className={`pill ${
                          client.risk_rating === "high"
                            ? "bg-rose-50 text-rose-700 ring-rose-200"
                            : client.risk_rating === "medium"
                              ? "bg-amber-50 text-amber-800 ring-amber-200"
                              : "bg-slate-100 text-slate-600 ring-slate-200"
                        }`}
                      >
                        {humanise(client.risk_rating)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {CLIENT_STATUS_LABELS[client.status]}
                    </td>
                    <td className="text-right tabular-nums">{client.open_tasks}</td>
                    <td className="text-right tabular-nums">
                      {client.overdue_tasks > 0 ? (
                        <span className="font-semibold text-rose-700">
                          {client.overdue_tasks}
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewClientModal
        open={creating}
        users={users}
        onClose={() => setCreating(false)}
        onCreated={() => void load()}
      />
    </div>
  );
}

function NewClientModal({
  open,
  users,
  onClose,
  onCreated,
}: {
  open: boolean;
  users: User[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const blank = {
    name: "",
    code: "",
    entity_type: "company",
    tax_id: "",
    registration_no: "",
    industry: "",
    fiscal_year_end: "12-31",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    risk_rating: "medium",
    status: "active",
    partner_id: "",
    manager_id: "",
    notes: "",
  };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(blank);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const partners = users.filter((user) => atLeast(user.role, "partner"));
  const managers = users.filter((user) => atLeast(user.role, "manager"));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, value === "" ? null : value]),
      );
      await api.createClient(payload);
      onCreated();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? [err.message, err.detail].filter(Boolean).join(" ")
          : "Could not create the client.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New client"
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="new-client" className="btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create client"}
          </button>
        </>
      }
    >
      <form id="new-client" onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client name" required>
            {(id) => (
              <TextInput
                id={id}
                required
                value={form.name}
                onChange={(e) => set("name")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Client code" hint="Leave blank to generate one automatically.">
            {(id) => (
              <TextInput
                id={id}
                value={form.code}
                onChange={(e) => set("code")(e.target.value)}
                placeholder="CLI-0001"
              />
            )}
          </Field>
          <Field label="Entity type">
            {(id) => (
              <Select
                id={id}
                value={form.entity_type}
                onChange={(e) => set("entity_type")(e.target.value)}
              >
                {options(ENTITY_TYPES, ENTITY_TYPE_LABELS)}
              </Select>
            )}
          </Field>
          <Field label="Industry">
            {(id) => (
              <TextInput
                id={id}
                value={form.industry}
                onChange={(e) => set("industry")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Tax identification number">
            {(id) => (
              <TextInput
                id={id}
                value={form.tax_id}
                onChange={(e) => set("tax_id")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Registration number">
            {(id) => (
              <TextInput
                id={id}
                value={form.registration_no}
                onChange={(e) => set("registration_no")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Financial year end" hint="MM-DD, for example 12-31.">
            {(id) => (
              <TextInput
                id={id}
                value={form.fiscal_year_end}
                onChange={(e) => set("fiscal_year_end")(e.target.value)}
                placeholder="12-31"
              />
            )}
          </Field>
          <Field label="Risk rating" hint="Drives client due diligence refresh cycles.">
            {(id) => (
              <Select
                id={id}
                value={form.risk_rating}
                onChange={(e) => set("risk_rating")(e.target.value)}
              >
                {RISK_RATINGS.map((rating) => (
                  <option key={rating} value={rating}>
                    {humanise(rating)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Engagement partner">
            {(id) => (
              <Select
                id={id}
                value={form.partner_id}
                onChange={(e) => set("partner_id")(e.target.value)}
              >
                <option value="">Not assigned</option>
                {partners.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} - {ROLE_LABELS[user.role]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Client manager">
            {(id) => (
              <Select
                id={id}
                value={form.manager_id}
                onChange={(e) => set("manager_id")(e.target.value)}
              >
                <option value="">Not assigned</option>
                {managers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} - {ROLE_LABELS[user.role]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Primary contact">
            {(id) => (
              <TextInput
                id={id}
                value={form.contact_name}
                onChange={(e) => set("contact_name")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Contact email">
            {(id) => (
              <TextInput
                id={id}
                type="email"
                value={form.contact_email}
                onChange={(e) => set("contact_email")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Contact phone">
            {(id) => (
              <TextInput
                id={id}
                value={form.contact_phone}
                onChange={(e) => set("contact_phone")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select
                id={id}
                value={form.status}
                onChange={(e) => set("status")(e.target.value)}
              >
                {options(CLIENT_STATUSES, CLIENT_STATUS_LABELS)}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Notes">
          {(id) => (
            <TextArea
              id={id}
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes")(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
