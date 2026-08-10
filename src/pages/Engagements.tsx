import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ClientSummary, EngagementSummary, User } from "@shared/types";
import {
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_STATUS_LABELS,
  ROLE_LABELS,
  SERVICE_LINES,
  SERVICE_LINE_LABELS,
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
import { formatDate, formatHours, formatMoney } from "../lib/format";

export function Engagements() {
  const { can } = useSession();
  const [engagements, setEngagements] = useState<EngagementSummary[] | null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [filters, setFilters] = useState({ q: "", status: "", service_line: "" });
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { engagements: result } = await api.engagements({
        q: filters.q || undefined,
        status: filters.status || undefined,
        service_line: filters.service_line || undefined,
      });
      setEngagements(result);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load engagements.",
      );
      setEngagements([]);
    }
  }, [filters]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    void Promise.all([api.clients(), api.users()])
      .then(([clientRes, userRes]) => {
        setClients(clientRes.clients);
        setUsers(userRes.users);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-title">Engagements</h1>
          <p className="muted mt-0.5">
            Signed pieces of work that group deliverables, fees and budgets.
          </p>
        </div>
        {can("manager") && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            New engagement
          </button>
        )}
      </div>

      <div className="card grid gap-3 p-3 sm:grid-cols-3">
        <TextInput
          placeholder="Search engagement or client…"
          value={filters.q}
          onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          aria-label="Search engagements"
        />
        <Select
          value={filters.status}
          onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          aria-label="Engagement status"
        >
          <option value="">Any status</option>
          {options(ENGAGEMENT_STATUSES, ENGAGEMENT_STATUS_LABELS)}
        </Select>
        <Select
          value={filters.service_line}
          onChange={(event) => setFilters({ ...filters, service_line: event.target.value })}
          aria-label="Service line"
        >
          <option value="">Any service line</option>
          {options(SERVICE_LINES, SERVICE_LINE_LABELS)}
        </Select>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="card">
        {engagements === null ? (
          <Spinner label="Loading engagements" />
        ) : !engagements.length ? (
          <EmptyState
            title="No engagements match"
            description="Create an engagement to group a client's deliverables under one letter and fee."
          />
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Client</th>
                  <th>Engagement</th>
                  <th>Service line</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="text-right">Fee</th>
                  <th className="text-right">Hours</th>
                  <th className="text-right">Open jobs</th>
                </tr>
              </thead>
              <tbody>
                {engagements.map((engagement) => (
                  <tr key={engagement.id}>
                    <td className="whitespace-nowrap font-mono text-xs">
                      {engagement.code}
                    </td>
                    <td className="whitespace-nowrap">
                      <Link to={`/clients/${engagement.client_id}`} className="link">
                        {engagement.client_name}
                      </Link>
                    </td>
                    <td className="min-w-48">{engagement.name}</td>
                    <td className="whitespace-nowrap text-xs">
                      {SERVICE_LINE_LABELS[engagement.service_line]}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {engagement.period_label ??
                        `${formatDate(engagement.period_start)} – ${formatDate(
                          engagement.period_end,
                        )}`}
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {ENGAGEMENT_STATUS_LABELS[engagement.status]}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {formatMoney(engagement.fee_amount, engagement.currency)}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {formatHours(engagement.logged_hours)}
                      {engagement.budget_hours ? (
                        <span className="text-slate-400">
                          {" "}
                          / {formatHours(engagement.budget_hours)}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">{engagement.open_tasks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NewEngagementModal
        open={creating}
        clients={clients}
        users={users}
        onClose={() => setCreating(false)}
        onCreated={() => void load()}
      />
    </div>
  );
}

function NewEngagementModal({
  open,
  clients,
  users,
  onClose,
  onCreated,
}: {
  open: boolean;
  clients: ClientSummary[];
  users: User[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const blank = {
    client_id: "",
    name: "",
    service_line: "tax_compliance",
    period_label: "",
    period_start: "",
    period_end: "",
    fee_amount: "",
    currency: "GHS",
    budget_hours: "",
    status: "planned",
    partner_id: "",
    manager_id: "",
    engagement_letter_ref: "",
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createEngagement({
        ...form,
        period_label: form.period_label || null,
        period_start: form.period_start || null,
        period_end: form.period_end || null,
        fee_amount: form.fee_amount || null,
        budget_hours: form.budget_hours || null,
        partner_id: form.partner_id || null,
        manager_id: form.manager_id || null,
        engagement_letter_ref: form.engagement_letter_ref || null,
        notes: form.notes || null,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? [err.message, err.detail].filter(Boolean).join(" ")
          : "Could not create the engagement.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New engagement"
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="new-engagement"
            className="btn-primary"
            disabled={busy}
          >
            {busy ? "Creating…" : "Create engagement"}
          </button>
        </>
      }
    >
      <form id="new-engagement" onSubmit={submit} className="space-y-4">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" required>
            {(id) => (
              <Select
                id={id}
                required
                value={form.client_id}
                onChange={(e) => set("client_id")(e.target.value)}
              >
                <option value="">Select a client…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.code} - {client.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Engagement name" required>
            {(id) => (
              <TextInput
                id={id}
                required
                value={form.name}
                onChange={(e) => set("name")(e.target.value)}
                placeholder="Statutory audit FY2026"
              />
            )}
          </Field>
          <Field label="Service line" required>
            {(id) => (
              <Select
                id={id}
                value={form.service_line}
                onChange={(e) => set("service_line")(e.target.value)}
              >
                {options(SERVICE_LINES, SERVICE_LINE_LABELS)}
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select
                id={id}
                value={form.status}
                onChange={(e) => set("status")(e.target.value)}
              >
                {options(ENGAGEMENT_STATUSES, ENGAGEMENT_STATUS_LABELS)}
              </Select>
            )}
          </Field>
          <Field label="Period label" hint="e.g. FY2026">
            {(id) => (
              <TextInput
                id={id}
                value={form.period_label}
                onChange={(e) => set("period_label")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Engagement letter reference">
            {(id) => (
              <TextInput
                id={id}
                value={form.engagement_letter_ref}
                onChange={(e) => set("engagement_letter_ref")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Period start">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={form.period_start}
                onChange={(e) => set("period_start")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Period end">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={form.period_end}
                onChange={(e) => set("period_end")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Fee">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min="0"
                step="1"
                value={form.fee_amount}
                onChange={(e) => set("fee_amount")(e.target.value)}
              />
            )}
          </Field>
          <Field label="Currency" hint="Three-letter code.">
            {(id) => (
              <TextInput
                id={id}
                maxLength={3}
                value={form.currency}
                onChange={(e) => set("currency")(e.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field label="Budget hours">
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min="0"
                step="1"
                value={form.budget_hours}
                onChange={(e) => set("budget_hours")(e.target.value)}
              />
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
                {users
                  .filter((user) => atLeast(user.role, "partner"))
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name} - {ROLE_LABELS[user.role]}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Manager">
            {(id) => (
              <Select
                id={id}
                value={form.manager_id}
                onChange={(e) => set("manager_id")(e.target.value)}
              >
                <option value="">Not assigned</option>
                {users
                  .filter((user) => atLeast(user.role, "manager"))
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name} - {ROLE_LABELS[user.role]}
                    </option>
                  ))}
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
