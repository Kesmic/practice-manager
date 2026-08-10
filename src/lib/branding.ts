/**
 * Applies the firm's chosen colours and logo to the running app.
 *
 * The administrator picks two colours. Each becomes a full ten-step ramp, because
 * the interface needs pale tints for backgrounds and deep shades for text from
 * the same hue. The ramp is written into the CSS variables that Tailwind reads
 * (see tailwind.config.js), so one setting recolours every button, link, pill and
 * highlight at once.
 *
 * Both a light and a dark set are emitted, in a single injected stylesheet, since
 * the same hue needs different treatment on a light and a dark page.
 */

export interface Branding {
  firm_name: string;
  logo_data_url: string;
  primary_color: string;
  secondary_color: string;
}

const STYLE_ID = "kpm-branding";

/** Tailwind's own blue-ish default, used when the firm has not chosen one. */
export const DEFAULT_PRIMARY = "#255291";
export const DEFAULT_SECONDARY = "#0f766e";

export function isHexColour(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

type Rgb = [number, number, number];

function parse(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * weight)) as Rgb;
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [15, 23, 42]; // slate-900 rather than pure black - less harsh.

/**
 * How far each step sits from the chosen colour: the pale end mixes toward white,
 * the deep end toward near-black, and 500 is the colour exactly as chosen.
 */
const TOWARD_WHITE: Record<number, number> = { 50: 0.94, 100: 0.84, 200: 0.68, 300: 0.47, 400: 0.24 };
const TOWARD_BLACK: Record<number, number> = { 600: 0.16, 700: 0.32, 800: 0.47, 900: 0.64 };

function ramp(hex: string): Record<number, Rgb> {
  const base = parse(hex);
  const out: Record<number, Rgb> = { 500: base };
  for (const [shade, weight] of Object.entries(TOWARD_WHITE)) {
    out[Number(shade)] = mix(base, WHITE, weight);
  }
  for (const [shade, weight] of Object.entries(TOWARD_BLACK)) {
    out[Number(shade)] = mix(base, BLACK, weight);
  }
  return out;
}

const channels = ([r, g, b]: Rgb) => `${r} ${g} ${b}`;

/**
 * Which light shade each dark shade borrows from.
 *
 * The primary colour keeps everything from 400 up: those are solid fills carrying
 * white text, and 900 in particular is the sidebar, which stays dark in both
 * themes. Only the pale end, used for tinted backgrounds, flips.
 *
 * The secondary colour is only ever a tint or a highlight, so both of its ends
 * flip - otherwise `text-accent-800` on a `bg-accent-50` badge is dark text on a
 * dark background, and the badge disappears.
 */
const PRIMARY_DARK: Record<number, number> = { 50: 900, 100: 800, 200: 700, 300: 600 };
const SECONDARY_DARK: Record<number, number> = {
  50: 900, 100: 800, 200: 700, 300: 600, 700: 200, 800: 100, 900: 50,
};

function declarations(
  name: string,
  colours: Record<number, Rgb>,
  substitutions: Record<number, number> | null,
): string {
  return Object.keys(colours)
    .map(Number)
    .sort((a, b) => a - b)
    .map((shade) => {
      const source = substitutions ? (substitutions[shade] ?? shade) : shade;
      return `--c-${name}-${shade}: ${channels(colours[source])};`;
    })
    .join("");
}

export function applyBranding(branding: Partial<Branding>): void {
  const primary = isHexColour(branding.primary_color ?? "")
    ? branding.primary_color!
    : DEFAULT_PRIMARY;
  const secondary = isHexColour(branding.secondary_color ?? "")
    ? branding.secondary_color!
    : DEFAULT_SECONDARY;

  const brand = ramp(primary);
  const accent = ramp(secondary);

  const css = [
    `:root{`,
    declarations("brand", brand, null),
    declarations("accent", accent, null),
    // Links need the deep end in light mode and the pale end in dark mode, or
    // they vanish into the background.
    `--c-link: ${channels(brand[700])};`,
    `}`,
    `.dark{`,
    declarations("brand", brand, PRIMARY_DARK),
    declarations("accent", accent, SECONDARY_DARK),
    `--c-link: ${channels(brand[300])};`,
    `}`,
  ].join("");

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    // appendChild rather than append: the Worker types in this project also
    // declare an `append` on their own Element, and it wins here.
    document.head.appendChild(style);
  }
  style.textContent = css;
}
