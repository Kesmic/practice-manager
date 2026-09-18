/**
 * Documents a member of staff attaches to their own record: their identification and
 * their qualification certificate.
 *
 * These are the two exceptions to the rule in shared/files.ts, and the exception is
 * worth stating because the rule is a good one. Client working papers are never copied
 * into the portal: the firm already has somewhere they live, with retention rules and
 * access control it has decided on, and a second copy forks the truth. None of that
 * holds for a new joiner's passport photograph. They have it on their phone on their
 * first morning, they have nowhere in the firm's document store to put it, and asking
 * them for a SharePoint link to a file they have not been given anywhere to upload is
 * asking them to solve the firm's filing problem before they have a desk.
 *
 * So these two are held by the portal. What follows from that is the rest of this file:
 * what may be attached, how large, and who may open it afterwards.
 *
 * Imported by both the Worker and the browser, so what the form offers and what the
 * server accepts cannot drift apart. The browser's checks are a courtesy - they let
 * somebody find out before a slow upload rather than after - and the server repeats
 * every one of them, because a check only the browser makes is not a check.
 */

/** The two things somebody attaches to their own record. */
export const STAFF_FILE_KINDS = ["identification", "qualification"] as const;
export type StaffFileKind = (typeof STAFF_FILE_KINDS)[number];

export const STAFF_FILE_LABELS: Record<StaffFileKind, string> = {
  identification: "Identification document",
  qualification: "Certificate",
};

/** The profile column each kind fills in. */
export const STAFF_FILE_FIELDS: Record<StaffFileKind, string> = {
  identification: "id_document_url",
  qualification: "qualification_document_url",
};

/**
 * What may be attached.
 *
 * A photograph or a scan, which between them is what an identity document arrives as,
 * plus PDF for a certificate that was issued electronically. Deliberately short: every
 * additional type is something the portal will later hand back to a browser, and the
 * shorter this list is the less that matters.
 *
 * HEIC is here because it is what an iPhone produces by default, and a new joiner
 * photographing their passport on their phone should not have to find out what HEIC is.
 */
export const ACCEPTED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
};

/** For the file picker's `accept`, so the chooser filters rather than the error does. */
export const ACCEPT_ATTRIBUTE = Object.entries(ACCEPTED_TYPES)
  .flatMap(([type, extensions]) => [type, ...extensions])
  .join(",");

export function isAcceptedType(contentType: string): boolean {
  return contentType.split(";")[0].trim().toLowerCase() in ACCEPTED_TYPES;
}

/**
 * The ceiling on one attachment.
 *
 * Ten megabytes takes a photograph of a passport from any phone, several times over,
 * and a scanned multi-page certificate. It is not generous enough to be a place people
 * store things that belong somewhere else, which is the failure mode worth avoiding:
 * the moment this becomes somewhere to put a document, it is a document store, and
 * shared/files.ts explains why the portal is not one.
 */
export const MAX_BYTES = 10 * 1024 * 1024;

export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Why this file cannot be attached, or null.
 *
 * One function rather than two so the browser and the Worker cannot disagree about
 * what is allowed - and so the wording somebody reads is the same either way.
 */
export function whyNotAcceptable(file: {
  type: string;
  size: number;
}): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) {
    return `That file is ${describeSize(file.size)}. The limit is ${describeSize(MAX_BYTES)}.`;
  }
  if (!isAcceptedType(file.type)) {
    return "Attach a PDF or a photograph - PDF, JPEG, PNG, WebP or HEIC.";
  }
  return null;
}

/**
 * How an attachment is recorded in the profile column the field already had.
 *
 * The column used to hold a link into SharePoint and for some people still does. Rather
 * than a second column and a rule about which one wins, an attachment is written into
 * the same column behind a scheme no URL can collide with. Everything that asks "has
 * this person supplied their identification" - the first-run gate, the onboarding
 * progress, the personnel record - keeps working unchanged, and a link somebody
 * recorded before this existed is still a link.
 */
export const ATTACHMENT_SCHEME = "portal:";

export function attachmentRef(fileId: string): string {
  return `${ATTACHMENT_SCHEME}${fileId}`;
}

export function isAttachment(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ATTACHMENT_SCHEME);
}

/** The file id inside a reference, or null if this is an ordinary link. */
export function attachmentId(value: string | null | undefined): string | null {
  return isAttachment(value) ? (value as string).slice(ATTACHMENT_SCHEME.length) : null;
}

/**
 * Where the object lives in the bucket.
 *
 * Keyed by the person as well as the file so that everything belonging to somebody
 * shares a prefix, which is what makes deleting their account able to delete their
 * documents too rather than leaving a passport scan behind.
 */
export function objectKey(userId: string, fileId: string): string {
  return `staff/${userId}/${fileId}`;
}

export function userPrefix(userId: string): string {
  return `staff/${userId}/`;
}

/** What the portal says about an attachment without handing over the file. */
export interface StaffAttachment {
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}
