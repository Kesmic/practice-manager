/**
 * Light, dark, or follow-the-device.
 *
 * The choice is per person and per browser, held in localStorage rather than on
 * the server: it is a viewing preference, not firm data, and it must apply before
 * the first paint. `main.tsx` applies the stored value synchronously at start-up
 * so the page never flashes light before turning dark.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "kpm_theme";

export function readStoredTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // Private browsing can refuse storage entirely; the default still works.
  }
  return "system";
}

function prefersDark(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Resolves a choice to what should actually be shown right now. */
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  return choice === "system" ? (prefersDark() ? "dark" : "light") : choice;
}

/**
 * Called both from here and from `main.tsx` before React mounts, so the very
 * first paint is already the right colour.
 */
export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.classList.toggle("dark", resolveTheme(choice) === "dark");
}

interface ThemeState {
  choice: ThemeChoice;
  /** What is on screen - differs from `choice` when following the device. */
  active: "light" | "dark";
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredTheme);
  const [active, setActive] = useState<"light" | "dark">(() => resolveTheme(choice));

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    setActive(resolveTheme(next));
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply will not persist; nothing else breaks.
    }
  }, []);

  // Following the device means reacting when the device changes, which happens
  // on a schedule on most phones.
  useEffect(() => {
    if (choice !== "system" || typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setActive(resolveTheme("system"));
      applyTheme("system");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  const value = useMemo(() => ({ choice, active, setChoice }), [choice, active, setChoice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
