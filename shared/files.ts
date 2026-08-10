/**
 * The client file: folders and documents that live in SharePoint, OneDrive or Google
 * Drive, recorded here as links.
 *
 * The portal deliberately stores no client documents of its own. A compliance practice
 * already has somewhere its working papers live, with the retention rules, the version
 * history and the access control the firm has decided on. Copying documents into a
 * second system would fork the truth and double the places a confidentiality breach
 * could come from.
 *
 * So a "file" here is a reference: a title, a link, and enough structure to find it
 * again. What the portal adds is the index. Which folder is this client's? Where is
 * last year's corporate tax computation? That is the question the portal answers, and
 * the answer is a link the person clicks, landing in SharePoint with their own
 * Microsoft sign-in and whatever permissions the firm gave them there.
 *
 * One consequence worth stating plainly, because it is a feature rather than a gap:
 * **the portal never checks whether a link still works, and never grants access to
 * anything.** If a document is moved or its permissions change, the portal will not
 * know, and someone without access in SharePoint will be refused by SharePoint.
 *
 * Imported by both the Worker and the React app, so what the form offers and what the
 * server accepts cannot drift apart.
 */

/** A whole folder, or one document inside it. */
export const FILE_KINDS = ["folder", "document"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  folder: "Folder",
  document: "Document",
};

/**
 * Where the document actually lives. Detected from the link rather than asked for,
 * because nobody should have to tell the portal what it can work out, and a wrong
 * answer here would only mislabel an icon.
 */
export const FILE_PROVIDERS = [
  "sharepoint",
  "onedrive",
  "google_drive",
  "other",
] as const;
export type FileProvider = (typeof FILE_PROVIDERS)[number];

export const FILE_PROVIDER_LABELS: Record<FileProvider, string> = {
  sharepoint: "SharePoint",
  onedrive: "OneDrive",
  google_drive: "Google Drive",
  other: "Elsewhere",
};

/** Enough of a visual difference to scan a list by, without an icon set. */
export const FILE_PROVIDER_STYLES: Record<FileProvider, string> = {
  sharepoint: "bg-brand-50 text-link ring-brand-200",
  onedrive: "bg-brand-50 text-link ring-brand-200",
  google_drive: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  other: "bg-slate-100 text-slate-600 ring-slate-200",
};

/**
 * Works out the provider from the link's hostname.
 *
 * SharePoint sites are `<tenant>.sharepoint.com`, and OneDrive personal shares are
 * `<tenant>-my.sharepoint.com` or `1drv.ms`, so OneDrive has to be tested first: every
 * OneDrive host is also a SharePoint host.
 */
export function providerFromUrl(url: string): FileProvider {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host.endsWith("-my.sharepoint.com") || host === "1drv.ms" || host.endsWith("onedrive.live.com")) {
    return "onedrive";
  }
  if (host.endsWith(".sharepoint.com") || host === "sharepoint.com") return "sharepoint";
  if (
    host === "drive.google.com" ||
    host === "docs.google.com" ||
    host.endsWith(".googleusercontent.com")
  ) {
    return "google_drive";
  }
  return "other";
}

/** The longest each field may be. */
export const FILE_LIMITS = {
  title: 200,
  url: 2000,
  category: 60,
  period_label: 40,
  notes: 1000,
} as const;

/**
 * Whether a link is one the portal will store.
 *
 * Only http and https. This matters more than it looks: a stored link is rendered as
 * an anchor for colleagues to click, so `javascript:` or `data:` would turn the client
 * file into a way to run something in a colleague's session. Returns the reason when
 * it refuses, so the message shown is the real one.
 */
export function checkFileUrl(url: string): { ok: true } | { ok: false; reason: string } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, reason: "Paste the link to the document." };
  if (trimmed.length > FILE_LIMITS.url) {
    return { ok: false, reason: "That link is too long to store." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: "That does not look like a link. Copy the address from your browser, starting with https://",
    };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "Links must start with https:// or http://" };
  }
  return { ok: true };
}

/**
 * Categories offered when adding to a client file, as the drop-down's suggestions.
 *
 * Suggestions rather than a fixed list: a firm's filing structure is its own, and
 * anything typed is kept. They exist so that the common case is one click and so that
 * two people filing the same thing are likely to agree on where it goes.
 */
export const FILE_CATEGORY_SUGGESTIONS = [
  "Permanent file",
  "Engagement letters",
  "Statutory accounts",
  "Tax returns and computations",
  "Working papers",
  "Payroll",
  "Correspondence",
  "Identification and due diligence",
  "Registrar and regulatory filings",
] as const;

/** One entry in a client file, as it crosses the wire. */
export interface ClientFile {
  id: string;
  client_id: string;
  engagement_id: string | null;
  kind: FileKind;
  provider: FileProvider;
  title: string;
  url: string;
  category: string | null;
  period_label: string | null;
  notes: string | null;
  added_by: string | null;
  added_by_name: string | null;
  engagement_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Groups a client file for display: folders first, then documents by category.
 *
 * Folders come first because the commonest thing anybody wants is the way in to the
 * client's folder, not one document inside it.
 */
export function groupClientFiles(
  files: ClientFile[],
): Array<{ heading: string; files: ClientFile[] }> {
  const folders = files.filter((f) => f.kind === "folder");
  const documents = files.filter((f) => f.kind === "document");

  const groups: Array<{ heading: string; files: ClientFile[] }> = [];
  if (folders.length) groups.push({ heading: "Folders", files: folders });

  const byCategory = new Map<string, ClientFile[]>();
  for (const file of documents) {
    const key = file.category?.trim() || "Uncategorised";
    const list = byCategory.get(key);
    if (list) list.push(file);
    else byCategory.set(key, [file]);
  }
  // Alphabetical, but "Uncategorised" last: it is a holding pen, not a category.
  const headings = [...byCategory.keys()].sort((a, b) => {
    if (a === "Uncategorised") return 1;
    if (b === "Uncategorised") return -1;
    return a.localeCompare(b);
  });
  for (const heading of headings) {
    groups.push({ heading, files: byCategory.get(heading)! });
  }
  return groups;
}
