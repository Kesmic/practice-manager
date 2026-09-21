/**
 * The pricing proposal, as the prospect reads it.
 *
 * Modelled on the document the firm already sends, so that a business receiving one
 * through a growth partner receives the firm's proposal rather than something that
 * looks like software output. From that document, kept deliberately:
 *
 *  - **Pricing Proposal** set large over a cover band, with "Prepared for" under it
 *  - the letter - "Dear ...", thank you for your interest - before anything is sold
 *  - **About Us**, then **Core Services** as a plain list
 *  - **Package Options**, four columns: the name, who it is for, what is included, and
 *    the price on a shaded row at the foot
 *  - **Your Pricing**: Service, Frequency, Price, then Discounts and a Grand Total
 *  - **Additional Details**: the billing terms, in the firm's own words
 *  - **Contact Details** as three cells - website, phone, email - and the date sent
 *
 * What is new, and the reason this is a page rather than a printed sheet: the package
 * columns answer the pointer. The recommended one is lifted and marked before anybody
 * touches it, and the others rise as they are pointed at, so comparing four columns is
 * something somebody actually does rather than something they skip. It still prints
 * flat, because a proposal is forwarded to a financial controller who prints it.
 *
 * HTML rather than PDF for the reason shared/invoice-document.ts gives: every browser
 * prints to PDF, a PDF writer is a large thing to carry in a Worker, and what is needed
 * is a file that opens anywhere.
 *
 * Everything is escaped on the way in, the firm's own settings included. A proposal is a
 * file that gets forwarded; nothing in the portal should be able to put script in one.
 */

import { escapeHtml } from "./markdown";

export interface ProposalPackage {
  tier: string;
  ideal_for: string | null;
  monthly_fee: number | null;
  currency: string;
  recommended: boolean;
  inclusions: Array<{ id: string; label: string; sub: boolean; parent_id: string | null; position: number }>;
}

export interface ProposalDocument {
  firm: {
    name: string;
    address_lines: string[];
    city: string;
    phone: string;
    email: string;
    website: string;
    logo: string;
    about: string;
  };
  reference: string;
  prepared_for: string;
  address_lines: string[];
  salutation: string | null;
  date: string;
  currency: string;
  packages: ProposalPackage[];
  /** The one being proposed, at the price actually quoted. */
  recommended: { tier: string; label: string; monthly_fee: number | null } | null;
  /** Work quoted beside the package. */
  lines: Array<{ description: string; frequency: string; amount: number }>;
  discount: number;
  note: string | null;
  prepared_by: { name: string; email: string; phone: string | null } | null;
  /** One line each, from the firm's settings. */
  core_services?: string[];
  terms?: string[];
}

const FREQUENCY_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annually",
  one_off: "One-off",
};

