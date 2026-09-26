/**
 * One invoice: issue it, record what came in, chase it, or cancel it.
 *
 * The actions available narrow as the invoice moves, because an issued invoice is a
 * document somebody is holding. A draft can be changed; a sent one can only be paid or
 * cancelled. Correcting a sent invoice in place would leave the firm's copy and the
 * client's as different documents with the same number.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { INVOICE_STATE_LABELS, whyNotALine } from "@shared/invoices";
import type { InvoiceDetail as Detail, InvoiceEmailRow } from "@shared/types";
import { useDialogs } from "../lib/dialogs";
import { ApiRequestError, api } from "../lib/api";
import { InvoiceStatePill, InvoiceTotals } from "../components/InvoiceTotals";
import { InvoiceEmailComposer } from "../components/InvoiceEmailComposer";
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
  const [composing, setComposing] = useState<"issued" | "resent" | null>(null);

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

  const { invoice, lines, taxes, payments, standing } = data;
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

      {composing && (
        <InvoiceEmailComposer
          invoiceId={invoice.id}
          kind={composing}
          onClose={() => setComposing(null)}
          onDone={(said) => {
            setComposing(null);
            setError(null);
            setNotice(said);
            void load();
          }}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <a className="btn-secondary" href={`/api/invoices/${invoice.id}/document`}>
          Download the invoice
        </a>
        {partner && invoice.state === "draft" && (
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => setComposing("issued")}
          >
            Issue and send…
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
            onClick={() => setComposing("resent")}
          >
            Send it again…
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

      <History data={data} />

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
  issued: "Invoice emailed",
  resent: "Sent again",
  due_today: "Due today notice",
  overdue: "Overdue reminder",
};

/** A date or a moment, shown as whichever it is. */
function when(at: string): string {
  return at.length <= 10 ? formatDate(at) : formatDateTime(at);
}

interface HistoryItem {
  at: string;
  title: string;
  by?: string | null;
  detail?: ReactNode;
  pills?: ReactNode;
}

/**
 * Everything that has happened to this invoice, oldest first, in one list: raised,
 * issued, every email and what the recipient did with it, the client's visits to the
 * portal, payments, a cancellation, a return to draft. Always shown, because even an
 * invoice issued before the email log began has a history - who raised it and when it
 * went out - and a blank space reads as "nothing is known".
 */
