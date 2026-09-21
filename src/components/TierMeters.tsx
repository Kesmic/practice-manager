/**
 * Where a client sits against their tier's ceilings.
 *
 * The same `assess` result drives this, the Partner's list and anything that later
 * emails about it, so an amber meter here and an amber pill on a Partner's screen are
 * one calculation rather than two that agree today.
 *
 * A criterion with nothing recorded is drawn as "not recorded" rather than as an empty
 * bar. An empty bar reads as zero, and zero reads as comfortable, which is the opposite
 * of what a missing figure means.
 */

import type { Assessment, Criterion } from "@shared/subscriptions";
import { CRITERION_UNIT_LABELS } from "@shared/subscriptions";
import { formatMoney } from "../lib/format";

function show(value: number | null, unit: Criterion["unit"], currency: string): string {
  if (value === null) return "-";
  return unit === "money" ? formatMoney(value, currency) : value.toLocaleString("en-GB");
}

export function TierMeters({
  criteria,
  assessment,
  currency = "GHS",
}: {
  criteria: Criterion[];
  assessment: Assessment;
  currency?: string;
}) {
  const byId = new Map(criteria.map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      {assessment.lines.map((line) => {
        const criterion = byId.get(line.criterion_id);
        if (!criterion) return null;
        const pct = line.fraction === null ? null : Math.round(line.fraction * 100);
        const tone =
          line.standing === "outgrown"
            ? "bg-rose-500"
            : line.standing === "close"
              ? "bg-amber-500"
              : "bg-brand-600";

        return (
          <div key={line.criterion_id}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-medium text-slate-800">{criterion.name}</span>
              {line.standing === "close" && (
                <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
                  Close to the ceiling
                </span>
              )}
              {line.standing === "outgrown" && (
                <span className="pill bg-rose-50 text-rose-800 ring-rose-200">Over</span>
              )}
              {line.standing === "unknown" && (
                <span className="pill bg-slate-100 text-slate-600 ring-slate-200">
                  Not recorded
                </span>
              )}
              <span className="ml-auto text-sm tabular-nums text-slate-600">
                {show(line.value, criterion.unit, currency)}
                {line.ceiling !== null && (
                  <> of {show(line.ceiling, criterion.unit, currency)}</>
                )}
                {line.ceiling === null && line.value !== null && <> · no ceiling</>}
              </span>
            </div>

            <div className="mt-1.5 h-2 overflow-hidden rounded bg-slate-200">
              {pct !== null && (
                <div className={`h-full rounded ${tone}`} style={{ width: `${pct}%` }} />
              )}
            </div>

            <p className="hint">
              {criterion.how_measured ?? CRITERION_UNIT_LABELS[criterion.unit]}
            </p>
          </div>
        );
      })}
    </div>
  );
}
