/**
 * Making one uploaded logo work on both light and dark backgrounds.
 *
 * The portal has navy surfaces in every theme (the sidebar, the sign-in panel) and
 * dark surfaces everywhere in dark mode. Almost every firm's logo is dark ink drawn
 * for white paper, which is unreadable on those. There are only three ways out:
 *
 * 1. Put the dark artwork on a white plate. Always works, always shows as a box.
 * 2. Have the firm supply a second file in white ink. Best result, but it asks the
 *    firm for something it may not have.
 * 3. Make the white version here, from the file already uploaded.
 *
 * This does the third where it is safe, which is the common case: a monochrome dark
 * logo on a transparent background becomes the same shape in white by keeping every
 * pixel's transparency and setting its colour to white. Antialiased edges keep their
 * partial coverage, so the result is as clean as the original rather than jagged.
 *
 * It refuses in the two cases where it would do damage:
 *
 * - **A logo with colour in it.** Painting a coloured mark flat white throws the
 *   brand away. A firm in that position needs to supply its own light version.
 * - **A file with no transparency**, such as a JPEG or a PNG saved with a white
 *   rectangle. There is no shape to preserve: every pixel would go white and the
 *   logo would vanish into a blank square.
 *
 * Where it refuses, the caller falls back to the white plate, which is honest and
 * readable even if it is not beautiful.
 */

/** What the artwork appears to be, measured from its pixels. */
export interface LogoAnalysis {
  /** Share of pixels that are transparent, 0 to 1. */
  transparency: number;
  /** Mean colourfulness of the visible ink, 0 to 255. Grey and black score 0. */
  saturation: number;
  /** Mean lightness of the visible ink, 0 to 255. */
  lightness: number;
}

/**
 * Below this share of transparent pixels the file is treated as having an opaque
 * background, so there is no silhouette to recolour.
 */
const MIN_TRANSPARENCY = 0.08;
/** Above this mean saturation the logo is carrying colour that must not be discarded. */
const MAX_SATURATION = 42;
/** Above this mean lightness the ink is already light enough for a dark background. */
const MAX_LIGHTNESS = 150;

/** Alpha at or below which a pixel counts as transparent rather than as ink. */
const INK_ALPHA = 32;

export function analyse(pixels: Uint8ClampedArray): LogoAnalysis {
  let clear = 0;
  let ink = 0;
  let saturation = 0;
  let lightness = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha <= INK_ALPHA) {
      clear += 1;
      continue;
    }
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const high = Math.max(r, g, b);
    const low = Math.min(r, g, b);
    ink += 1;
    saturation += high - low;
    // Perceived lightness rather than the plain mean: a saturated blue is darker to
    // the eye than the average of its channels suggests.
    lightness += 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const total = pixels.length / 4;
  return {
    transparency: total ? clear / total : 0,
    saturation: ink ? saturation / ink : 0,
    lightness: ink ? lightness / ink : 255,
  };
}

/** Whether a white version can be made from this artwork without spoiling it. */
export function canDeriveLightInk(analysis: LogoAnalysis): boolean {
  return (
    analysis.transparency >= MIN_TRANSPARENCY &&
    analysis.saturation <= MAX_SATURATION &&
    analysis.lightness <= MAX_LIGHTNESS
  );
}

/** Why a white version could not be made, in words an administrator can act on. */
export function whyNotDerivable(analysis: LogoAnalysis): string {
  if (analysis.transparency < MIN_TRANSPARENCY) {
    return "Your logo file has a solid background rather than a transparent one, so a white version cannot be made from it. Save it as a PNG with a transparent background, or upload a white version yourself.";
  }
  if (analysis.saturation > MAX_SATURATION) {
    return "Your logo has colour in it, and turning it white would throw that away. Please upload a light version of your own.";
  }
  return "Your logo is already light, so it should read on a dark background as it is. Upload a version here if you want a different one used there.";
}

/** The largest edge a logo is analysed and redrawn at. Larger is redrawn smaller. */
const MAX_EDGE = 1600;

function load(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be read."));
    image.src = dataUrl;
  });
}

function draw(image: HTMLImageElement, scale: number) {
  // An SVG with no width or height gives a natural size of 0, so fall back to
  // something large enough that the redrawn version does not look soft.
  const naturalWidth = image.naturalWidth || 800;
  const naturalHeight = image.naturalHeight || 300;
  const fit = Math.min(1, MAX_EDGE / Math.max(naturalWidth, naturalHeight)) * scale;
  const width = Math.max(1, Math.round(naturalWidth * fit));
  const height = Math.max(1, Math.round(naturalHeight * fit));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context, width, height };
}

/** What the server will hold, less a little room for the rest of the request. */
const MAX_CHARS = 380_000;

export interface DerivedLogo {
  dataUrl: string;
  analysis: LogoAnalysis;
}

/**
 * Makes a white-ink version of the uploaded logo, or returns the analysis alone if
 * that cannot be done safely. Runs entirely in the browser: nothing is uploaded to
 * make this, and the administrator can replace or delete the result afterwards.
 */
export async function deriveLightInk(
  dataUrl: string,
): Promise<{ derived: string | null; analysis: LogoAnalysis }> {
  const image = await load(dataUrl);
  const first = draw(image, 1);
  if (!first) throw new Error("This browser cannot process images.");

  const analysis = analyse(
    first.context.getImageData(0, 0, first.width, first.height).data,
  );
  if (!canDeriveLightInk(analysis)) return { derived: null, analysis };

  // Two attempts at most: full size, then half, in case the exported PNG comes out
  // larger than the field will hold. A logo at half of 1600px is still plenty.
  for (const scale of [1, 0.5]) {
    const step = scale === 1 ? first : draw(image, scale);
    if (!step) break;
    const frame = step.context.getImageData(0, 0, step.width, step.height);
    const pixels = frame.data;
    for (let i = 0; i < pixels.length; i += 4) {
      // Transparency carries the shape, so it is left exactly as it was and only
      // the colour changes. This is what keeps antialiased edges clean.
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
    }
    step.context.putImageData(frame, 0, 0);
    const out = step.canvas.toDataURL("image/png");
    if (out.length <= MAX_CHARS) return { derived: out, analysis };
  }

  return { derived: null, analysis };
}
