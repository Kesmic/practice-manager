import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Notification } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { EmptyState, ErrorBanner, Spinner } from "../components/ui";
import { relativeTime } from "../lib/format";

export function Notifications() {
  const { setUnread } = useSession();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { notifications } = await api.notifications();
      setItems(notifications);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your inbox.",
      );
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markAll = async () => {
    setError(null);
    try {
      const { unread_notifications } = await api.markNotificationsRead();
      setUnread(unread_notifications);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not update your inbox.",
      );
    }
  };

  const markOne = async (id: string) => {
    try {
      const { unread_notifications } = await api.markNotificationsRead([id]);
      setUnread(unread_notifications);
      setItems(
        (current) =>
          current?.map((item) =>
            item.id === id ? { ...item, read_at: new Date().toISOString() } : item,
          ) ?? null,
      );
    } catch {
      /* Marking read is best-effort; the badge refreshes on the next load. */
    }
  };

  const unreadCount = items?.filter((item) => !item.read_at).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="section-title">Inbox</h1>
          <p className="muted mt-0.5">
            {unreadCount ? `${unreadCount} unread` : "Everything read"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button type="button" className="btn-secondary" onClick={() => void markAll()}>
            Mark all read
          </button>
        )}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="card">
        {items === null ? (
          <Spinner label="Loading inbox" />
        ) : !items.length ? (
          <EmptyState
            title="Nothing in your inbox"
            description="You will be notified when work is assigned to you, submitted for your review, or returned for rework."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li
                key={item.id}
                className={`flex items-start gap-3 px-4 py-3 ${
                  item.read_at ? "" : "bg-brand-50/40"
                }`}
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    item.read_at ? "bg-transparent" : "bg-brand-500"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {item.task_id ? (
                      <Link
                        to={`/tasks/${item.task_id}`}
                        className="hover:text-brand-700"
                        onClick={() => void markOne(item.id)}
                      >
                        {item.title}
                      </Link>
                    ) : (
                      item.title
                    )}
                  </p>
                  {item.body && (
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-600">
                      {item.body}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-slate-400">
                    {relativeTime(item.created_at)}
                  </p>
                </div>
                {!item.read_at && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm shrink-0"
                    onClick={() => void markOne(item.id)}
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
