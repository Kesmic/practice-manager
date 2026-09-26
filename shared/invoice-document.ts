/**
 * The invoice as a document: the thing that gets printed, emailed and filed.
 *
 * Modelled on the invoice the firm already issues, because a client who has had twenty
 * of those should not be able to tell that the twenty-first came from somewhere new.
 * From that document, kept deliberately:
 *
 *  - the letterhead: name, street, city, telephone, finance address, website
 *  - **INVOICE** set large, with BILL TO on the left and the reference block on the right
 *  - the reference block's four rows: INVOICE, DATE, TERMS, DUE DATE
 *  - the client's own tax identification number under their address, which a Ghanaian
 *    client needs on the document to claim the input
 *  - the columns: DATE, ACTIVITY, DESCRIPTION, QTY, RATE, AMOUNT
 *  - withholding as a negative line in the body rather than a note at the foot
 *  - **BALANCE DUE** as the one large figure, already net of that deduction
 *  - the bank block, and "Thanks for your business!"
 *
 * This file is the document's content; shared/invoice-pdf.ts sets it as the PDF the
 * client downloads and receives by email. It was an HTML page at first, because a PDF
 * library is a large thing to carry in a Worker - but clients file, forward and upload
 * invoices, mail services distrust HTML attachments, and shared/pdf.ts turned out to be
 * a few hundred lines, so the invoice is a PDF like everybody else's.
 */

export interface InvoiceDocument {
  /** The letterhead, from the firm's settings. */
  firm: {
    name: string;
    address_lines: string[];
    city: string;
    phone: string;
    email: string;
    website: string;
    /** A data URI, or empty. The portal already holds one for the sign-in screen. */
    logo: string;
    tax_id: string;
  };
  client: {
    name: string;
    address_lines: string[];
    /** Theirs, not the firm's. A Ghanaian client needs it on the document. */
    tax_id: string;
  };
  number: string;
  issued_on: string;
  due_on: string;
  /** "Net 15", worked out from the two dates. */
  terms: string;
  currency: string;
  lines: Array<{
    date: string | null;
    activity: string;
    description: string;
    quantity: number;
    unit_amount: number;
    amount: number;
  }>;
  taxes: Array<{ name: string; rate: number; amount: number }>;
  /**
   * Taken off before tax, the way it was granted. `net` is already net of it, so the
   * subtotal the document shows is the two added back together - there is no separate
   * subtotal figure to get out of step with the lines.
   */
  discount: { label: string; amount: number } | null;
  net: number;
  tax_total: number;
  gross: number;
  /** Shown as a deduction in the body, the way the firm's own invoices show it. */
  withholding: { label: string; rate: number; amount: number } | null;
  balance_due: number;
  /** What has already been settled, so a part-paid invoice reads honestly. */
  paid: number;
  note: string | null;
  bank: {
    account_name: string;
    account_number: string;
    bank: string;
    branch: string;
    swift: string;
  };
}

/** "Net 15", from the gap between issue and due. */
export function describeTerms(issuedOn: string, dueOn: string): string {
  const a = Date.parse(`${issuedOn}T00:00:00Z`);
  const b = Date.parse(`${dueOn}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return "";
  const days = Math.round((b - a) / 86_400_000);
  if (days <= 0) return "Due on receipt";
  return `Net ${days}`;
}

/** The firm's own date style on these documents: 25/08/2026. */
export function slashDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Just the figure, for the columns where the currency is already in the heading. */
export function figure(amount: number): string {
  return amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function invoiceFilename(doc: InvoiceDocument): string {
  const slug = `${doc.number} ${doc.client.name}`
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 80);
  return `${slug || "invoice"}.pdf`;
}
