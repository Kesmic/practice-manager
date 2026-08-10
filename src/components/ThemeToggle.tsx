/**
 * Light, dark, or follow the device.
 *
 * Three explicit choices rather than a two-state switch: "follow the device" is
 * what most people actually want, and a plain toggle cannot express it — it would
 * silently override the phone's own evening switch to dark.
 */

import { useTheme, type ThemeChoice } from "../lib/theme";

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: JSX.Element }> = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="10" cy="10" r="3.6" />
        <path
          d="M10 2.4v1.8M10 15.8v1.8M2.4 10h1.8M15.8 10h1.8M4.6 4.6l1.3 1.3M14.1 14.1l1.3 1.3M15.4 4.6l-1.3 1.3M5.9 14.1l-1.3 1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path
          d="M16 11.7A6.3 6.3 0 1 1 8.3 4a5.2 5.2 0 0 0 7.7 7.7z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    value: "system",
    label: "Device",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="2.6" y="3.6" width="14.8" height="9.6" rx="1.6" />
        <path d="M7 16.4h6" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { choice, setChoice } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 p-0.5 ring-1 ring-inset ring-slate-200"
    >
      {OPTIONS.map((option) => {
        const selected = choice === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={`Appearance: ${option.label}`}
            onClick={() => setChoice(option.value)}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
              selected
                ? "bg-panel text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <span className="h-4 w-4">{option.icon}</span>
            {!compact && option.label}
          </button>
        );
      })}
    </div>
  );
}
