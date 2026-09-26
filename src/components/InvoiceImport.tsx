/**
 * Bringing a client's past invoices in from QuickBooks.
 *
 * Two reports, exported from QuickBooks to Excel: Sales by Customer Detail for the
 * invoices, and - optionally - Deposit Detail for what was paid. Both are read here, in
 * the browser, and shown back as the invoices the client will see, each with its
 * payments and whether it ends up paid. Any invoice can be left out. Nothing is saved
 * until "Bring in", and then the Worker checks it all again (routes/invoice-import.ts).
 */

import { useMemo, useState } from "react";
import {
  balanceOf,
  customerFor,
  customersIn,
  matchPayments,
  readDeposits,
  readSalesDetail,
  type ImportedInvoice,
  type ImportedPayment,
} from "@shared/quickbooks-import";
import { readFirstSheet } from "@shared/xlsx";
import { CURRENCIES, type Currency } from "@shared/money";
import { ApiRequestError, api } from "../lib/api";
import { formatDate, formatMoneyExact } from "../lib/format";
import { ErrorBanner, Modal, Select } from "./ui";

async function sheetOf(file: File) {
  return readFirstSheet(new Uint8Array(await file.arrayBuffer()));
}

export function InvoiceImportModal({
  clientId,
  clientName,
  currency: defaultCurrency,
  onClose,
  onDone,
}: {
  clientId: string;
  clientName: string;
  currency: Currency;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [invoices, setInvoices] = useState<ImportedInvoice[] | null>(null);
  const [skippedRows, setSkippedRows] = useState<string[]>([]);
  const [deposits, setDeposits] = useState<ImportedPayment[]>([]);
  const [customer, setCustomer] = useState("");
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [salesName, setSalesName] = useState("");
  const [depositName, setDepositName] = useState("");

  const readSales = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const reading = readSalesDetail(await sheetOf(file));
      if (!reading.invoices.length) throw new Error("That report has no invoices in it.");
      setInvoices(reading.invoices);
      setSkippedRows(reading.skipped);
      setLeft(new Set());
      setSalesName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file could not be read.");
    }
  };

  const readDeposit = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const payments = readDeposits(await sheetOf(file));
      setDeposits(payments);
      const names = customersIn(payments);
      setCustomer(customerFor(clientName, names) ?? (names.length === 1 ? names[0] : ""));
      setDepositName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file could not be read.");
    }
  };

  const chosen = useMemo(() => (invoices ?? []).filter((i) => !left.has(i.number)), [invoices, left]);
  const theirs = useMemo(() => deposits.filter((d) => d.customer === customer), [deposits, customer]);
  const matched = useMemo(() => matchPayments(chosen, theirs), [chosen, theirs]);
  const paidOn = (number: string) => matched.payments.filter((p) => p.invoice === number);

  const totals = chosen.reduce(
    (t, i) => {
      const paid = paidOn(i.number).reduce((s, p) => s + p.amount, 0);
      return { billed: t.billed + balanceOf(i), paid: t.paid + paid };
    },
    { billed: 0, paid: 0 },
  );

  const bringIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.importInvoices(clientId, {
        source: "QuickBooks",
        currency,
        invoices: chosen,
        payments: matched.payments.map((p) => ({
          invoice: p.invoice,
          paid_on: p.paid_on,
          amount: p.amount,
          account: p.account,
        })),
      });
      onDone(
        `${r.created} invoice${r.created === 1 ? "" : "s"} brought in from QuickBooks, ${r.paid} of them paid. ${formatMoneyExact(r.outstanding, currency)} outstanding. Nothing was emailed to the client.`,
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not bring them in.");
      setBusy(false);
    }
  };

  const names = customersIn(deposits);

  return (
    <Modal
      open
      xwide
      title="Bring in invoices from QuickBooks"
      onClose={onClose}
      footer={
        <>
          {invoices && (
            <p className="mr-auto text-xs text-slate-500">
              {chosen.length} of {invoices.length} invoices · {matched.payments.length} payments
            </p>
          )}
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !chosen.length}
            onClick={() => void bringIn()}
          >
            {busy ? "Bringing in…" : `Bring in ${chosen.length} invoice${chosen.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        <p className="text-sm text-slate-600">
          Export two reports from QuickBooks to Excel, run for this client only, and choose them
          below. They are read here, on your computer, and nothing is saved until you press
          &ldquo;Bring in&rdquo;. Nothing is emailed to the client, and the reminder schedule
          leaves these invoices alone.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <FilePick
            label="Sales by Customer Detail"
            hint="The invoices, line by line."
            name={salesName}
            onPick={(f) => void readSales(f)}
          />
          <FilePick
            label="Deposit Detail (optional)"
            hint="What was paid. Without it, every invoice comes in unpaid."
            name={depositName}
            onPick={(f) => void readDeposit(f)}
          />
        </div>

        {invoices && (
          <>
            <div className="flex flex-wrap items-end gap-4 text-sm">
              <label className="block">
                <span className="label">Currency</span>
                <Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </label>
              {deposits.length > 0 && (
                <label className="block">
                  <span className="label">Payments from</span>
                  <Select value={customer} onChange={(e) => setCustomer(e.target.value)}>
                    <option value="">Nobody - bring them in unpaid</option>
                    {names.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </Select>
                </label>
              )}
            </div>

            <div className="scroll-x rounded-lg ring-1 ring-slate-200">
              <table className="table">
                <thead>
                  <tr>
                    <th aria-label="Bring in" />
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>What it was for</th>
                    <th className="text-right">Withholding</th>
                    <th className="text-right">Amount due</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const out = left.has(inv.number);
                    const paid = out ? [] : paidOn(inv.number);
                    const paidTotal = paid.reduce((s, p) => s + p.amount, 0);
                    const settled = paidTotal >= balanceOf(inv) - 0.005;
                    return (
                      <tr key={inv.number} className={out ? "opacity-50" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Bring in ${inv.number}`}
                            checked={!out}
                            onChange={() =>
                              setLeft((s) => {
                                const next = new Set(s);
                                if (next.has(inv.number)) next.delete(inv.number);
                                else next.add(inv.number);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="font-medium">{inv.number}</td>
                        <td className="whitespace-nowrap">{formatDate(inv.issued_on)}</td>
                        <td className="max-w-[18rem]">
                          <div className="truncate" title={inv.lines.map((l) => l.description).join("; ")}>
                            {inv.lines.map((l) => l.description).join("; ")}
                          </div>
                          {inv.lines.length > 1 && (
                            <div className="text-xs text-slate-500">{inv.lines.length} lines</div>
                          )}
                        </td>
                        <td className="text-right tabular-nums">
                          {inv.withheld ? `-${formatMoneyExact(inv.withheld, currency)}` : "-"}
                        </td>
                        <td className="text-right tabular-nums">{formatMoneyExact(balanceOf(inv), currency)}</td>
                        <td className="whitespace-nowrap">
                          {out ? (
                            <span className="text-xs text-slate-500">Left out</span>
                          ) : paid.length ? (
                            <span
                              className={`pill ${settled ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}
                              title={paid.map((p) => `${formatDate(p.paid_on)} ${formatMoneyExact(p.amount, currency)}`).join(", ")}
                            >
                              {settled ? "Paid" : "Part paid"} {formatDate(paid[paid.length - 1].paid_on)}
                            </span>
                          ) : (
                            <span className="pill bg-rose-50 text-rose-800 ring-rose-200">Unpaid</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan={5} className="px-3 py-2 text-right">
                      Billed {formatMoneyExact(totals.billed, currency)} · paid{" "}
                      {formatMoneyExact(totals.paid, currency)} · outstanding
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatMoneyExact(totals.billed - totals.paid, currency)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {matched.unmatched.length > 0 && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                {matched.unmatched.length === 1 ? "One payment matches" : `${matched.unmatched.length} payments match`}{" "}
                no invoice here for exactly its amount, so{" "}
                {matched.unmatched.length === 1 ? "it is" : "they are"} left out:{" "}
                {matched.unmatched.map((p) => `${formatDate(p.paid_on)} ${formatMoneyExact(p.amount, currency)}`).join(", ")}.
                Record {matched.unmatched.length === 1 ? "it" : "them"} by hand on the right invoice afterwards.
              </div>
            )}
            {skippedRows.length > 0 && (
              <p className="text-xs text-slate-500">
                Not invoices, so not brought in: {skippedRows.join(", ")}.
              </p>
            )}
            <p className="text-xs text-slate-500">
              Each payment is matched to the oldest invoice still open for exactly its amount.
              Withholding is taken off each invoice as the client&rsquo;s copy shows it. Due
              dates are the invoice date plus the firm&rsquo;s payment terms.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function FilePick({
  label,
  hint,
  name,
  onPick,
}: {
  label: string;
  hint: string;
  name: string;
  onPick: (file: File | undefined) => void;
}) {
  return (
    <label className="block cursor-pointer rounded-lg border border-dashed border-slate-300 p-3 hover:border-brand-400">
      <span className="block text-sm font-semibold text-slate-900">{label}</span>
      <span className="block text-xs text-slate-500">{name ? `✓ ${name}` : hint}</span>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}
