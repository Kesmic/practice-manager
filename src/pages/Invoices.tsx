/**
 * The firm's invoice list: what is out, what is outstanding, and what is late.
 *
 * Overdue is asked of each row rather than read off a column, so the list is right the
 * morning after a due date without anything having run overnight.
 *
 * Certificates owed get their own figure. Withholding settles an invoice, so those
 * invoices read as paid - but the firm is still owed the paperwork to claim the credit,
 * and nothing else on this screen would ever surface that.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { INVOICE_STATE_LABELS } from "@shared/invoices";
import type { InvoiceList } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import { InvoiceStatePill } from "../components/InvoiceTotals";
import { EmptyState, ErrorBanner, Spinner, StatTile } from "../components/ui";
import { formatDate, formatMoneyExact } from "../lib/format";

const FILTERS: Array<[string, string]> = [
  ["", "Everything"],
  ["draft", "Drafts"],
  ["sent", "Sent"],
  ["part_paid", "Part paid"],
  ["paid", "Paid"],
];

export function Invoices() {
  const [data, setData] = useState<InvoiceList | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.invoices(filter || undefined));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load invoices.");
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading invoices" />;

  const currency = data.invoices[0]?.currency ?? "GHS";
  const overdue = data.invoices.filter((i) => i.standing.overdue);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">Invoices</h1>
        <p className="muted mt-1">
          Raised from a client's record. Reminders go out on their own once one is late.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Outstanding" value={formatMoneyExact(data.totals.outstanding, currency)} />
        <StatTile
          label="Of which overdue"
          value={formatMoneyExact(data.totals.overdue, currency)}
          tone={data.totals.overdue > 0 ? "danger" : "good"}
        />
        <StatTile label="Invoices late" value={overdue.length} tone={overdue.length ? "warn" : "good"} />
        <StatTile
          label="Certificates owed"
          value={formatMoneyExact(data.totals.awaiting_certificate, currency)}
          tone={data.totals.awaiting_certificate > 0 ? "warn" : "neutral"}
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map(([key, label]) => (
          <button
            key={key || "all"}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              filter === key
                ? "bg-brand-50 font-semibold text-link"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!data.invoices.length ? (
        <EmptyState
          title="Nothing here"
          description="Invoices are raised from a client's record, against a subscription month or delivered work."
        />
      ) : (
        <div className="card">
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Client</th>
                  <th>Covers</th>
                  <th>Due</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Outstanding</th>
                  <th>Standing</th>
                  <th className="text-right">Chased</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <Link className="link" to={`/invoices/${invoice.id}`}>
                        {invoice.number}
                      </Link>
                    </td>
                    <td>
                      <Link className="link" to={`/clients/${invoice.client_id}`}>
                        {invoice.client_name}
                      </Link>
                    </td>
                    <td className="text-slate-600">{invoice.period_label ?? "-"}</td>
                    <td className="whitespace-nowrap tabular-nums">{formatDate(invoice.due_on)}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {formatMoneyExact(invoice.gross, invoice.currency)}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {invoice.standing.outstanding > 0
                        ? formatMoneyExact(invoice.standing.outstanding, invoice.currency)
                        : "-"}
                    </td>
                    <td>
                      <InvoiceStatePill
                        state={invoice.state}
                        overdue={invoice.standing.overdue}
                        daysToDue={invoice.standing.days_to_due}
                        labels={INVOICE_STATE_LABELS}
                      />
                    </td>
                    <td className="text-right tabular-nums text-slate-500">
                      {invoice.reminders_sent > 0 ? `${invoice.reminders_sent}x` : "-"}
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
