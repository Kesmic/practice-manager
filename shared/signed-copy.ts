/**
 * A downloadable copy of a document somebody has signed, with the evidence attached.
 *
 * The portal already captures everything a typed-name signature needs to stand up: who
 * signed, the name they typed, when, from what address, on which version, and a SHA-256
 * of the exact text they agreed to. Until now all of that lived in a database row that
 * the person who signed could not obtain. Somebody asked for their contract - by a bank,
 * a landlord, a visa office - and the answer was a screenshot.
 *
 * So this produces the whole thing as one self-contained file: the document as they read
 * it, followed by a signature certificate setting out the evidence, formatted to print
 * to a clean PDF from any browser.
 *
 * Three decisions worth stating.
 *
 * **It re-checks itself.** The hash recorded at signature is compared against the text
 * in the file being produced. Matching, the certificate says so. Not matching, it says
 * that too, loudly - because a signed copy whose text has drifted from what was signed
 * is worse than no copy, and the one thing it must never do is look convincing while
 * being wrong.
 *
 * **It is HTML, not PDF.** A PDF writer that lays out a fifteen-page agreement well is a
 * large thing to carry in a Worker, and every browser already prints to PDF. What the
 * firm needs is a file that opens anywhere, prints cleanly, and carries its own styling;
 * this is that, in about a hundred lines rather than a dependency.
 *
 * **Nothing is asserted that the portal cannot support.** The certificate says what was
 * recorded and how to check it. It does not claim to be a qualified electronic signature
 * or to satisfy any particular jurisdiction, because whether a typed name is a signature
 * where the firm operates is a legal question and not one a file can settle by saying so.
 */

import { escapeHtml, renderMarkdownHtml } from "./markdown";

export interface SignedCopy {
  /** The document as it stands. */
  title: string;
  body: string;
  version: number;
  kind: string;
  /** Who signed, from their account rather than from what they typed. */
  signatory_name: string;
  signatory_email: string;
  /** What they typed into the signature box. */
  typed_name: string;
  action: "signed" | "acknowledged";
  signed_at: string;
  ip_address: string | null;
  user_agent: string | null;
  /** The SHA-256 recorded when they signed. */
  content_hash: string;
  /** The SHA-256 of the body in this file, worked out as it is produced. */
  current_hash: string;
  firm_name: string;
}

/** Whether the text in this file is the text that was signed. */
export function textIsIntact(copy: SignedCopy): boolean {
  return copy.content_hash === copy.current_hash;
}

/** A filename somebody can find again in six months. */
export function signedCopyFilename(copy: SignedCopy): string {
  const slug = `${copy.title} ${copy.signatory_name}`
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 80);
  return `${slug || "signed-document"}-${copy.signed_at.slice(0, 10)}.html`;
}

/** "14 September 2026 at 09:42 UTC", which reads as a date rather than a timestamp. */
export function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const day = date.getUTCDate();
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} at ${hh}:${mm} UTC`;
}

/** The hash in groups of eight, so a person can read it against another one. */
export function groupHash(hash: string): string {
  return (hash.match(/.{1,8}/g) ?? [hash]).join(" ");
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 64px;
    font: 15px/1.65 Georgia, Cambria, "Times New Roman", serif;
    color: #1f2933; background: #f4f6f8;
  }
  .sheet {
    max-width: 46rem; margin: 0 auto; background: #fff;
    padding: 48px 56px; border: 1px solid #dfe3e8;
  }
  .letterhead {
    border-bottom: 2px solid #1f3a68; padding-bottom: 12px; margin-bottom: 32px;
  }
  .letterhead .firm {
    font: 600 13px/1.2 system-ui, sans-serif;
    letter-spacing: .16em; text-transform: uppercase; color: #1f3a68;
  }
  h1 { font-size: 24px; margin: 10px 0 0; }
  .meta { font: 12px/1.5 system-ui, sans-serif; color: #6b7785; margin-top: 6px; }
  h2 { font-size: 18px; margin: 28px 0 8px; }
  h3 { font-size: 16px; margin: 22px 0 6px; }
  h4, h5, h6 { font-size: 15px; margin: 18px 0 6px; }
  p { margin: 0 0 12px; }
  ul, ol { margin: 0 0 12px; padding-left: 24px; }
  li { margin-bottom: 5px; }
  blockquote {
    margin: 0 0 12px; padding-left: 14px; border-left: 3px solid #cdd4dc; color: #4a5561;
  }
  hr { border: 0; border-top: 1px solid #dfe3e8; margin: 24px 0; }
  code { font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; background: #eef1f4; padding: 1px 4px; }
  a { color: #1f3a68; }

  .certificate {
    margin-top: 48px; border: 2px solid #1f3a68; padding: 0;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    page-break-inside: avoid;
  }
  .certificate .head {
    background: #1f3a68; color: #fff; padding: 12px 20px;
    font-size: 12px; letter-spacing: .14em; text-transform: uppercase; font-weight: 600;
  }
  .certificate .inner { padding: 20px 24px; }
  .signature-name {
    font: italic 30px/1.2 Georgia, Cambria, serif; color: #17223b;
    border-bottom: 1px solid #b9c1cb; padding-bottom: 8px; margin: 0 0 6px;
  }
  .signature-note { font-size: 12px; color: #6b7785; margin: 0 0 18px; }
  dl { display: grid; grid-template-columns: 13rem 1fr; gap: 7px 18px; margin: 0; font-size: 13px; }
  dt { color: #6b7785; }
  dd { margin: 0; color: #1f2933; word-break: break-word; }
  dd.hash { font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; }
  .verdict { margin: 18px 0 0; padding: 10px 14px; font-size: 13px; }
  .verdict.intact { background: #eaf6ef; color: #1b5e3a; border: 1px solid #bfe0cd; }
  .verdict.changed { background: #fdecea; color: #8a1c13; border: 1px solid #f3c2bd; }
  .footnote { margin-top: 16px; font-size: 12px; color: #6b7785; }

  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border: 0; max-width: none; padding: 0; }
    .certificate { page-break-before: auto; }
    a { color: inherit; text-decoration: none; }
  }
`;

