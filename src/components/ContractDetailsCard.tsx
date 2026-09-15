/**
 * One person's contract details: what the firm knows, what it does not, and who is
 * expected to supply the rest.
 *
 * The screen exists because the alternative is what used to happen. A template was
 * copied for a new joiner and somebody went through fifteen pages of it replacing
 * bracketed fields by hand - thirty-eight of them in the Associate agreement. Two or
 * three were always missed, and the ones missed were the ones deep in the schedules,
 * where the money is.
 *
 * The distinction the layout is built around is not filled versus empty. It is *who is
 * expected to fill it*:
 *
 * - **From the record.** Already known - their name, job title, start date, salary.
 *   Shown so the administrator can see the contract will say the right thing, and not
 *   editable here: a second copy of a job title is how a contract comes to disagree
 *   with a personnel file.
 * - **They will give this at first sign-in.** Their address, TIN and Ghana Card number.
 *   Fill it in if you have it. If you do not, leave it - it is asked when they sign in
 *   for the first time, and the contract completes from the same column either way.
 *   This is the case that used to stall an issue for a week while somebody emailed.
 * - **The firm's standard term.** Shown with its value and where it came from, so it is
 *   obvious when a contract is about to be issued on a default nobody has reviewed.
 * - **Yours to supply.** Neither in the record nor standard across the firm.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContractDetails, ResolvedContractField } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import { formatDate } from "../lib/format";
import { ErrorBanner, Field, Spinner, TextArea, TextInput } from "./ui";

/** How each origin reads in the margin beside a value. */
const ORIGIN_LABEL: Record<NonNullable<ResolvedContractField["origin"]>, string> = {
  record: "From their record",
  person: "Supplied here",
  firm: "The firm's standard term",
  fallback: "Not set - using the usual value",
};

export function ContractDetailsCard({
  userId,
  personName,
  onSaved,
}: {
  userId: string;
  personName: string;
  onSaved?: (message: string) => void;
}) {
  const [details, setDetails] = useState<ContractDetails | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetails(await api.contractDetails(userId));
      setEdits({});
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Could not load the contract details.",
      );
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Grouped as the registry orders them, so the form reads like the contract does. */
  const groups = useMemo(() => {
    if (!details) return [];
    const out: Array<{ group: string; fields: ResolvedContractField[] }> = [];
    for (const field of details.fields) {
      const existing = out.find((g) => g.group === field.group);
      if (existing) existing.fields.push(field);
      else out.push({ group: field.group, fields: [field] });
    }
    return out;
  }, [details]);

  if (!details) {
    return error ? (
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
    ) : (
      <Spinner label="Loading contract details" />
    );
  }

  const editable = (f: ResolvedContractField) =>
    f.supplier !== "record" || f.from?.filledBy === "employee";

  const save = async () => {
    if (!Object.keys(edits).length) {
      setNotice("Nothing has changed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.saveContractDetails(userId, edits);
      await load();
      const message = `Saved the contract details for ${personName}.`;
      setNotice(message);
      onSaved?.(message);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save those details.",
      );
    } finally {
      setBusy(false);
    }
  };

  const chased = details.outstanding - details.awaiting_employee;

  return (
    <section className="card space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Contract details</h2>
        <p className="text-sm text-slate-600">
          What {personName}&rsquo;s{" "}
          {details.template === "associate"
            ? "Associate Consultant Agreement"
            : "contract of employment"}{" "}
          will say when it is issued. Anything left blank stays as a bracket in the
          document rather than being printed empty, so it cannot be signed unnoticed.
        </p>
      </header>

      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      <Summary outstanding={details.outstanding} chased={chased} awaiting={details.awaiting_employee} />

      {groups.map((group) => (
        <fieldset key={group.group} className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {group.group}
          </legend>
          {group.fields.map((field) => (
            <Row
              key={field.token}
              field={field}
              draft={edits[field.token]}
              editable={editable(field)}
              onChange={(value) =>
                setEdits((current) => ({ ...current, [field.token]: value }))
              }
            />
          ))}
        </fieldset>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save contract details"}
        </button>
        {notice ? <span className="text-sm text-emerald-700">{notice}</span> : null}
      </div>
    </section>
  );
}

/**
 * The count at the top, split the way it has to be acted on.
 *
 * "Six outstanding" tells an administrator to go and find six things. Three of them
 * will arrive on their own the first time the person signs in, and the instruction for
 * those is to do nothing.
 */
function Summary({
  outstanding,
  chased,
  awaiting,
}: {
  outstanding: number;
  chased: number;
  awaiting: number;
}) {
  if (outstanding === 0) {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        Every field is filled. The contract can be issued complete.
      </p>
    );
  }
  return (
    <div className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {chased > 0 ? (
        <p>
          <strong>
            {chased} {chased === 1 ? "field is" : "fields are"} still needed from you.
          </strong>{" "}
          Until they are supplied, the contract prints them as brackets.
        </p>
      ) : null}
      {awaiting > 0 ? (
        <p>
          {awaiting} {awaiting === 1 ? "field" : "fields"} will be answered when they
          sign in for the first time. You can fill{" "}
          {awaiting === 1 ? "it" : "them"} in now if you have{" "}
          {awaiting === 1 ? "it" : "them"}, but you do not need to chase{" "}
          {awaiting === 1 ? "it" : "them"}.
        </p>
      ) : null}
    </div>
  );
}

function Row({
  field,
  draft,
  editable,
  onChange,
}: {
  field: ResolvedContractField;
  draft: string | undefined;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  /*
   * A value the registry supplies because nobody has set the term is shown as a
   * placeholder, not as text in the box. Shown as text it reads as something somebody
   * chose for this person, and the first edit to any other field on the form would look
   * like it had been agreed.
   */
  const isFallback = field.origin === "fallback" && draft === undefined;
  const current = draft ?? (isFallback ? "" : (field.value ?? ""));

  const margin = field.restricted
    ? "Set - Partner grade only"
    : field.awaiting_employee
      ? "They will give this at first sign-in"
      : field.origin
        ? ORIGIN_LABEL[field.origin]
        : "Not set";

  if (!editable) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-1.5">
        <span className="text-sm text-slate-700">{field.label}</span>
        <span className="text-sm text-slate-900">
          {field.restricted ? (
            <em className="text-slate-500">Set</em>
          ) : field.value ? (
            // A commencement date belongs in a contract as "1 October 2026", and it
            // should read that way here too rather than as the stored ISO string.
            field.input === "date" ? formatDate(field.value) : field.value
          ) : (
            <em className="text-amber-700">Not on their record</em>
          )}
        </span>
        <span className="w-full text-xs text-slate-500">{margin}</span>
      </div>
    );
  }

  return (
    <Field label={field.label} hint={field.hint ? `${field.hint} ${margin}` : margin}>
      {(id) =>
        field.input === "textarea" ? (
          <TextArea
            id={id}
            rows={2}
            value={current}
            placeholder={isFallback ? (field.value ?? "") : undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <div className="flex items-center gap-2">
            <TextInput
              id={id}
              type={field.input === "date" ? "date" : field.input === "number" ? "number" : "text"}
              value={current}
              placeholder={isFallback ? (field.value ?? "") : undefined}
              onChange={(e) => onChange(e.target.value)}
            />
            {field.suffix ? (
              <span className="whitespace-nowrap text-sm text-slate-500">
                {field.suffix}
              </span>
            ) : null}
          </div>
        )
      }
    </Field>
  );
}
