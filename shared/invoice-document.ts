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
 * HTML rather than PDF for the reason shared/signed-copy.ts gives: a PDF writer is a
 * large thing to carry in a Worker, every browser already prints to PDF, and what the
 * firm needs is a file that opens anywhere and prints cleanly.
 *
 * Everything is escaped on the way in, the firm's own settings included. An invoice is a
 * file the firm sends to a client and the client forwards to their bank; nothing in the
 * portal should be able to put script into one.
 */

import { escapeHtml } from "./markdown";

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

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Just the figure, for the columns where the currency is already in the heading. */
function figure(amount: number): string {
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
  return `${slug || "invoice"}.html`;
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 18px 56px; background: #f1f3f6; color: #1b2431;
    font: 13px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .sheet {
    max-width: 52rem; margin: 0 auto; background: #fff; padding: 44px 48px 40px;
    box-shadow: 0 1px 3px rgba(20,30,50,.10);
  }

  /* --- letterhead ------------------------------------------------------- */
  .head { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
  .head img { max-height: 62px; max-width: 220px; object-fit: contain; }
  .head .firm { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
  .head address {
    font-style: normal; font-size: 11.5px; line-height: 1.6; color: #6b7686; margin-top: 4px;
  }
  .head .title {
    margin-left: auto; text-align: right;
    font-size: 30px; font-weight: 300; letter-spacing: .10em; color: #5b6673;
    text-transform: uppercase;
  }

  /* --- bill to and the reference block ---------------------------------- */
  .parties { display: flex; flex-wrap: wrap; gap: 28px; margin-top: 30px; }
  .billto { min-width: 15rem; }
  .label {
    font-size: 9.5px; font-weight: 700; letter-spacing: .13em;
    text-transform: uppercase; color: #8b95a3;
  }
  .billto .name { font-weight: 700; margin-top: 5px; }
  .billto address { font-style: normal; font-size: 12px; line-height: 1.55; color: #46505f; }
  .billto .tin { font-size: 11.5px; color: #6b7686; margin-top: 3px; }

  .refs { margin-left: auto; min-width: 16rem; }
  .refs dl { display: grid; grid-template-columns: auto auto; gap: 5px 20px; margin: 0; }
  .refs dt {
    font-size: 9.5px; font-weight: 700; letter-spacing: .13em;
    text-transform: uppercase; color: #8b95a3; align-self: center;
  }
  .refs dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

  /* --- the body --------------------------------------------------------- */
  table { width: 100%; border-collapse: collapse; margin-top: 30px; }
  thead th {
    background: #f2f2f2; padding: 8px 10px; text-align: left;
    font-size: 9.5px; font-weight: 700; letter-spacing: .12em;
    text-transform: uppercase; color: #5b6673; white-space: nowrap;
  }
  tbody td { padding: 10px; border-bottom: 1px solid #e4e8ee; vertical-align: top; font-size: 12.5px; }
  .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tbody tr.deduction td { color: #8a1c13; }

  /* --- totals ----------------------------------------------------------- */
  .foot { display: flex; flex-wrap: wrap; gap: 28px; margin-top: 22px; }
  .thanks { font-size: 13px; color: #46505f; align-self: flex-end; }
  .totals { margin-left: auto; min-width: 17rem; }
  .totals dl { display: grid; grid-template-columns: 1fr auto; gap: 6px 20px; margin: 0; font-size: 12.5px; }
  .totals dt { color: #6b7686; }
  .totals dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .totals .rule { grid-column: 1 / -1; border-top: 1px solid #d7dce4; margin: 3px 0; }
  .balance {
    display: flex; align-items: baseline; gap: 14px; justify-content: flex-end;
    margin-top: 14px; padding-top: 12px; border-top: 2px solid #1b2431;
  }
  .balance .k {
    font-size: 9.5px; font-weight: 700; letter-spacing: .13em;
    text-transform: uppercase; color: #5b6673;
  }
  .balance .v { font-size: 25px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }

  /* --- bank ------------------------------------------------------------- */
  .bank { margin-top: 34px; padding-top: 16px; border-top: 1px solid #e4e8ee; }
  .bank p { margin: 0 0 8px; font-size: 12.5px; color: #46505f; }
  .bank dl {
    display: grid; grid-template-columns: auto 1fr; gap: 3px 18px;
    margin: 0; font-size: 12px;
  }
  .bank dt { color: #8b95a3; }
  .bank dd { margin: 0; font-variant-numeric: tabular-nums; }
  .note { margin-top: 20px; font-size: 12px; color: #6b7686; }

  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; max-width: none; padding: 0; }
    thead th { background: #f2f2f2 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
  @media (max-width: 640px) {
    .sheet { padding: 24px 18px; }
    .head .title { margin-left: 0; text-align: left; }
    .refs, .totals { margin-left: 0; }
  }
`;

export function renderInvoice(doc: InvoiceDocument): string {
  const c = doc.currency;

  const rows = doc.lines
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(slashDate(line.date))}</td>
          <td>${escapeHtml(line.activity)}</td>
          <td>${escapeHtml(line.description)}</td>
          <td class="r">${line.quantity}</td>
          <td class="r">${figure(line.unit_amount)}</td>
          <td class="r">${figure(line.amount)}</td>
        </tr>`,
    )
    .join("");

  /*
   * The deduction sits in the body, as a negative line, exactly where the firm's own
   * invoices put it. A note at the foot would be tidier and would not survive being
   * read by somebody comparing this against last month's.
   */
  /*
   * The discount sits in the body too, immediately under the lines it came off. A client
   * who has been given one looks for it among the charges rather than in the totals
   * block, and one that appeared only at the foot reads as though the fee had changed.
   */
  const discountRow = doc.discount
    ? `
        <tr class="deduction">
          <td></td>
          <td>Discount</td>
          <td>${escapeHtml(doc.discount.label)}</td>
          <td class="r">1</td>
          <td class="r">-${figure(doc.discount.amount)}</td>
          <td class="r">-${figure(doc.discount.amount)}</td>
        </tr>`
    : "";

  const deduction = doc.withholding
    ? `
        <tr class="deduction">
          <td></td>
          <td>${escapeHtml(doc.withholding.label)}</td>
          <td>${escapeHtml(doc.withholding.label)} at ${doc.withholding.rate}%</td>
          <td class="r">1</td>
          <td class="r">-${figure(doc.withholding.amount)}</td>
          <td class="r">-${figure(doc.withholding.amount)}</td>
        </tr>`
    : "";

  const taxRows = doc.taxes
    .map(
      (tax) => `
        <dt>${escapeHtml(tax.name)} ${tax.rate}%</dt>
        <dd>${figure(tax.amount)}</dd>`,
    )
    .join("");

  const bank = [
    ["Account Name", doc.bank.account_name],
    ["Account Number", doc.bank.account_number],
    ["Bank", doc.bank.bank],
    ["Branch", doc.bank.branch],
    ["Swift Code", doc.bank.swift],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(doc.number)} - ${escapeHtml(doc.client.name)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="sheet">
  <header class="head">
    <div>
      ${
        doc.firm.logo
          ? `<img src="${escapeHtml(doc.firm.logo)}" alt="${escapeHtml(doc.firm.name)}" />`
          : `<div class="firm">${escapeHtml(doc.firm.name)}</div>`
      }
      <address>
        ${doc.firm.address_lines.map((l) => escapeHtml(l)).join("<br />")}
        ${doc.firm.city ? `<br />${escapeHtml(doc.firm.city)}` : ""}
        ${doc.firm.phone ? `<br />${escapeHtml(doc.firm.phone)}` : ""}
        ${doc.firm.email ? `<br />${escapeHtml(doc.firm.email)}` : ""}
        ${doc.firm.website ? `<br />${escapeHtml(doc.firm.website)}` : ""}
        ${doc.firm.tax_id ? `<br />TIN ${escapeHtml(doc.firm.tax_id)}` : ""}
      </address>
    </div>
    <div class="title">Invoice</div>
  </header>

  <section class="parties">
    <div class="billto">
      <div class="label">Bill to</div>
      <div class="name">${escapeHtml(doc.client.name)}</div>
      <address>${doc.client.address_lines.map((l) => escapeHtml(l)).join("<br />")}</address>
      ${doc.client.tax_id ? `<p class="tin">TIN ${escapeHtml(doc.client.tax_id)}</p>` : ""}
    </div>

    <div class="refs">
      <dl>
        <dt>Invoice</dt><dd>${escapeHtml(doc.number)}</dd>
        <dt>Date</dt><dd>${escapeHtml(slashDate(doc.issued_on))}</dd>
        <dt>Terms</dt><dd>${escapeHtml(doc.terms)}</dd>
        <dt>Due date</dt><dd>${escapeHtml(slashDate(doc.due_on))}</dd>
      </dl>
    </div>
  </section>

  <table>
    <thead>
      <tr>
        <th>Date</th><th>Activity</th><th>Description</th>
        <th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}${discountRow}${deduction}</tbody>
  </table>

  <section class="foot">
    <p class="thanks">Thanks for your business!</p>
    <div class="totals">
      <dl>
        <dt>Subtotal</dt><dd>${figure(doc.net + (doc.discount?.amount ?? 0))}</dd>
        ${
          doc.discount
            ? `<dt>${escapeHtml(doc.discount.label)}</dt>
               <dd>-${figure(doc.discount.amount)}</dd>
               <dt>Before tax</dt><dd>${figure(doc.net)}</dd>`
            : ""
        }
        ${taxRows}
        ${
          doc.withholding
            ? `<div class="rule"></div>
               <dt>Total</dt><dd>${figure(doc.gross)}</dd>
               <dt>${escapeHtml(doc.withholding.label)}</dt>
               <dd>-${figure(doc.withholding.amount)}</dd>`
            : ""
        }
        ${
          doc.paid > 0
            ? `<div class="rule"></div><dt>Paid</dt><dd>-${figure(doc.paid)}</dd>`
            : ""
        }
      </dl>
      <div class="balance">
        <span class="k">Balance due</span>
        <span class="v">${escapeHtml(money(Math.max(doc.balance_due - doc.paid, 0), c))}</span>
      </div>
    </div>
  </section>

  ${
    bank
      ? `<section class="bank">
      <p>Kindly remit payment into our bank account with the details below:</p>
      <dl>${bank}</dl>
    </section>`
      : ""
  }

  ${doc.note ? `<p class="note">${escapeHtml(doc.note)}</p>` : ""}
</div>
</body>
</html>`;
}
