import { Link } from "react-router-dom";
import type { TaskSummary } from "@shared/types";
import { SERVICE_LINE_LABELS } from "@shared/workflow";
import { formatHours } from "../lib/format";
import {
  Avatar,
  DuePill,
  EmptyState,
  PriorityPill,
  Progress,
  StatusPill,
} from "./ui";

type Column =
  | "ref"
  | "client"
  | "title"
  | "service"
  | "status"
  | "assignee"
  | "reviewer"
  | "due"
  | "progress"
  | "points"
  | "hours";

const DEFAULT_COLUMNS: Column[] = [
  "ref",
  "client",
  "title",
  "status",
  "assignee",
  "reviewer",
  "due",
  "progress",
];

export function TaskTable({
  tasks,
  columns = DEFAULT_COLUMNS,
  emptyTitle = "Nothing here",
  emptyDescription,
}: {
  tasks: TaskSummary[];
  columns?: Column[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (!tasks.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const has = (column: Column) => columns.includes(column);

  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            {has("ref") && <th>Ref</th>}
            {has("client") && <th>Client</th>}
            {has("title") && <th>Deliverable</th>}
            {has("service") && <th>Service line</th>}
            {has("status") && <th>Status</th>}
            {has("assignee") && <th>Preparer</th>}
            {has("reviewer") && <th>Reviewer</th>}
            {has("due") && <th>Due</th>}
            {has("progress") && <th>Steps</th>}
            {has("points") && <th>Review points</th>}
            {has("hours") && <th className="text-right">Hours</th>}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id}>
              {has("ref") && (
                <td className="whitespace-nowrap">
                  <Link to={`/tasks/${task.id}`} className="link font-mono text-xs">
                    {task.ref}
                  </Link>
                </td>
              )}
              {has("client") && (
                <td className="whitespace-nowrap">
                  <Link to={`/clients/${task.client_id}`} className="link">
                    {task.client_name}
                  </Link>
                </td>
              )}
              {has("title") && (
                <td className="min-w-64">
                  <Link
                    to={`/tasks/${task.id}`}
                    className="font-medium text-slate-800 hover:text-link"
                  >
                    {task.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <PriorityPill priority={task.priority} />
                    {task.period_label && (
                      <span className="text-xs text-slate-500">{task.period_label}</span>
                    )}
                  </div>
                </td>
              )}
              {has("service") && (
                <td className="whitespace-nowrap text-xs">
                  {SERVICE_LINE_LABELS[task.service_line]}
                </td>
              )}
              {has("status") && (
                <td className="whitespace-nowrap">
                  <StatusPill status={task.status} />
                </td>
              )}
              {has("assignee") && (
                <td className="whitespace-nowrap">
                  {task.assignee_name ? (
                    <span className="inline-flex items-center gap-2">
                      <Avatar name={task.assignee_name} />
                      <span className="text-xs">{task.assignee_name}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-amber-700">Unassigned</span>
                  )}
                </td>
              )}
              {has("reviewer") && (
                <td className="whitespace-nowrap text-xs">
                  {task.reviewer_name ?? (
                    <span className="text-slate-400">Not named</span>
                  )}
                </td>
              )}
              {has("due") && (
                <td className="whitespace-nowrap">
                  <DuePill date={task.internal_due_date ?? task.statutory_due_date} />
                </td>
              )}
              {has("progress") && (
                <td>
                  <Progress done={task.checklist_done} total={task.checklist_total} />
                </td>
              )}
              {has("points") && (
                <td className="whitespace-nowrap text-center">
                  {task.open_review_points > 0 ? (
                    <span className="pill bg-rose-50 text-rose-700 ring-rose-200">
                      {task.open_review_points} open
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              )}
              {has("hours") && (
                <td className="whitespace-nowrap text-right text-xs tabular-nums">
                  {formatHours(task.logged_hours)}
                  {task.budget_hours ? (
                    <span className="text-slate-400"> / {formatHours(task.budget_hours)}</span>
                  ) : null}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
