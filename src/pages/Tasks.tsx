import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ClientSummary, TaskSummary, TaskTemplate, User } from "@shared/types";
import {
  SERVICE_LINES,
  SERVICE_LINE_LABELS,
  STATUS_LABELS,
  TASK_STATUSES,
} from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { NewTaskModal } from "../components/NewTaskModal";
import { TaskTable } from "../components/TaskTable";
import { ErrorBanner, Select, Spinner, TextInput, options } from "../components/ui";

const SCOPES = [
  { value: "", label: "All deliverables" },
  { value: "open", label: "Open only" },
  { value: "mine", label: "Assigned to me" },
  { value: "my_reviews", label: "Awaiting my review" },
  { value: "overdue", label: "Overdue" },
  { value: "unassigned", label: "Unassigned" },
];

export function Tasks() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useSession();

  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Free-text search is debounced separately from the dropdown filters.
  const [search, setSearch] = useState(params.get("q") ?? "");

  const filters = {
    scope: params.get("scope") ?? "",
    status: params.get("status") ?? "",
    service_line: params.get("service_line") ?? "",
    client_id: params.get("client_id") ?? "",
    assignee_id: params.get("assignee_id") ?? "",
    q: params.get("q") ?? "",
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      const { tasks: result } = await api.tasks(filters);
      setTasks(result);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load deliverables.",
      );
      setTasks([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reference data for the filter bar and the create form.
  useEffect(() => {
    void Promise.all([api.clients(), api.users(), api.templates()])
      .then(([clientRes, userRes, templateRes]) => {
        setClients(clientRes.clients);
        setUsers(userRes.users);
        setTemplates(templateRes.templates);
      })
      .catch(() => {
        /* Filters degrade to text search if reference data fails to load. */
      });
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (search !== filters.q) update("q", search);
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-title">Deliverables</h1>
          <p className="muted mt-0.5">
            {tasks ? `${tasks.length} matching deliverable(s)` : "Loading…"}
          </p>
        </div>
        {can("senior_associate") && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setCreating(true)}
          >
            New deliverable
          </button>
        )}
      </div>

      <div className="card p-3">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <TextInput
            placeholder="Search title, ref or client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search deliverables"
          />
          <Select
            value={filters.scope}
            onChange={(e) => update("scope", e.target.value)}
            aria-label="Scope"
          >
            {SCOPES.map((scope) => (
              <option key={scope.value} value={scope.value}>
                {scope.label}
              </option>
            ))}
          </Select>
          <Select
            value={filters.status}
            onChange={(e) => update("status", e.target.value)}
            aria-label="Status"
          >
            <option value="">Any status</option>
            {options(TASK_STATUSES, STATUS_LABELS)}
          </Select>
          <Select
            value={filters.service_line}
            onChange={(e) => update("service_line", e.target.value)}
            aria-label="Service line"
          >
            <option value="">Any service line</option>
            {options(SERVICE_LINES, SERVICE_LINE_LABELS)}
          </Select>
          <Select
            value={filters.client_id}
            onChange={(e) => update("client_id", e.target.value)}
            aria-label="Client"
          >
            <option value="">Any client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
          <Select
            value={filters.assignee_id}
            onChange={(e) => update("assignee_id", e.target.value)}
            aria-label="Preparer"
          >
            <option value="">Any preparer</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="card">
        {tasks === null ? (
          <Spinner label="Loading deliverables" />
        ) : (
          <TaskTable
            tasks={tasks}
            columns={[
              "ref",
              "client",
              "title",
              "service",
              "status",
              "assignee",
              "reviewer",
              "due",
              "progress",
              "points",
            ]}
            emptyTitle="No deliverables match these filters"
            emptyDescription="Try widening the filters, or create a new deliverable."
          />
        )}
      </div>

      <NewTaskModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => navigate(`/tasks/${id}`)}
        clients={clients}
        users={users}
        templates={templates}
      />
    </div>
  );
}
