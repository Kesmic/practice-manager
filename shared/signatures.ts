/**
 * The image of somebody's actual signature, and what a document signed with one holds.
 *
 * Until now signing a contract in the portal meant typing your full name, with the
 * evidence around it - the account it was typed from, the time, the address, a SHA-256
 * of the exact text - carrying the weight. That evidence is good, and none of it is
 * going away. What it does not produce is a document that looks signed, and a contract
 * of employment gets handed to people who expect one: a bank, a landlord, a visa
 * office, the firm's own file. So the person now uploads a picture of their signature
 * and it appears on the document above their typed name.
 *
 * Two rules shape everything below.
 *
 * **A specimen is never overwritten.** Uploading a new signature does not replace the
 * old one; it adds one, and the old row stays exactly where it is. A contract signed
 * last year must go on showing the signature that was used last year, whatever the
 * person has uploaded since. Storage for a picture of a signature is measured in tens
 * of kilobytes, and the alternative - a replacement quietly restating what is on every
 * document somebody has ever signed - is not a trade worth making at any price.
 *
 * **It must be an image a browser will draw, and nothing else.** This is the one place
 * in the portal where a file somebody uploaded is rendered rather than handed back as
 * a download, because a signature that only downloads is not a signature on a page.
 * That inverts the usual reasoning in shared/staff-files.ts and the list below is the
 * price of it.
 *
 * Imported by both the Worker and the browser, so the form and the server cannot
 * disagree about what may be uploaded.
 */

/**
 * What a signature may be.
 *
 * Shorter than the list for attachments, and each absence is deliberate.
 *
 * **No SVG.** An SVG is a document that can carry script, and this is the one upload
 * the portal renders in its own origin. An SVG signature would be somebody else's
 * JavaScript running in the session of whoever opened the contract.
 *
 * **No PDF.** A PDF does not go in an `<img>`, and a signature that cannot be drawn
 * beside a name is not doing the job this exists for.
 *
 * **No HEIC**, although identification photographs accept it, because browsers will
 * not render HEIC. Somebody uploading one would see a broken image and no explanation.
 * Phones offer "most compatible" in their camera settings, and the refusal below says
 * so rather than leaving them to guess.
 */
export const SIGNATURE_TYPES: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

/** For the file chooser's `accept`, so it filters rather than the error message. */
export const SIGNATURE_ACCEPT = Object.entries(SIGNATURE_TYPES)
  .flatMap(([type, extensions]) => [type, ...extensions])
  .join(",");

export function isSignatureType(contentType: string): boolean {
  return contentType.split(";")[0].trim().toLowerCase() in SIGNATURE_TYPES;
}

/**
 * The ceiling on one signature image.
 *
 * Two megabytes is a generous phone photograph of a signature on paper. It is well
 * short of what a document scanner produces at full resolution, which is the point:
 * this is a picture of a few pen strokes, and anything approaching the limit is
 * somebody uploading the whole page they signed rather than the signature on it.
 */
export const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;

/** A signature small enough that something has gone wrong. */
const SIGNATURE_MIN_BYTES = 64;

export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Why this file cannot be used as a signature, or null.
 *
 * One function so that what the form refuses and what the server refuses are the same
 * refusal, in the same words.
 */
export function whyNotASignature(file: { type: string; size: number }): string | null {
  if (file.size < SIGNATURE_MIN_BYTES) return "That file is empty.";
  if (file.size > SIGNATURE_MAX_BYTES) {
    return `That image is ${describeSize(file.size)}. The limit is ${describeSize(
      SIGNATURE_MAX_BYTES,
    )} - photograph just the signature rather than the whole page.`;
  }
  if (!isSignatureType(file.type)) {
    return "Upload a PNG, JPEG or WebP image. If your phone produced a HEIC file, set its camera format to “Most Compatible” and take the photograph again.";
  }
  return null;
}

/**
 * Where a specimen lives in the bucket.
 *
 * Under the person's own prefix, so that removing an account can find everything
 * belonging to them without consulting anything but the prefix.
 */
export function signatureKey(userId: string, signatureId: string): string {
  return `staff/${userId}/signatures/${signatureId}`;
}

/** What the portal says about a specimen without handing over the image. */
export interface SignatureSpecimen {
  id: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

/**
 * Whether this document needs a drawn signature rather than a typed name alone.
 *
 * Signing and acknowledging are different acts. A contract is signed, and the firm
 * wants something that looks like a signature on it. A handbook policy is
 * acknowledged - a record that somebody read it and said so - and asking for a
 * signature image on every policy would turn a two-second confirmation into an upload,
 * twelve times over, for no gain in what the record proves.
 */
export function needsSignatureImage(document: {
  requires_signature: 0 | 1 | boolean;
}): boolean {
  return document.requires_signature === 1 || document.requires_signature === true;
}

/** What somebody is told when they try to sign without having uploaded one. */
export const NO_SIGNATURE_ON_FILE =
  "Upload an image of your signature before signing. You can take a photograph of your signature on paper, or sign on a touchscreen and save the picture.";
