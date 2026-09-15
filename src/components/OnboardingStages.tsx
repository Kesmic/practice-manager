/**
 * The programme as a timeline, so a new joiner can see what is coming and when.
 *
 * The old screen was two flat lists - yours, and the firm's - which said what but never
 * when, and never how far through somebody was. This shows every stage in order, the
 * date it falls due, and which one the person is actually at.
 *
 * The firm's own steps are shown rather than hidden. Somebody waiting to be given a
 * contract should be able to see that it is the firm's move and not theirs, instead of
 * looking at a list with nothing on it and wondering what they have missed.
 */

import type { OnboardingItem } from "@shared/types";
import {
  STAGE_SPECS,
  type Stage,
  type StageProgress,
} from "@shared/onboarding";
import { formatDate } from "../lib/format";

export function OnboardingStages({
  stages,
  current,
  items,
  onToggle,
}: {
  stages: StageProgress[];
  current: Stage | null;
  items: OnboardingItem[];
  onToggle: (id: string, done: boolean) => void;
}) {
  // A stage with nothing in it belongs to a programme that does not include it.
  const shown = stages.filter((s) => s.total > 0);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="section-title text-lg">What happens, and when</h2>
        <p className="muted mt-0.5">
          {current
            ? `You are at: ${STAGE_SPECS[current].label}.`
            : "Every stage is complete."}
        </p>
      </div>

      <ol className="space-y-4">
        {shown.map((stage) => {
          const spec = STAGE_SPECS[stage.stage];
          const isCurrent = stage.stage === current;
          const inStage = items.filter((i) => i.stage === stage.stage);

          return (
            <li
              key={stage.stage}
              className={`card overflow-hidden ${
                isCurrent ? "ring-2 ring-brand-500" : ""
              }`}
            >
              <div className="border-b border-slate-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">
                        {spec.label}
                      </h3>
                      {stage.complete ? (
                        <span className="pill bg-emerald-50 text-emerald-700 ring-emerald-200">
                          Done
                        </span>
                      ) : isCurrent ? (
                        <span className="pill bg-brand-50 text-brand-700 ring-brand-200">
                          You are here
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{spec.detail}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-slate-700">
                      {stage.due ? formatDate(stage.due) : spec.whenLabel}
                    </p>
                    <p className="text-xs tabular-nums text-slate-500">
                      {stage.done}/{stage.total} done
                    </p>
                  </div>
                </div>
              </div>

              <ul className="divide-y divide-slate-100">
                {inStage.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                    {item.owner === "employee" ? (
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={item.is_done === 1}
                        onChange={(e) => onToggle(item.id, e.target.checked)}
                        aria-label={item.label}
                      />
                    ) : (
                      /*
                        A marker rather than a disabled checkbox. A greyed-out box invites
                        somebody to try clicking it and reads as something they have failed
                        to do, when it is not theirs at all.
                      */
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          item.is_done === 1 ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm ${
                          item.is_done === 1
                            ? "text-slate-400 line-through"
                            : "text-slate-800"
                        }`}
                      >
                        {item.label}
                      </p>
                      {item.detail && (
                        <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">
                      {item.owner === "employee" ? "You" : "The firm"}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
