/**
 * The firm's standing wording for the three emails an invoice sends: the invoice
 * itself, the notice on the day payment falls due, and the overdue reminder.
 *
 * This is where the automatic ones are changed. The monthly run issues invoices and the
 * schedule sends notices and reminders with nobody at a keyboard, so there is no send
 * window to edit them in - they go out in whatever is saved here. Each letter is shown
 * beside a preview built by the same function that sends it, filled in with example
 * figures, so the effect of a change is visible before it is saved.
 *
 * Saving the standard words stores nothing, so an improvement to the standard later
 * still reaches a firm that never changed it.
 */

import { useEffect, useMemo, useState } from "react";
import {
  INVOICE_EMAIL_LIMITS,
  INVOICE_EMAIL_NAMES,
  INVOICE_EMAIL_SETTINGS,
  STANDARD_INVOICE_EMAILS,
  composeInvoiceEmail,
  wordingFor,
} from "@shared/invoice-email-wording";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Spinner, SuccessBanner } from "./ui";
import { EmailPreview, WordingFields } from "./InvoiceEmailComposer";

const LETTERS = ["issued", "due_today", "overdue"] as const;
type Letter = (typeof LETTERS)[number];

/** When each letter goes, in a line under its name. */
const WHEN: Record<Letter, string> = {
  issued: "When an invoice is issued, by hand or by the monthly run, and when it is sent again.",
  due_today: "On the day payment falls due, if it is still unpaid.",
  overdue: "On the reminder schedule once it is late, and when somebody chases it by hand.",
};

/** "15 October 2026", some days from today. */
function letterDateFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function EmailWordingAdmin() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [letter, setLetter] = useState<Letter>("issued");
  const [drafts, setDrafts] = useState<Partial<Record<Letter, { subject: string; message: string }>>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .settings()
      .then((s) => setSettings(s.settings as unknown as Record<string, string>))
      .catch((err) =>
        setError(err instanceof ApiRequestError ? err.message : "Could not load the settings."),
      );
  }, []);

  const saved = settings ? wordingFor(letter, settings) : STANDARD_INVOICE_EMAILS[letter];
  const current = drafts[letter] ?? saved;
  const standard = STANDARD_INVOICE_EMAILS[letter];
  const changed = current.subject !== saved.subject || current.message !== saved.message;
  const isStandard = current.subject.trim() === standard.subject && current.message.trim() === standard.message;
  const savedIsStandard = saved.subject === standard.subject && saved.message === standard.message;

  const edit = (patch: Partial<{ subject: string; message: string }>) =>
    setDrafts((d) => ({ ...d, [letter]: { ...current, ...patch } }));

  const preview = useMemo(
    () =>
      composeInvoiceEmail(current, {
        name: "Ama Owusu",
        number: "INV202610",
        firmName: settings?.firm_name ?? "",
        amountDue: "GHS 1,494.00",
        dueOn: letterDateFromToday(letter === "overdue" ? -10 : letter === "due_today" ? 0 : 15),
        link: "#the-invoice-in-the-portal",
        pixel: "",
      }),
    [current, settings, letter],
  );

  if (!settings) return error ? <ErrorBanner error={error} /> : <Spinner label="Loading" />;

  const save = async () => {
    setBusy(true);
    setError(null);
    const keys = INVOICE_EMAIL_SETTINGS[letter];
    const subject = current.subject.replace(/[\r\n]+/g, " ").trim();
    const message = current.message.replace(/\r\n?/g, "\n").trim();
    try {
      const r = await api.updateSettings({
        [keys.subject]: subject === standard.subject ? "" : subject,
        [keys.message]: message === standard.message ? "" : message,
      } as never);
      setSettings(r.settings as unknown as Record<string, string>);
      setDrafts((d) => ({ ...d, [letter]: undefined }));
      setDone(`${INVOICE_EMAIL_NAMES[letter]}: saved. Everything sent from now on uses it.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Invoice emails</h2>
      </div>
      <div className="space-y-4 p-4">
        <p className="muted text-sm">
          The words each email goes out with, including the ones sent automatically. Anybody
          sending one by hand can still change it for that one email.
        </p>
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {done && <SuccessBanner message={done} onDismiss={() => setDone(null)} />}

        <div className="flex flex-wrap gap-1 rounded-md bg-slate-100 p-0.5 text-sm" role="tablist">
          {LETTERS.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={letter === l}
              onClick={() => setLetter(l)}
              className={`rounded px-3 py-1 ${letter === l ? "bg-panel font-semibold text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              {INVOICE_EMAIL_NAMES[l]}
              {drafts[l] ? " •" : ""}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600">{WHEN[letter]}</span>
          <span
            className={`pill ${savedIsStandard ? "bg-slate-100 text-slate-600 ring-slate-200" : "bg-brand-50 text-link ring-brand-200"}`}
          >
            {savedIsStandard ? "Standard wording" : "The firm's own wording"}
          </span>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <WordingFields
              subject={current.subject}
              message={current.message}
              onSubject={(subject) => edit({ subject })}
              onMessage={(message) => edit({ message })}
              limits={INVOICE_EMAIL_LIMITS}
              rows={14}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !changed || !current.subject.trim() || !current.message.trim()}
                onClick={() => void save()}
              >
                {busy ? "Saving..." : "Save"}
              </button>
              {changed && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setDrafts((d) => ({ ...d, [letter]: undefined }))}
                >
                  Undo my changes
                </button>
              )}
              {!isStandard && (
                <button type="button" className="link text-sm" onClick={() => edit(standard)}>
                  Use the standard wording
                </button>
              )}
            </div>
          </div>
          <div className="lg:sticky lg:top-4 lg:self-start">
            <EmailPreview
              fromName={`${settings.firm_name} Finance`}
              to="Ama Owusu <ama@example.com>"
              subject={preview.subject}
              html={preview.html}
              attachment="inv202610-example-client.html"
            />
            <p className="hint">An example client and figures, to show how it reads.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
