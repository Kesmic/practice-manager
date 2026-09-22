/**
 * The colour of the sky over Accra at a given hour.
 *
 * The sign-in page carries a ring painted with the whole day, and a hand pointing at
 * the hour now. Five bands of the day are enough: night, morning, afternoon, evening,
 * night again. Between them the ring's gradient does the blending, so the page never
 * needs a sixth.
 *
 * Presentation only, which is why it lives with the browser code and not in shared/.
 * The hour itself comes from shared/filing-clock.ts.
 */

export interface Sky {
  /** The colour at the top of the sky. This is what the ring is painted with. */
  top: string;
  /** The sun, or the moon: the disc on the end of the hand. */
  sun: string;
  /** Whether this is a dark hour, for anything that wants to know without a colour. */
  dark: boolean;
}

export function skyFor(hour: number): Sky {
  if (hour < 6) return { top: "#0F2440", sun: "#EEF4FB", dark: true };
  if (hour < 11) return { top: "#FDE7C2", sun: "#F59E0B", dark: false };
  if (hour < 17) return { top: "#D9E9FB", sun: "#FFFFFF", dark: false };
  if (hour < 20) return { top: "#F4C58F", sun: "#F59E0B", dark: false };
  return { top: "#0F2440", sun: "#EEF4FB", dark: true };
}

/**
 * The whole day as a conic gradient, midnight at the bottom and noon at the top.
 *
 * Starting from 180deg puts hour zero at six o'clock on the dial, so the hand for the
 * hour now can be a plain rotation of hour / 24 turns from the same origin.
 */
export function dayRing(): string {
  const stops: string[] = [];
  for (let h = 0; h <= 24; h++) {
    stops.push(`${skyFor(h % 24).top} ${(h / 24) * 360}deg`);
  }
  return `conic-gradient(from 180deg, ${stops.join(", ")})`;
}

/** Where the hand points, in degrees from the same origin as the ring. */
export function handAngle(hour: number, minute: number): number {
  return ((hour + minute / 60) / 24) * 360 + 180;
}
