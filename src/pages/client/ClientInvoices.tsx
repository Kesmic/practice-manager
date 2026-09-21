/**
 * A client's invoices, with the statement figure at the top.
 *
 * The total and the column beneath it are summed from the same standings, so they cannot
 * disagree - which is the one thing a statement must never do.
 *
 * Drafts never appear. A draft is the firm thinking about what to charge, and showing a
 * client a figure nobody has decided to ask them for is worse than showing them nothing.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { INVOICE_STATE_CLIENT_LABELS } from "@shared/invoices";
import type { ClientInvoiceList } from "@shared/types";
import { ApiRequestError, api } from "../../lib/api";
import { InvoiceStatePill } from "../../components/InvoiceTotals";
import { EmptyState, ErrorBanner, Spinner, StatTile } from "../../components/ui";
import { formatDate, formatMoneyExact } from "../../lib/format";

export function ClientInvoices() {
  const [data, setData] = useState<ClientInvoiceList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.clientMyInvoices());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your invoices.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading your invoices" />;

  const currency = data.invoices[0]?.currency ?? "GHS";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">Invoices</h1>
        <p className="muted mt-1">Everything we have invoiced you, and what is outstanding.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Outstanding"
          value={formatMoneyExact(data.statement.outstanding, currency)}
          tone={data.statement.outstanding > 0 ? "warn" : "good"}
        />
        <StatTile
          label="Of which overdue"
          value={formatMoneyExact(data.statement.overdue, currency)}
          tone={data.statement.overdue > 0 ? "danger" : "good"}
        />
        <StatTile label="Invoices" value={data.statement.count} />
      </div>

      {!data.invoices.length ? (
        <EmptyState
          title="Nothing invoiced yet"
          description="When we invoice you, it will appear here with what is outstanding on it."
        />
      ) : (
        <div className="card">
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Covers</th>
                  <th>Due</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Outstanding</th>
                  <th>Standing</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link className="link" to={`/client/invoices/${invoice.id}`}>
                        {invoice.number}
                      </Link>
                    </td>
                    <td className="text-slate-600">{invoice.period_label ?? "-"}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDate(invoice.due_on)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatMoneyExact(invoice.gross, invoice.currency)}
                    </td>
                    <td className="text-right tabular-nums">
                      {invoice.standing.outstanding > 0
                        ? formatMoneyExact(invoice.standing.outstanding, invoice.currency)
                        : "-"}
                    </td>
                    <td>
                      <InvoiceStatePill
                        state={invoice.state}
                        overdue={invoice.standing.overdue}
                        daysToDue={invoice.standing.days_to_due}
                        labels={INVOICE_STATE_CLIENT_LABELS}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