/**
 * The whole file.
 *
 * Every value is escaped on the way in, including the ones that came from the firm's own
 * settings. A signed copy is a file the firm hands to an employee and an employee hands
 * to a bank, and it should not be possible for anything in the portal to put script into
 * it.
 */
export function renderSignedCopy(copy: SignedCopy): string {
  const intact = textIsIntact(copy);
  const verb = copy.action === "signed" ? "signed" : "acknowledged";

  const rows: Array<[string, string, boolean?]> = [
    ["Document", copy.title],
    ["Version", `Version ${copy.version}`],
    ["Signatory", `${copy.signatory_name} (${copy.signatory_email})`],
    ["Name as typed", copy.typed_name],
    ["Action", verb === "signed" ? "Signed" : "Acknowledged"],
    ["Date and time", `${formatStamp(copy.signed_at)} (${copy.signed_at})`],
    ...(copy.ip_address ? ([["IP address", copy.ip_address]] as Array<[string, string]>) : []),
    ...(copy.user_agent ? ([["Device", copy.user_agent]] as Array<[string, string]>) : []),
    ["SHA-256 recorded at signature", groupHash(copy.content_hash), true],
    ["SHA-256 of the text above", groupHash(copy.current_hash), true],
  ];

  const dl = rows
    .map(
      ([term, value, mono]) =>
        `<dt>${escapeHtml(term)}</dt><dd${mono ? ' class="hash"' : ""}>${escapeHtml(value)}</dd>`,
    )
    .join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(copy.title)} - ${escapeHtml(copy.signatory_name)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="sheet">
  <header class="letterhead">
    <p class="firm">${escapeHtml(copy.firm_name)}</p>
    <h1>${escapeHtml(copy.title)}</h1>
    <p class="meta">Version ${copy.version} &middot; ${verb} by ${escapeHtml(
      copy.signatory_name,
    )} on ${escapeHtml(formatStamp(copy.signed_at))}</p>
  </header>

  <main>
${renderMarkdownHtml(copy.body)}
  </main>

  <section class="certificate">
    <p class="head">Electronic signature certificate</p>
    <div class="inner">
      <p class="signature-name">${escapeHtml(copy.typed_name)}</p>
      <p class="signature-note">
        Typed by the signatory into the ${escapeHtml(copy.firm_name)} staff portal,
        after confirming they had read the document in full.
      </p>

      <dl>
        ${dl}
      </dl>

      <p class="verdict ${intact ? "intact" : "changed"}">
        ${
          intact
            ? "<strong>The text in this file is the text that was signed.</strong> The two fingerprints above are identical, so nothing in the document has changed since the signature was given."
            : "<strong>Warning: the text in this file is not the text that was signed.</strong> The two fingerprints above differ, which means the document has been amended since. Treat the document above as the current wording, not as the signed one, and ask the firm for the version that carries the recorded fingerprint."
        }
      </p>

      <p class="footnote">
        The fingerprint is a SHA-256 of the document text as it was agreed to. Anyone
        holding this file can recompute it from the text above and compare, which is what
        makes the record checkable rather than merely asserted. This certificate sets out
        what ${escapeHtml(copy.firm_name)} recorded; whether a typed name constitutes a
        signature is a matter for the law that applies to the document.
      </p>
    </div>
  </section>
</div>
</body>
</html>`;
}
