import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PortalDocument } from "@shared/types";
import { requiredAction } from "@shared/hr";
import { ApiRequestError, api } from "../lib/api";
import { EmptyState, ErrorBanner, Spinner, TextInput } from "../components/ui";
import { formatDate } from "../lib/format";

type Row = PortalDocument & { my_action: string | null; my_signed_at: string | null };

/**
 * The employee handbook: every published policy, grouped by category, with the
 * viewer's own acknowledgement state against each one.
 */
export function Handbook() {
  const [documents, setDocuments] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void api
      .documents()
      .then((res) => setDocuments(res.documents as Row[]))
      .catch((err) => {
        setError(
          err instanceof ApiRequestError ? err.message : "Could not load the handbook.",
        );
        setDocuments([]);
      });
  }, []);

  const grouped = useMemo(() => {
    if (!documents) return [];
    const term = search.trim().toLowerCase();
    const visible = documents
      .filter((doc) => doc.kind === "policy" || doc.kind === "handbook")
      .filter(
        (doc) =>
          !term ||
          doc.title.toLowerCase().includes(term) ||
          (doc.summary ?? "").toLowerCase().includes(term) ||
          (doc.category ?? "").toLowerCase().includes(term),
      );

    const map = new Map<string, Row[]>();
    for (const doc of visible) {
      const key = doc.category ?? "General";
      const list = map.get(key) ?? [];
      list.push(doc);
      map.set(key, list);
    }
    return [...map.entries()].map(([category, docs]) => ({ category, docs }));
  }, [documents, search]);

  const others = useMemo(
    () =>
      (documents ?? []).filter(
        (doc) => doc.kind === "contract" || doc.kind === "notice" || doc.kind === "form",
      ),
    [documents],
  );

  const outstanding = (documents ?? []).filter(
    (doc) => requiredAction(doc) && !doc.my_action,
  );

  if (error && !documents) return <ErrorBanner error={error} />;
  if (!documents) return <Spinner label="Loading the handbook" />;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="section-title">Employee handbook</h1>
        <p className="muted mt-0.5">
          The policies that apply to everyone at the firm. Each is acknowledged
          separately, so the record shows what you agreed to and when.
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {outstanding.length > 0 && (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="font-medium">
            {outstanding.length}{" "}
            {outstanding.length === 1 ? "document needs" : "documents need"} your
            response.
          </p>
          <p className="mt-0.5 text-xs">
            They are marked below, and listed on your{" "}
            <Link to="/onboarding" className="link">
              onboarding page
            </Link>
            .
          </p>
        </div>
      )}

      <TextInput
        placeholder="Search policies…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label="Search the handbook"
      />

      {!grouped.length ? (
        <div className="card">
          <EmptyState
            title="No policies published yet"
            description="Policies appear here once a partner publishes them."
          />
        </div>
      ) : (
        grouped.map(({ category, docs }) => (
          <section key={category} className="card">
            <div className="card-header">
              <h2 className="card-title">{category}</h2>
              <span className="muted">{docs.length}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {docs.map((doc) => (
                <li key={doc.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/documents/${doc.id}`}
                        className="text-sm font-medium text-slate-800 hover:text-brand-700"
                      >
                        {doc.title}
                      </Link>
                      {doc.summary && (
                        <p className="mt-0.5 text-xs text-slate-500">{doc.summary}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {doc.my_action ? (
                        <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">
                          Acknowledged {formatDate(doc.my_signed_at)}
                        </span>
                      ) : requiredAction(doc) ? (
                        <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
                          Action needed
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Reference</span>
                      )}
                      <p className="mt-1 text-xs text-slate-400">v{doc.version}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {others.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Your other documents</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {others.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <Link to={`/documents/${doc.id}`} className="link text-sm">
                  {doc.title}
                </Link>
                {doc.my_action ? (
                  <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">
                    Signed {formatDate(doc.my_signed_at)}
                  </span>
                ) : requiredAction(doc) ? (
                  <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
                    Action needed
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">Reference</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
