import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ENTITY_TYPES, ENTITY_TYPE_LABELS } from "@shared/workflow";
import { REQUEST_LIMITS, type IntakeForm, type RequestKind } from "@shared/intake";
import { ApiRequestError, api } from "../lib/api";
import { FirmLogo, useFirm } from "../lib/firm";
import {
  ErrorBanner,
  Field,
  Select,
  Spinner,
  TextArea,
  TextInput,
  options,
} from "../components/ui";

/**
 * The public side of client intake: the page the two links open.
 *
 * This is the only screen in the portal a stranger can reach and post from, and it
 * is written for that audience rather than for staff. Four things follow from it:
 *
 * 1. **It asks for as little as it can get away with.** Everything except the
 *    organisation, a name, an email address and what they want is optional. A
 *    prospective client abandoning the form because it demanded a tax number is a
 *    worse outcome than a record with gaps.
 * 2. **The two kinds ask different questions.** An existing client is not asked to
 *    retype its registered address; the firm already has it. Asking anyway is how a
 *    form tells someone the firm is not paying attention.
 * 3. **It says what happens next**, before and after submitting. Silence after a
 *    form is submitted is what makes people telephone.
 * 4. **It carries the firm's logo and colours** but nothing else from inside: no
 *    navigation, no sign-in prompt, and no hint of what the portal holds.
 */
export function Intake() {
  const params = useParams<{ kind: string; token: string }>();
  const kind = params.kind as RequestKind;
  const token = params.token ?? "";

  const [form, setForm] = useState<IntakeForm | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  useEffect(() => {
    api
      .intakeForm(kind, token)
      .then((res) => setForm(res.form))
      .catch((err) =>
        setDead(
          err instanceof ApiRequestError
            ? err.message
            : "This link could not be opened. Please check it and try again.",
        ),
      );
  }, [kind, token]);

  if (dead) return <Shell><LinkProblem message={dead} /></Shell>;
  if (!form) return <Shell><Spinner label="Opening the form" /></Shell>;
  if (reference) {
    return (
      <Shell>
        <Received reference={reference} firm={form.firm_name} />
      </Shell>
    );
  }

  return (
    <Shell>
      <RequestForm form={form} kind={kind} token={token} onSent={setReference} />
    </Shell>
  );
}

/** The frame: the firm's logo, the card, and a footer that sets expectations. */
function Shell({ children }: { children: React.ReactNode }) {
  const { branding } = useFirm();
  return (
    <div className="min-h-screen bg-page px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex justify-center">
          <FirmLogo maxWidth="max-w-[15rem]" maxHeight="max-h-16" labelled />
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-slate-400">
          {branding.firm_name}. This form is for enquiries only. Do not send passwords
          or payment details through it.
        </p>
      </div>
    </div>
  );
}

function LinkProblem({ message }: { message: string }) {
  return (
    <div className="card p-6 text-center">
      <h1 className="section-title">This link is not working</h1>
      <p className="muted mx-auto mt-2 max-w-md">{message}</p>
      <p className="muted mx-auto mt-3 max-w-md">
        Links are replaced from time to time. If you were sent this one a while ago,
        ask the firm for the current address.
      </p>
    </div>
  );
}

/** After a successful submission. The reference is the whole point of this screen. */
function Received({
  reference,
  firm,
}: {
  reference: string;
  firm: string;
}) {
  return (
    <div className="card p-6 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-xl text-emerald-700">
        ✓
      </div>
      <h1 className="section-title">Thank you, we have it</h1>
      <p className="muted mx-auto mt-2 max-w-md">
        Your enquiry has reached {firm} and is with the people who can act on it.
      </p>
      <p className="mt-4 text-sm text-slate-700">
        Your reference is{" "}
        <span className="rounded bg-slate-100 px-2 py-1 font-mono font-semibold text-slate-800">
          {reference}
        </span>
      </p>
      <p className="muted mx-auto mt-4 max-w-md">
        Please keep it and quote it if you get in touch again. Someone will reply to
        the email address you gave. You can close this page.
      </p>
    </div>
  );
}