function title(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 25 August 2026, which is how the firm's own proposal dates itself. */
export function longDate(iso: string): string {
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(at)) return iso;
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What the proposal totals to.
 *
 * The package's monthly fee and every line quoted beside it, less the discount. One
 * function because the figure appears twice - in the pricing table and as the grand
 * total - and two workings would eventually disagree on the document a client is
 * holding.
 */
export function proposalTotal(doc: ProposalDocument): {
  monthly: number;
  one_off: number;
  discount: number;
  total: number;
} {
  const monthly =
    (doc.recommended?.monthly_fee ?? 0) +
    doc.lines.filter((l) => l.frequency === "monthly").reduce((s, l) => s + l.amount, 0);
  const oneOff = doc.lines
    .filter((l) => l.frequency !== "monthly")
    .reduce((s, l) => s + l.amount, 0);
  const discount = Math.min(doc.discount, monthly + oneOff);
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return {
    monthly: round(monthly),
    one_off: round(oneOff),
    discount: round(discount),
    total: round(monthly + oneOff - discount),
  };
}

const STYLE = `
:root {
  --ink: #101828;
  --muted: #667085;
  --line: #e4e7ec;
  --band: #f4f5f7;
  --accent: #14306b;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--ink);
  background: #f7f8fa;
  font: 15px/1.65 "Segoe UI", system-ui, -apple-system, Arial, sans-serif;
}
.sheet {
  max-width: 54rem;
  margin: 0 auto;
  background: #fff;
  padding: 0 0 3rem;
}
.cover {
  display: flex;
  align-items: stretch;
  background: var(--band);
  min-height: 15rem;
}
.cover .title {
  flex: 1;
  padding: 3rem 2.5rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.cover h1 {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 400;
  font-size: 3.4rem;
  line-height: 1.05;
  letter-spacing: -0.5px;
}
.cover img { max-height: 3rem; margin-bottom: 1.5rem; }
.inner { padding: 0 2.5rem; }
h2 {
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 400;
  font-size: 2rem;
  margin: 2.5rem 0 0.35rem;
}
h2 + .rule { border-top: 1px solid var(--line); margin-bottom: 1.1rem; }
.label { font-weight: 700; font-size: 0.8rem; letter-spacing: 0.04em; }
address { font-style: normal; }
.letter {
  background: var(--band);
  padding: 2rem 3rem;
  margin: 2rem 0 0;
  text-align: center;
}
.letter .dear {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.15rem;
  margin-bottom: 0.6rem;
}
ul.plain { margin: 0.4rem 0 0; padding-left: 1.2rem; }
ul.plain li { margin: 0.15rem 0; }

/* ----------------------------------------------------------- the packages */
.packages {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
}
.pack {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 1rem 0.9rem 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}
/*
  The pointer answer. The recommended column is already lifted, so the eye lands on it
  before anybody moves the mouse, and the others come up as they are considered.
*/
.pack:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 28px rgba(16, 24, 40, 0.12);
  border-color: var(--accent);
}
.pack.recommended {
  border: 2px solid var(--accent);
  box-shadow: 0 10px 24px rgba(20, 48, 107, 0.14);
  transform: translateY(-4px);
}
.pack h3 {
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 400;
  font-size: 1.35rem;
  margin: 0 0 0.2rem;
}
.pack .for { color: var(--muted); font-size: 0.85rem; min-height: 4.2rem; }
.pack ul { margin: 0.6rem 0 1rem; padding-left: 1rem; font-size: 0.85rem; }
.pack ul ul { margin: 0.1rem 0 0.3rem; padding-left: 0.9rem; color: var(--muted); font-size: 0.8rem; }
.pack .price {
  margin-top: auto;
  background: var(--band);
  margin-left: -0.9rem;
  margin-right: -0.9rem;
  padding: 0.7rem 0.9rem;
  border-radius: 0 0 9px 9px;
  font-weight: 700;
}
.tag {
  display: inline-block;
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  padding: 0.1rem 0.6rem;
  font-size: 0.7rem;
  letter-spacing: 0.03em;
  margin-bottom: 0.4rem;
}

/* ------------------------------------------------------------ the pricing */
table { width: 100%; border-collapse: collapse; margin-top: 0.8rem; }
th {
  text-align: left;
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 400;
  font-size: 1.1rem;
  border-bottom: 2px solid var(--ink);
  padding: 0.35rem 0.5rem;
}
td { padding: 0.6rem 0.5rem; border-bottom: 1px solid var(--line); }
td.r, th.r { text-align: right; }
tr.total td { background: var(--band); font-weight: 700; border-bottom: none; }
.contacts { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 0.8rem; }
.contacts div {
  border: 1px solid var(--line);
  padding: 0.8rem;
  text-align: center;
}
.contacts div + div { border-left: none; }
.contacts .k { font-weight: 700; font-size: 0.85rem; }
.sent { margin-top: 2rem; font-family: Georgia, serif; }
.sent span { background: var(--band); border-radius: 999px; padding: 0.15rem 0.7rem; }
.muted { color: var(--muted); }

@media (max-width: 800px) {
  .packages { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cover h1 { font-size: 2.4rem; }
  .inner { padding: 0 1.2rem; }
  .letter { padding: 1.5rem 1.2rem; }
}
@media (max-width: 520px) {
  .packages, .contacts { grid-template-columns: 1fr; }
  .contacts div + div { border-left: 1px solid var(--line); border-top: none; }
}
/* Printed, nothing hovers and nothing is lifted off the page. */
@media print {
  body { background: #fff; }
  .pack, .pack.recommended { transform: none; box-shadow: none; }
  .packages { break-inside: avoid; }
}
@media (prefers-reduced-motion: reduce) {
  .pack { transition: none; }
}
`;

/** One package column, with its inclusions nested the way the proposal prints them. */
function packageColumn(pack: ProposalPackage): string {
  const tops = pack.inclusions
    .filter((i) => !i.sub)
    .sort((a, b) => a.position - b.position);
  const items = tops
    .map((top) => {
      const children = pack.inclusions
        .filter((i) => i.parent_id === top.id)
        .sort((a, b) => a.position - b.position);
      return `<li>${escapeHtml(top.label)}${
        children.length
          ? `<ul>${children.map((c) => `<li>${escapeHtml(c.label)}</li>`).join("")}</ul>`
          : ""
      }</li>`;
    })
    .join("");

  return `
    <div class="pack${pack.recommended ? " recommended" : ""}">
      ${pack.recommended ? `<span class="tag">Recommended for you</span>` : ""}
      <h3>${escapeHtml(title(pack.tier))}</h3>
      <p class="for">${escapeHtml(pack.ideal_for ?? "")}</p>
      <ul>${items}</ul>
      <div class="price">${
        pack.monthly_fee === null
          ? "On application"
          : escapeHtml(money(pack.monthly_fee, pack.currency))
      }</div>
    </div>`;
}

export function renderProposal(doc: ProposalDocument): string {
  const totals = proposalTotal(doc);
  const c = doc.currency;

  const pricingRows = [
    ...(doc.recommended
      ? [
          {
            description: `${title(doc.recommended.label)} package`,
            frequency: "monthly",
            amount: doc.recommended.monthly_fee ?? 0,
          },
        ]
      : []),
    ...doc.lines,
  ]
    .map(
      (line) => `
        <tr>
          <td><strong>${escapeHtml(line.description)}</strong></td>
          <td>${escapeHtml(FREQUENCY_LABELS[line.frequency] ?? title(line.frequency))}</td>
          <td class="r">${escapeHtml(money(line.amount, c))}</td>
        </tr>`,
    )
    .join("");

  const coreServices = (doc.core_services ?? []).filter(Boolean);
  const terms = (doc.terms ?? []).filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pricing proposal ${escapeHtml(doc.reference)} - ${escapeHtml(doc.prepared_for)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="sheet">
  <header class="cover">
    <div class="title">
      ${
        doc.firm.logo
          ? `<img src="${escapeHtml(doc.firm.logo)}" alt="${escapeHtml(doc.firm.name)}" />`
          : `<div class="label">${escapeHtml(doc.firm.name)}</div>`
      }
      <h1>Pricing<br />Proposal</h1>
    </div>
  </header>

  <div class="inner">
    <p class="label" style="margin-top:1.6rem">Prepared for:</p>
    <address>
      <strong>${escapeHtml(doc.prepared_for)}</strong>
      ${doc.address_lines.map((l) => `<br />${escapeHtml(l)}`).join("")}
    </address>
  </div>

  <div class="letter">
    <div class="dear">Dear ${escapeHtml(doc.salutation || "Sir or Madam")},</div>
    <p style="margin:0">
      Thank you for your interest in what we offer. We are delighted to share this
      pricing proposal, which sets out who we are, our packages, and how we can work
      together. We look forward to collaborating soon.
    </p>
  </div>

  <div class="inner">
    <h2>About Us</h2><div class="rule"></div>
    <p>${escapeHtml(doc.firm.about)}</p>

    ${
      coreServices.length
        ? `<h2>Core Services</h2><div class="rule"></div>
           <p>We provide a diverse range of consulting services tailored to meet the needs
              of businesses of all sizes. Our core services include:</p>
           <ul class="plain">${coreServices
             .map((s) => `<li>${escapeHtml(s)}</li>`)
             .join("")}</ul>`
        : ""
    }

    <h2>Package Options</h2><div class="rule"></div>
    <p>An all-in-one package designed to meet your accounting, payroll, tax and
       regulatory needs.</p>
    <div class="packages">${doc.packages.map(packageColumn).join("")}</div>

    <h2>Your Pricing</h2><div class="rule"></div>
    <p>Based on our assessment of your request, the required scope of work and the
       expertise needed, we recommend the following${
         doc.recommended ? ` as the most suitable for ${escapeHtml(doc.prepared_for)}` : ""
       }.</p>
    <table>
      <thead>
        <tr><th>Service</th><th>Frequency</th><th class="r">Price</th></tr>
      </thead>
      <tbody>
        ${pricingRows}
        ${
          totals.discount > 0
            ? `<tr><td><strong>Discount</strong></td><td></td>
                 <td class="r">(${escapeHtml(money(totals.discount, c))})</td></tr>`
            : ""
        }
        <tr class="total">
          <td>Grand total</td><td></td>
          <td class="r">${escapeHtml(money(totals.total, c))}</td>
        </tr>
      </tbody>
    </table>
    ${doc.note ? `<p class="muted">${escapeHtml(doc.note)}</p>` : ""}

    ${
      terms.length
        ? `<h2>Additional Details</h2><div class="rule"></div>
           <p class="label">Billing options</p>
           <ul class="plain">${terms.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
        : ""
    }

    <h2>Contact Details</h2><div class="rule"></div>
    <div class="contacts">
      <div><div class="k">Website</div>${escapeHtml(doc.firm.website)}</div>
      <div><div class="k">Phone</div>${escapeHtml(doc.firm.phone)}</div>
      <div><div class="k">Email</div>${escapeHtml(doc.firm.email)}</div>
    </div>

    ${
      doc.prepared_by
        ? `<p class="muted" style="margin-top:1rem">
             Prepared by ${escapeHtml(doc.prepared_by.name)} on behalf of
             ${escapeHtml(doc.firm.name)}${
               doc.prepared_by.email ? ` - ${escapeHtml(doc.prepared_by.email)}` : ""
             }${doc.prepared_by.phone ? `, ${escapeHtml(doc.prepared_by.phone)}` : ""}.
           </p>`
        : ""
    }

    <p class="sent">Date sent: <span>${escapeHtml(longDate(doc.date))}</span></p>
    <p class="muted" style="font-size:0.8rem">Reference ${escapeHtml(doc.reference)}</p>
  </div>
</div>
</body>
</html>`;
}
