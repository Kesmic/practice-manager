/**
 * The staff directory.
 *
 * A practice needs a phone list. Somebody preparing a return has to be able to find out
 * who reviews for the tax team, what a colleague's job title is and which address to
 * use, and asking around for that is how a new joiner spends their first fortnight.
 *
 * Everybody appears and everybody can open it. What differs by grade is what is said
 * about each person - working identity for all, employment facts for Manager grade and
 * above, nothing personal for anybody. `shared/directory.ts` sets out that line.
 *
 * Two things about the layout.
 *
 * **Grouped by department rather than listed alphabetically.** A flat list of forty
 * names answers "is there somebody called Mensah"; grouped, it answers "who is in tax",
 * which is the question people actually arrive with.
 *
 * **The colleagues you work with are marked.** That is the half of "who do I talk to"
 * that a grade cannot answer, and it is the reason the page is worth opening twice.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  byDepartment,
  sharedWorkLabel,
  type DirectoryEntry,
} from "@shared/directory";
import { ROLE_LABELS } from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { Avatar, EmptyState, ErrorBanner, Spinner, TextInput } from "../components/ui";

export function Directory() {
  const [people, setPeople] = useState<DirectoryEntry[] | null>(null);
  const [canOpenRecords, setCanOpenRecords] = useState(false);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.directory();
      setPeople(result.people);
      setCanOpenRecords(result.can_open_records);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load the directory.",
      );
      setPeople([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Filtered here rather than by asking the server again on every keystroke. A practice
   * directory is tens of rows, not thousands, and a search that responds as you type
   * beats one that is authoritative but arrives late.
   */
  const shown = useMemo(() => {
    if (!people) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((person) =>
      [person.full_name, person.title, person.department, person.email, ROLE_LABELS[person.role]]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [people, q]);

  const colleagues = useMemo(
    () => shown.filter((person) => person.shared_deliverables > 0),
    [shown],
  );

  if (!people) {
    return error ? (
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
    ) : (
      <Spinner label="Loading the directory" />
    );
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="section-title">Staff directory</h1>
        <p className="muted">
          Everybody at the firm, what they do, and how to reach them. Personal details
          and pay are not here.
        </p>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="card p-3">
        <TextInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a name, job title, department or address"
          aria-label="Search the directory"
        />
      </div>

      {colleagues.length ? (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">
              People you are working with
            </h2>
            {/*
              These names appear again under their own department below. That is
              deliberate: this row is a shortcut, and the grouped list underneath has to
              stay complete or "who is in tax" stops being answerable from it.
            */}
            <p className="hint">A shortcut. They are listed under their department too.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {colleagues.map((person) => (
              <Card
                key={person.id}
                person={person}
                canOpenRecords={canOpenRecords}
                highlight
              />
            ))}
          </div>
        </section>
      ) : null}

      {!shown.length ? (
        <EmptyState
          title="Nobody matches that"
          description="Try a shorter search, or part of a surname."
        />
      ) : (
        byDepartment(shown).map((group) => (
          <section key={group.department} className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-800">{group.department}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.people.map((person) => (
                <Card
                  key={person.id}
                  person={person}
                  canOpenRecords={canOpenRecords}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Card({
  person,
  canOpenRecords,
  highlight = false,
}: {
  person: DirectoryEntry;
  canOpenRecords: boolean;
  highlight?: boolean;
}) {
  const shared = sharedWorkLabel(person.shared_deliverables);

  return (
    <article
      className={`card flex gap-3 p-4 ${highlight ? "ring-1 ring-brand-200" : ""}`}
    >
      <Avatar name={person.full_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900 dark:text-slate-100">
          {canOpenRecords ? (
            <Link className="link" to={`/people/${person.id}`}>
              {person.full_name}
            </Link>
          ) : (
            person.full_name
          )}
          {!person.active ? (
            <span className="ml-2 pill bg-slate-100 text-slate-500 ring-slate-200">
              Suspended
            </span>
          ) : null}
        </p>
        <p className="truncate text-sm text-slate-600 dark:text-slate-300">
          {person.title ?? ROLE_LABELS[person.role]}
          {person.title ? (
            <span className="text-slate-400"> · {ROLE_LABELS[person.role]}</span>
          ) : null}
        </p>
        <p className="truncate text-xs">
          <a className="link" href={`mailto:${person.email}`}>
            {person.email}
          </a>
        </p>
        {person.work_location ? (
          <p className="truncate text-xs text-slate-500">{person.work_location}</p>
        ) : null}
        {person.line_manager_name ? (
          <p className="truncate text-xs text-slate-500">
            Reports to {person.line_manager_name}
          </p>
        ) : null}
        {shared ? (
          <p className="mt-1 text-xs font-medium text-link">{shared}</p>
        ) : null}
      </div>
    </article>
  );
}