function History({ data }: { data: Detail }) {
  const { invoice, emails, views, reminders, payments, events } = data;
  const items: HistoryItem[] = [];

  items.push({
    at: invoice.created_at,
    title: "Raised as a draft",
    by: invoice.created_by_name ?? (invoice.period_label ? "the monthly billing run" : null),
  });

  const firstEmail = emails.length ? emails.map((e) => e.sent_at).sort()[0] : null;
  const issuedEmails = emails.filter((e) => e.kind === "issued");
  if (invoice.sent_at) {
    items.push({
      at: invoice.sent_at,
      title: "Issued",
      by: issuedEmails[0]?.sent_by_name ?? (issuedEmails[0]?.automatic ? "the monthly billing run" : null),
      detail:
        issuedEmails.length === 0 ? (
          <span>
            Emailed to the client&rsquo;s billing contacts. This was before the email log
            began, so who it reached and whether it was opened were not recorded.
          </span>
        ) : undefined,
    });
  }

  for (const e of emails) {
    items.push({
      at: e.sent_at,
      title: EMAIL_LABELS[e.kind],
      by: e.automatic ? "the portal, automatically" : e.sent_by_name,
      detail: (
        <>
          <div className="break-words">
            To {e.recipient_name ? `${e.recipient_name} <${e.recipient_email}>` : e.recipient_email}
          </div>
          {e.cc && <div className="break-words text-xs text-slate-500">Copied to {e.cc}</div>}
          {e.status === "failed" && <div className="text-xs text-rose-700">{e.error}</div>}
          {e.subject && (
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer text-link">
                What it said{e.attached ? "" : " · sent without the invoice attached"}
              </summary>
              <div className="mt-1 rounded-md bg-slate-50 p-3 ring-1 ring-slate-200">
                <div className="font-semibold text-slate-900">{e.subject}</div>
                <div className="mt-2 whitespace-pre-wrap break-words text-slate-700">{e.body}</div>
              </div>
            </details>
          )}
        </>
      ),
      pills:
        e.status === "failed" ? (
          <span className="pill bg-rose-50 text-rose-800 ring-rose-200">Not delivered</span>
        ) : (
          <>
            {e.opened_at ? (
              <span
                className="pill bg-emerald-50 text-emerald-800 ring-emerald-200"
                title={`First ${formatDateTime(e.opened_at)}${e.last_opened_at && e.last_opened_at !== e.opened_at ? `, last ${formatDateTime(e.last_opened_at)}` : ""}`}
              >
                Opened {formatDateTime(e.opened_at)}
                {e.open_count > 1 ? ` · ${e.open_count} times` : ""}
              </span>
            ) : (
              <span className="pill bg-slate-100 text-slate-600 ring-slate-200">Not opened yet</span>
            )}
            {e.clicked_at && (
              <span className="pill bg-brand-50 text-link ring-brand-200">
                Followed the link {formatDateTime(e.clicked_at)}
              </span>
            )}
          </>
        ),
    });
  }

  // Reminders sent before the email log began, which only the old record knows about.
  for (const r of reminders) {
    if (firstEmail && r.sent_at >= firstEmail) continue;
    items.push({
      at: r.sent_at,
      title: `Reminder ${r.step} · ${r.days_late} days late`,
      by: r.automatic ? "the portal, automatically" : null,
      detail: r.sent_to ? <span className="break-words">To {r.sent_to}</span> : undefined,
    });
  }

  for (const v of views) {
    const who = v.full_name ?? v.email ?? "A former login";
    items.push({
      at: v.first_at,
      title: `${who} ${v.what === "download" ? "downloaded it" : "opened it"} in the portal`,
      detail:
        v.times > 1 ? (
          <span>
            {v.times} times, most recently {formatDateTime(v.last_at)}
          </span>
        ) : undefined,
    });
  }

  for (const p of payments) {
    items.push({
      at: p.recorded_at ?? p.paid_on,
      title: `Payment recorded: ${formatMoneyExact(p.amount, invoice.currency)}${p.withheld > 0 ? ` and ${formatMoneyExact(p.withheld, invoice.currency)} withheld` : ""}`,
      by: p.recorded_by_name,
      detail: (
        <span>
          Paid on {formatDate(p.paid_on)}
          {p.method ? ` by ${p.method}` : ""}
          {p.reference ? ` · ${p.reference}` : ""}
        </span>
      ),
    });
  }

  for (const ev of events) {
    // An earlier issue, kept when the invoice went back to draft and lost its date.
    if (ev.kind === "issued") {
      // Emailed that time if an issue email went out before it was put back to draft.
      const redraftedAt = events.find((x) => x.kind === "redrafted" && x.at >= ev.at)?.at;
      const emailedThen = issuedEmails.some((e) => !redraftedAt || e.sent_at < redraftedAt);
      items.push({
        at: ev.at,
        title: "Issued",
        detail: emailedThen ? undefined : (
          <span>
            Emailed to the client&rsquo;s billing contacts, before the email log began.
          </span>
        ),
      });
      continue;
    }
    items.push({
      at: ev.at,
      title: ev.kind === "cancelled" ? "Cancelled" : "Put back to draft",
      by: ev.actor_name,
      detail: ev.detail ? <span>{ev.detail}</span> : undefined,
    });
  }
  // A cancellation from before cancellations were recorded as events.
  if (invoice.voided_at && !events.some((ev) => ev.kind === "cancelled")) {
    items.push({
      at: invoice.voided_at,
      title: "Cancelled",
      detail: invoice.void_reason ? <span>{invoice.void_reason}</span> : undefined,
    });
  }

  items.sort((a, b) => a.at.localeCompare(b.at));

  return (
    <section className="card p-5">
      <h2 className="card-title">History</h2>
      {emails.length > 0 && (
        <p className="muted mt-1">
          &ldquo;Opened&rdquo; is what the recipient&rsquo;s mail app reports when it loads
          images. Some apps block that and some load images on arrival, so treat it as a
          strong hint. A visit to the portal is exact.
        </p>
      )}
      <ol className="mt-3 space-y-0">
        {items.map((item, i) => (
          <li key={i} className="relative grid gap-x-4 pb-4 pl-5 text-sm sm:grid-cols-[10rem_1fr]">
            {/* The line and the dot that make it read as a timeline. */}
            <span
              aria-hidden="true"
              className={`absolute left-[5px] top-1.5 w-px bg-slate-200 ${i === items.length - 1 ? "h-0" : "h-full"}`}
            />
            <span aria-hidden="true" className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-white" />
            <div className="tabular-nums text-slate-500">{when(item.at)}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{item.title}</span>
                {item.pills}
              </div>
              {item.by && <div className="text-xs text-slate-500">by {item.by}</div>}
              {item.detail && <div className="mt-0.5 text-slate-600">{item.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
