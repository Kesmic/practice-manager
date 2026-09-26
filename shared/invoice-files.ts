/**
 * Files attached to an invoice: the receipt behind a reimbursable, a timesheet, the
 * ORC's acknowledgement - the papers that explain a bill.
 *
 * As in Xero, each file is either the firm's own or shared with the client. A shared
 * one appears under the invoice in the client's portal, where they can download it, and
 * can go out attached to the invoice email; one that is not shared never leaves the
 * firm. Nothing is shared by default: somebody decides, file by file.
 *
 * Imported by the Worker and the browser, so the file chooser and the server agree on
 * what may be attached. The browser's checks spare somebody a slow upload; the Worker
 * makes every one of them again.
 */

/** What may be attached: documents and pictures people actually send with a bill. */
export const INVOICE_FILE_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/msword": [".doc"],
  "text/csv": [".csv"],
};

/** For the file chooser's `accept`. */
export const INVOICE_FILE_ACCEPT = Object.entries(INVOICE_FILE_TYPES)
  .flatMap(([type, extensions]) => [type, ...extensions])
  .join(",");

/** Ten megabytes a file, ten files an invoice: supporting papers, not an archive. */
export const MAX_INVOICE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_INVOICE_FILES = 10;
/** What one email will carry, the invoice PDF aside. Mail services refuse much more. */
export const MAX_EMAIL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/**
 * The type to store a file under. The browser's own claim first; failing that - some
 * send spreadsheets as application/octet-stream - the extension, if it is one allowed.
 */
export function invoiceFileType(claimed: string, filename: string): string | null {
  const type = claimed.split(";")[0].trim().toLowerCase();
  if (type in INVOICE_FILE_TYPES) return type;
  const ext = /\.[a-z0-9]+$/i.exec(filename)?.[0]?.toLowerCase();
  if (!ext) return null;
  const found = Object.entries(INVOICE_FILE_TYPES).find(([, exts]) => exts.includes(ext));
  return found ? found[0] : null;
}

export function describeFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why this file cannot be attached, or null. The same sentence in both places. */
export function whyNotInvoiceFile(file: { type: string; name: string; size: number }): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_INVOICE_FILE_BYTES) {
    return `${file.name} is ${describeFileSize(file.size)}. The limit is ${describeFileSize(MAX_INVOICE_FILE_BYTES)}.`;
  }
  if (!invoiceFileType(file.type, file.name)) {
    return `${file.name} is not a kind of file that can be attached. Use a PDF, a picture, or a Word, Excel or CSV file.`;
  }
  return null;
}

/** Where a file lives in the bucket: under its invoice, so deleting the invoice can sweep it. */
export function invoiceFileKey(invoiceId: string, fileId: string): string {
  return `invoices/${invoiceId}/${fileId}`;
}
