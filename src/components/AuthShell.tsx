/**
 * The frame around every page somebody meets before they are signed in.
 *
 * There are five of them - staff sign-in, the client's, the growth partner's, the two
 * invitation pages - and they share one frame so that none of them can be framed badly
 * on its own. Two things about it.
 *
 * **The firm's side is a clock, not a paragraph.** On a wide screen the left half is
 * the dial from DayDial: the day as a ring, the hour in Accra as a hand, and the next
 * filing deadline counting down in the middle. That is what the firm does all month,
 * and it says so without a sentence of copy. On a phone the same dial sits, smaller, in
 * a band across the top, with the firm's logo and which door this is - "Client
 * portal", "Growth partners" - so somebody following a link from an email can tell at
 * a glance that they are in the right place.
 *
 * **The form is the other half.** On a wide screen it is a panel of its own; on a phone
 * it is a card lifted onto the band. The appearance control lives with the form, because
 * somebody who needs dark mode needs it on this page too.
 */

import type { ReactNode } from "react";
import { FirmLogo, FirmName } from "../lib/firm";
import { ThemeToggle } from "./ThemeToggle";
import { DayDial, FilingDays } from "./DayDial";

export function AuthShell({
  /** Which door this is: "Client portal", "Growth partners", "Practice Manager". */
  kicker,
  children,
  /** Under the card: the small print that belongs to this door. */
  footer,
  /** Wider than a sign-in form, for the pages that carry more than one. */
  wide = false,
}: {
  kicker: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-page lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ------------------------------------------- the firm's side, wide screens */}
      <aside className="hidden lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:p-12">
        <div className="flex flex-col items-start gap-2">
          <FirmLogo maxWidth="max-w-[14rem]" maxHeight="max-h-16" labelled />
          <FirmName className="text-base font-semibold text-slate-900" />
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{kicker}</p>
        </div>

        <DayDial />

        <p className="text-xs text-slate-500">
          <FilingDays /> · Ghana Revenue Authority dates, Accra time. Public holidays
          bring a deadline forward; the filing calendar inside is the record.
        </p>
      </aside>

      <main className="relative flex min-h-screen flex-col lg:justify-center lg:bg-panel lg:px-14 lg:py-10 lg:shadow-[-1px_0_0_rgba(15,23,42,0.06)]">
        {/*
          The control sits in the corner of the form's panel on a wide screen and in
          the band on a phone. Either way the shell owns it, because a page that placed
          its own would have to know which layout it was in.
        */}
        <div className="absolute right-8 top-6 z-20 hidden lg:block">
          <ThemeToggle compact />
        </div>

        {/* ------------------------------------------------- the phone band */}
        <div className="px-5 pb-12 pt-6 lg:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col items-start gap-1.5">
              <FirmLogo maxWidth="max-w-[9rem]" maxHeight="max-h-10" labelled />
              <div className="min-w-0">
                <FirmName className="truncate text-sm font-semibold text-slate-900" />
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {kicker}
                </p>
              </div>
            </div>
            <ThemeToggle compact />
          </div>
          <div className="mt-5">
            <DayDial compact />
          </div>
        </div>

        {/* ------------------------------------------------------ the content */}
        <div className="flex flex-1 flex-col px-4 pb-10 sm:px-6 lg:flex-none lg:px-0 lg:pb-0">
          <div
            className={`mx-auto w-full ${wide ? "max-w-xl" : "max-w-sm"} -mt-4 lg:mt-0`}
          >
            <div
              className="rounded-2xl bg-panel p-5 shadow-lg ring-1 ring-slate-900/5
                         sm:p-6 lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0"
            >
              {children}
            </div>

            {footer && (
              <div className="mt-6 px-1 text-center text-xs leading-relaxed text-slate-500 lg:mt-10 lg:px-0 lg:text-left">
                {footer}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
