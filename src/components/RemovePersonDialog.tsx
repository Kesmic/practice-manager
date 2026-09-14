/**
 * Removing somebody from the firm, with the cost shown first.
 *
 * "Delete the account" sounds like one action on one row. It is not: a user row is
 * referenced by forty-odd columns and about a third of them cascade, so the plain delete
 * takes review rounds, review points, comments and logged hours off **other people's**
 * deliverables as well. That was measured, not guessed - deleting a reviewer leaves the
 * deliverable they were reviewing sitting in `under_review` with no reviewer and no
 * record of what was asked for, and the person whose deliverable it is did nothing.
 *
 * So the dialog leads with what the person is attached to, and offers two removals
 * rather than one. Neither is hidden: an administrator who created an account with a
 * typo in the address wants the row gone, and telling them they may only "retire" it
 * would be the system deciding something that is not its to decide. What it can do is
 * make sure nobody finds out afterwards.
 *
 * The confirmation is the person's own name rather than a fixed word. "DELETE" can be
 * typed without reading; the point is not friction but making somebody look at which
 * person they have selected.
 */

import { useCallback, useEffect, useState } from "react";
import type { RemovalPreview } from "@shared/types";
import {
  REMOVAL_EFFECTS,
  REMOVAL_LABELS,
  REMOVALS,
  confirmationMatches,
  type Removal,
} from "@shared/removal";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Modal, Spinner, TextInput } from "./ui";

export function RemovePersonDialog({
  userId,
  onClose,
  onRemoved,
}: {
  userId: string | null;
  onClose: () => void;
  onRemoved: (message: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<RemovalPreview | null>(null);
  const [removal, setRemoval] = useState<Removal>("retire");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setPreview(null);
    setTyped("");
    setError(null);
    try {
      const result = await api.removalPreview(userId);
      setPreview(result);
      // Opens on whichever removal is honest for this person, rather than on a default
      // that has to be corrected for most of them.
      setRemoval(result.advice.recommended);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load that account.",
      );
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!userId) return null;

  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.removeUser(userId, removal, typed);
      await onRemoved(
        result.removed === "erase"
          ? `${preview.user.full_name} has been deleted entirely.`
          : `${preview.user.full_name}'s personal record has been removed. Their client work is untouched.`,
      );
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not remove that account.",
      );
    } finally {
      setBusy(false);
    }
  };

  const ready =
    !!preview &&
    !preview.blocked &&
    confirmationMatches(typed, preview.confirmation) &&
    !busy;

  return (
    <Modal
      open
      title={preview ? `Remove ${preview.user.full_name}` : "Remove"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!ready}
            onClick={() => void submit()}
          >
            {busy ? "Removing…" : REMOVAL_LABELS[removal]}
          </button>
        </>
      }
    >
      {!preview ? (
        error ? (
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        ) : (
          <Spinner label="Working out what this would remove" />
        )
      ) : (
        <div className="space-y-4">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />

          {preview.blocked ? (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <strong>This account cannot be removed.</strong> {preview.blocked}
            </p>
          ) : (
            <>
              <Footprint preview={preview} />

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-800">
                  How much do you want removed?
                </legend>
                {REMOVALS.map((key) => (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 ${
                      removal === key ? "border-slate-400 bg-slate-50" : "border-slate-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="removal"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={removal === key}
                      onChange={() => setRemoval(key)}
                    />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-medium text-slate-800">
                        {REMOVAL_LABELS[key]}
                        {preview.advice.recommended === key ? (
                          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-normal text-emerald-700">
                            Recommended
                          </span>
                        ) : null}
                      </span>
                      <Effects removal={key} />
                    </span>
                  </label>
                ))}
              </fieldset>

              <label className="block space-y-1">
                <span className="text-sm font-medium text-slate-800">
                  Type <span className="font-mono">{preview.confirmation}</span> to
                  confirm
                </span>
                <TextInput
                  value={typed}
                  autoComplete="off"
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={preview.confirmation}
                />
                <span className="hint">
                  Their name rather than a fixed word, so it cannot be typed without
                  looking at whose account this is.
                </span>
              </label>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** What the person is attached to, and what the strong option would take with it. */
function Footprint({ preview }: { preview: RemovalPreview }) {
  const { advice } = preview;

  if (advice.collateral.length === 0) {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {advice.summary}
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p>{advice.summary}</p>
      <p>
        Deleting the account entirely would also remove{" "}
        {advice.collateral.join(", ").replace(/, ([^,]*)$/, " and $1")}.
      </p>
    </div>
  );
}

function Effects({ removal }: { removal: Removal }) {
  const effects = REMOVAL_EFFECTS[removal];
  return (
    <span className="mt-1.5 block space-y-1.5">
      {effects.keeps.length ? (
        <span className="block">
          <span className="text-xs font-medium text-emerald-700">Keeps</span>
          <ul className="ml-4 list-disc text-xs text-slate-600">
            {effects.keeps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </span>
      ) : null}
      <span className="block">
        <span className="text-xs font-medium text-rose-700">Removes</span>
        <ul className="ml-4 list-disc text-xs text-slate-600">
          {effects.destroys.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </span>
    </span>
  );
}
