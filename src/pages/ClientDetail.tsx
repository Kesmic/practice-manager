import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ClientSummary,
  EngagementSummary,
  TaskSummary,
  TaskTemplate,
  User,
} from "@shared/types";
import {
  CLIENT_STATUS_LABELS,
  ENGAGEMENT_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  SERVICE_LINE_LABELS,
} from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { NewTaskModal } from "../components/NewTaskModal";
import { TaskTable } from "../components/TaskTable";
import {
  DetailRow,
  EmptyState,
  ErrorBanner,
  Spinner,
  StatTile,
} from "../components/ui";
import { formatDate, formatHours, formatMoney, humanise } from "../lib/format";

export function ClientDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();

  const [client, setClient] = useState<ClientSummary | null>(null);
  const [engagements, setEngagements] = useState<EngagementSummary[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.client(id);
      setClient(result.client);
      setEngagements(result.engagements);
      setTasks(result.tasks);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load the client.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void Promise.all([api.users(), api.templates()])
      .then(([userRes, templateRes]) => {
        setUsers(userRes.users);
        setTemplates(templateRes.templates);
      })
      .catch(() => undefined);
  }, []);

  if (error && !client) return <ErrorBanner error={error} />;
  if (!client) return <Spinner label="Loading client" />;

  const openTasks = tasks.filter(
    (task) => task.status !== "closed" && task.status !== "cancelled",
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-slate-500">{client.code}</p>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900">
            {client.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
              {ENTITY_TYPE_LABELS[client.entity_type]}
            </span>
            <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
              {CLIENT_STATUS_LABELS[client.status]}
            </span>
            <span
              className={`pill ${
                client.risk_rating === "high"
                  ? "bg-rose-50 text-rose-700 ring-rose-200"
                  : client.risk_rating === "medium"
                    ? "bg-amber-50 text-amber-800 ring-amber-200"
                    : "bg-slate-100 text-slate-600 ring-slate-200"
              }`}
            >
              {humanise(client.risk_rating)} risk
            </span>
          </div>
        </div>
        {can("senior_associate") && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            New deliverable
          </button>
        )}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Open deliverables" value={openTasks.length} />
        <StatTile
          label="Overdue"
          value={client.overdue_tasks}
          tone={client.overdue_tasks ? "danger" : "good"}
        />
        <StatTile label="Engagements" value={engagements.length} />
        <StatTile
          label="Hours logged"
          value={formatHours(tasks.reduce((sum, task) => sum + (task.logged_hours ?? 0), 0))}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Deliverables</h2>
              <span className="muted">{tasks.length} on file</span>
            </div>
            <TaskTable
              tasks={tasks}
              columns={[
                "ref",
                "title",
                "service",
                "status",
                "assignee",
                "reviewer",
                "due",
                "progress",
              ]}
              emptyTitle="No deliverables for this client yet"
              emptyDescription="Create one, or generate a filing calendar from a job template."
            />
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Engagements</h2>
            </div>
            {!engagements.length ? (
              <EmptyState
                title="No engagements recorded"
                description="Engagements group deliverables under a signed letter and a fee."
              />
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Engagement</th>
                      <th>Service line</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th className="text-right">Fee</th>
                      <th className="text-right">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {engagements.map((engagement) => (
                      <tr key={engagement.id}>
                        <td className="whitespace-nowrap font-mono text-xs">
                          {engagement.code}
                        </td>
                        <td>{engagement.name}</td>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <div className="card p-4">
            <h2 className="card-title mb-2">Client details</h2>
            <dl className="divide-y divide-slate-100">
              <DetailRow label="Engagement partner">
                {client.partner_name ?? "—"}
              </DetailRow>
              <DetailRow label="Client manager">{client.manager_name ?? "—"}</DetailRow>
              <DetailRow label="Tax ID">{client.tax_id ?? "—"}</DetailRow>
              <DetailRow label="Registration no.">
                {client.registration_no ?? "—"}
              </DetailRow>
              <DetailRow label="Financial year end">
                {client.fiscal_year_end ?? "—"}
              </DetailRow>
              <DetailRow label="Industry">{client.industry ?? "—"}</DetailRow>
              <DetailRow label="Onboarded">{formatDate(client.onboarded_on)}</DetailRow>
            </dl>
          </div>

          <div className="card p-4">
            <h2 className="card-title mb-2">Contact</h2>
            <dl className="divide-y divide-slate-100">
              <DetailRow label="Name">{client.contact_name ?? "—"}</DetailRow>
              <DetailRow label="Email">
                {client.contact_email ? (
                  <a href={`mailto:${client.contact_email}`} className="link">
                    {client.contact_email}
                  </a>
                ) : (
                  "—"
                )}
              </DetailRow>
              <DetailRow label="Phone">{client.contact_phone ?? "—"}</DetailRow>
            </dl>
          </div>

          {client.notes && (
            <div className="card p-4">
              <h2 className="card-title mb-2">Notes</h2>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{client.notes}</p>
            </div>
          )}
        </div>
      </div>

      <NewTaskModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(taskId) => navigate(`/tasks/${taskId}`)}
        fixedClientId={client.id}
        clients={[client]}
        users={users}
        templates={templates}
      />
    </div>
  );
}
