/**
 * The frame around every page somebody meets before they are signed in.
 *
 * There are five of them - staff sign-in, the client's, the growth partner's, the two
 * invitation pages - and they share one frame so that none of them can be framed badly
 * on its own. Two things about it.
 *
 * **The firm's side is a picture, not a paragraph.** On a wide screen the left half is
 * navy with the orbit from Orbit.tsx: the firm's own mark at the centre and everyone
 * it works with going slowly round it. That is what the portal is - the one place
 * clients, partners and staff meet - and it says so without a list of what the portal
 * is for. On a phone the same orbit sits, smaller, in a navy band across the top, with
 * which door this is - "Client portal", "Growth partners" - so somebody following a
 * link from an email can tell at a glance that they are in the right place.
 *
 * **The form is the other half.** On a wide screen it is a panel of its own; on a
 * phone it is a card lifted onto the band. The appearance control lives with the form,
 * because somebody who needs dark mode needs it on this page too.
 */

import type { ReactNode } from "react";
import { FirmName } from "../lib/firm";
import { ThemeToggle } from "./ThemeToggle";
import { Orbit } from "./Orbit";

export function AuthShell({
  /** Which door this is: "Client portal", "Growth partners", "Practice Manager". */
  kicker,
  children,
  /** Under the card: the small print that belongs to this door. */
  footer,
}: {
  kicker: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-page lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ------------------------------------------- the firm's side, wide screens */}
      <aside className="relative hidden overflow-hidden bg-brand-900 lg:flex lg:min-h-screen lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 flex items-center justify-center">
          <Orbit />
        </div>
        <div className="relative flex flex-col items-start gap-1.5">
          <FirmName className="text-base font-semibold text-white" />
          <p className="text-xs uppercase tracking-[0.18em] text-white/55">{kicker}</p>
        </div>
        <p className="relative max-w-xs text-xs leading-relaxed text-white/50">
          Clients, partners and the people who do the work - around one centre.
        </p>
      </aside>

      <main className="relative flex min-h-screen flex-col lg:justify-center lg:bg-panel lg:px-14 lg:py-10">
        {/*
          The control sits in the corner of the form's panel on a wide screen and in
          the band on a phone. Either way the shell owns it, because a page that placed
          its own would have to know which layout it was in.
        */}
        <div className="absolute right-8 top-6 z-20 hidden lg:block">
          <ThemeToggle compact />
        </div>

        {/* ------------------------------------------------- the phone band */}
        <div className="relative isolate overflow-hidden bg-brand-900 px-5 pb-14 pt-5 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <FirmName className="truncate text-sm font-semibold text-white" />
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">
                {kicker}
              </p>
            </div>
            <ThemeToggle compact onDark />
          </div>
          <div className="mt-3 flex justify-center">
            <Orbit compact />
          </div>
        </div>

        {/* ------------------------------------------------------ the content */}
        {/*
          Above the band, not under it. The band isolates itself so nothing in it can
          escape, and an isolated, positioned element paints over a static sibling -
          which put the card's heading behind the navy until this said otherwise.
        */}
        <div className="relative z-10 flex flex-1 flex-col px-4 pb-10 sm:px-6 lg:flex-none lg:px-0 lg:pb-0">
          <div className="mx-auto w-full max-w-sm -mt-9 lg:mt-0">
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
