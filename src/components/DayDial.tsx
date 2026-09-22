/**
 * The dial on the sign-in page: the day as a ring, the hour as a hand, and the next
 * filing deadline counting down in the middle.
 *
 * Every page somebody meets before signing in carries this instead of a paragraph
 * about what the portal is for. A firm whose month runs on the 15th and the last
 * working day does not need to describe itself; it can show the two dates it lives by
 * and let the hand move.
 *
 * What moves, and why each thing moves:
 *
 * - **The seconds.** The countdown ticks once a second, because a figure that only
 *   changed by the minute would look printed rather than alive. One interval, cleared
 *   on unmount.
 * - **The hand.** A slow CSS transition, so that the once-a-minute step is a glide.
 *   Somebody who has asked their system to reduce motion gets the step.
 * - **Nothing else.** The ring is painted once. The greeting changes five times a day.
 *
 * Two shapes: the full dial for a wide screen, and a compact one for the phone band,
 * where the ring sits beside the words rather than around them. Both read the same
 * clock, so they can never disagree.
 *
 * The countdown is not announced to a screen reader every second - that would be a
 * voice reading numbers for as long as the page is open. The whole dial is one image
 * with a label that says what it shows, and the moving figure is hidden from the tree.
 */

import { useEffect, useState } from "react";
import {
  accraClock,
  accraHour,
  daysLeft,
  filingDate,
  greetingFor,
  nextFilings,
  timeLeft,
} from "@shared/filing-clock";
import { dayRing, handAngle, skyFor } from "../lib/daylight";

/** The clock, ticking. One subscription for every dial on the page. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Painted once: the gradient never changes, only the hand over it. */
const RING = dayRing();

function Ring({ now, size }: { now: Date; size: number }) {
  const hour = accraHour(now);
  const sky = skyFor(hour);
  const angle = handAngle(hour, now.getUTCMinutes());
  // The ring's width scales with the dial, as does the hand's reach.
  const band = Math.round(size * 0.05);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        aria-hidden
        className="absolute inset-0 rounded-full shadow-[0_20px_60px_rgba(15,36,64,0.12)]"
        style={{ background: RING }}
      />
      <div
        aria-hidden
        className="absolute rounded-full bg-panel ring-1 ring-inset ring-slate-900/5"
        style={{ inset: band }}
      />
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full text-slate-900 motion-safe:transition-transform motion-safe:duration-1000 motion-safe:ease-out"
        style={{ transform: `rotate(${angle}deg)`, transformOrigin: "50% 50%" }}
      >
        {/*
          A pointer on the rim rather than a hand from the centre: the centre is where
          the countdown is, and a line through "8d 22:43:17" made it harder to read
          than a clock has any business being.
        */}
        <line
          x1="50"
          y1="16"
          x2="50"
          y2="6"
          className="stroke-current"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <circle
          cx="50"
          cy="4.5"
          r="3"
          fill={sky.sun}
          className="stroke-current"
          strokeWidth="0.8"
        />
      </svg>
    </div>
  );
}

export function DayDial({ compact = false }: { compact?: boolean }) {
  const now = useNow();
  const hour = accraHour(now);
  const { paye, vat, soonest } = nextFilings(now);
  const left = timeLeft(soonest.at, now);
  const label = `${accraClock(now)} in Accra. ${greetingFor(hour)} Next filing: ${
    soonest.name
  }, ${filingDate(soonest.at)}, ${left.days} days away. PAYE in ${daysLeft(
    paye.at,
    now,
  )} days, VAT in ${daysLeft(vat.at, now)}.`;

  if (compact) {
    return (
      <div role="img" aria-label={label} className="flex items-center gap-4">
        <Ring now={now} size={96} />
        <div aria-hidden className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {accraClock(now)} Accra
          </p>
          <p className="mt-0.5 text-xl font-semibold tracking-tight text-slate-900">
            {greetingFor(hour)}
          </p>
          <p className="mt-1.5 truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-500">
            {soonest.short} · {filingDate(soonest.at)}
          </p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
            {left.text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div role="img" aria-label={label} className="relative mx-auto h-[26rem] w-[26rem] max-w-full">
      <Ring now={now} size={416} />
      <div
        aria-hidden
        className="absolute inset-12 flex flex-col items-center justify-center text-center"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {accraClock(now)} Accra
        </p>
        <p className="mt-2 text-4xl font-semibold tracking-tight text-slate-900">
          {greetingFor(hour)}
        </p>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-500">
          Next: {soonest.name}
        </p>
        <p className="mt-1 text-[2.6rem] font-semibold leading-none tabular-nums tracking-tight text-slate-900">
          {left.text}
        </p>
        <p className="mt-2 text-sm text-slate-500">{filingDate(soonest.at)}</p>
      </div>
    </div>
  );
}

/**
 * The line under the dial: both deadlines in days, so the one that is not counting
 * down is not forgotten.
 */
export function FilingDays() {
  const now = useNow();
  const { paye, vat } = nextFilings(now);
  return (
    <span className="tabular-nums">
      PAYE {daysLeft(paye.at, now)}d · VAT {daysLeft(vat.at, now)}d
    </span>
  );
}
