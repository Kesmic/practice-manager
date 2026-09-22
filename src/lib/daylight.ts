/**
 * The sky over Accra at this hour, and how the page says hello under it.
 *
 * Every page somebody meets before signing in is painted with the sky as it is in
 * Accra now - dawn, the flat blue of the afternoon, the amber of the evening, the navy
 * of the night - and a sun or moon at the height it would be. It is the one thing on
 * the page that is never the same twice, and it needs no copy to say where the firm
 * is or that the portal is alive.
 *
 * Five bands are enough. Between them nothing blends: a person does not watch the
 * sign-in page long enough for a gradual sunset, and a page that changed by the minute
 * would look like it was doing something.
 *
 * Ghana keeps GMT all year and has no daylight saving, so the UTC hour is the Accra
 * hour whatever zone the browser is in. Somebody signing in from abroad is greeted by
 * the office they are signing in to.
 *
 * Presentation only, which is why it lives with the browser code and not in shared/.
 */

export interface Sky {
  /** The top and bottom of the gradient. */
  top: string;
  bottom: string;
  /** The colour for words written on the sky, and a quieter one for the second line. */
  ink: string;
  sub: string;
  /** The sun or the moon: its face and the glow around it. */
  sun: string;
  glow: string;
  /** How far down the page the disc sits, as a fraction of the height. */
  height: number;
  /** Whether words on this sky need to be light. */
  dark: boolean;
  greeting: string;
  line: string;
}

export function skyFor(hour: number): Sky {
  if (hour < 6) {
    return {
      top: "#0F2440", bottom: "#1C3861", ink: "#FFFFFF", sub: "rgba(255,255,255,.72)",
      sun: "#EEF4FB", glow: "rgba(238,244,251,.35)", height: 0.14, dark: true,
      greeting: "Still up?", line: "Whatever needs doing at this hour, it can wait for you.",
    };
  }
  if (hour < 11) {
    return {
      top: "#FDE7C2", bottom: "#F7F9FC", ink: "#0F2440", sub: "#5B6472",
      sun: "#F59E0B", glow: "rgba(245,158,11,.45)", height: 0.39, dark: false,
      greeting: "Good morning.", line: "The list is waiting, and so is the coffee.",
    };
  }
  if (hour < 17) {
    return {
      top: "#D9E9FB", bottom: "#F7F9FC", ink: "#0F2440", sub: "#5B6472",
      sun: "#FFFFFF", glow: "rgba(255,255,255,.9)", height: 0.07, dark: false,
      greeting: "Good afternoon.", line: "Half the month's filings are already in.",
    };
  }
  if (hour < 20) {
    return {
      top: "#F4C58F", bottom: "#1F4276", ink: "#FFFFFF", sub: "rgba(255,255,255,.78)",
      sun: "#F59E0B", glow: "rgba(245,158,11,.5)", height: 0.62, dark: true,
      greeting: "Good evening.", line: "Finish what you came for and go home.",
    };
  }
  return {
    top: "#0F2440", bottom: "#0B1A2E", ink: "#FFFFFF", sub: "rgba(255,255,255,.72)",
    sun: "#EEF4FB", glow: "rgba(238,244,251,.3)", height: 0.17, dark: true,
    greeting: "Good night.", line: "The portal keeps the hours you keep.",
  };
}

/** The hour in Accra, 0 to 23. */
export function accraHour(now: Date = new Date()): number {
  return now.getUTCHours();
}
