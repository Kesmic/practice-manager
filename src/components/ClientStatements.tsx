/**
 * Statements of account for one client, as QuickBooks Online does them: choose the
 * kind and the dates, see it drawn up, then download it as a PDF or email it.
 *
 * The card lists what has been sent; "Create a statement" opens the window. Its first
 * step is the statement itself, shown as the client will read it; its second is the
 * email, editable, with the PDF attached - the same window invoices go out through.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AGEING_LABELS,
  STATEMENT_TYPES,
  STATEMENT_TYPE_HINTS,
  STATEMENT_TYPE_LABELS,
  type Statement,
  type StatementType,
} from "@shared/statements";
import { STATEMENT_EMAIL_PLACEHOLDERS, composeStatementEmail } from "@shared/invoice-email-wording";
import type { StatementEmailDraft, StatementSentRow, StatementView } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import { formatDate, formatDateTime, formatMoneyExact } from "../lib/format";
import { ErrorBanner, Modal, Spinner, TextInput } from "./ui";
import { AddressField, EmailPreview, WordingFields } from "./InvoiceEmailComposer";

const today = () => new Date().toISOString().slice(0, 10);

export function ClientStatements({ clientId }: { clientId: string }) {
  const [sent, setSent] = useState<StatementSentRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    api
      .statementsSent(clientId)
      .then((r) => setSent(r.statements))
      .catch(() => setSent([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Statements</h2>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>
          Create a statement…
        </button>
      </div>
      <div className="p-4">
        {notice && <p className="mb-2 text-sm text-emerald-800">{notice}</p>}
        {!sent ? (
          <Spinner label="Loading" />
        ) : !sent.length ? (
          <p className="muted text-sm">
            No statement has been sent to this client yet. A statement sets out their invoices and
            payments and what they owe - balance forward, open item or a list of transactions.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {sent.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <span className="font-medium text-slate-900">
                  {STATEMENT_TYPE_LABELS[s.kind]} · {formatDate(s.statement_date)}
                </span>
                <span className="tabular-nums">{formatMoneyExact(s.amount_due, s.currency)} due</span>
                <span className="min-w-0 break-words text-slate-600">
                  to {s.recipient_name ? `${s.recipient_name} <${s.recipient_email}>` : s.recipient_email}
                </span>
                <span className="text-xs text-slate-500">
                  {formatDateTime(s.sent_at)}
                  {s.sent_by_name ? ` by ${s.sent_by_name}` : ""}
                </span>
                {s.status === "failed" && (
                  <span className="pill bg-rose-50 text-rose-800 ring-rose-200" title={s.error ?? ""}>
                    Not delivered
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && (
        <StatementModal
          clientId={clientId}
          onClose={() => setOpen(false)}
          onSent={(message) => {
            setOpen(false);
            setNotice(message);
            void load();
          }}
        />
      )}
    </section>
  );
}

function StatementModal({
  clientId,
  onClose,
  onSent,
}: {
  clientId: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [type, setType] = useState<StatementType>("balance_forward");
  const [date, setDate] = useState(today());
  const [start, setStart] = useState(`${today().slice(0, 4)}-01-01`);
  const [end, setEnd] = useState(today());
  const [currency, setCurrency] = useState("");
  const [view, setView] = useState<StatementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"statement" | "email">("statement");

  const query = useMemo(() => {
    const q = new URLSearchParams({ type, date });
    if (type !== "open_item") {
      q.set("start", start);
      q.set("end", end > date ? date : end);
    }
    if (currency) q.set("currency", currency);
    return q.toString();
  }, [type, date, start, end, currency]);

  useEffect(() => {
    let live = true;
    setError(null);
    api
      .statement(clientId, query)
      .then((v) => {
        if (!live) return;
        setView(v);
        if (!currency) setCurrency(v.currency);
      })
      .catch((err) => live && setError(err instanceof ApiRequestError ? err.message : "Could not draw it up."));
    return () => {
      live = false;
    };
    // currency is part of query; set once from the first answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, query]);

  if (step === "email" && view) {
    return (
      <StatementEmail
        clientId={clientId}
        query={query}
        view={view}
        onBack={() => setStep("statement")}
        onClose={onClose}
        onSent={onSent}
      />
    );
  }

  return (
    <Modal
      open
      xwide
      title="Create a statement"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <a className={`btn-secondary ${view ? "" : "pointer-events-none opacity-50"}`} href={api.statementPdfUrl(clientId, query)}>
            Download PDF
          </a>
          <button type="button" className="btn-primary" disabled={!view} onClick={() => setStep("email")}>
            Email it…
          </button>
        </>
      }
    >
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="label">Kind of statement</legend>
            {STATEMENT_TYPES.map((t) => (
              <label
                key={t}
                className={`block cursor-pointer rounded-md p-2.5 ring-1 ${type === t ? "bg-brand-50 ring-brand-300" : "ring-slate-200 hover:bg-slate-50"}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <input type="radio" name="statement-type" checked={type === t} onChange={() => setType(t)} />
                  {STATEMENT_TYPE_LABELS[t]}
                </span>
                <span className="mt-0.5 block pl-5 text-xs text-slate-500">{STATEMENT_TYPE_HINTS[t]}</span>
              </label>
            ))}
          </fieldset>
          <label className="block">
            <span className="label">Statement date</span>
            <TextInput type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
          </label>
          {type !== "open_item" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">From</span>
                <TextInput type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="block">
                <span className="label">To</span>
                <TextInput type="date" value={end} max={date} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
          )}
          {view && view.currencies.length > 1 && (
            <label className="block">
              <span className="label">Currency</span>
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {view.currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <span className="hint">A statement is in one currency; send one for each.</span>
            </label>
          )}
        </div>

        <div>{!view ? <Spinner label="Drawing it up" /> : <StatementPreview view={view} />}</div>
      </div>
    </Modal>
  );
}

/** The statement as the client will read it, in the shape the PDF prints. */
function StatementPreview({ view }: { view: StatementView }) {
  const s: Statement = view.statement;
  const m = (n: number | null) => (n === null ? "" : formatMoneyExact(n, view.currency));
  return (
    <div className="rounded-lg bg-panel p-4 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Statement to</div>
          <div className="font-semibold text-slate-900">{view.client.name}</div>
        </div>
        <div className="text-right text-sm">
          <div className="text-slate-500">
            {STATEMENT_TYPE_LABELS[s.type]} · {formatDate(s.statement_date)}
          </div>
          {s.start && s.end && (
            <div className="text-slate-500">
              {formatDate(s.start)} - {formatDate(s.end)}
            </div>
          )}
          <div className="mt-1 text-lg font-bold text-slate-900">{m(s.amount_due)} due</div>
        </div>
      </div>
      <div className="scroll-x mt-3">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>{s.type === "open_item" ? "Invoice" : "Activity"}</th>
              <th>Due</th>
              {s.type === "open_item" && <th className="text-right">Days late</th>}
              <th className="text-right">Amount</th>
              {s.type !== "open_item" && <th className="text-right">Received</th>}
              {s.type !== "transaction" && <th className="text-right">{s.type === "open_item" ? "Open" : "Balance"}</th>}
            </tr>
          </thead>
          <tbody>
            {s.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-slate-500">
                  {s.type === "open_item" ? "Nothing is outstanding." : "Nothing was invoiced or paid in this period."}
                </td>
              </tr>
            )}
            {s.rows.map((r, i) => (
              <tr key={i} className={r.kind === "opening" ? "bg-slate-50" : ""}>
                <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                <td className={r.kind === "payment" ? "text-emerald-800" : ""}>
                  {s.type === "open_item" ? r.reference : r.activity}
                  {r.kind === "payment" && <span className="text-xs text-slate-500"> · {r.reference}</span>}
                </td>
                <td className="whitespace-nowrap">{r.due_on ? formatDate(r.due_on) : ""}</td>
                {s.type === "open_item" && <td className="text-right tabular-nums">{r.days_overdue || "-"}</td>}
                <td className="text-right tabular-nums">{m(r.amount)}</td>
                {s.type !== "open_item" && <td className="text-right tabular-nums text-emerald-800">{m(r.received)}</td>}
                {s.type !== "transaction" && <td className="text-right font-medium tabular-nums">{m(r.balance)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.ageing && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
          {AGEING_LABELS.map(([k, label]) => (
            <div key={k} className="rounded-md bg-slate-50 p-2 text-center">
              <div className="text-[11px] text-slate-500">{label}</div>
              <div className={`tabular-nums text-sm ${k !== "current" && s.ageing![k] > 0 ? "font-semibold text-rose-700" : ""}`}>
                {formatMoneyExact(s.ageing![k], view.currency)}
              </div>
            </div>
          ))}
          <div className="rounded-md bg-slate-900 p-2 text-center text-white">
            <div className="text-[11px] opacity-80">Amount due</div>
            <div className="text-sm font-bold tabular-nums">{m(s.amount_due)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatementEmail({
  clientId,
  query,
  view,
  onBack,
  onClose,
  onSent,
}: {
  clientId: string;
  query: string;
  view: StatementView;
  onBack: () => void;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [draft, setDraft] = useState<StatementEmailDraft | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attach, setAttach] = useState(true);
  const [saveWording, setSaveWording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .statementEmail(clientId, query)
      .then((d) => {
        setDraft(d);
        setTo(d.contacts.map((c) => c.email));
        setCc(d.cc);
        setSubject(d.wording.subject);
        setMessage(d.wording.message);
      })
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : "Could not prepare the email."));
  }, [clientId, query]);

  const nameOf = (email: string) =>
    draft?.contacts.find((c) => c.email.toLowerCase() === email.toLowerCase())?.full_name ?? "";
  const preview = useMemo(
    () =>
      draft
        ? composeStatementEmail(
            { subject, message },
            {
              name: nameOf(to[0] ?? ""),
              firmName: draft.facts.firm_name,
              statementDate: draft.facts.statement_date,
              amountDue: draft.facts.amount_due,
              link: "#the-client-portal",
            },
          )
        : null,
    // nameOf reads draft and to, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, subject, message, to],
  );

  const send = async () => {
    setBusy(true);
    setError(null);
    const params = Object.fromEntries(new URLSearchParams(query));
    try {
      const r = await api.sendStatement(clientId, {
        ...params,
        to,
        cc,
        subject,
        message,
        attach,
        save_wording: saveWording,
      });
      onSent(
        r.sent_to.length
          ? `Statement sent to ${r.sent_to.join(", ")}.${r.failed.length ? ` It could not reach ${r.failed.map((f) => f.email).join(", ")} (${r.failed[0].error.replace(/\.$/, "")}).` : ""}`
          : `The statement did not go: ${(r.failed[0]?.error ?? "nobody to send it to").replace(/\.$/, "")}.`,
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not send it.");
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      xwide
      title={`Email the statement to ${view.client.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary mr-auto" onClick={onBack} disabled={busy}>
            ← Back to the statement
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !draft || !to.length || !subject.trim() || !message.trim()}
            onClick={() => void send()}
          >
            {busy ? "Sending…" : "Send the statement"}
          </button>
        </>
      }
    >
      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {!draft ? (
        !error && <Spinner label="Preparing the email" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            {!draft.email_ready && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                Email is not set up on this portal yet, so nothing will actually be sent. The attempt is
                still logged.
              </div>
            )}
            <AddressField
              label="To"
              values={to}
              onChange={setTo}
              describe={nameOf}
              suggestions={draft.contacts.filter((c) => !to.some((t) => t.toLowerCase() === c.email.toLowerCase()))}
              empty="Nobody yet. Add a billing contact back, or type an address."
            />
            <AddressField label="Cc" values={cc} onChange={setCc} describe={() => ""} />
            <WordingFields
              subject={subject}
              message={message}
              onSubject={setSubject}
              onMessage={setMessage}
              limits={draft.limits}
              rows={13}
              placeholders={STATEMENT_EMAIL_PLACEHOLDERS}
            />
            <div className="space-y-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                <span>
                  Attach the statement <span className="text-slate-500">({draft.attachment_name})</span>
                </span>
              </label>
              {draft.can_save_wording && (
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={saveWording}
                    onChange={(e) => setSaveWording(e.target.checked)}
                  />
                  <span>Use this subject and message for every statement from now on</span>
                </label>
              )}
              {(subject !== draft.standard.subject || message !== draft.standard.message) && (
                <button
                  type="button"
                  className="link text-xs"
                  onClick={() => {
                    setSubject(draft.standard.subject);
                    setMessage(draft.standard.message);
                  }}
                >
                  Use the standard wording
                </button>
              )}
            </div>
          </div>
          <div className="lg:sticky lg:top-0 lg:self-start">
            <EmailPreview
              fromName={draft.from_name}
              to={to[0] ? (nameOf(to[0]) ? `${nameOf(to[0])} <${to[0]}>` : to[0]) : "Nobody yet"}
              cc={cc}
              subject={preview?.subject ?? ""}
              html={preview?.html ?? ""}
              attachments={attach ? [draft.attachment_name] : []}
            />
            {to.length > 1 && (
              <p className="hint">{to.length} copies, one to each person, addressed to them by name.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
