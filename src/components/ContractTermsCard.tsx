/**
 * The firm's standard contract terms - set once, used in every contract issued after.
 *
 * The registered company name, the notice period, the payment days, the fee for each
 * subscription tier. None of it differs per person, and asking an administrator to
 * retype twenty-five standard terms for each new Associate guarantees that the
 * twenty-sixth is engaged on different ones.
 *
 * Terms with a conventional value start from it, and the screen says so, because the
 * failure this is guarding against is not a blank field. It is a firm issuing thirty
 * contracts on a notice period nobody ever chose.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContractField } from "@shared/contract-fields";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Field, Spinner, TextArea, TextInput } from "./ui";

export function ContractTermsCard({ canEdit }: { canEdit: boolean }) {
  const [fields, setFields] = useState<ContractField[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.contractDefaults();
      setFields(result.fields);
      setValues(result.values);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load the contract terms.",
      );
      setFields([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const out: Array<{ group: string; fields: ContractField[] }> = [];
    for (const field of fields ?? []) {
      const existing = out.find((g) => g.group === field.group);
      if (existing) existing.fields.push(field);
      else out.push({ group: field.group, fields: [field] });
    }
    return out;
  }, [fields]);

  if (!fields) return <Spinner label="Loading contract terms" />;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.saveContractDefaults(values);
      setValues(result.values);
      setNotice("Saved. Contracts issued from now on will use these terms.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save those terms.",
      );
    } finally {
      setBusy(false);
    }
  };

  const unset = fields.filter((f) => !values[f.token] && !f.fallback);

  return (
    <section className="card space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">Contract terms</h2>
        <p className="text-sm text-slate-600">
          The standard terms that go into every contract the firm issues. Set them once
          here rather than in each person&rsquo;s contract, so two people engaged in the
          same month cannot end up on different notice periods.
        </p>
      </header>

      {error ? <ErrorBanner error={error} onDismiss={() => setError(null)} /> : null}

      {unset.length ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>
            {unset.length} {unset.length === 1 ? "term has" : "terms have"} no value and
            no usual one to fall back on.
          </strong>{" "}
          Contracts issued now will print{" "}
          {unset.length === 1 ? "it" : "them"} as a bracket:{" "}
          {unset.map((f) => f.label).join(", ")}.
        </p>
      ) : null}

      {groups.map((group) => (
        <fieldset key={group.group} className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {group.group}
          </legend>
          {group.fields.map((field) => (
            <Field
              key={field.token}
              label={field.label}
              hint={
                field.hint ??
                (field.fallback && !values[field.token]
                  ? `Not set. Contracts will say “${field.fallback}”.`
                  : undefined)
              }
            >
              {(id) =>
                field.input === "textarea" ? (
                  <TextArea
                    id={id}
                    rows={2}
                    disabled={!canEdit}
                    value={values[field.token] ?? ""}
                    placeholder={field.fallback ?? ""}
                    onChange={(e) =>
                      setValues((c) => ({ ...c, [field.token]: e.target.value }))
                    }
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <TextInput
                      id={id}
                      type={field.input === "number" ? "number" : "text"}
                      disabled={!canEdit}
                      value={values[field.token] ?? ""}
                      placeholder={field.fallback ?? ""}
                      onChange={(e) =>
                        setValues((c) => ({ ...c, [field.token]: e.target.value }))
                      }
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
          ))}
        </fieldset>
      ))}

      {canEdit ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save contract terms"}
          </button>
          {notice ? <span className="text-sm text-emerald-700">{notice}</span> : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Changing a standard term changes every contract issued afterwards, so it is
          restricted to Partner grade.
        </p>
      )}
    </section>
  );
}
