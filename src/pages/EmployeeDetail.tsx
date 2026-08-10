import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { EmployeeFile, User } from "@shared/types";
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUS_STYLES,
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABELS,
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABELS,
  PROFILE_FIELD_LABELS,
} from "@shared/hr";
import { ROLE_LABELS, atLeast } from "@shared/workflow";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  Avatar,
  DetailRow,
  EmptyState,
  ErrorBanner,
  Field,
  Select,
  Spinner,
  SuccessBanner,
  TextArea,
  TextInput,
  options,
} from "../components/ui";
import { formatDate, formatDateTime, formatMoney, percent, relativeTime } from "../lib/format";

type Tab = "employment" | "onboarding" | "documents" | "personal" | "pay" | "trail";

export function EmployeeDetail() {
  const { id = "" } = useParams();
  const { user: me, can } = useSession();
  const [file, setFile] = useState<EmployeeFile | null>(null);
  const [colleagues, setColleagues] = useState<User[]>([]);
  const [tab, setTab] = useState<Tab>("employment");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isHr = can("partner");

  const load = useCallback(async () => {
    try {
      setFile(await api.employee(id));
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load this record.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isHr) return;
    void api
      .users()
      .then((res) => setColleagues(res.users))
      .catch(() => setColleagues([]));
  }, [isHr]);

  if (error && !file) return <ErrorBanner error={error} />;
  if (!file || !me) return <Spinner label="Loading employee record" />;

  const { user, profile, progress } = file;
  const isSelf = me.id === user.id;

  const tabs: Array<[Tab, string]> = [
    ["employment", "Employment"],
    ["onboarding", `Onboarding (${file.onboarding.filter((i) => i.is_done).length}/${file.onboarding.length})`],
    ["documents", `Documents (${file.signatures.length})`],
  ];
  if (file.personal) tabs.push(["personal", "Personal details"]);
  if (file.compensation !== null || can("partner")) tabs.push(["pay", "Pay and bank"]);
  if (isHr) tabs.push(["trail", "HR trail"]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Avatar name={user.full_name} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              {user.full_name}
              {isSelf && <span className="ml-2 text-xs text-slate-400">you</span>}
            </h1>
            <p className="muted mt-0.5">
              {profile?.job_title ?? user.title ?? ROLE_LABELS[user.role]}
              {profile?.department ? ` · ${profile.department}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
                {ROLE_LABELS[user.role]}
              </span>
              {profile?.employment_status && (
                <span
                  className={`pill ${EMPLOYMENT_STATUS_STYLES[profile.employment_status]}`}
                >
                  {EMPLOYMENT_STATUS_LABELS[profile.employment_status]}
                </span>
              )}
              {user.status === "suspended" && (
                <span className="pill bg-rose-50 text-rose-700 ring-rose-200">
                  Account suspended
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-slate-500">Onboarding</p>
          <p className="text-lg font-semibold tabular-nums text-slate-800">
            {percent(progress.fraction)}
          </p>
          {isHr && !file.onboarding.length && (
            <button
              type="button"
              className="btn-secondary btn-sm mt-1"
              onClick={async () => {
                setError(null);
                try {
                  const res = await api.startOnboarding(user.id);
                  setNotice(`Onboarding started with ${res.created} steps.`);
                  await load();
                } catch (err) {
                  setError(
                    err instanceof ApiRequestError
                      ? err.message
                      : "Could not start onboarding.",
                  );
                }
              }}
            >
              Start onboarding
            </button>
          )}
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />

      <div className="card">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-brand-600 text-link"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === "employment" && (
            <EmploymentTab
              file={file}
              colleagues={colleagues}
              editable={isHr}
              onSaved={async (message) => {
                setNotice(message);
                await load();
              }}
              setError={setError}
            />
          )}

          {tab === "onboarding" && (
            <div className="space-y-2">
              {!file.onboarding.length ? (
                <EmptyState
                  title="No onboarding programme"
                  description="Start the standard programme from the button above."
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {file.onboarding.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={item.is_done === 1}
                        disabled={
                          item.owner === "hr" ? !isHr : !(isSelf || isHr)
                        }
                        onChange={async (event) => {
                          setError(null);
                          try {
                            await api.setOnboardingItem(item.id, event.target.checked);
                            await load();
                          } catch (err) {
                            setError(
                              err instanceof ApiRequestError
                                ? err.message
                                : "Could not update that step.",
                            );
                          }
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-link"
                        aria-label={item.label}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm ${
                            item.is_done ? "text-slate-400 line-through" : "text-slate-800"
                          }`}
                        >
                          {item.label}
                        </p>
                        {item.detail && (
                          <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
                        )}
                        {item.done_at && (
                          <p className="mt-0.5 text-xs text-slate-400">
                            {item.done_by_name} · {relativeTime(item.done_at)}
                          </p>
                        )}
                      </div>
                      <span className="pill shrink-0 bg-slate-100 text-slate-600 ring-slate-200">
                        {item.owner === "hr" ? "Firm" : "Employee"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "documents" && (
            <DocumentsTab file={file} isHr={isHr} onChanged={load} setError={setError} />
          )}

          {tab === "personal" && file.personal && (
            <dl className="divide-y divide-slate-100">
              {Object.entries(file.personal)
                .filter(([key]) => key in PROFILE_FIELD_LABELS)
                .map(([key, value]) => (
                  <DetailRow key={key} label={PROFILE_FIELD_LABELS[key] ?? key}>
                    {key === "date_of_birth"
                      ? formatDate(value as string)
                      : ((value as string) ?? "—")}
                  </DetailRow>
                ))}
            </dl>
          )}

          {tab === "pay" && (
            <PayTab
              file={file}
              editable={can("partner")}
              onSaved={async (message) => {
                setNotice(message);
                await load();
              }}
              setError={setError}
            />
          )}

          {tab === "trail" && (
            <>
              {!file.events.length ? (
                <p className="py-4 text-center text-sm text-slate-500">
                  No HR activity recorded.
                </p>
              ) : (
                <ol className="space-y-3">
                  {file.events.map((event) => (
                    <li key={event.id} className="flex gap-3 text-sm">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                      <div>
                        <p className="text-slate-800">
                          <span className="font-medium">
                            {event.actor_name ?? "System"}
                          </span>{" "}
                          — {event.kind.replace(/[:_]/g, " ")}
                        </p>
                        {event.detail && (
                          <p className="text-xs text-slate-600">{event.detail}</p>
                        )}
                        <p className="text-xs text-slate-400">
                          {formatDateTime(event.created_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmploymentTab({
  file,
  colleagues,
  editable,
  onSaved,
  setError,
}: {
  file: EmployeeFile;
  colleagues: User[];
  editable: boolean;
  onSaved: (message: string) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const { profile, user } = file;
  const [form, setForm] = useState({
    staff_no: profile?.staff_no ?? "",
    job_title: profile?.job_title ?? "",
    department: profile?.department ?? "",
    employment_type: profile?.employment_type ?? "permanent",
    employment_status: profile?.employment_status ?? "onboarding",
    start_date: profile?.start_date ?? "",
    probation_end_date: profile?.probation_end_date ?? "",
    confirmed_on: profile?.confirmed_on ?? "",
    exit_date: profile?.exit_date ?? "",
    line_manager_id: profile?.line_manager_id ?? "",
    work_location: profile?.work_location ?? "",
  });
  const [busy, setBusy] = useState(false);

  if (!editable) {
    return (
      <dl className="divide-y divide-slate-100">
        <DetailRow label="Staff number">{profile?.staff_no ?? "—"}</DetailRow>
        <DetailRow label="Job title">{profile?.job_title ?? "—"}</DetailRow>
        <DetailRow label="Department">{profile?.department ?? "—"}</DetailRow>
        <DetailRow label="Employment type">
          {profile ? EMPLOYMENT_TYPE_LABELS[profile.employment_type] : "—"}
        </DetailRow>
        <DetailRow label="Start date">{formatDate(profile?.start_date)}</DetailRow>
        <DetailRow label="Probation ends">
          {formatDate(profile?.probation_end_date)}
        </DetailRow>
        <DetailRow label="Line manager">{profile?.line_manager_id ? "On file" : "—"}</DetailRow>
        <DetailRow label="Work location">{profile?.work_location ?? "—"}</DetailRow>
        <DetailRow label="Account email">{user.email}</DetailRow>
      </dl>
    );
  }

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(form)) payload[key] = value || null;
      await api.updateEmployee(user.id, payload);
      await onSaved("Employment record saved.");
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not save the record.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Staff number">
          {(id) => (
            <TextInput
              id={id}
              value={form.staff_no}
              onChange={(e) => set("staff_no")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Job title">
          {(id) => (
            <TextInput
              id={id}
              value={form.job_title}
              onChange={(e) => set("job_title")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Department">
          {(id) => (
            <TextInput
              id={id}
              value={form.department}
              onChange={(e) => set("department")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Employment type">
          {(id) => (
            <Select
              id={id}
              value={form.employment_type}
              onChange={(e) => set("employment_type")(e.target.value)}
            >
              {options(EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABELS)}
            </Select>
          )}
        </Field>
        <Field label="Employment status">
          {(id) => (
            <Select
              id={id}
              value={form.employment_status}
              onChange={(e) => set("employment_status")(e.target.value)}
            >
              {options(EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABELS)}
            </Select>
          )}
        </Field>
        <Field label="Line manager">
          {(id) => (
            <Select
              id={id}
              value={form.line_manager_id}
              onChange={(e) => set("line_manager_id")(e.target.value)}
            >
              <option value="">Not assigned</option>
              {colleagues
                .filter((c) => c.id !== user.id && atLeast(c.role, "senior_associate"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} — {ROLE_LABELS[c.role]}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label="Start date">
          {(id) => (
            <TextInput
              id={id}
              type="date"
              value={form.start_date}
              onChange={(e) => set("start_date")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Probation end date">
          {(id) => (
            <TextInput
              id={id}
              type="date"
              value={form.probation_end_date}
              onChange={(e) => set("probation_end_date")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Confirmed in post">
          {(id) => (
            <TextInput
              id={id}
              type="date"
              value={form.confirmed_on}
              onChange={(e) => set("confirmed_on")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Work location">
          {(id) => (
            <TextInput
              id={id}
              value={form.work_location}
              onChange={(e) => set("work_location")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Exit date" hint="Only when the employee has left.">
          {(id) => (
            <TextInput
              id={id}
              type="date"
              value={form.exit_date}
              onChange={(e) => set("exit_date")(e.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save employment record"}
        </button>
      </div>
    </form>
  );
}

function DocumentsTab({
  file,
  isHr,
  onChanged,
  setError,
}: {
  file: EmployeeFile;
  isHr: boolean;
  onChanged: () => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [form, setForm] = useState({ label: "", url: "", category: "" });
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Signed and acknowledged
        </h3>
        {!file.signatures.length ? (
          <p className="text-sm text-slate-500">Nothing signed yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {file.signatures.map((signature) => (
              <li
                key={signature.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <Link to={`/documents/${signature.document_id}`} className="link text-sm">
                  {signature.document_title}
                </Link>
                <span className="text-xs text-slate-500">
                  {signature.action === "signed" ? "Signed" : "Acknowledged"} v
                  {signature.version} · {formatDateTime(signature.signed_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {file.outstanding_documents.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Outstanding
          </h3>
          <ul className="divide-y divide-slate-100">
            {file.outstanding_documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2 py-2">
                <Link to={`/documents/${doc.id}`} className="link text-sm">
                  {doc.title}
                </Link>
                <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
                  {doc.requires_signature ? "Signature due" : "Acknowledgement due"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Personnel file
        </h3>
        {!file.documents.length ? (
          <p className="text-sm text-slate-500">No documents on file.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {file.documents.map((doc) => (
              <li key={doc.id} className="py-2">
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="link text-sm"
                >
                  {doc.label}
                </a>
                <p className="text-xs text-slate-500">
                  {doc.category ?? "Uncategorised"} · added by {doc.added_by_name} ·{" "}
                  {formatDate(doc.added_at)}
                  {doc.expires_on && ` · expires ${formatDate(doc.expires_on)}`}
                  {doc.visible_to_employee === 0 && " · internal only"}
                </p>
              </li>
            ))}
          </ul>
        )}

        {isHr && (
          <form
            className="mt-3 grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-[1fr_1fr_2fr_auto]"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api.addEmployeeDocument(file.user.id, form);
                setForm({ label: "", url: "", category: "" });
                await onChanged();
              } catch (err) {
                setError(
                  err instanceof ApiRequestError ? err.message : "Could not add the link.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <TextInput
              required
              placeholder="Description"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              aria-label="Document description"
            />
            <TextInput
              placeholder="Category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              aria-label="Category"
            />
            <TextInput
              required
              type="url"
              placeholder="https://…"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              aria-label="Document URL"
            />
            <button type="submit" className="btn-secondary" disabled={busy}>
              Add
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function PayTab({
  file,
  editable,
  onSaved,
  setError,
}: {
  file: EmployeeFile;
  editable: boolean;
  onSaved: (message: string) => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const c = file.compensation;
  const [form, setForm] = useState({
    annual_salary: c?.annual_salary ? String(c.annual_salary) : "",
    currency: c?.currency ?? "GHS",
    pay_frequency: c?.pay_frequency ?? "monthly",
    bank_name: c?.bank_name ?? "",
    bank_branch: c?.bank_branch ?? "",
    account_name: c?.account_name ?? "",
    account_number: c?.account_number ?? "",
    tax_identification_no: c?.tax_identification_no ?? "",
    social_security_no: c?.social_security_no ?? "",
    notes: c?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);

  if (!editable) {
    return (
      <dl className="divide-y divide-slate-100">
        <DetailRow label="Salary">
          {formatMoney(c?.annual_salary, c?.currency ?? "GHS")} per annum
        </DetailRow>
        <DetailRow label="Paid">
          {c ? PAY_FREQUENCY_LABELS[c.pay_frequency] : "—"}
        </DetailRow>
        <DetailRow label="Bank">{c?.bank_name ?? "—"}</DetailRow>
        <DetailRow label="Account">
          {c?.account_number ? `•••• ${c.account_number.slice(-4)}` : "—"}
        </DetailRow>
        <DetailRow label="Tax identification">
          {c?.tax_identification_no ?? "—"}
        </DetailRow>
        <DetailRow label="Social security">{c?.social_security_no ?? "—"}</DetailRow>
      </dl>
    );
  }

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.updateCompensation(file.user.id, {
            ...form,
            annual_salary: form.annual_salary || null,
          });
          await onSaved("Pay and bank details saved.");
        } catch (err) {
          setError(
            err instanceof ApiRequestError ? err.message : "Could not save the details.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
        Restricted to Partner grade. Changes are recorded on the HR trail, but the values
        themselves are never written to it.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Annual salary">
          {(id) => (
            <TextInput
              id={id}
              type="number"
              min="0"
              step="1"
              value={form.annual_salary}
              onChange={(e) => set("annual_salary")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Currency">
          {(id) => (
            <TextInput
              id={id}
              maxLength={3}
              value={form.currency}
              onChange={(e) => set("currency")(e.target.value.toUpperCase())}
            />
          )}
        </Field>
        <Field label="Pay frequency">
          {(id) => (
            <Select
              id={id}
              value={form.pay_frequency}
              onChange={(e) => set("pay_frequency")(e.target.value)}
            >
              {options(PAY_FREQUENCIES, PAY_FREQUENCY_LABELS)}
            </Select>
          )}
        </Field>
        <Field label="Bank name">
          {(id) => (
            <TextInput
              id={id}
              value={form.bank_name}
              onChange={(e) => set("bank_name")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Branch">
          {(id) => (
            <TextInput
              id={id}
              value={form.bank_branch}
              onChange={(e) => set("bank_branch")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Account name">
          {(id) => (
            <TextInput
              id={id}
              value={form.account_name}
              onChange={(e) => set("account_name")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Account number">
          {(id) => (
            <TextInput
              id={id}
              value={form.account_number}
              onChange={(e) => set("account_number")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Tax identification number">
          {(id) => (
            <TextInput
              id={id}
              value={form.tax_identification_no}
              onChange={(e) => set("tax_identification_no")(e.target.value)}
            />
          )}
        </Field>
        <Field label="Social security number">
          {(id) => (
            <TextInput
              id={id}
              value={form.social_security_no}
              onChange={(e) => set("social_security_no")(e.target.value)}
            />
          )}
        </Field>
      </div>

      <Field label="Notes">
        {(id) => (
          <TextArea
            id={id}
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        )}
      </Field>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save pay details"}
        </button>
      </div>
    </form>
  );
}
