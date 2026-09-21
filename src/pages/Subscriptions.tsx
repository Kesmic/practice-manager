/**
 * Every client on a tier, and who has outgrown the one they pay for.
 *
 * The screen that earns the feature. A client quietly outstripping what they pay is
 * money the firm is already earning and not billing, and nobody notices it from inside a
 * single client file - it only shows up in a list like this.
 *
 * "No figures" is as loud as everything else on purpose. A criterion nobody updates
 * makes every judgement on this page a guess, and hiding that would make the page look
 * more certain than it is.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TIER_LABELS, type Standing } from "@shared/subscriptions";
import type { SubscriptionsOverview } from "@shared/types";
import { ApiRequestError, api } from "../lib/api";
import { EmptyState, ErrorBanner, Spinner, StatTile } from "../components/ui";
import { formatMoney } from "../lib/format";

const STANDING_STYLE: Record<Standing, string> = {
  within: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  close: "bg-amber-50 text-amber-800 ring-amber-200",
  outgrown: "bg-rose-50 text-rose-800 ring-rose-200",
  unknown: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function Subscriptions() {
  const [data, setData] = useState<SubscriptionsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.subscriptions());
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Could not load subscriptions.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Sorted by what needs attention rather than by name: outgrown first, then close,
   * then the ones nobody has measured, then the settled majority. A list ordered
   * alphabetically buries the three rows worth opening.
   */
  const rows = useMemo(() => {
    const rank: Record<Standing, number> = { outgrown: 0, close: 1, unknown: 2, within: 3 };
    return [...(data?.subscriptions ?? [])].sort(
      (a, b) =>
        rank[a.assessment.standing] - rank[b.assessment.standing] ||
        a.client_name.localeCompare(b.client_name),
    );
  }, [data]);

  if (error && !data) return <ErrorBanner error={error} />;
  if (!data) return <Spinner label="Loading subscriptions" />;

  const currency = rows[0]?.currency ?? "GHS";
  const monthly = rows
    .filter((r) => r.status === "active")
    .reduce((sum, r) => sum + (r.fee ?? 0), 0);
  const needReview = rows.filter((r) => r.assessment.should_move);
  const uplift = needReview.reduce((sum, row) => {
    const suggested = data.tiers.find((t) => t.tier === row.assessment.suggested);
    return sum + Math.max((suggested?.monthly_fee ?? 0) - (row.fee ?? 0), 0);
  }, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="section-title">Subscriptions</h1>
        <p className="muted mt-1">
          What every client is on, and where their figures put them.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Recurring, a month" value={formatMoney(monthly, currency)} />
        <StatTile label="Annualised" value={formatMoney(monthly * 12, currency)} />
        <StatTile label="On a tier" value={rows.length} />
        <StatTile
          label="Need a tier review"
          value={needReview.length}
          tone={needReview.length ? "warn" : "good"}
        />
      </div>

      {needReview.length > 0 && (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <strong>
            {needReview.length === 1
              ? "One client has outgrown their tier."
              : `${needReview.length} clients have outgrown their tier.`}
          </strong>{" "}
          {uplift > 0 && (
            <>
              On the tier their figures point to they would bring in{" "}
              {formatMoney(uplift, currency)} more a month. Nothing moves until a Partner
              moves it.
            </>
          )}
        </div>
      )}

      {!rows.length ? (
        <EmptyState
          title="No client is on a tier yet"
          description="Open a client and put them on one. Their figures then decide whether it still fits."
        />
      ) : (
        <div className="card">
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Tier</th>
                  <th className="text-right">Fee a month</th>
                  {data.criteria.map((c) => (
                    <th key={c.id} className="text-right">
                      {c.name}
                    </th>
                  ))}
                  <th>Standing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.client_id}>
                    <td>
                      <Link className="link" to={`/clients/${row.client_id}`}>
                        {row.client_name}
                      </Link>
                      <div className="text-xs text-slate-500">{row.client_code}</div>
                    </td>
                    <td>
                      {TIER_LABELS[row.tier]}
                      {row.status !== "active" && (
                        <div className="text-xs text-slate-500">{row.status}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      {row.fee === null ? (
                        <span className="text-amber-700">No fee set</span>
                      ) : (
                        formatMoney(row.fee, row.currency)
                      )}
                      {row.negotiated && (
                        <div className="text-xs text-slate-500">negotiated</div>
                      )}
                    </td>
                    {data.criteria.map((criterion) => {
                      const line = row.assessment.lines.find(
                        (l) => l.criterion_id === criterion.id,
                      );
                      return (
                        <td key={criterion.id} className="whitespace-nowrap text-right tabular-nums">
                          {line?.value === null || line?.value === undefined ? (
                            <span className="text-slate-400">-</span>
                          ) : (
                            <>
                              {criterion.unit === "money"
                                ? formatMoney(line.value, row.currency)
                                : line.value.toLocaleString("en-GB")}
                              <span className="text-slate-400">
                                {" / "}
                                {line.ceiling === null
                                  ? "-"
                                  : criterion.unit === "money"
                                    ? formatMoney(line.ceiling, row.currency)
                                    : line.ceiling.toLocaleString("en-GB")}
                              </span>
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      <span className={`pill ${STANDING_STYLE[row.assessment.standing]}`}>
                        {row.assessment.should_move && row.assessment.suggested
                          ? `Outgrown - ${TIER_LABELS[row.assessment.suggested]} fits`
                          : row.assessment.standing === "close"
                            ? "Close - watch"
                            : row.assessment.standing === "unknown"
                              ? "No figures"
                              : "Right tier"}
                      </span>
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
