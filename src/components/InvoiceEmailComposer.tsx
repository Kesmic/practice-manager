/**
 * The email an invoice goes out with, shown before it is sent and editable, beside a
 * preview of exactly what the client will read.
 *
 * Modelled on how Xero emails an invoice: who it goes to and who is copied as
 * removable chips, a subject and a message in plain words with a few bracketed words
 * the portal fills in for each recipient, the invoice attached, and a live preview.
 * The preview is not a lookalike - it is the same function the Worker sends with
 * (shared/invoice-email-wording.ts), fed the same figures.
 *
 * Every recipient gets their own copy, greeted by name, because each copy carries its
 * own tracking for the invoice's History. So "To" here means "send a copy to each of
 * these", and the preview can be switched between them.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  INVOICE_EMAIL_PLACEHOLDERS,
  composeInvoiceEmail,
  looksLikeEmail,
  unknownPlaceholders,
} from "@shared/invoice-email-wording";
import type { InvoiceEmailComposed, InvoiceEmailDraft } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import { ErrorBanner, Modal, Spinner, TextInput } from "./ui";

type Outcome = { sent_to: string[]; failed: Array<{ email: string; error: string }> };

export function InvoiceEmailComposer({
  invoiceId,
  kind,
  onClose,
  onDone,
}: {
  invoiceId: string;
  kind: "issued" | "resent";
  onClose: () => void;
  /** Called once it has gone, with a sentence saying what happened. */
  onDone: (message: string) => void;
}) {
  const [draft, setDraft] = useState<InvoiceEmailDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attach, setAttach] = useState(true);
  const [saveWording, setSaveWording] = useState(false);
  const [previewAs, setPreviewAs] = useState(0);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    api
      .invoiceEmail(invoiceId, kind)
      .then((d) => {
        if (!live) return;
        setDraft(d);
        setTo(d.contacts.map((c) => c.email));
        setCc(d.cc);
        setSubject(d.wording.subject);
        setMessage(d.wording.message);
      })
      .catch((err) => {
        if (live) setError(err instanceof ApiRequestError ? err.message : "Could not prepare the email.");
      });
    return () => {
      live = false;
    };
  }, [invoiceId, kind]);

  const nameOf = (email: string) =>
    draft?.contacts.find((c) => c.email.toLowerCase() === email.toLowerCase())?.full_name ?? "";

  const who = to[Math.min(previewAs, Math.max(to.length - 1, 0))] ?? "";
  const preview = useMemo(() => {
    if (!draft) return null;
    return composeInvoiceEmail(
      { subject, message },
      {
        name: nameOf(who),
        number: draft.facts.number,
        firmName: draft.facts.firm_name,
        amountDue: draft.facts.amount_due,
        dueOn: draft.facts.due_on,
        link: "#the-invoice-in-the-portal",
        pixel: "",
      },
    );
    // nameOf reads only draft and who, both listed.
  }, [draft, subject, message, who]);

  const stray = useMemo(() => unknownPlaceholders(`${subject}\n${message}`), [subject, message]);
  const edited = draft
    ? subject.trim() !== draft.wording.subject.trim() || message.trim() !== draft.wording.message.trim()
    : false;
  const isStandard = draft
    ? subject.trim() === draft.standard.subject && message.trim() === draft.standard.message
    : true;

  // Puts a placeholder where the cursor is, as Xero's "insert placeholder" does.
  const insert = (token: string) => {
    const el = messageRef.current;
    const start = el?.selectionStart ?? message.length;
    const end = el?.selectionEnd ?? message.length;
    const next = message.slice(0, start) + token + message.slice(end);
    setMessage(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const send = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const composed: InvoiceEmailComposed = {
      to,
      cc,
      subject,
      message,
      attach,
      save_wording: saveWording,
    };
    try {
      const r: Outcome =
        kind === "issued"
          ? await api.sendInvoice(invoiceId, composed)
          : await api.resendInvoice(invoiceId, composed);
      const missed = r.failed.length
        ? ` It could not reach ${r.failed.map((f) => f.email).join(", ")}${r.failed[0] ? ` (${r.failed[0].error})` : ""}.`
        : "";
      const saved = saveWording ? " The wording is saved for future invoices." : "";
      if (kind === "issued") {
        onDone(
          r.sent_to.length
            ? `Issued and emailed to ${r.sent_to.join(", ")}.${missed}${saved}`
            : to.length
              ? `Issued, but the email did not go.${missed}${saved}`
              : `Issued without emailing.${saved}`,
        );
      } else {
        onDone(`Sent again to ${r.sent_to.join(", ")}.${missed}${saved}`);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not send it.");
      setBusy(false);
    }
  };

  const title =
    kind === "issued"
      ? `Issue and email ${draft?.facts.number ?? "the invoice"}`
      : `Send ${draft?.facts.number ?? "the invoice"} again`;
  const action =
    kind === "issued" ? (to.length ? "Issue and send" : "Issue without emailing") : "Send it again";
  const tooLong =
    draft &&
    (subject.length > draft.limits.subject || message.length > draft.limits.message);
  const blocked = busy || !draft || !subject.trim() || !message.trim() || Boolean(tooLong) || (kind === "resent" && !to.length);

  return (
    <Modal
      open
      xwide
      title={title}
      onClose={onClose}
      footer={
        <>
          {draft && (
            <p className="mr-auto text-xs text-slate-500">
              {to.length > 1
                ? `${to.length} copies, one to each person, addressed to them by name.`
                : to.length === 1
                  ? "One copy."
                  : kind === "issued"
                    ? "Nobody to email: it will be issued, and the client sees it in the portal."
                    : "Add somebody to send it to."}
            </p>
          )}
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => void send()} disabled={blocked}>
            {busy ? "Sending…" : action}
          </button>
        </>
      }
    >
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {!draft && !error && <Spinner label="Preparing the email" />}
      {draft && (
        <>
          <div className="mb-3 inline-flex rounded-md bg-slate-100 p-0.5 text-sm lg:hidden" role="tablist">
            {(["edit", "preview"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded px-3 py-1 ${tab === t ? "bg-panel font-semibold text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                {t === "edit" ? "Edit" : "Preview"}
              </button>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* ------------------------------------------------------------ edit */}
            <div className={`space-y-4 ${tab === "edit" ? "" : "hidden lg:block"}`}>
              {!draft.email_ready && (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                  Email is not set up on this portal yet, so nothing will actually be sent
                  {kind === "issued" ? " - the invoice will still be issued" : ""}. Every
                  attempt is still logged in the invoice&rsquo;s History.
                </div>
              )}

              <div className="text-sm">
                <span className="label inline">From</span>{" "}
                <span className="font-medium text-slate-900">{draft.from_name}</span>
                {draft.reply_to && (
                  <span className="text-slate-500"> · replies go to {draft.reply_to}</span>
                )}
              </div>

              <AddressField
                label="To"
                values={to}
                onChange={(next) => {
                  setTo(next);
                  setPreviewAs(0);
                }}
                describe={nameOf}
                suggestions={draft.contacts.filter(
                  (c) => !to.some((t) => t.toLowerCase() === c.email.toLowerCase()),
                )}
                empty={
                  draft.contacts.length
                    ? "Nobody. Add a billing contact back, or type an address."
                    : "Nobody at this client has an email address on file. Type one to send it."
                }
              />
              <AddressField label="Cc" values={cc} onChange={setCc} describe={() => ""} />

              <div>
                <label className="label" htmlFor="invoice-email-subject">
                  Subject
                </label>
                <TextInput
                  id="invoice-email-subject"
                  value={subject}
                  maxLength={draft.limits.subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div>
                <label className="label" htmlFor="invoice-email-message">
                  Message
                </label>
                <textarea
                  id="invoice-email-message"
                  ref={messageRef}
                  rows={15}
                  value={message}
                  maxLength={draft.limits.message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="input leading-relaxed"
                />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500">Insert:</span>
                  {INVOICE_EMAIL_PLACEHOLDERS.map((p) => (
                    <button
                      key={p.token}
                      type="button"
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-brand-50 hover:text-link"
                      title={p.hint}
                      onClick={() => insert(p.token)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="hint">
                  Words in square brackets are filled in for each person. [here] becomes a link
                  to the invoice in the client portal, and [Summary] on its own line becomes
                  the box with the number, amount and due date.
                </p>
                {stray.length > 0 && (
                  <p className="mt-1 text-xs text-amber-800">
                    {stray.join(", ")} {stray.length === 1 ? "is not" : "are not"} filled in by
                    the portal, so {stray.length === 1 ? "it" : "they"} will be sent exactly as
                    typed.
                  </p>
                )}
              </div>

              <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={attach}
                    onChange={(e) => setAttach(e.target.checked)}
                  />
                  <span>
                    Attach the invoice <span className="text-slate-500">({draft.attachment_name})</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={saveWording}
                    onChange={(e) => setSaveWording(e.target.checked)}
                  />
                  <span>
                    Use this subject and message for every invoice from now on
                    <span className="block text-xs text-slate-500">
                      Including the ones the monthly billing run sends by itself. Who it goes
                      to is not saved.
                    </span>
                  </span>
                </label>
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs">
                  {edited && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setSubject(draft.wording.subject);
                        setMessage(draft.wording.message);
                      }}
                    >
                      Undo my changes
                    </button>
                  )}
                  {!isStandard && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setSubject(draft.standard.subject);
                        setMessage(draft.standard.message);
                      }}
                    >
                      Use the standard wording
                    </button>
                  )}
                  {draft.firm_wording && (
                    <span className="text-slate-500">This starts from the firm&rsquo;s saved wording.</span>
                  )}
                </div>
              </div>
            </div>

            {/* --------------------------------------------------------- preview */}
            {/* Pinned on a wide screen, so the preview stays beside whatever is being edited. */}
            <div className={`lg:sticky lg:top-0 lg:self-start ${tab === "preview" ? "" : "hidden lg:block"}`}>
              <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
                <div className="space-y-1 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Preview
                    </span>
                    {to.length > 1 && (
                      <select
                        className="rounded border-0 bg-panel py-0.5 pl-2 pr-7 text-xs ring-1 ring-slate-300"
                        value={Math.min(previewAs, to.length - 1)}
                        onChange={(e) => setPreviewAs(Number(e.target.value))}
                        aria-label="Preview the copy for"
                      >
                        {to.map((email, i) => (
                          <option key={email} value={i}>
                            As {nameOf(email) || email}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <PreviewRow label="From" value={draft.from_name} />
                  <PreviewRow
                    label="To"
                    value={who ? (nameOf(who) ? `${nameOf(who)} <${who}>` : who) : "Nobody yet"}
                  />
                  {cc.length > 0 && <PreviewRow label="Cc" value={cc.join(", ")} />}
                  <PreviewRow label="Subject" value={preview?.subject ?? ""} strong />
                </div>
                <iframe
                  title="What the client will read"
                  sandbox=""
                  srcDoc={preview?.html ?? ""}
                  className="block h-[26rem] w-full bg-slate-100 lg:h-[calc(70vh-16rem)] lg:min-h-[18rem]"
                />
                {attach && (
                  <div className="border-t border-slate-200 bg-panel px-4 py-2 text-xs text-slate-600">
                    <span aria-hidden="true">📎</span> {draft.attachment_name}
                  </div>
                )}
              </div>
              <p className="hint">
                &ldquo;here&rdquo; opens the invoice in the client portal. Opens and clicks show
                in the invoice&rsquo;s History once it has gone.
              </p>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function PreviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-slate-500">{label}</span>
      <span className={`min-w-0 break-words ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * A list of addresses as chips, with a box to add more. Enter, a comma or leaving the
 * box adds what was typed; a pasted list is split; backspace in an empty box takes the
 * last one off. Billing contacts not on the list are offered back with one click.
 */
function AddressField({
  label,
  values,
  onChange,
  describe,
  suggestions = [],
  empty,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  describe: (email: string) => string;
  suggestions?: Array<{ email: string; full_name: string }>;
  empty?: string;
}) {
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const id = `address-${label.toLowerCase()}`;

  const add = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return true;
    const bad = parts.filter((p) => !looksLikeEmail(p));
    const good = parts.filter((p) => looksLikeEmail(p));
    const next = [...values];
    for (const g of good) {
      if (!next.some((v) => v.toLowerCase() === g.toLowerCase())) next.push(g);
    }
    if (good.length) onChange(next);
    setProblem(bad.length ? `${bad.join(", ")} does not look like an email address.` : null);
    setTyped(bad.join(", "));
    return !bad.length;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      add(typed);
    } else if (e.key === "Backspace" && !typed && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-panel px-2 py-1.5 ring-1 ring-inset ring-slate-300 focus-within:ring-2 focus-within:ring-brand-500">
        {values.map((email) => (
          <span
            key={email}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs text-slate-800 ring-1 ring-inset ring-brand-200"
            title={email}
          >
            <span className="truncate">
              {describe(email) ? (
                <>
                  <span className="font-medium">{describe(email)}</span>{" "}
                  <span className="text-slate-500">{email}</span>
                </>
              ) : (
                email
              )}
            </span>
            <button
              type="button"
              className="rounded-full px-1 text-slate-500 hover:bg-brand-100 hover:text-slate-900"
              aria-label={`Remove ${email}`}
              onClick={() => onChange(values.filter((v) => v !== email))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          type="email"
          multiple
          className="min-w-[10rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-0"
          placeholder={values.length ? "Add another" : "Type an email address"}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setProblem(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => add(typed)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[\s,;]/.test(text.trim())) {
              e.preventDefault();
              add(`${typed}${text}`);
            }
          }}
        />
      </div>
      {problem && <p className="mt-1 text-xs text-rose-700">{problem}</p>}
      {!values.length && empty && !problem && <p className="hint">{empty}</p>}
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s.email}
              type="button"
              className="rounded-full px-2 py-0.5 text-xs text-link ring-1 ring-inset ring-slate-200 hover:bg-brand-50"
              onClick={() => onChange([...values, s.email])}
            >
              + {s.full_name || s.email}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
