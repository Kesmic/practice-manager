/**
 * The foot of an invoice: lines, tax as it was charged, and the total.
 *
 * Reads its tax from the invoice's own frozen rows rather than from the firm's current
 * settings, which is what lets an invoice issued last year still show last year's rates.
 */

import type { InvoiceLineRow, InvoiceTaxRow } from "@shared/types";
import { formatMoneyExact } from "../lib/format";

export function InvoiceTotals({
  lines,
  taxes,
  net,
  gross,
  currency,
  withheld = 0,
  balanceDue,
  withholdingLabel = "Withholding tax",
  discount = 0,
  discountLabel,
}: {
  lines: InvoiceLineRow[];
  taxes: InvoiceTaxRow[];
  /** What tax was charged on: the lines, less any discount. */
  net: number;
  gross: number;
  currency: string;
  /** Deducted on the face of the invoice, so the client pays the balance. */
  withheld?: number;
  balanceDue?: number;
  withholdingLabel?: string;
  /**
   * Taken off before tax. `net` is already net of it, so the subtotal shown above it is
   * the two added back together - there is no third figure that could get out of step.
   */
  discount?: number;
  discountLabel?: string | null;
}) {
  return (
    <div className="scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Description</th>
            <th className="text-right">Quantity</th>
            <th className="text-right">Unit</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>{line.description}</td>
              <td className="text-right tabular-nums">{line.quantity}</td>
              <td className="text-right tabular-nums">
                {formatMoneyExact(line.unit_amount, currency)}
              </td>
              <td className="text-right tabular-nums">{formatMoneyExact(line.amount, currency)}</td>
            </tr>
          ))}

          {/*
            With a discount there are three figures rather than one: what the work came
            to, what came off, and what tax was then charged on. Showing only the last
            would leave a Partner - and the client reading the same lines - unable to
            see why the total is not the sum of the column above it.
          */}
          {discount > 0 && (
            <>
              <tr>
                <td colSpan={3} className="text-right font-medium">
                  Subtotal
                </td>
                <td className="text-right tabular-nums font-medium">
                  {formatMoneyExact(net + discount, currency)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="text-right text-emerald-700">
                  {discountLabel || "Discount"}
                </td>
                <td className="text-right tabular-nums text-emerald-700">
                  -{formatMoneyExact(discount, currency)}
                </td>
              </tr>
            </>
          )}

          <tr>
            <td colSpan={3} className="text-right font-medium">
              Before tax
            </td>
            <td className="text-right tabular-nums font-medium">
              {formatMoneyExact(net, currency)}
            </td>
          </tr>

          {taxes.map((tax) => (
            <tr key={tax.name}>
              <td colSpan={3} className="text-right text-slate-500">
                {tax.name} {tax.rate}%
              </td>
              <td className="text-right tabular-nums text-slate-600">
                {formatMoneyExact(tax.amount, currency)}
              </td>
            </tr>
          ))}

          <tr>
            <td colSpan={3} className="text-right font-semibold">
              Total
            </td>
            <td className="text-right font-semibold tabular-nums">
              {formatMoneyExact(gross, currency)}
            </td>
          </tr>

          {/*
            Shown whenever the invoice anticipates a deduction, because the figure the
            client was asked for is the balance, not the total - and a Partner reading
            this needs to be looking at the same number the client is.
          */}
          {withheld > 0 && (
            <>
              <tr>
                <td colSpan={3} className="text-right text-rose-700">
                  {withholdingLabel} withheld
                </td>
                <td className="text-right tabular-nums text-rose-700">
                  -{formatMoneyExact(withheld, currency)}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="text-right text-base font-semibold">
                  Balance due
                </td>
                <td className="text-right text-base font-semibold tabular-nums">
                  {formatMoneyExact(balanceDue ?? gross - withheld, currency)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** How an invoice reads at a glance, in a pill. Overdue outranks the stored state. */
export function InvoiceStatePill({
  state,
  overdue,
  daysToDue,
  labels,
}: {
  state: string;
  overdue: boolean;
  daysToDue: number;
  labels: Record<string, string>;
}) {
  if (overdue) {
    return (
      <span className="pill bg-rose-50 text-rose-800 ring-rose-200">
        {-daysToDue} days overdue
      </span>
    );
  }
  const tone =
    state === "paid"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : state === "void"
        ? "bg-slate-100 text-slate-600 ring-slate-200"
        : state === "part_paid"
          ? "bg-amber-50 text-amber-800 ring-amber-200"
          : "bg-brand-50 text-link ring-brand-200";
  return <span className={`pill ${tone}`}>{labels[state] ?? state}</span>;
}
