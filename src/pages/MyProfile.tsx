import { useCallback, useEffect, useState } from "react";
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, PROFILE_FIELD_LABELS, REQUIRED_PROFILE_FIELDS } from "@shared/hr";
import type { EmploymentStatus, EmploymentType } from "@shared/hr";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  DetailRow,
  ErrorBanner,
  Field,
  Select,
  Spinner,
  SuccessBanner,
  TextArea,
  TextInput,
} from "../components/ui";
import { formatDate } from "../lib/format";

/** Fields the employee maintains themselves. Employment terms are HR-controlled. */
const EDITABLE = [
  "phone",
  "personal_email",
  "residential_address",
  "date_of_birth",
  "gender",
  "marital_status",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
  "next_of_kin_name",
  "next_of_kin_phone",
  "highest_qualification",
  "professional_body",
  "membership_number",
] as const;

type Editable = (typeof EDITABLE)[number];

export function MyProfile() {
  const { user } = useSession();
  const [profile, setProfile] = useState<Record<string, string | null> | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.myProfile();
      setProfile(res.profile);
      setMissing(res.missing_profile_fields);
      const next: Record<string, string> = {};
      for (const field of EDITABLE) next[field] = res.profile?.[field] ?? "";
      setForm(next);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your profile.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !profile) return <ErrorBanner error={error} />;
  if (!profile || !user) return <Spinner label="Loading your profile" />;

  const set = (key: Editable) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of EDITABLE) payload[field] = form[field] || null;
      const res = await api.updateMyProfile(payload);
      setProfile(res.profile);
      setMissing(res.missing_profile_fields);
      setNotice("Your details have been saved.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save your details.",
      );
    } finally {
      setBusy(false);
    }
  };

  const text = (key: Editable, type = "text") => (
    <Field
      key={key}
      label={PROFILE_FIELD_LABELS[key] ?? key}
      required={(REQUIRED_PROFILE_FIELDS as readonly string[]).includes(key)}
    >
      {(id) => (
        <TextInput
          id={id}
          type={type}
          value={form[key] ?? ""}
          onChange={(event) => set(key)(event.target.value)}
        />
      )}
    </Field>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="section-title">My details</h1>
        <p className="muted mt-0.5">
          Keep your contact and emergency information current. Your employment terms
          are maintained by the firm - speak to a partner if anything there is wrong.
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      {missing.length > 0 && (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          Still needed:{" "}
          {missing.map((field) => PROFILE_FIELD_LABELS[field] ?? field).join(", ")}.
        </div>
      )}

      {/* Employment record - read only */}
      <div className="card p-5">
        <h2 className="card-title mb-2">Employment record</h2>
        <dl className="divide-y divide-slate-100">
          <DetailRow label="Staff number">{profile.staff_no ?? "-"}</DetailRow>
          <DetailRow label="Job title">{profile.job_title ?? user.title ?? "-"}</DetailRow>
          <DetailRow label="Department">{profile.department ?? "-"}</DetailRow>
          <DetailRow label="Employment type">
            {EMPLOYMENT_TYPE_LABELS[profile.employment_type as EmploymentType] ?? "-"}
          </DetailRow>
          <DetailRow label="Status">
            {EMPLOYMENT_STATUS_LABELS[profile.employment_status as EmploymentStatus] ?? "-"}
          </DetailRow>
          <DetailRow label="Start date">{formatDate(profile.start_date)}</DetailRow>
          {profile.probation_end_date && (
            <DetailRow label="Probation ends">
              {formatDate(profile.probation_end_date)}
            </DetailRow>
          )}
          <DetailRow label="Line manager">
            {(profile.line_manager_name as string | null) ?? "-"}
          </DetailRow>
          <DetailRow label="Work location">{profile.work_location ?? "-"}</DetailRow>
        </dl>
      </div>

      {/* Editable personal details */}
      <form onSubmit={submit} className="card space-y-5 p-5">
        <h2 className="card-title">Personal details</h2>
        <p className="text-xs text-slate-500">
          These are visible to you and to the partners who administer HR records. Your
          line manager does not see your home address or date of birth.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {text("phone", "tel")}
          {text("personal_email", "email")}
          {text("date_of_birth", "date")}
          <Field label="Gender">
            {(id) => (
              <Select
                id={id}
                value={form.gender ?? ""}
                onChange={(event) => set("gender")(event.target.value)}
              >
                <option value="">Prefer not to say</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </Select>
            )}
          </Field>
          <Field label="Marital status">
            {(id) => (
              <Select
                id={id}
                value={form.marital_status ?? ""}
                onChange={(event) => set("marital_status")(event.target.value)}
              >
                <option value="">Prefer not to say</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
              </Select>
            )}
          </Field>
        </div>

        <Field label={PROFILE_FIELD_LABELS.residential_address} required>
          {(id) => (
            <TextArea
              id={id}
              rows={2}
              value={form.residential_address ?? ""}
              onChange={(event) => set("residential_address")(event.target.value)}
            />
          )}
        </Field>

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Emergency contact
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {text("emergency_contact_name")}
            {text("emergency_contact_phone", "tel")}
            {text("emergency_contact_relationship")}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Next of kin
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("next_of_kin_name")}
            {text("next_of_kin_phone", "tel")}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Qualifications
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {text("highest_qualification")}
            {text("professional_body")}
            {text("membership_number")}
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save details"}
          </button>
        </div>
      </form>
    </div>
  );
}
