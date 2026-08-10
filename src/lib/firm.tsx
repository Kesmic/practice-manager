/**
 * The firm's own identity - name, logo and colours - available everywhere,
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
import { useTheme } from "./theme";
import {
  applyBranding,
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  type Branding,
} from "./branding";

const FALLBACK: Branding = {
  firm_name: "Kesmic Consulting",
  logo_data_url: "",
  logo_dark_data_url: "",
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
 * The firm's logo.
 *
 * Three things a naive square <img> gets wrong, all of which this handles:
 *
 * 1. **Shape.** A firm's logo is usually a wide wordmark, not a square badge. Fitted
 *    into a square box it shrinks to the box's width and ends up a third of the
 *    available height, which reads as an accident. So the slot fixes the height and
 *    lets the width run to a sensible maximum instead.
 * 2. **Colour.** Most logos are dark artwork meant for white paper, and the portal
 *    has dark surfaces: the sidebar and the sign-in panel are navy in every theme,
 *    and in dark mode the pages themselves are dark. Dark ink on either is
 *    unreadable, so a second logo can be uploaded in light ink. Where one exists it
 *    is used on every dark surface and sits straight on it with nothing behind it,
 *    which is what a designer would do. Where it does not, the main logo is set on
 *    a bright plate instead, which keeps it legible at the cost of a visible box.
 * 3. **Duplication.** A wordmark already says the firm's name. Printing the name
 *    beside it says everything twice. `FirmName` below therefore renders nothing
 *    when a logo has been uploaded, and the name when one has not.
 *
 * The product mark is the fallback, and it *is* square, so it keeps a square slot.
 */
export function FirmLogo({
  /**
   * A wordmark is sized by its width, with the height merely capped. Doing it the
   * other way round, fixing the height, leaves a wide logo occupying a fraction of
   * the space available and looking like a mistake.
   */
  maxWidth = "max-w-[11rem]",
  maxHeight = "max-h-10",
  /** Set where the logo sits on one of the navy surfaces. */
  onDark = false,
  labelled = false,
}: {
  maxWidth?: string;
  maxHeight?: string;
  onDark?: boolean;
  labelled?: boolean;
}) {
  const { branding } = useFirm();
  const { active } = useTheme();

  // A dark background is either a surface that is always navy, or any surface at
  // all once the theme is dark. Both want light ink.
  const dark = onDark || active === "dark";
  const lightInk = branding.logo_dark_data_url;
  const custom = Boolean(branding.logo_data_url || lightInk);
  const source = (dark && lightInk ? lightInk : branding.logo_data_url) || "/icon.svg";

  if (!custom) {
    // The product mark is square and designed for a dark background, so it needs
    // neither the width-driven sizing nor a plate.
    return (
      <img
        src={source}
        alt={labelled ? `${branding.firm_name} logo` : ""}
        className={`${maxHeight} aspect-square shrink-0 object-contain`}
      />
    );
  }

  const image = (
    <img
      src={source}
      alt={labelled ? `${branding.firm_name} logo` : ""}
      className={`h-auto w-full ${maxWidth} ${maxHeight} object-contain object-left`}
    />
  );

  // The plate exists only to rescue dark artwork on a dark surface, so it is drawn
  // in exactly one case: the background is dark and there is no light-ink version to
  // use instead. On a light page, and wherever the light-ink logo is available, the
  // artwork sits bare, which is what a transparent file is for.
  //
  // `bg-white` rather than a slate step: the slate ramp reverses in dark mode, so
  // `bg-slate-50` there would resolve to something dark and defeat the whole point.
  // `w-fit self-start` matters too - inside a flex column the plate would otherwise
  // stretch the full width of the panel and read as a white banner, not a logo.
  if (!dark || lightInk) return image;

  return (
    <span
      className={`inline-flex w-fit self-start items-center rounded-lg bg-white p-2 shadow-sm ${maxWidth}`}
    >
      {image}
    </span>
  );
}

/**
 * The firm's name as text, for use beside the logo. Renders nothing once a logo
 * has been uploaded, because a wordmark already carries the name.
 */
export function FirmName({ className = "" }: { className?: string }) {
  const { branding } = useFirm();
  if (branding.logo_data_url || branding.logo_dark_data_url) return null;
  return <p className={className}>{branding.firm_name}</p>;
}
