/** @type {import('tailwindcss').Config} */

/*
 * Every colour is served from a CSS variable rather than a fixed hex value, so
 * that dark mode and the administrator's chosen brand colours both work by
 * redefining variables instead of by editing hundreds of class names. The values
 * live in src/theme.generated.css (see scripts/build-theme-css.mjs).
 *
 * `<alpha-value>` is what lets Tailwind's opacity modifiers, such as
 * bg-slate-900/50, keep working against a variable.
 */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

const ramp = (name) =>
  Object.fromEntries(
    SHADES.map((shade) => [shade, `rgb(var(--c-${name}-${shade}) / <alpha-value>)`]),
  );

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Dark mode is a class on <html>, set by src/lib/theme.tsx, so the choice can
  // be an explicit preference rather than only the operating system's setting.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        slate: ramp("slate"),
        brand: ramp("brand"),
        amber: ramp("amber"),
        rose: ramp("rose"),
        emerald: ramp("emerald"),
        violet: ramp("violet"),
        blue: ramp("blue"),
        indigo: ramp("indigo"),
        /** The firm's secondary colour, set by an administrator. */
        accent: ramp("accent"),

        /** Raised surfaces: cards, inputs, table headers, menus. */
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        /** The page behind those surfaces. */
        page: "rgb(var(--c-page) / <alpha-value>)",
        /** Link and accent text, legible on both a light and a dark page. */
        link: "rgb(var(--c-link) / <alpha-value>)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
