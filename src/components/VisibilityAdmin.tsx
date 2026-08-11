/**
 * Who sees what.
 *
 * One row per area, one grade per row: the lowest grade that may open it. Areas with a
 * floor at their default are shown as fixed rather than offered and then refused, so
 * the screen never invites a change it will not accept.
 */

import { useEffect, useState } from "react";
import { ROLE_LABELS, ROLES, ROLE_RANK, type Role } from "@shared/workflow";
import {
  AREAS,
  AREA_SPECS,
  DEFAULT_VISIBILITY,
  type Visibility,
  choicesFor,
  isFixed,
} from "@shared/visibility";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { ErrorBanner, Select, Spinner } from "./ui";

export function VisibilityAdmin({
  setError,
  setNotice,
}: {
  setError: (m: string | null) => void;
  setNotice: (m: string | null) => void;
}) {
  const { refresh } = useSession();
  const [draft, setDraft] = useState<Visibility | null>(null);
  const [saved, setSaved] = useState<Visibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .visibility()
      .then((res) => {
        setDraft(res.visibility);
        setSaved(res.visibility);
      })
      .catch(() => {
        setDraft(DEFAULT_VISIBILITY);
        setSaved(DEFAULT_VISIBILITY);
      });
  }, []);

  if (!draft || !saved) return <Spinner label="Loading who sees what" />;

  const dirty = AREAS.some((area) => draft[area] !== saved[area]);

  const save = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      const res = await api.setVisibility(draft);
      setSaved(res.visibility);
      setDraft(res.visibility);
      setNotice("Saved. This takes effect the next time each person loads the portal.");
      setError(null);
      // The signed-in user's own sidebar is driven by this, so pick it up now.
      await refresh();
    } catch (err) {
      setLocalError(
        err instanceof ApiRequestError
          ? [err.message, err.detail].filter(Boolean).join(" ")
          : "Could not save.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <ErrorBanner error={localError} onDismiss={() => setLocalError(null)} />

      <section className="card p-4">
        <h2 className="card-title">Who sees what</h2>
        <p className="muted mb-4 mt-0.5">
          For each area, the lowest grade that can open it. Everyone at that grade and
          above sees it. This is enforced by the server as well as the sidebar, so a
          screen you close here is refused, not merely hidden.
        </p>

        <div className="space-y-3">
          {AREAS.map((area) => {
            const spec = AREA_SPECS[area];
            const fixed = isFixed(area);
            const choices = choicesFor(area);
            const changed = draft[area] !== saved[area];
            return (
              <div
                key={area}
                className={`rounded-md border p-3 ${
                  changed ? "border-brand-400 bg-brand-50/40" : "border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{spec.label}</p>
                    <p className="muted mt-0.5">{spec.detail}</p>
                    {spec.floorReason && (
                      <p className="muted mt-1 italic">{spec.floorReason}</p>
                    )}
                  </div>
                  {/*
                    Every area gets a control. The floor only stops it being opened
                    further down; closing an area is always the firm's call, so an area
                    already at its floor still offers every stricter grade above it.
                  */}
                  <div className="w-56 shrink-0">
                    {fixed ? (
                      <p className="text-sm text-slate-500">
                        Fixed at {ROLE_LABELS[spec.defaultMin]} and above
                      </p>
                    ) : (
                      <Select
                        aria-label={`Lowest grade that can see ${spec.label}`}
                        value={draft[area]}
                        onChange={(e) =>
                          setDraft({ ...draft, [area]: e.target.value as Role })
                        }
                      >
                        {choices.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]} and above
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {busy ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setDraft(DEFAULT_VISIBILITY)}
          >
            Back to the defaults
          </button>
          {dirty && <span className="muted">Unsaved changes.</span>}
        </div>
      </section>

      {/* What each grade would end up seeing, which is the question actually being
          asked. Easier to check than reading the rows one at a time. */}
      <section className="card p-4">
        <h2 className="card-title">What each grade would see</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-3">Area</th>
                {ROLES.map((role) => (
                  <th key={role} className="py-1 pr-3 text-center">
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {AREAS.map((area) => (
                <tr key={area}>
                  <td className="py-2 pr-3">{AREA_SPECS[area].label}</td>
                  {ROLES.map((role) => (
                    <td key={role} className="py-2 pr-3 text-center">
                      {ROLE_RANK[role] >= ROLE_RANK[draft[area]] ? (
                        <span className="text-emerald-700" aria-label="yes">
                          yes
                        </span>
                      ) : (
                        <span className="text-slate-300" aria-label="no">
                          no
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="card-title">Not on this screen, and not changeable</h2>
        <ul className="muted mt-2 list-disc space-y-1 pl-5">
          <li>Nobody reviews their own work, whatever their grade.</li>
          <li>
            An Associate cannot be named as a reviewer. Reviewers are Senior Associate
            grade or above.
          </li>
          <li>Pay and bank details are Partner only.</li>
          <li>Accounts, grades and these settings are Partner only.</li>
          <li>
            Everyone always sees their own dashboard, their own deliverables, the
            handbook and their own details.
          </li>
        </ul>
        <p className="muted mt-2">
          These are what make the review file worth anything, so they are not
          preferences.
        </p>
      </section>
    </div>
  );
}
