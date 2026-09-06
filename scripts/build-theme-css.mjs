/**
 * Generates `src/theme.generated.css` - the light and dark values for every
 * colour the app uses.
 *
 * Why generate rather than hand-write: the app refers to Tailwind colours at
 * around five hundred places. Rather than annotate every one of them with a
 * `dark:` variant, the palettes themselves are served from CSS variables, and
 * dark mode redefines the variables. Every existing `text-slate-900` or
 * `ring-slate-200` then does the right thing in both themes, and so does any
 * class written in future.
 *
 * The dark values are the light ramp reversed - 50 becomes 900, 100 becomes 800
 * and so on. That is the correct transformation for how these palettes are used
 * here: pale shades are backgrounds and dark shades are text, and both need to
 * swap ends. `brand` is the exception, handled below.
 *
 * Run via `npm run build:theme`, which the build depends on. Values come from
 * Tailwind itself so they cannot drift from the framework.
 */

import { writeFileSync } from "node:fs";
import colors from "tailwindcss/colors.js";

/** Fallback secondary colour, until an administrator chooses one. */
const ACCENT_DEFAULT = "#0f766e";

/** The firm's default blue. Overridden at runtime by the administrator's choice. */
const BRAND = {
  50: "#eef4fb",
  100: "#d8e6f5",
  200: "#b4cdea",
  300: "#84acdb",
  400: "#5286c8",
  500: "#3268ae",
  600: "#255291",
  700: "#1f4276",
  800: "#1c3861",
  900: "#0f2440",
};

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

/**
 * Which light shade each dark shade borrows from.
 *
 * FULL reverses the whole ramp. That is right for `slate`, where the pale end is
 * always a background and the deep end is always text, so both must swap.
 *
 * TINT reverses only the ends and leaves 400 to 600 alone, for palettes that do
 * two jobs at once: `bg-rose-50` with `text-rose-700` is a tinted badge and has to
 * flip, but `bg-rose-600` is the Cancel button carrying white text and has to stay
 * saturated. Reversing that one too turns the button pale pink.
 */
const FULL = { 50: 900, 100: 800, 200: 700, 300: 600, 400: 500, 500: 400, 600: 300, 700: 200, 800: 100, 900: 50 };
const TINT = { 50: 900, 100: 800, 200: 700, 300: 600, 400: 400, 500: 500, 600: 600, 700: 200, 800: 100, 900: 50 };

/*
 * Every palette the app names has to be listed here, or it silently keeps Tailwind's own
 * fixed values and stops following the theme. That is how `blue` and `indigo` came to be
 * wrong: the "In progress" and "Submitted for review" pills, and the "Addressed" review
 * point, stayed pale-on-dark in dark mode while every other pill inverted around them.
 *
 * If you reach for a colour that is not in this list, add it here rather than using it.
 */
const PALETTES = [
  ["slate", colors.slate, FULL],
  ["amber", colors.amber, TINT],
  ["rose", colors.rose, TINT],
  ["emerald", colors.emerald, TINT],
  ["violet", colors.violet, TINT],
  ["blue", colors.blue, TINT],
  ["indigo", colors.indigo, TINT],
];

function channels(value) {
  if (Array.isArray(value)) return value.join(" ");
  const h = value.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Mirrors the ramp construction in src/lib/branding.ts. */
function buildRamp(hex) {
  const base = channels(hex).split(" ").map(Number);
  const mix = (target, weight) =>
    base.map((c, i) => Math.round(c + (target[i] - c) * weight));
  const white = [255, 255, 255];
  const near = [15, 23, 42];
  return {
    50: mix(white, 0.94), 100: mix(white, 0.84), 200: mix(white, 0.68),
    300: mix(white, 0.47), 400: mix(white, 0.24), 500: base,
    600: mix(near, 0.16), 700: mix(near, 0.32), 800: mix(near, 0.47), 900: mix(near, 0.64),
  };
}

const light = [];
const dark = [];

for (const [name, ramp, mapping] of PALETTES) {
  for (const shade of SHADES) {
    light.push(`    --c-${name}-${shade}: ${channels(ramp[shade])};`);
    dark.push(`    --c-${name}-${shade}: ${channels(ramp[mapping[shade]])};`);
  }
}

/*
 * `brand` cannot simply be reversed. Its mid and dark shades are solid button
 * backgrounds carrying white text, so they must stay saturated in both themes;
 * only the pale end, used for tinted backgrounds and borders, needs to flip.
 */
for (const shade of SHADES) {
  light.push(`    --c-brand-${shade}: ${channels(BRAND[shade])};`);
  const darkValue = shade <= 300 ? BRAND[FULL[shade]] : BRAND[shade];
  dark.push(`    --c-brand-${shade}: ${channels(darkValue)};`);
}

/*
 * `accent` is the firm's secondary colour. These are only the fallbacks used
 * before the administrator has chosen one, or on the sign-in page before the
 * choice has loaded; src/lib/branding.ts replaces them at runtime by the same
 * rules. Built by the same mixing the client uses so the two cannot disagree.
 */
const accentRamp = buildRamp(ACCENT_DEFAULT);
for (const shade of SHADES) {
  light.push(`    --c-accent-${shade}: ${channels(accentRamp[shade])};`);
  const darkValue = accentRamp[TINT[shade]];
  dark.push(`    --c-accent-${shade}: ${channels(darkValue)};`);
}

/*
 * Semantic tokens, for the jobs a fixed palette shade cannot do in both themes.
 *
 * `panel` is the raised surface behind cards, inputs and table headers - white on
 * a light page, a lifted slate on a dark one. `text-white` deliberately stays
 * literal white, because it sits on brand-coloured buttons in both themes.
 *
 * `link` exists because brand-700 reads as a link in light mode but disappears
 * against a dark background, and the same class cannot be both.
 */
light.push(`    --c-panel: ${channels(colors.white)};`);
dark.push(`    --c-panel: ${channels(colors.slate[800])};`);
light.push(`    --c-page: ${channels(colors.slate[100])};`);
dark.push(`    --c-page: ${channels(colors.slate[900])};`);
light.push(`    --c-link: ${channels(BRAND[700])};`);
dark.push(`    --c-link: ${channels(BRAND[300])};`);

const css = `/*
 * GENERATED FILE - do not edit.
 * Produced by scripts/build-theme-css.mjs; run \`npm run build:theme\`.
 *
 * Light values, then the same names redefined for dark mode. The administrator's
 * chosen brand colours override --c-brand-* and --c-link at runtime, from
 * src/lib/branding.ts.
 */

:root {
${light.join("\n")}
}

.dark {
${dark.join("\n")}
}
`;

writeFileSync(new URL("../src/theme.generated.css", import.meta.url), css);
console.log(`theme.generated.css  ${SHADES.length * (PALETTES.length + 3) + 3} colours × 2 themes`);
