/**
 * What a growth partner has earned, and where each piece of it has got to.
 *
 * The question this page answers is always the same - how much am I owed, and when - so
 * the totals are at the top and every accrual says what it was worked out on. Nothing is
 * summed across currencies: a partner with one client billed in cedis and another in
 * dollars is owed two amounts, and one converted figure would be a number the firm never
 * agreed to.
 */

import { useCallback, useEffect, useState } from "react";
import { COMMISSION_STATE_LABELS } from "@shared/growth-partners";
import type { PartnerStatement } from "@shared/types";
import { formatAmount } from "@shared/money";
import { ApiRequestError, api } from "../../lib/api";
import { ErrorBanner, Spinner } from "../../components/ui";
import { formatDate } from "../../lib/format";

const TONE: Record<string, string> = {
  accrued: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-brand-50 text-link ring-brand-200",
  paid: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
};

export function PartnerEarnings() {
  const [data, setData] = useState<PartnerStatement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.partnerStatement());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load your statement.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading what you have earned" />;

  const currencies = Object.keys(data.totals);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">What I have earned</h1>
        <p className="muted mt-1">
          {data.terms.rate}% of what a client of yours pays us, for their first{" "}
          {data.terms.months} billed months. A month a client pauses raises no invoice, so
          it is not one of them.
        </p>
      </div>

      {!currencies.length ? (
        <div className="card p-6 text-center">
          <h2 className="card-title">Nothing yet</h2>
          <p className="muted mx-auto mt-1 max-w-prose">
            The first commission appears the day we invoice a client you sold, not the day
            they sign. Nothing here is an estimate.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {currencies.map((currency) =>
            (["earned", "approved", "paid"] as const).map((key) => (
              <div key={`${currency}-${key}`} className="lift card p-4">
                <p className="text-xs uppercase tracking-wider text-slate-500">
                  {key === "earned"
                    ? "Earned in total"
                    : key === "approved"
                      ? "Approved, not yet paid"
                      : "Paid"}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                  {formatAmount(data.totals[currency][key], currency)}
                </p>
              </div>
            )),
          )}
        </div>
      )}

      {data.entitlements.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title">Where each client stands</h2>
          <div className="mt-2 divide-y divide-slate-100">
            {data.entitlements.map((row) => (
              <div key={row.client_id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium text-slate-800">
                    {row.client_name}
                  </span>
                  <span className="ml-auto text-xs text-slate-500">
                    {row.months_earned} of {data.terms.months} months
                  </span>
                </div>
                <div className="mt-1.5 flex gap-1">
                  {/*
                    Six blocks rather than a bar. The entitlement is counted in months,
                    and a partner asking "how many left" wants to count them.
                  */}
                  {Array.from({ length: data.terms.months }, (_, i) => (
                    <span
                      key={i}
                      className={`h-2 flex-1 rounded ${
                        i < row.months_earned ? "bg-brand-600" : "bg-slate-200"
                      }`}
                    />
                  ))}
                </div>
                <p className="hint mt-1">{row.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.commissions.length > 0 && (
        <section className="card p-5">
          <h2 className="card-title">Every line</h2>
          <div className="scroll-x mt-2">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Client</th>
                  <th>What for</th>
                  <th className="text-right">Worked out on</th>
                  <th className="text-right">Yours</th>
                  <th>Where it is</th>
                </tr>
              </thead>
              <tbody>
                {data.commissions.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">{formatDate(row.created_at)}</td>
                    <td>{row.client_name ?? "-"}</td>
                    <td>
                      {row.kind === "subscription"
                        ? `Month ${row.month_index} · ${row.reference ?? ""}`
                        : "One-off work"}
                      {row.invoice_number && (
                        <span className="text-slate-400"> · {row.invoice_number}</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatAmount(row.basis, row.currency)}
                    </td>
                    <td className="text-right font-medium tabular-nums">
                      {formatAmount(row.amount, row.currency)}
                    </td>
                    <td>
                      <span className={`pill ${TONE[row.status] ?? ""}`}>
                        {COMMISSION_STATE_LABELS[row.status]}
                      </span>
                      {row.paid_reference && (
                        <span className="ml-2 text-xs text-slate-500">
                          {row.paid_reference}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
