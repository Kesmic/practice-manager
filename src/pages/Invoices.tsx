/**
 * The firm's invoice list: what is out, what is outstanding, and what is late - and
 * finding any one of them.
 *
 * Search, filters, sorting and grouping all run on the list in the browser
 * (shared/invoice-browse.ts), so the table answers as the Partner types. What they
 * have chosen lives in the address, so a filtered view can be bookmarked or sent to a
 * colleague, and "back" returns to it.
 *
 * Overdue is asked of each row rather than read off a column, so the list is right the
 * morning after a due date without anything having run overnight. Certificates owed
 * get their own figure: withholding settles an invoice, but the firm is still owed the
 * paperwork to claim the credit, and nothing else on this screen would surface that.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { INVOICE_STATE_LABELS } from "@shared/invoices";
import {
  GROUPINGS,
  INVOICE_STATUS_FILTERS,
  datePresets,
  filterInvoices,
  groupInvoices,
  invoicesCsv,
  owedOn,
  sortInvoices,
  totalsByCurrency,
  type CurrencyTotals,
  type Grouping,
  type InvoiceCriteria,
  type InvoiceStatusFilter,
  type SortKey,
} from "@shared/invoice-browse";
import type { InvoiceList, InvoiceSummary } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import { InvoiceStatePill } from "../components/InvoiceTotals";
import { EmptyState, ErrorBanner, Spinner, StatTile } from "../components/ui";
import { formatDate, formatMoneyExact } from "../lib/format";

const today = () => new Date().toISOString().slice(0, 10);

/** The criteria, the grouping and the sort, read from and written to the address. */
function useBrowseState() {
  const [params, setParams] = useSearchParams();
  const criteria: InvoiceCriteria = {
    q: params.get("q") ?? "",
    status: (params.get("status") ?? "") as InvoiceStatusFilter,
    clientId: params.get("client") ?? "",
    currency: params.get("currency") ?? "",
    dateField: params.get("date") === "due" ? "due" : "issued",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const group = (params.get("group") ?? "none") as Grouping;
  const sort = (params.get("sort") ?? "due") as SortKey;
  const descending = params.get("dir") !== "asc";

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  return { criteria, group, sort, descending, set, clear: () => setParams(new URLSearchParams(), { replace: true }) };
}

export function Invoices() {
  const [data, setData] = useState<InvoiceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { criteria, group, sort, descending, set, clear } = useBrowseState();
  // The search box answers as it is typed; the address catches up a moment later.
  const [q, setQ] = useState(criteria.q);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== criteria.q) set({ q });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const load = useCallback(async () => {
    try {
      setData(await api.invoices());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not load invoices.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const live = { ...criteria, q };
  const shown = useMemo(
    () => (data ? sortInvoices(filterInvoices(data.invoices, live), sort, descending) : []),
    // live is rebuilt each render from its parts, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, q, criteria.status, criteria.clientId, criteria.currency, criteria.dateField, criteria.from, criteria.to, sort, descending],
  );
  const groups = useMemo(() => groupInvoices(shown, group), [shown, group]);
  const totals = useMemo(() => totalsByCurrency(shown), [shown]);

  const clients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of data?.invoices ?? []) seen.set(i.client_id, i.client_name);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);
  const currencies = useMemo(() => [...new Set((data?.invoices ?? []).map((i) => i.currency))], [data]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading invoices" />;

  const filtered =
    q.trim() || criteria.status || criteria.clientId || criteria.currency || criteria.from || criteria.to;
  const preset = datePresets(today()).find((p) => p.from === criteria.from && p.to === criteria.to)?.key ?? (criteria.from || criteria.to ? "custom" : "");

  const sortBy = (key: SortKey) =>
    set({ sort: key, dir: sort === key ? (descending ? "asc" : "") : key === "client" || key === "number" ? "asc" : "" });

  const downloadCsv = () => {
    const blob = new Blob(["﻿" + invoicesCsv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="section-title">Invoices</h1>
          <p className="muted mt-1">
            Raised from a client&rsquo;s record. Reminders go out on their own once one is late.
          </p>
        </div>
        <button type="button" className="btn-secondary btn-sm" disabled={!shown.length} onClick={downloadCsv}>
          Download CSV
        </button>
      </div>

      {(totals.length ? totals : [{ currency: currencies[0] ?? "GHS", count: 0, billed: 0, outstanding: 0, overdue: 0, awaiting_certificate: 0 }]).map(
        (t) => (
          <Tiles key={t.currency} t={t} labelled={totals.length > 1} />
        ),
      )}

      {/* ------------------------------------------------------------- finding */}
      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="input min-w-[16rem] flex-1"
            placeholder="Search by invoice number, client, amount or date - e.g. CPL2026, 3,245 or July 2026"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search invoices"
          />
          {filtered && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setQ("");
                clear();
              }}
            >
              Clear all
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Standing">
          {INVOICE_STATUS_FILTERS.map(([key, label]) => (
            <button
              key={key || "all"}
              type="button"
              onClick={() => set({ status: key })}
              className={`rounded-md px-3 py-1.5 text-sm ${
                criteria.status === key ? "bg-brand-50 font-semibold text-link" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <span className="label">Client</span>
            <select className="input" value={criteria.clientId} onChange={(e) => set({ client: e.target.value })}>
              <option value="">Every client</option>
              {clients.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Dates</span>
            <select
              className="input"
              value={preset}
              onChange={(e) => {
                const p = datePresets(today()).find((x) => x.key === e.target.value);
                if (e.target.value === "") set({ from: "", to: "" });
                else if (p) set({ from: p.from, to: p.to });
              }}
            >
              <option value="">Any time</option>
              {datePresets(today()).map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
              {preset === "custom" && <option value="custom">Custom</option>}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2 lg:col-span-2">
            <label className="block">
              <span className="label">
                <select
                  className="border-0 bg-transparent p-0 text-xs font-semibold uppercase tracking-wide text-slate-600 focus:ring-0"
                  value={criteria.dateField}
                  onChange={(e) => set({ date: e.target.value === "due" ? "due" : "" })}
                  aria-label="Which date"
                >
                  <option value="issued">Issued from</option>
                  <option value="due">Due from</option>
                </select>
              </span>
              <input type="date" className="input" value={criteria.from} max={criteria.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">To</span>
              <input type="date" className="input" value={criteria.to} min={criteria.from || undefined} onChange={(e) => set({ to: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="label">Group by</span>
            <select className="input" value={group} onChange={(e) => set({ group: e.target.value === "none" ? "" : e.target.value })}>
              {GROUPINGS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {currencies.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="label mb-0">Currency</span>
            {["", ...currencies].map((c) => (
              <button
                key={c || "all"}
                type="button"
                onClick={() => set({ currency: c })}
                className={`rounded-md px-2.5 py-1 ${criteria.currency === c ? "bg-brand-50 font-semibold text-link" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {c || "All"}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-500">
          {shown.length === data.invoices.length
            ? `${shown.length} invoice${shown.length === 1 ? "" : "s"}`
            : `${shown.length} of ${data.invoices.length} invoices match`}
          {group !== "none" && shown.length ? ` in ${groups.length} group${groups.length === 1 ? "" : "s"}` : ""}.
        </p>
      </div>

      {/* ---------------------------------------------------------------- list */}
      {!shown.length ? (
        <EmptyState
          title={filtered ? "Nothing matches" : "No invoices yet"}
          description={
            filtered
              ? "Try fewer words, a wider date range, or clear the filters."
              : "Invoices are raised from a client's record, against a subscription month or delivered work."
          }
        />
      ) : (
        <div className="card">
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Invoice" k="number" sort={sort} descending={descending} onSort={sortBy} />
                  <SortHeader label="Client" k="client" sort={sort} descending={descending} onSort={sortBy} />
                  <th>Covers</th>
                  <SortHeader label="Issued" k="issued" sort={sort} descending={descending} onSort={sortBy} />
                  <SortHeader label="Due" k="due" sort={sort} descending={descending} onSort={sortBy} />
                  <SortHeader label="Total" k="total" sort={sort} descending={descending} onSort={sortBy} right />
                  <SortHeader label="Outstanding" k="outstanding" sort={sort} descending={descending} onSort={sortBy} right />
                  <th>Standing</th>
                  <th className="text-right">Chased</th>
                </tr>
              </thead>
              {groups.map((g) => {
                const shut = collapsed.has(g.key);
                return (
                  <tbody key={g.key}>
                    {group !== "none" && (
                      <tr className="bg-slate-50">
                        <td colSpan={9} className="py-2">
                          <button
                            type="button"
                            className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 text-left"
                            aria-expanded={!shut}
                            onClick={() =>
                              setCollapsed((s) => {
                                const next = new Set(s);
                                if (next.has(g.key)) next.delete(g.key);
                                else next.add(g.key);
                                return next;
                              })
                            }
                          >
                            <span className="text-slate-400" aria-hidden="true">
                              {shut ? "▸" : "▾"}
                            </span>
                            <span className="font-semibold text-slate-900">{g.label}</span>
                            <span className="text-xs text-slate-500">
                              {g.rows.length} invoice{g.rows.length === 1 ? "" : "s"}
                            </span>
                            {g.totals.map((t) => (
                              <span key={t.currency} className="text-xs text-slate-600">
                                {formatMoneyExact(t.billed, t.currency)} billed
                                {t.outstanding > 0 && (
                                  <>
                                    {" · "}
                                    <span className={t.overdue > 0 ? "font-semibold text-rose-700" : "font-semibold text-amber-700"}>
                                      {formatMoneyExact(t.outstanding, t.currency)} outstanding
                                    </span>
                                  </>
                                )}
                              </span>
                            ))}
                          </button>
                        </td>
                      </tr>
                    )}
                    {!shut && g.rows.map((invoice) => <Row key={invoice.id} invoice={invoice} />)}
                  </tbody>
                );
              })}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Tiles({ t, labelled }: { t: CurrencyTotals; labelled: boolean }) {
  const suffix = labelled ? ` (${t.currency})` : "";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label={`Outstanding${suffix}`} value={formatMoneyExact(t.outstanding, t.currency)} />
      <StatTile label={`Of which overdue${suffix}`} value={formatMoneyExact(t.overdue, t.currency)} tone={t.overdue > 0 ? "danger" : "good"} />
      <StatTile label={`Billed${suffix}`} value={formatMoneyExact(t.billed, t.currency)} />
      <StatTile
        label={`Certificates owed${suffix}`}
        value={formatMoneyExact(t.awaiting_certificate, t.currency)}
        tone={t.awaiting_certificate > 0 ? "warn" : "neutral"}
      />
    </div>
  );
}

function SortHeader({
  label,
  k,
  sort,
  descending,
  onSort,
  right,
}: {
  label: string;
  k: SortKey;
  sort: SortKey;
  descending: boolean;
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = sort === k;
  return (
    <th className={right ? "text-right" : ""} aria-sort={active ? (descending ? "descending" : "ascending") : "none"}>
      <button type="button" className={`inline-flex items-center gap-1 uppercase ${active ? "text-slate-900" : ""}`} onClick={() => onSort(k)}>
        {label}
        <span aria-hidden="true" className={active ? "" : "opacity-30"}>
          {active && !descending ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function Row({ invoice }: { invoice: InvoiceSummary }) {
  return (
    <tr>
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
      <td className="whitespace-nowrap tabular-nums">{invoice.issued_on ? formatDate(invoice.issued_on) : "-"}</td>
      <td className="whitespace-nowrap tabular-nums">{formatDate(invoice.due_on)}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{formatMoneyExact(invoice.gross, invoice.currency)}</td>
      <td className="whitespace-nowrap text-right tabular-nums">
        {owedOn(invoice) > 0 ? formatMoneyExact(owedOn(invoice), invoice.currency) : "-"}
      </td>
      <td>
        <InvoiceStatePill
          state={invoice.state}
          overdue={invoice.standing.overdue}
          daysToDue={invoice.standing.days_to_due}
          labels={INVOICE_STATE_LABELS}
        />
      </td>
      <td className="text-right tabular-nums text-slate-500">{invoice.reminders_sent > 0 ? `${invoice.reminders_sent}x` : "-"}</td>
    </tr>
  );
}
