/**
 * One invoice, as the client sees it.
 *
 * Its tax lines are the ones frozen onto it at issue, so an old invoice shows the rates
 * that applied on the day rather than today's.
 *
 * Withholding is shown as part of what settled the invoice, not as a shortfall, because
 * that is what it is: the client remitted that part to the GRA on the firm's behalf.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { INVOICE_STATE_CLIENT_LABELS } from "@shared/invoices";
import type { ClientInvoiceDetail as Detail } from "@shared/types";
import { ApiRequestError, api } from "../../lib/api";
import { InvoiceStatePill, InvoiceTotals } from "../../components/InvoiceTotals";
import { ErrorBanner, Spinner } from "../../components/ui";
import { formatDate, formatMoneyExact } from "../../lib/format";

export function ClientInvoiceDetail() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.clientMyInvoice(id));
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load that invoice.",
      );
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading the invoice" />;

  const { invoice, lines, taxes, payments, standing } = data;
  const settled = payments.reduce((sum, p) => sum + p.amount + p.withheld, 0);

  return (
    <div className="space-y-5">
      <div>
        <Link to="/client/invoices" className="text-xs text-slate-500 hover:text-link">
          ← Back to invoices
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="section-title">{invoice.number}</h1>
          <InvoiceStatePill
            state={invoice.state}
            overdue={standing.overdue}
            daysToDue={standing.days_to_due}
            labels={INVOICE_STATE_CLIENT_LABELS}
          />
        </div>
        <p className="muted mt-1">
          {invoice.issued_on ? `Issued ${formatDate(invoice.issued_on)} · ` : ""}
          due {formatDate(invoice.due_on)}
          {invoice.period_label ? ` · covers ${invoice.period_label}` : ""}
        </p>
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
        />
      </section>

      <section className="card p-5">
        <h2 className="card-title">Payment</h2>
        {!payments.length ? (
          <p className="muted mt-2">
            {standing.outstanding > 0
              ? `${formatMoneyExact(standing.outstanding, invoice.currency)} outstanding.`
              : "Nothing outstanding."}
          </p>
        ) : (
          <>
            <div className="mt-2 divide-y divide-slate-100">
              {payments.map((payment) => (
                <div key={payment.id} className="flex flex-wrap gap-x-4 gap-y-1 py-2.5 text-sm">
                  <span className="tabular-nums text-slate-500">
                    {formatDate(payment.paid_on)}
                  </span>
                  <span className="tabular-nums">
                    {formatMoneyExact(payment.amount, invoice.currency)} received
                  </span>
                  {/*
                    Shown as part of what settled the invoice. It is not a shortfall -
                    the client remitted it to the GRA on our behalf.
                  */}
                  {payment.withheld > 0 && (
                    <span className="tabular-nums text-slate-600">
                      {formatMoneyExact(payment.withheld, invoice.currency)} withheld
                    </span>
                  )}
                  {payment.reference && (
                    <span className="text-slate-500">{payment.reference}</span>
                  )}
                </div>
              ))}
            </div>

            <dl className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
              <div className="flex">
                <dt className="text-slate-500">Settled</dt>
                <dd className="ml-auto tabular-nums">
                  {formatMoneyExact(settled, invoice.currency)}
                </dd>
              </div>
              <div className="flex font-semibold">
                <dt>Outstanding</dt>
                <dd className="ml-auto tabular-nums">
                  {formatMoneyExact(standing.outstanding, invoice.currency)}
                </dd>
              </div>
            </dl>
          </>
        )}

        {standing.overdue && (
          <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-inset ring-rose-200">
            This became due on {formatDate(invoice.due_on)}. If you have already paid it,
            tell us and we will match it off.
          </p>
        )}
      </section>

      {invoice.note && (
        <section className="card p-5">
          <h2 className="card-title">Note</h2>
          <p className="mt-2 text-sm text-slate-700">{invoice.note}</p>
        </section>
      )}
    </div>
  );
}
