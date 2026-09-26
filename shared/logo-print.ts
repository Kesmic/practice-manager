/**
 * Which picture of the firm's logo goes on a PDF.
 *
 * A PDF can carry a PNG or a JPEG as it is. An SVG it cannot - drawing one needs a
 * renderer, and the Worker has none - and neither can a WebP or a GIF. So for those,
 * the browser of the Partner who saves the logo draws it once into a large PNG (see
 * src/lib/logo.ts, printCopy) and the portal keeps that beside the original, with a
 * fingerprint of the logo it was drawn from. The PDF uses the copy only while the
 * fingerprint still matches: a logo changed some other way never goes out with the
 * old picture, it goes out with the firm's name until a new copy is drawn.
 */

/** Whether a logo can go into a PDF as it is. */
export function isRasterLogo(dataUri: string): boolean {
  return /^data:image\/(png|jpeg|jpg);base64,/.test(dataUri.trim());
}

/** A short, stable fingerprint of a logo, to tell whether a printed copy is its own. */
export async function logoFingerprint(dataUri: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUri));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The logo a PDF should show: the logo itself when it is a PNG or JPEG, its printed
 * copy when that was drawn from this logo, and otherwise none - the document then sets
 * the firm's name.
 */
export async function pdfLogo(settings: Record<string, string | undefined>): Promise<string> {
  const logo = (settings.logo_data_url ?? "").trim();
  if (!logo) return "";
  if (isRasterLogo(logo)) return logo;
  const copy = (settings.logo_print_data_url ?? "").trim();
  if (copy && isRasterLogo(copy) && settings.logo_print_for === (await logoFingerprint(logo))) {
    return copy;
  }
  return "";
}
