/**
 * The words of an invoice email, and how they become the message a client reads.
 *
 * Shared by the Worker, which sends it, and the screen, which previews it as it is
 * edited - so what the Partner sees before pressing send is the same function's
 * output as what arrives, not a lookalike that drifts.
 *
 * The wording is plain text with a few square-bracketed words the portal fills in for
 * each recipient, the way Xero's invoice emails work: [Name], [Invoice number],
 * [Amount due] and so on. Two are more than a word: [here] becomes the word "here",
 * linked to the invoice in the client portal (and tracked, when it is followed), and
 * [Summary] on a line of its own becomes the short block of figures - the number, the
 * amount and the due date. Anything else in brackets is left exactly as written.
 */

export type InvoiceEmailKind = "issued" | "resent" | "due_today" | "overdue";

export interface InvoiceEmailWording {
  subject: string;
  message: string;
}

export interface InvoiceEmailFacts {
  /** The recipient's name as the firm holds it. Blank reads "Sir/Madam". */
  name: string;
  number: string;
  firmName: string;
  /** Already formatted: "GHS 1,494.00". */
  amountDue: string;
  /** Already formatted: "15 October 2026". */
  dueOn: string;
  /** Where "here" goes. Empty when the portal has no address to link to. */
  link: string;
  /** The open-tracking image. Empty for none. */
  pixel: string;
}

/** The words the portal fills in, in the order the screen offers them. */
export const INVOICE_EMAIL_PLACEHOLDERS: Array<{ token: string; label: string; hint: string }> = [
  { token: "[Name]", label: "Name", hint: "The recipient's full name, or Sir/Madam when none is held" },
  { token: "[First name]", label: "First name", hint: "The first word of the recipient's name" },
  { token: "[Invoice number]", label: "Invoice number", hint: "The invoice's number" },
  { token: "[Amount due]", label: "Amount due", hint: "The amount due, with its currency" },
  { token: "[Due date]", label: "Due date", hint: "The date payment falls due" },
  { token: "[Firm name]", label: "Firm name", hint: "The firm's name, from Settings" },
  { token: "[here]", label: "Link", hint: "The word here, linked to the invoice in the client portal" },
  {
    token: "[Summary]",
    label: "Summary",
    hint: "On a line of its own: the invoice number, amount due and due date",
  },
];

/**
 * The firm's own wording for each letter. The invoice and the copy sent again read
 * the same; the two reminders say what they are.
 */
export const STANDARD_INVOICE_EMAILS: Record<InvoiceEmailKind, InvoiceEmailWording> = {
  issued: {
    subject: "Invoice [Invoice number] from [Firm name]",
    message: [
      "Dear [Name],",
      "",
      "Thank you for choosing to do business with us.",
      "",
      "Please find your invoice details [here]. We kindly request you to make the payment by the due date.",
      "",
      "[Summary]",
      "",
      "If you have any questions or need further information, please do not hesitate to contact us.",
      "",
      "--",
      "Best regards,",
      "Finance Team",
      "[Firm name]",
    ].join("\n"),
  },
  resent: {
    subject: "Invoice [Invoice number] from [Firm name]",
    message: "",
  },
  due_today: {
    subject: "Payment reminder: invoice [Invoice number] is due today",
    message: [
      "Dear [Name],",
      "",
      "Please note that payment for invoice [Invoice number] is due today.",
      "",
      "[Summary]",
      "",
      "We have attached a copy of the invoice to this email for your convenience. Please let us know if you have any questions.",
      "",
      "--",
      "Best regards,",
      "Finance Team",
      "[Firm name]",
    ].join("\n"),
  },
  overdue: {
    subject: "Payment reminder: invoice [Invoice number] is overdue",
    message: [
      "Dear [Name],",
      "",
      "Please note that payment for invoice [Invoice number] was due on [Due date] and remains outstanding.",
      "",
      "[Summary]",
      "",
      "We have attached a copy of the invoice to this email for your convenience. If payment has already been made, please let us know so that we can match it; otherwise, please let us know if you have any questions.",
      "",
      "--",
      "Best regards,",
      "Finance Team",
      "[Firm name]",
    ].join("\n"),
  },
};
STANDARD_INVOICE_EMAILS.resent.message = STANDARD_INVOICE_EMAILS.issued.message;

/** The longest subject and message the portal will send. */
export const INVOICE_EMAIL_LIMITS = { subject: 200, message: 5_000 };

/**
 * The wording an invoice goes out with: the firm's own saved wording for invoices when
 * there is one, otherwise the standard. Reminders always use the standard.
 */
export function wordingFor(
  kind: InvoiceEmailKind,
  saved: { subject?: string | null; message?: string | null },
): InvoiceEmailWording {
  const standard = STANDARD_INVOICE_EMAILS[kind];
  if (kind !== "issued" && kind !== "resent") return standard;
  return {
    subject: saved.subject?.trim() || standard.subject,
    message: saved.message?.trim() || standard.message,
  };
}

