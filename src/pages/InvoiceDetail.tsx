/**
 * One invoice: issue it, record what came in, chase it, or cancel it.
 *
 * The actions available narrow as the invoice moves, because an issued invoice is a
 * document somebody is holding. A draft can be changed; a sent one can only be paid or
 * cancelled. Correcting a sent invoice in place would leave the firm's copy and the
 * client's as different documents with the same number.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { INVOICE_STATE_LABELS, whyNotALine } from "@shared/invoices";
import type { InvoiceDetail as Detail, InvoiceEmailRow } from "@shared/types";
import { useDialogs } from "../lib/dialogs";
import { ApiRequestError, api } from "../lib/api";
import { InvoiceStatePill, InvoiceTotals } from "../components/InvoiceTotals";
import {
  ErrorBanner,
  Field,
  Modal,
  Spinner,
  SuccessBanner,
  TextInput,
} from "../components/ui";
import { useSession } from "../lib/auth";
import { formatDate, formatDateTime, formatMoneyExact } from "../lib/format";

export function InvoiceDetail() {
  const { id = "" } = useParams();
  const { can } = useSession();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.invoice(id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load the invoice.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading the invoice" />;

  const { invoice, lines, taxes, payments, reminders, emails, views, standing } = data;
  const partner = can("partner");

  const act = async (what: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      const said = await what();
      setNotice(typeof said === "string" ? said : message);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not do that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link to="/invoices" className="text-xs text-slate-500 hover:text-link">
          ← Back to invoices
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="section-title">{invoice.number}</h1>
          <InvoiceStatePill
            state={invoice.state}
            overdue={standing.overdue}
            daysToDue={standing.days_to_due}
            labels={INVOICE_STATE_LABELS}
          />
        </div>
        <p className="muted mt-1">
          <Link className="link" to={`/clients/${invoice.client_id}`}>
            {invoice.client_name}
          </Link>
          {invoice.issued_on ? ` · issued ${formatDate(invoice.issued_on)}` : " · not issued"}
          {` · due ${formatDate(invoice.due_on)}`}
          {invoice.period_label ? ` · covers ${invoice.period_label}` : ""}
        </p>
      </div>

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {notice && <SuccessBanner message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-wrap gap-2">
        <a className="btn-secondary" href={`/api/invoices/${invoice.id}/document`}>
          Download the invoice
        </a>
        {partner && invoice.state === "draft" && (
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const { sent_to, failed } = await api.sendInvoice(invoice.id);
                return sent_to.length
                  ? `Issued and emailed to ${sent_to.join(", ")}.${failed.length ? ` It could not reach ${failed.map((f) => f.email).join(", ")}.` : ""}`
                  : failed.length
                    ? `Issued, but the email failed: ${failed[0].error}`
                    : "Issued. Nobody at that client has an email address on file, so nothing was sent.";
              }, "Issued.")
            }
          >
            Issue and send
          </button>
        )}
        {partner && (invoice.state === "sent" || invoice.state === "part_paid") && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => setPaying(true)}>
            Record a payment
          </button>
        )}
        {(invoice.state === "sent" || invoice.state === "part_paid") && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const r = await api.remindInvoice(invoice.id);
                return r.step === 0 ? "Due today notice sent." : `Reminder ${r.step} sent.`;
              }, "Reminder sent.")
            }
          >
            Chase it now
          </button>
        )}
        {partner && (invoice.state === "sent" || invoice.state === "part_paid" || invoice.state === "paid") && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={async () => {
              const alsoTo = await dialogs.ask(
                "It goes to the billing contacts again, in the same words as the first time. To send it somewhere else as well - the client's accountant, say - add the address.",
                {
                  title: "Send it again",
                  required: false,
                  placeholder: "Also send to (optional)",
                  confirmLabel: "Send it again",
                },
              );
              if (alsoTo === null) return;
              void act(async () => {
                const r = await api.resendInvoice(invoice.id, alsoTo.trim());
                return `Sent again to ${r.sent_to.join(", ")}.${r.failed.length ? ` It could not reach ${r.failed.map((f) => f.email).join(", ")}.` : ""}`;
              }, "Sent again.");
            }}
          >
            Send it again
          </button>
        )}
        {partner && invoice.state === "void" && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={async () => {
              const ok = await dialogs.confirm(
                "It goes back to a draft under the same number, with a fresh due date. The client stops seeing it straight away, and you can correct it and issue it again.",
                { title: "Put it back to draft?", confirmLabel: "Back to draft" },
              );
              if (!ok) return;
              void act(() => api.redraftInvoice(invoice.id), "Back to draft. The client no longer sees it.");
            }}
          >
            Back to draft
          </button>
        )}
        {partner && (invoice.state === "void" || invoice.state === "draft") && (
          <button
            type="button"
            className="btn-ghost text-rose-700"
            disabled={busy}
            onClick={async () => {
              const reason = await dialogs.ask(
                `${invoice.number} will be deleted outright and the client will no longer see it. The firm keeps a one-line record of the number and why, for the audit trail. Why is it being deleted?`,
                { title: "Delete this invoice?", multiline: true, danger: true, confirmLabel: "Delete it" },
              );
              if (!reason?.trim()) return;
              setBusy(true);
              setError(null);
              try {
                await api.deleteInvoice(invoice.id, reason.trim());
                navigate("/invoices");
              } catch (err) {
                setError(err instanceof ApiRequestError ? err.message : "Could not delete it.");
                setBusy(false);
              }
            }}
          >
            Delete
          </button>
        )}
        {partner && invoice.state !== "void" && invoice.state !== "paid" && invoice.state !== "draft" && (
          <button
            type="button"
            className="btn-ghost text-rose-700"
            disabled={busy}
            onClick={async () => {
              const reason = await dialogs.ask("Why is this being cancelled?", { multiline: true, danger: true, confirmLabel: "Cancel the invoice" });
              if (reason?.trim()) {
                void act(
                  () => api.voidInvoice(invoice.id, reason.trim()),
                  "Cancelled. The month it billed is free again.",
                );
              }
            }}
          >
            Cancel it
          </button>
        )}
      </div>

      <section className="card p-5">
        <InvoiceTotals
          lines={lines}
          taxes={taxes}
          net={invoice.net}
          gross={invoice.gross}
          currency={invoice.currency}
          withheld={invoice.withholding_amount}
          balanceDue={invoice.balance_due}
          discount={invoice.discount_amount}
          discountLabel={invoice.discount_label}
          onRemove={
            partner && invoice.state === "draft"
              ? (lineId) => void act(() => api.removeInvoiceLine(lineId), "Line removed.")
              : undefined
          }
        />
        {/*
          A draft can still change. Once issued it is a document somebody is holding, and
          a wrong line means cancelling it and raising another - so the form is here and
          nowhere later.
        */}
        {partner && invoice.state === "draft" && (
          <AddLine
            busy={busy}
            currency={invoice.currency}
            onAdd={(line) => act(() => api.addInvoiceLine(invoice.id, line), "Line added.")}
          />
        )}
        <dl className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div className="flex font-semibold">
            <dt>Outstanding</dt>
            <dd className="ml-auto tabular-nums">
              {formatMoneyExact(standing.outstanding, invoice.currency)}
            </dd>
          </div>
          {standing.awaiting_certificate > 0 && (
            <div className="flex text-amber-800">
              <dt>Withholding certificate owed</dt>
              <dd className="ml-auto tabular-nums">
                {formatMoneyExact(standing.awaiting_certificate, invoice.currency)}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="card p-5">
        <h2 className="card-title">Payments</h2>
        {!payments.length ? (
          <p className="muted mt-2">Nothing recorded yet.</p>
        ) : (
          <div className="mt-2 divide-y divide-slate-100">
            {payments.map((payment) => (
              <div key={payment.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="tabular-nums text-slate-500">{formatDate(payment.paid_on)}</span>
                <span className="tabular-nums">
                  {formatMoneyExact(payment.amount, invoice.currency)}
                </span>
                {payment.withheld > 0 && (
                  <>
                    <span className="tabular-nums text-slate-600">
                      +{formatMoneyExact(payment.withheld, invoice.currency)} withheld
                    </span>
                    {payment.certificate_received ? (
                      <span className="pill bg-emerald-50 text-emerald-800 ring-emerald-200">
                        Certificate in
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-amber-800"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () =>
                              api.setCertificate(payment.id, { certificate_received: true }),
                            "Certificate recorded.",
                          )
                        }
                      >
                        Mark certificate received
                      </button>
                    )}
                  </>
                )}
                {payment.reference && (
                  <span className="text-slate-500">{payment.reference}</span>
                )}
                {partner && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm ml-auto text-rose-700"
                    disabled={busy}
                    onClick={() =>
                      void act(() => api.removePayment(payment.id), "Payment removed.")
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <EmailLog emails={emails} />

      {views.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title">Seen in the client portal</h2>
          <p className="muted mt-1">Exact: recorded when somebody signed in to the portal opened or downloaded it.</p>
          <div className="mt-2 divide-y divide-slate-100">
            {views.map((v, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 text-sm">
                <span className="font-medium text-slate-800">{v.full_name ?? v.email ?? "A former login"}</span>
                <span className="text-slate-600">
                  {v.what === "download" ? "Downloaded it" : "Opened it"}
                  {v.times > 1 ? ` ${v.times} times` : ""}
                </span>
                <span className="ml-auto tabular-nums text-xs text-slate-500">
                  {v.times > 1
                    ? `first ${formatDateTime(v.first_at)} · last ${formatDateTime(v.last_at)}`
                    : formatDateTime(v.last_at)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {emails.length === 0 && reminders.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title">Chasing</h2>
          <div className="mt-2 divide-y divide-slate-100">
            {reminders.map((r, i) => (
              <div key={i} className="flex flex-wrap gap-x-4 gap-y-1 py-2 text-sm">
                <span className="tabular-nums text-slate-500">{formatDateTime(r.sent_at)}</span>
                <span>
                  Reminder {r.step} · {r.days_late} days late
                </span>
                <span className="text-slate-500">{r.sent_to}</span>
                <span className="ml-auto text-xs text-slate-400">
                  {r.automatic ? "automatic" : "by hand"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <PaymentModal
        open={paying}
        outstanding={standing.outstanding}
        currency={invoice.currency}
        onClose={() => setPaying(false)}
        onSave={async (body) => {
          await act(() => api.recordPayment(invoice.id, body), "Payment recorded.");
          setPaying(false);
        }}
      />
    </div>
  );
}

/**
 * Recording money in.
 *
 * Withheld is its own field rather than being inferred from a short payment, because the
 * two mean opposite things: one is the invoice settled, the other is the invoice unpaid.
 * Guessing between them from the arithmetic would be guessing about somebody's money.
 */
function PaymentModal({
  open,
  outstanding,
  currency,
  onClose,
  onSave,
}: {
  open: boolean;
  outstanding: number;
  currency: string;
  onClose: () => void;
  onSave: (body: {
    amount: number;
    withheld: number;
    paid_on?: string;
    method?: string;
    reference?: string;
  }) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [withheld, setWithheld] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [reference, setReference] = useState("");

  const total = (Number(amount) || 0) + (Number(withheld) || 0);
  const over = total > outstanding + 0.01;

  return (
    <Modal
      open={open}
      title="Record a payment"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={total <= 0 || over}
            onClick={() =>
              void onSave({
                amount: Number(amount) || 0,
                withheld: Number(withheld) || 0,
                paid_on: paidOn || undefined,
                reference: reference || undefined,
              })
            }
          >
            Record it
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="muted">
          {formatMoneyExact(outstanding, currency)} outstanding.
        </p>
        <Field label="Received" hint="The cash that actually arrived.">
          {(id) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Withheld"
          hint="Deducted by the client and remitted to the GRA. It settles the invoice; what they still owe you is the certificate."
        >
          {(id) => (
            <TextInput
              id={id}
              inputMode="decimal"
              value={withheld}
              onChange={(e) => setWithheld(e.target.value)}
            />
          )}
        </Field>
        <Field label="Paid on" hint="Left blank, today.">
          {(id) => (
            <TextInput id={id} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          )}
        </Field>
        <Field label="Reference">
          {(id) => (
            <TextInput id={id} value={reference} onChange={(e) => setReference(e.target.value)} />
          )}
        </Field>
        {over && (
          <p className="text-sm text-rose-700">
            That is more than is outstanding. Check the amount, or which invoice it
            belongs to.
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * A line typed onto a draft: what it is, how many, what each costs, and whether it is
 * the firm's fee or something paid out for the client and passed on at cost. The
 * distinction is the whole point - tax and withholding are charged on fees only.
 */
function AddLine({
  busy,
  currency,
  onAdd,
}: {
  busy: boolean;
  currency: string;
  onAdd: (line: {
    description: string;
    quantity: number;
    unit_amount: number;
    taxable: boolean;
  }) => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [kind, setKind] = useState<"fee" | "cost">("fee");
  const reason = whyNotALine({ description, quantity, unit_amount: unit });
  return (
    <form
      className="mt-4 border-t border-slate-200 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason) return;
        void onAdd({
          description: description.trim(),
          quantity: Number(quantity),
          unit_amount: Number(unit),
          taxable: kind === "fee",
        }).then(() => {
          setDescription("");
          setQuantity("1");
          setUnit("");
          setKind("fee");
        });
      }}
    >
      <h3 className="mb-2 text-sm font-semibold text-slate-900">Add a line</h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_6rem_9rem_11rem_auto] sm:items-end">
        <Field label="What for">
          {(id) => (
            <TextInput
              id={id}
              value={description}
              placeholder="ORC filing fee paid on your behalf"
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <Field label="Quantity">
          {(id) => (
            <TextInput id={id} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          )}
        </Field>
        <Field label={`Each, in ${currency}`}>
          {(id) => (
            <TextInput id={id} inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} />
          )}
        </Field>
        <Field label="Charged as">
          {(id) => (
            <select id={id} className="input" value={kind} onChange={(e) => setKind(e.target.value as "fee" | "cost")}>
              <option value="fee">Our fee - tax applies</option>
              <option value="cost">Reimbursable at cost - no tax</option>
            </select>
          )}
        </Field>
        <button type="submit" className="btn-secondary" disabled={busy || !!reason}>
          Add
        </button>
      </div>
      {reason && description.trim() && <p className="hint mt-1 text-amber-800">{reason}</p>}
    </form>
  );
}

const EMAIL_LABELS: Record<InvoiceEmailRow["kind"], string> = {
  issued: "Invoice sent",
  resent: "Sent again",
  due_today: "Due today notice",
  overdue: "Overdue reminder",
};

/**
 * Every email this invoice has sent, one row per recipient: what it was, who it went to
 * and who was copied, whether the provider took it, and what the recipient did with it.
 */
function EmailLog({ emails }: { emails: InvoiceEmailRow[] }) {
  if (emails.length === 0) return null;
  return (
    <section className="card p-5">
      <h2 className="card-title">Emails</h2>
      <p className="muted mt-1">
        Opened is what the recipient&rsquo;s mail app reports when it loads images. Some
        apps block that and some load images on arrival, so treat it as a strong hint, not
        proof. Seen in the portal, below, is exact.
      </p>
      <div className="mt-3 divide-y divide-slate-100">
        {emails.map((e) => (
          <div key={e.id} className="grid gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[10rem_1fr]">
            <div className="tabular-nums text-slate-500">
              {formatDateTime(e.sent_at)}
              <div className="text-xs text-slate-400">
                {e.automatic ? "automatic" : e.sent_by_name ? `by ${e.sent_by_name}` : "by hand"}
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{EMAIL_LABELS[e.kind]}</span>
                {e.status === "failed" ? (
                  <span className="pill bg-rose-50 text-rose-800 ring-rose-200">Not delivered</span>
                ) : e.opened_at ? (
                  <span
                    className="pill bg-emerald-50 text-emerald-800 ring-emerald-200"
                    title={`First ${formatDateTime(e.opened_at)}${e.last_opened_at && e.last_opened_at !== e.opened_at ? `, last ${formatDateTime(e.last_opened_at)}` : ""}`}
                  >
                    Opened {formatDateTime(e.opened_at)}
                    {e.open_count > 1 ? ` · ${e.open_count} times` : ""}
                  </span>
                ) : (
                  <span className="pill bg-slate-100 text-slate-600 ring-slate-200">Sent, not opened yet</span>
                )}
                {e.clicked_at && (
                  <span className="pill bg-brand-50 text-link ring-brand-200">
                    Followed the link {formatDateTime(e.clicked_at)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 break-words text-slate-600">
                To {e.recipient_name ? `${e.recipient_name} <${e.recipient_email}>` : e.recipient_email}
              </div>
              {e.cc && <div className="break-words text-xs text-slate-500">Copied to {e.cc}</div>}
              {e.status === "failed" && <div className="mt-1 text-xs text-rose-700">{e.error}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
