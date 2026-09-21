/**
 * The frame around every page somebody meets before they are signed in.
 *
 * There are five of them now - staff sign-in, the client's, the growth partner's, the
 * two invitation pages - and until this existed each was a form sitting directly on the
 * page background. On a desktop that passed, because the staff page had a navy panel
 * beside it doing the work. On a phone, where that panel is hidden, what was left was an
 * unframed form on a flat field: no logo, nothing to land on, and on the client's own
 * page nothing at all to say whose portal it was. Somebody following a link from an
 * email deserves better than that on the one screen where they are deciding whether the
 * link was genuine.
 *
 * So: a branded band at the top carrying the firm's logo, its name, and which door this
 * is, and the content in a card lifted onto it. Four things about it.
 *
 * **The band is the answer to "am I in the right place?"** It is the first thing on the
 * screen, it is the firm's own logo, and the kicker under it names the door - "Client
 * portal", "Growth partners" - so a client who has landed on the staff page can tell.
 *
 * **It is a phone layout first.** The two-panel arrangement is what the wide screen
 * gets, through `aside`, and the band is hidden there because the panel says the same
 * thing better. Nothing about the desktop page changes.
 *
 * **The card overlaps the band.** Fifteen pixels of overlap is the whole difference
 * between a page that looks composed and one that looks like a form somebody forgot to
 * style, and it costs one negative margin.
 *
 * **The appearance control lives in the band**, because somebody who needs dark mode
 * needs it on this page too, and a bare toggle floating at the top of a phone screen
 * was reading as a stray widget rather than a control.
 */

import type { ReactNode } from "react";
import { FirmLogo, FirmName } from "../lib/firm";
import { ThemeToggle } from "./ThemeToggle";

export function AuthShell({
  /** Which door this is: "Client portal", "Growth partners", "Practice Manager". */
  kicker,
  children,
  /** The wide-screen panel. Where there is none, the content is simply centred. */
  aside,
  /** Under the card: the small print that belongs to this door. */
  footer,
  /** Wider than a sign-in form, for the pages that carry more than one. */
  wide = false,
}: {
  kicker: string;
  children: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`min-h-screen overflow-x-hidden bg-page ${
        aside ? "lg:grid lg:grid-cols-[1.05fr_1fr]" : ""
      }`}
    >
      {aside}

      <main className="relative flex min-h-screen flex-col lg:justify-center lg:px-14 lg:py-10">
        {/*
          On a wide screen the control sits in the corner of this panel; on a phone it
          is in the band below, where there is a dark surface to sit on. Either way the
          shell owns it, because a page that placed its own would have to know which
          layout it was in.
        */}
        <div className="absolute right-8 top-6 z-20 hidden lg:block">
          <ThemeToggle compact />
        </div>

        {/* ------------------------------------------------- the phone band */}
        <div className="relative isolate overflow-hidden bg-brand-900 px-5 pb-14 pt-7 lg:hidden">
          {/*
            The same two soft lights the wide panel uses, so the two layouts are
            recognisably one design rather than two.
          */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -left-20 -top-24 h-64 w-64 rounded-full bg-brand-500/25 blur-3xl" />
            <div className="absolute -bottom-24 right-[-15%] h-72 w-72 rounded-full bg-accent-500/20 blur-3xl" />
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              <FirmLogo maxWidth="max-w-[9rem]" maxHeight="max-h-11" onDark labelled />
              <div className="min-w-0">
                <FirmName className="truncate text-sm font-semibold text-white" />
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">
                  {kicker}
                </p>
              </div>
            </div>
            <ThemeToggle compact onDark />
          </div>
        </div>

        {/* ------------------------------------------------------ the content */}
        {/*
          Above the band, not under it. The band isolates itself so its two blurred
          lights cannot escape, and an isolated, positioned element paints over a
          static sibling - which put the card's heading behind the navy until this
          said otherwise.
        */}
        <div className="relative z-10 flex flex-1 flex-col px-4 pb-10 sm:px-6 lg:flex-none lg:px-0 lg:pb-0">
          <div
            className={`mx-auto w-full ${wide ? "max-w-xl" : "max-w-sm"} -mt-9 lg:mt-0`}
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
