import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Dashboard as DashboardData } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { TaskTable } from "../components/TaskTable";
import { ErrorBanner, Spinner, StatTile } from "../components/ui";

export function Dashboard() {
  const { user, can } = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .dashboard()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiRequestError
              ? err.message
              : "Could not load your dashboard.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading your dashboard" />;

  const { stats } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="section-title">
          Good day{user ? `, ${user.full_name.split(" ")[0]}` : ""}
        </h1>
        <p className="muted mt-0.5">Here is where your work stands today.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Assigned to me"
          value={stats.assigned_open ?? 0}
          onClick={() => navigate("/tasks?scope=mine")}
        />
        <StatTile
          label="Awaiting my review"
          value={stats.awaiting_my_review ?? 0}
          tone={stats.awaiting_my_review ? "warn" : "neutral"}
          onClick={() => navigate("/tasks?scope=my_reviews")}
        />
        <StatTile
          label="In rework"
          value={stats.in_rework ?? 0}
          tone={stats.in_rework ? "warn" : "neutral"}
          onClick={() => navigate("/tasks?status=rework")}
        />
        <StatTile
          label="Overdue"
          value={stats.overdue ?? 0}
          tone={stats.overdue ? "danger" : "good"}
          onClick={() => navigate("/tasks?scope=overdue")}
        />
        <StatTile label="Due within 7 days" value={stats.due_this_week ?? 0} tone="warn" />
      </div>

      {can("senior_associate") && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Awaiting your review</h2>
            <span className="muted">{data.awaiting_my_review.length} item(s)</span>
          </div>
          <TaskTable
            tasks={data.awaiting_my_review}
            columns={["ref", "client", "title", "status", "assignee", "due", "points"]}
            emptyTitle="Nothing waiting on you"
            emptyDescription="Submissions assigned to you for review will appear here."
          />
        </section>
      )}

      {/*
        Handed in with no reviewer named. This sits above your own queue when it
        has anything in it, because work nobody has been asked to review is the
        more urgent of the two: the preparer is finished and waiting.
      */}
      {can("manager") && data.awaiting_a_reviewer.length > 0 && (
        <section className="card ring-1 ring-amber-200">
          <div className="card-header">
            <h2 className="card-title">Submitted with no reviewer named</h2>
            <span className="muted">{data.awaiting_a_reviewer.length} item(s)</span>
          </div>
          <p className="muted px-4 pb-2">
            The preparer has finished and is waiting. Open one and use Change under
            Assignment to name a reviewer.
          </p>
          <TaskTable
            tasks={data.awaiting_a_reviewer}
            columns={["ref", "client", "title", "status", "assignee", "due", "points"]}
            emptyTitle="Nothing unclaimed"
            emptyDescription="Work submitted without a named reviewer appears here."
          />
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">My deliverables</h2>
          <span className="muted">{data.my_tasks.length} open</span>
        </div>
        <TaskTable
          tasks={data.my_tasks}
          columns={["ref", "client", "title", "status", "reviewer", "due", "progress"]}
          emptyTitle="No open deliverables assigned to you"
          emptyDescription="Work assigned to you by a manager or partner will appear here."
        />
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            {can("manager") ? "Overdue across the practice" : "My overdue work"}
          </h2>
          <span className="muted">{data.overdue.length} item(s)</span>
        </div>
        <TaskTable
          tasks={data.overdue}
          columns={["ref", "client", "title", "status", "assignee", "due"]}
          emptyTitle="Nothing overdue"
          emptyDescription="Every deliverable is inside its target date."
        />
      </section>
    </div>
  );
}
