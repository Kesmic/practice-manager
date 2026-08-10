/**
 * The firm's own identity — name, logo and colours — available everywhere,
 * including on the sign-in screen before anyone has signed in.
 *
 * It is fetched from `/api/branding`, which needs no session, so the first thing
 * a member of staff sees already looks like their firm rather than like software.
 * The colours are applied to CSS variables as soon as they arrive.
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
import {
  applyBranding,
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  type Branding,
} from "./branding";

const FALLBACK: Branding = {
  firm_name: "Kesmic Consulting",
  logo_data_url: "",
  primary_color: DEFAULT_PRIMARY,
  secondary_color: DEFAULT_SECONDARY,
};

interface FirmState {
  branding: Branding;
  /** Re-reads branding after an administrator changes it. */
  refresh: () => Promise<void>;
}

const FirmContext = createContext<FirmState | null>(null);

export function FirmProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(FALLBACK);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/branding", { credentials: "same-origin" });
      if (!response.ok) return;
      const payload = (await response.json()) as { branding?: Partial<Branding> };
      const next: Branding = { ...FALLBACK, ...payload.branding };
      // An unset colour means "use the default", not an empty string.
      if (!next.primary_color) next.primary_color = DEFAULT_PRIMARY;
      if (!next.secondary_color) next.secondary_color = DEFAULT_SECONDARY;
      setBranding(next);
      applyBranding(next);
    } catch {
      // The portal is perfectly usable in its default colours; never block on this.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ branding, refresh }), [branding, refresh]);
  return <FirmContext.Provider value={value}>{children}</FirmContext.Provider>;
}

export function useFirm(): FirmState {
  const context = useContext(FirmContext);
  if (!context) throw new Error("useFirm must be used inside FirmProvider");
  return context;
}

/**
 * The firm's logo, falling back to the product mark when none has been uploaded.
 * `alt` is empty on purpose where the firm name is already written beside it —
 * a screen reader announcing the name twice is worse than not announcing it.
 */
export function FirmLogo({
  className = "h-9 w-9",
  labelled = false,
}: {
  className?: string;
  labelled?: boolean;
}) {
  const { branding } = useFirm();
  const source = branding.logo_data_url || "/icon.svg";
  return (
    <img
      src={source}
      alt={labelled ? `${branding.firm_name} logo` : ""}
      className={`${className} shrink-0 rounded-md object-contain`}
    />
  );
}