const KNOWN = new Set(INVOICE_EMAIL_PLACEHOLDERS.map((p) => p.token.toLowerCase()));

/**
 * Bracketed words the portal will not fill in - "[Contact name]" where "[Name]" was
 * meant, say - so the screen can point them out before a client reads them verbatim.
 */
export function unknownPlaceholders(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(/\[[^\]\n]{1,40}\]/g)) {
    if (!KNOWN.has(match[0].toLowerCase())) out.add(match[0]);
  }
  return [...out];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One stretch of the message: text, the link, or the figures. */
type Run = { text: string } | { link: true } | { summary: true };

/** Splits a line into text and the two special placeholders, filling in the rest. */
function runsOf(line: string, facts: InvoiceEmailFacts): Run[] {
  const name = facts.name.trim();
  const words: Record<string, string> = {
    "[name]": name || "Sir/Madam",
    "[first name]": name.split(/\s+/)[0] || "Sir/Madam",
    "[invoice number]": facts.number,
    "[amount due]": facts.amountDue,
    "[due date]": facts.dueOn,
    "[firm name]": facts.firmName,
  };
  const runs: Run[] = [];
  let rest = line;
  const pattern = /\[[^\]\n]{1,40}\]/;
  for (;;) {
    const match = pattern.exec(rest);
    if (!match) break;
    const before = rest.slice(0, match.index);
    const key = match[0].toLowerCase();
    rest = rest.slice(match.index + match[0].length);
    if (key === "[here]") {
      if (before) runs.push({ text: before });
      runs.push({ link: true });
    } else if (key === "[summary]") {
      if (before) runs.push({ text: before });
      runs.push({ summary: true });
    } else {
      runs.push({ text: before + (words[key] ?? match[0]) });
    }
  }
  if (rest) runs.push({ text: rest });
  return runs;
}

/**
 * The message, in both halves, from any wording. Pure, so the tests pin what a client
 * actually reads and the screen can preview it as it is typed.
 *
 * Paragraphs are separated by a blank line; a single line break stays a line break, so
 * a sign-off keeps its shape. Everything the Partner typed is escaped: the wording is
 * text, never markup.
 */
export function composeInvoiceEmail(
  wording: InvoiceEmailWording,
  facts: InvoiceEmailFacts,
): { subject: string; text: string; html: string } {
  const figures: Array<[string, string]> = [
    ["Invoice", facts.number],
    ["Amount due", facts.amountDue],
    ["Due date", facts.dueOn],
  ];
  const inlineFigures = figures.map(([k, v]) => `${k}: ${v}`).join(" · ");

  // A subject is one line of plain text: the link is just the word, the figures a line.
  const subject = runsOf(wording.subject.replace(/[\r\n]+/g, " "), facts)
    .map((r) => ("text" in r ? r.text : "link" in r ? "here" : inlineFigures))
    .join("")
    .trim();

  const paragraphs = wording.message
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.split("\n").map((line) => line.replace(/[ \t]+$/, "")))
    .filter((lines) => lines.some((line) => line.trim()));

  const isSummary = (lines: string[]) =>
    lines.length === 1 && lines[0].trim().toLowerCase() === "[summary]";

  const textRun = (r: Run) =>
    "text" in r ? r.text : "link" in r ? (facts.link ? `here (${facts.link})` : "here") : inlineFigures;
  const text = paragraphs
    .map((lines) =>
      isSummary(lines)
        ? figures.map(([k, v]) => `${k}: ${v}`).join("\n")
        : lines.map((line) => runsOf(line, facts).map(textRun).join("")).join("\n"),
    )
    .join("\n\n");

  const htmlRun = (r: Run) =>
    "text" in r
      ? escapeHtml(r.text)
      : "link" in r
        ? facts.link
          ? `<a href="${escapeHtml(facts.link)}" style="color:#255291;font-weight:600">here</a>`
          : "here"
        : escapeHtml(inlineFigures);
  const table = `<table role="presentation" style="margin:0 0 18px;border-collapse:collapse;font-size:14px">${figures
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 16px 3px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:3px 0;font-weight:600">${escapeHtml(v)}</td></tr>`,
    )
    .join("")}</table>`;
  const body = paragraphs
    .map((lines) =>
      isSummary(lines)
        ? table
        : `<p style="margin:0 0 16px;font-size:15px;line-height:1.55">${lines
            .map((line) => runsOf(line, facts).map(htmlRun).join(""))
            .join("<br>")}</p>`,
    )
    .join("\n    ");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px">
    ${body}
  </div>
  ${
    facts.pixel
      ? `<img src="${escapeHtml(facts.pixel)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`
      : ""
  }
</body></html>`;

  return { subject, text, html };
}

/** An address the portal will send to. Deliberately plain: one mailbox, no names. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(value.trim());
}