interface FormState {
  organisation: string;
  client_ref: string;
  entity_type: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  tax_id: string;
  registration_no: string;
  industry: string;
  fiscal_year_end: string;
  address: string;
  details: string;
  preferred_start: string;
  services: string[];
}

const EMPTY: FormState = {
  organisation: "",
  client_ref: "",
  entity_type: "company",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  tax_id: "",
  registration_no: "",
  industry: "",
  fiscal_year_end: "",
  address: "",
  details: "",
  preferred_start: "",
  services: [],
};

function RequestForm({
  form,
  kind,
  token,
  onSent,
}: {
  form: IntakeForm;
  kind: RequestKind;
  token: string;
  onSent: (reference: string) => void;
}) {
  const [state, setState] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isNew = kind === "new";
  const text = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setState((prev) => ({ ...prev, [key]: event.target.value }));

  const toggleService = (service: string) =>
    setState((prev) => ({
      ...prev,
      services: prev.services.includes(service)
        ? prev.services.filter((s) => s !== service)
        : [...prev.services, service],
    }));

  // Sent as a whole, with the blanks left out rather than sent as empty strings,
  // so the server stores nulls and the review screen can show what was really given.
  const payload = useMemo(() => {
    const keep = (value: string) => (value.trim() ? value.trim() : undefined);
    const common = {
      organisation: state.organisation.trim(),
      contact_name: state.contact_name.trim(),
      contact_email: state.contact_email.trim(),
      contact_phone: keep(state.contact_phone),
      services: state.services,
      details: keep(state.details),
      preferred_start: keep(state.preferred_start),
    };
    return isNew
      ? {
          ...common,
          entity_type: state.entity_type || undefined,
          tax_id: keep(state.tax_id),
          registration_no: keep(state.registration_no),
          industry: keep(state.industry),
          fiscal_year_end: keep(state.fiscal_year_end),
          address: keep(state.address),
        }
      : { ...common, client_ref: keep(state.client_ref) };
  }, [state, isNew]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!state.services.length) {
      setError("Please tick at least one service so we know who should reply.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitIntake(kind, token, payload);
      onSent(res.reference);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "That did not send. Please try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card space-y-6 p-5 sm:p-6" onSubmit={submit}>
      <div>
        <h1 className="section-title">
          {isNew ? "Enquire about our services" : "Request a service"}
        </h1>
        <p className="muted mt-1">
          {isNew
            ? `Tell us who you are and what you need, and the right person at ${form.firm_name} will come back to you. Only the first few boxes are required.`
            : `You already have a file with ${form.firm_name}. Tell us what you need and we will pick it up from your existing records.`}
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">
          {isNew ? "About your organisation" : "About you"}
        </h2>

        <Field label={isNew ? "Organisation name" : "Client name as we hold it"} required
          hint={isNew ? undefined : "The name your account is under. If you are unsure, your best guess is fine."}>
          {(id) => (
            <TextInput
              id={id}
              required
              maxLength={REQUEST_LIMITS.organisation}
              value={state.organisation}
              onChange={text("organisation")}
              placeholder={isNew ? "Acme Ghana Limited" : "Acme Ghana Limited"}
            />
          )}
        </Field>

        {!isNew && (
          <Field
            label="Your client reference"
            hint="If you know it, from a previous invoice or letter. Leave it blank if you do not."
          >
            {(id) => (
              <TextInput
                id={id}
                maxLength={REQUEST_LIMITS.client_ref}
                value={state.client_ref}
                onChange={text("client_ref")}
                placeholder="CLI-0042"
              />
            )}
          </Field>
        )}

        {isNew && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type of entity">
              {(id) => (
                <Select id={id} value={state.entity_type} onChange={text("entity_type")}>
                  {options(ENTITY_TYPES, ENTITY_TYPE_LABELS)}
                </Select>
              )}
            </Field>
            <Field label="Industry or sector">
              {(id) => (
                <TextInput
                  id={id}
                  maxLength={REQUEST_LIMITS.industry}
                  value={state.industry}
                  onChange={text("industry")}
                  placeholder="Manufacturing"
                />
              )}
            </Field>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Who we should reply to</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" required>
            {(id) => (
              <TextInput
                id={id}
                required
                maxLength={REQUEST_LIMITS.contact_name}
                value={state.contact_name}
                onChange={text("contact_name")}
                autoComplete="name"
              />
            )}
          </Field>
          <Field label="Email address" required>
            {(id) => (
              <TextInput
                id={id}
                type="email"
                required
                maxLength={REQUEST_LIMITS.contact_email}
                value={state.contact_email}
                onChange={text("contact_email")}
                autoComplete="email"
              />
            )}
          </Field>
          <Field label="Telephone">
            {(id) => (
              <TextInput
                id={id}
                type="tel"
                maxLength={REQUEST_LIMITS.contact_phone}
                value={state.contact_phone}
                onChange={text("contact_phone")}
                autoComplete="tel"
              />
            )}
          </Field>
          <Field label="When would you like us to start?" hint="Approximate is fine.">
            {(id) => (
              <TextInput
                id={id}
                type="date"
                value={state.preferred_start}
                onChange={text("preferred_start")}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">
          What do you need help with? <span className="text-rose-600">*</span>
        </h2>
        <p className="hint">Tick everything that applies. It decides who reads this.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {form.services.map((service) => {
            const checked = state.services.includes(service.key);
            return (
              <label
                key={service.key}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${
                  checked
                    ? "border-brand-500 bg-brand-50 font-medium text-link"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  checked={checked}
                  onChange={() => toggleService(service.key)}
                />
                {service.label}
              </label>
            );
          })}
        </div>
      </section>

      {isNew && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">
            Registration details, if you have them to hand
          </h2>
          <p className="hint">
            All optional. Giving them now saves a round of emails later, and leaving
            them blank costs you nothing.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tax identification number">
              {(id) => (
                <TextInput
                  id={id}
                  maxLength={REQUEST_LIMITS.tax_id}
                  value={state.tax_id}
                  onChange={text("tax_id")}
                />
              )}
            </Field>
            <Field label="Registration number">
              {(id) => (
                <TextInput
                  id={id}
                  maxLength={REQUEST_LIMITS.registration_no}
                  value={state.registration_no}
                  onChange={text("registration_no")}
                />
              )}
            </Field>
            <Field label="Financial year end" hint="Month and day, for example 12-31.">
              {(id) => (
                <TextInput
                  id={id}
                  value={state.fiscal_year_end}
                  onChange={text("fiscal_year_end")}
                  placeholder="12-31"
                />
              )}
            </Field>
            <Field label="Registered address">
              {(id) => (
                <TextInput
                  id={id}
                  maxLength={REQUEST_LIMITS.address}
                  value={state.address}
                  onChange={text("address")}
                />
              )}
            </Field>
          </div>
        </section>
      )}

      <Field
        label="Anything else we should know"
        hint="Deadlines you are working to, what has gone wrong, what you have already tried. This is the part people read first."
      >
        {(id) => (
          <TextArea
            id={id}
            rows={5}
            maxLength={REQUEST_LIMITS.details}
            value={state.details}
            onChange={text("details")}
          />
        )}
      </Field>

      <div className="border-t border-slate-200 pt-4">
        <p className="hint mb-3">
          What happens next: you get a reference straight away, and someone at the
          firm replies to your email address. Nothing you send here is visible to
          anyone outside {form.firm_name}.
        </p>
        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={busy}>
          {busy ? "Sending…" : isNew ? "Send enquiry" : "Send request"}
        </button>
      </div>
    </form>
  );
}
