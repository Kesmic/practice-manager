/**
 * Everything the firm needs from somebody, asked once on their first sign-in.
 *
 * Until this is finished the person can reach this form, their onboarding page and the
 * screens that let them set a password and a second factor, and nothing else. That is
 * deliberate and it is confinement rather than lockout - the same shape a temporary
 * password already uses. The failure it replaces is the one where a step sits unticked
 * for a month because the only way to complete it was to catch somebody in a corridor.
 *
 * Asked in four groups with a sentence each on why, because a form that demands an
 * identity number and a bank account without saying what for is a form people fill in
 * badly.
 */

import { useEffect, useRef, useState } from "react";
import { FIRST_RUN_GROUPS, PROFILE_FIELD_LABELS } from "@shared/hr";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Field, Select, TextArea, TextInput } from "./ui";
import { AttachmentField } from "./AttachmentField";
import {
  STAFF_FILE_FIELDS,
  type StaffAttachment,
  type StaffFileKind,
} from "@shared/staff-files";

/** The profile field each attachment kind fills in, read the other way round. */
const FIELD_KINDS: Record<string, StaffFileKind> = Object.fromEntries(
  Object.entries(STAFF_FILE_FIELDS).map(([kind, field]) => [field, kind as StaffFileKind]),
);

const ID_TYPES = [
  "Ghana Card",
  "Passport",
  "Driver's licence",
  "Voter identification",
] as const;

/** Which of the four groups a field belongs to, and where it is written. */
const BANK_FIELDS = new Set(["bank_name", "bank_branch", "account_name", "account_number"]);

export function FirstRunForm({
  values,
  missing,
  attachments,
  onSaved,
  onAttachmentChanged,
}: {
  values: Record<string, unknown>;
  missing: string[];
  /** What is already attached, by kind, so the form opens on the truth. */
  attachments?: Partial<Record<StaffFileKind, StaffAttachment | null>>;
  onSaved: () => Promise<void> | void;
  onAttachmentChanged: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * Which fields this person has typed into.
   *
   * The profile is re-read whenever an attachment is added, and this form is seeded
   * from it - so a straight reseed threw away everything typed so far the moment
   * somebody attached their passport half way down the form. Twenty fields, gone, with
   * no error to explain it. Server values now fill only the fields nobody has touched.
   */
  const touched = useRef<Set<string>>(new Set());

  useEffect(() => {
    setForm((prev) => {
      const seed: Record<string, string> = {};
      for (const group of FIRST_RUN_GROUPS) {
        for (const field of group.fields) {
          seed[field] = touched.current.has(field)
            ? (prev[field] ?? "")
            : ((values[field] as string) ?? "");
        }
      }
      return seed;
    });
  }, [values]);

  const set = (field: string) => (value: string) => {
    touched.current.add(field);
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const stillMissing = FIRST_RUN_GROUPS.flatMap((g) => g.fields).filter(
    (f) => !form[f]?.trim(),
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      /*
       * Two calls, because the two halves live in two tables with two different access
       * rules: the personal record, and the pay record that only Partners may read.
       * Bank details go second, so a rejected personal field does not leave an account
       * number written with nothing else around it.
       */
      const profile: Record<string, string> = {};
      const bank: Record<string, string> = {};
      for (const [key, value] of Object.entries(form)) {
        /*
         * Attachments are not sent back. The upload endpoint writes the column when the
         * file arrives, so resubmitting it here is at best a no-op - and it was worse
         * than that: the form posted the portal's own reference back as though it were
         * a link somebody had typed, and the profile refused the whole save.
         */
        if (FIELD_KINDS[key]) continue;
        (BANK_FIELDS.has(key) ? bank : profile)[key] = value;
      }
      await api.updateMyProfile(profile);
      await api.updateOwnBank(bank);
      await onSaved();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save those details.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
        <p className="font-medium">
          {missing.length} of these are still outstanding.
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {FIRST_RUN_GROUPS.map((group) => (
        <section key={group.key} className="card space-y-3 p-4">
          <div>
            <h2 className="card-title">{group.label}</h2>
            <p className="muted mt-0.5 text-xs">{group.detail}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {group.fields.map((field) => (
              <FirstRunField
                key={field}
                field={field}
                value={form[field] ?? ""}
                onChange={set(field)}
                attachments={attachments}
                onAttachmentChanged={onAttachmentChanged}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy || stillMissing.length > 0}>
          {busy ? "Saving..." : "Save and continue"}
        </button>
        {stillMissing.length > 0 && (
          <p className="text-xs text-slate-500">
            Still to fill in:{" "}
            {stillMissing.map((f) => PROFILE_FIELD_LABELS[f] ?? f).join(", ")}.
          </p>
        )}
      </div>
    </form>
  );
}

function FirstRunField({
  field,
  value,
  onChange,
  attachments,
  onAttachmentChanged,
}: {
  field: string;
  value: string;
  onChange: (value: string) => void;
  attachments?: Partial<Record<StaffFileKind, StaffAttachment | null>>;
  onAttachmentChanged: () => Promise<void> | void;
}) {
  const label = PROFILE_FIELD_LABELS[field] ?? field;
  const wide = field === "residential_address";
  // The two document fields are attached rather than linked. `field.endsWith("_url")`
  // is not used to decide this: the kind has to be known to upload against it.
  const kind = FIELD_KINDS[field];

  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Field
        label={label}
        required
        hint={
          field === "tin"
            ? "Your Taxpayer Identification Number, as registered with the GRA."
            : undefined
        }
      >
        {(id) =>
          kind ? (
            <AttachmentField
              kind={kind}
              value={value}
              attached={attachments?.[kind] ?? null}
              onChange={onChange}
              onAttachmentChanged={onAttachmentChanged}
            />
          ) : field === "id_type" ? (
            <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
              <option value="">Choose...</option>
              {ID_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          ) : wide ? (
            <TextArea
              id={id}
              rows={2}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            <TextInput
              id={id}
              type={field === "date_of_birth" ? "date" : "text"}
              inputMode={field.includes("phone") ? "tel" : undefined}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.endsWith("_url") ? "https://..." : undefined}
            />
          )
        }
      </Field>
    </div>
  );
}
