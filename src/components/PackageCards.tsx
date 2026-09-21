/**
 * The four packages, side by side, as something a client can actually read.
 *
 * This is the one screen in the portal that is selling rather than recording, and it is
 * the same four columns the firm's pricing proposal prints. The proposal gets away with
 * four columns of small print because it is a document somebody sits down with; a page
 * has to work in a glance on a phone, so the detail is on the back of each card.
 *
 * Three things about how it behaves, each of which is the reason it is built this way
 * rather than as a table:
 *
 * **The card turns over on hover, on focus and on a tap.** A flip that only answers the
 * mouse is a flip that hides half the page from everybody on a phone, and one that only
 * answers a click makes a reader work to find out it can be clicked. All three, so the
 * hint reads the same however somebody is reading it.
 *
 * **Turning it over by pointer does not commit to anything.** Moving the pointer away
 * turns it back; tapping or pressing Enter pins it, so a client reading the inclusions
 * on a phone does not lose them the moment their thumb moves.
 *
 * **Nothing here decides anything.** Choosing a package is a conversation with the firm,
 * so the only action a client gets is asking about one. The portal never moves anybody -
 * see shared/subscriptions.ts - and this page says so rather than offering a button
 * that would appear to.
 */

import { useState } from "react";
import { TIER_LABELS, type ClientTier } from "@shared/subscriptions";
import type { TierInclusion, TierRow } from "@shared/types";
import { formatAmount } from "@shared/money";

export interface PackageCardsProps {
  tiers: TierRow[];
  inclusions: TierInclusion[];
  /** The package this client is already on, which gets the ribbon. */
  current?: ClientTier | null;
  /** Where their figures point, which gets the quieter mark. */
  suggested?: ClientTier | null;
  /** Offered under each card that is not theirs. Omitted for the firm's own screens. */
  onAsk?: (tier: ClientTier) => void;
  askLabel?: string;
  busyTier?: ClientTier | null;
}

/** The inclusions of one package, as headings with their sub-items under them. */
function groupedInclusions(
  inclusions: TierInclusion[],
  tier: ClientTier,
): Array<{ label: string; children: string[] }> {
  const mine = inclusions.filter((i) => i.tier === tier);
  return mine
    .filter((i) => !i.parent_id)
    .sort((a, b) => a.position - b.position)
    .map((top) => ({
      label: top.label,
      children: mine
        .filter((i) => i.parent_id === top.id)
        .sort((a, b) => a.position - b.position)
        .map((i) => i.label),
    }));
}

export function PackageCards({
  tiers,
  inclusions,
  current = null,
  suggested = null,
  onAsk,
  askLabel = "Ask about this",
  busyTier = null,
}: PackageCardsProps) {
  /*
   * Two pieces of state rather than one. `pinned` is a decision somebody made and stays
   * until they make another; `hovered` is where the pointer happens to be. Merging them
   * would mean a card pinned open closing itself when the pointer wandered off it.
   */
  const [pinned, setPinned] = useState<ClientTier | null>(null);
  const [hovered, setHovered] = useState<ClientTier | null>(null);

  const shown = [...tiers]
    .filter((t) => t.active !== 0)
    .sort((a, b) => a.position - b.position);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {shown.map((row) => {
        const tier = row.tier;
        const lines = groupedInclusions(inclusions, tier);
        // Every line, sub-items included: "3 things" against a column of nine reads as
        // though six of them did not count.
        const counted = lines.reduce((sum, line) => sum + 1 + line.children.length, 0);
        const turned = pinned === tier || (pinned === null && hovered === tier);
        const isCurrent = current === tier;
        const isSuggested = suggested === tier && !isCurrent;

        return (
          <div
            key={tier}
            className={`flip lift h-[30rem] ${turned ? "is-turned" : ""}`}
            onMouseEnter={() => setHovered(tier)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="flip-inner h-full">
              {/* ------------------------------------------------- the front */}
              <button
                type="button"
                aria-expanded={turned}
                onFocus={() => setHovered(tier)}
                onBlur={() => setHovered(null)}
                onClick={() => setPinned(pinned === tier ? null : tier)}
                className={`flip-face flex h-full w-full flex-col rounded-xl p-5 text-left ring-1 ring-inset
                  ${
                    isCurrent
                      ? "bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-900/20"
                      : "bg-panel ring-slate-200 hover:ring-brand-300"
                  }`}
              >
                {/*
                  The mark goes above the name rather than beside it. Beside it, a long
                  package name and a two-word pill fight for the same line and the name
                  wraps under its own badge.
                */}
                <div className="mb-1 h-5">
                  {isCurrent && (
                    <span className="pill bg-brand-600 text-white ring-brand-600">
                      Your package
                    </span>
                  )}
                  {isSuggested && (
                    <span className="pill bg-amber-50 text-amber-800 ring-amber-200">
                      Where your figures point
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-slate-900">
                  {TIER_LABELS[tier]}
                </h3>

                {row.ideal_for && (
                  <p className="mt-2 text-sm leading-6 text-slate-600">{row.ideal_for}</p>
                )}

                <div className="mt-auto">
                  <div className="text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                    {row.monthly_fee === null
                      ? "On application"
                      : formatAmount(row.monthly_fee, row.currency, { decimals: false })}
                  </div>
                  <p className="muted">
                    {row.monthly_fee === null ? "Ask us" : "a month"}
                  </p>

                  <p className="mt-3 text-xs font-medium text-link">
                    {counted} things included - turn it over
                  </p>
                </div>
              </button>

              {/* -------------------------------------------------- the back */}
              <div
                className={`flip-face flip-back flex flex-col overflow-hidden rounded-xl p-5 ring-1 ring-inset
                  ${isCurrent ? "bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-900/20" : "bg-panel ring-brand-300"}`}
              >
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {TIER_LABELS[tier]} includes
                  </h3>
                  <button
                    type="button"
                    className="btn-ghost btn-sm ml-auto"
                    onClick={() => setPinned(null)}
                    onFocus={() => setHovered(tier)}
                    onBlur={() => setHovered(null)}
                  >
                    Back
                  </button>
                </div>

                {row.summary && <p className="hint mt-1">{row.summary}</p>}

                <ul className="mt-2 flex-1 space-y-1.5 overflow-auto text-sm text-slate-700">
                  {lines.map((line) => (
                    <li key={line.label}>
                      <span className="font-medium text-slate-800">{line.label}</span>
                      {line.children.length > 0 && (
                        <ul className="ml-4 mt-0.5 space-y-0.5 text-xs text-slate-600">
                          {line.children.map((child) => (
                            <li key={child}>· {child}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>

                {onAsk && !isCurrent && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm mt-3 shrink-0"
                    disabled={busyTier === tier}
                    onClick={() => onAsk(tier)}
                    onFocus={() => setHovered(tier)}
                    onBlur={() => setHovered(null)}
                  >
                    {busyTier === tier ? "Sending..." : askLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
