/**
 * The firm at the centre, and everyone it works with going round it.
 *
 * Every page somebody meets before signing in carries this instead of a paragraph
 * about what the portal is for. Three rings, two slow orbits of dots - teal for the
 * clients and the people who do the work, amber for the growth partners who bring
 * them - and the firm's own mark in a disc at the middle. It says what the portal is,
 * which is the one place all of those meet, without a sentence of copy.
 *
 * The orbits are CSS animations on two SVG groups, forty seconds one way and
 * twenty-six the other, slow enough to be noticed only when you look. Somebody who
 * has asked their system to reduce motion gets the same picture, still.
 *
 * Two sizes: the full orbit for a wide screen, where it fills the firm's side, and a
 * compact one for the phone band. Both are the same drawing scaled, so they can never
 * disagree.
 */

import { FirmLogo } from "../lib/firm";

export function Orbit({ compact = false }: { compact?: boolean }) {
  const size = compact ? 168 : 560;
  const disc = compact ? 60 : 200;
  return (
    <div
      aria-hidden
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 600 600" className="absolute inset-0 h-full w-full">
        <g fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="1.2">
          <circle cx="300" cy="300" r="290" />
          <circle cx="300" cy="300" r="200" />
          <circle cx="300" cy="300" r="112" />
        </g>
        {/* Clients and the people who do the work. */}
        <g className="orbit-spin" fill="#0F766E">
          <circle cx="300" cy="10" r="15" />
          <circle cx="590" cy="300" r="11" />
          <circle cx="300" cy="590" r="13" />
          <circle cx="10" cy="300" r="9" />
        </g>
        {/* Growth partners, on the inner ring and the other way round. */}
        <g className="orbit-spin-reverse" fill="#F59E0B">
          <circle cx="300" cy="100" r="9" />
          <circle cx="500" cy="300" r="11" />
          <circle cx="100" cy="300" r="7" />
        </g>
      </svg>

      {/* The firm itself. Its own logo, on a white disc, at the centre of everything. */}
      <div
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_0_80px_rgba(255,255,255,0.18)]"
        style={{ width: disc, height: disc }}
      >
        <FirmLogo
          maxWidth={compact ? "max-w-[2.75rem]" : "max-w-[8.5rem]"}
          maxHeight={compact ? "max-h-7" : "max-h-20"}
        />
      </div>
    </div>
  );
}
