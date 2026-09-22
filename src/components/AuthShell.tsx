/**
 * The frame around every page somebody meets before they are signed in.
 *
 * There are five of them - staff sign-in, the client's, the growth partner's, the two
 * invitation pages - and they share one frame so that none of them can be framed badly
 * on its own. Two things about it.
 *
 * **The page is the sky over Accra, now.** Dawn, the flat blue of the afternoon, the
 * amber of the evening, the navy of the night, with the sun or the moon where it would
 * be and a greeting for the hour. That is the whole of the firm's side: no list of
 * what the portal is for, no assurances. A page that is never the same twice says the
 * portal is alive better than a paragraph could. On a phone the sky is the band across
 * the top, carrying the firm's logo and which door this is - "Client portal", "Growth
 * partners" - so somebody following a link from an email can tell at a glance that they
 * are in the right place.
 *
 * **The form sits on the sky in a card**, on every size of screen. The appearance
 * control lives with it, because somebody who needs dark mode needs it on this page too,
 * and it is drawn for light or dark ink according to the sky rather than the theme.
 */

import type { ReactNode } from "react";
import { FirmLogo, FirmName } from "../lib/firm";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { accraHour, skyFor } from "../lib/daylight";

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
  const sky = useSky();
  return (
    <div
      className="relative min-h-screen overflow-x-hidden motion-safe:transition-colors motion-safe:duration-1000"
      style={{ background: `linear-gradient(180deg, ${sky.top}, ${sky.bottom})` }}
    >
      {/*
        The sun, or the moon. On a wide screen it hangs at the height of the hour, in
        the middle of the page; on a phone it sits in the band at the top right, where
        it is a mark beside the firm's name rather than something the card has to avoid.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 hidden h-44 w-44 rounded-full motion-safe:transition-all motion-safe:duration-1000 lg:block"
        style={{
          background: sky.sun,
          boxShadow: `0 0 120px 60px ${sky.glow}`,
          transform: `translate(-50%, ${sky.height * 100}vh)`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-6 top-[4.5rem] h-20 w-20 rounded-full lg:hidden"
        style={{ background: sky.sun, boxShadow: `0 0 60px 30px ${sky.glow}` }}
      />
      {/* A little weight at the foot of the sky, so the card has something to stand on. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-brand-900/20 to-transparent"
      />

      <div className="relative flex min-h-screen flex-col lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-stretch">
        {/* --------------------------------------------- the firm's side */}
        <div className="flex flex-col justify-between px-5 pb-16 pt-6 lg:px-14 lg:pb-14 lg:pt-12">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col items-start gap-1.5 lg:gap-2">
              <FirmLogo
                maxWidth="max-w-[9rem] lg:max-w-[14rem]"
                maxHeight="max-h-10 lg:max-h-16"
                onDark={sky.dark}
                labelled
              />
              <div className="min-w-0">
                <FirmName
                  className="truncate text-sm font-semibold lg:text-base"
                  style={{ color: sky.ink }}
                />
                <p
                  className="text-[11px] uppercase tracking-[0.18em] lg:text-xs"
                  style={{ color: sky.sub }}
                >
                  {kicker}
                </p>
              </div>
            </div>
            <div className="lg:hidden">
              <ThemeToggle compact onDark={sky.dark} />
            </div>
          </div>

          <div className="mt-8 max-w-[calc(100%-5rem)] lg:mt-0 lg:max-w-lg">
            <h1
              className="text-3xl font-semibold leading-none tracking-[-0.03em] lg:text-6xl"
              style={{ color: sky.ink }}
            >
              {sky.greeting}
            </h1>
            <p className="mt-3 text-sm lg:text-base" style={{ color: sky.sub }}>
              {sky.line}
            </p>
          </div>
        </div>

        {/* ---------------------------------------------------- the card */}
        <main className="relative flex flex-1 flex-col px-4 pb-10 lg:justify-center lg:px-14 lg:py-10">
          <div className="absolute right-8 top-6 z-20 hidden lg:block">
            <ThemeToggle compact onDark={sky.dark} />
          </div>

          <div className="mx-auto w-full max-w-sm -mt-8 lg:mt-0 lg:max-w-md">
            <div className="rounded-3xl bg-panel/95 p-6 shadow-[0_30px_70px_rgba(15,36,64,0.22)] ring-1 ring-slate-900/5 backdrop-blur-xl sm:p-8">
              {children}
            </div>

            {/*
              The links in the small print are drawn for a light page. On a dark sky
              they would vanish, so the footer restyles them to match its own ink.
            */}
            {footer && (
              <div
                className={`mt-6 px-1 text-center text-xs leading-relaxed lg:px-2 ${
                  sky.dark ? "[&_.link]:text-white [&_.link]:underline" : ""
                }`}
                style={{ color: sky.sub }}
              >
                {footer}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * The sky for the hour in Accra, rechecked once a minute so a page left open over
 * dusk goes dark without a reload.
 */
function useSky() {
  const [hour, setHour] = useState(() => accraHour());
  useEffect(() => {
    const timer = window.setInterval(() => setHour(accraHour()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return skyFor(hour);
}
