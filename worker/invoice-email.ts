/**
 * The emails an invoice sends: the invoice itself, a copy sent again, the notice on
 * the day payment falls due, and the reminder once it is late.
 *
 * These are letters from the firm's finance team to a client, not portal notifications,
 * so they do not go through the generic "Hello Kofi, you are receiving this because"
 * template. The wording is the firm's own, and the invoice travels with the message.
 *
 * Every message is logged, one row per recipient, with what the mail provider said.
 * Each carries a token: a one-pixel image asks the portal for it when the recipient's
 * mail app loads images, and the "here" link passes through the portal on its way to
 * the invoice. Both only ever write to that row. Opens are a hint - some apps block
 * images, some load them on arrival - and the screen says so; a view in the portal,
 * recorded separately, is exact.
 */

import type { Env } from "./env";
import { deliver, emailConfigured } from "./email";
import { newId, nowIso } from "./db";

export const INVOICE_EMAIL_KINDS = ["issued", "resent", "due_today", "overdue"] as const;
export type InvoiceEmailKind = (typeof INVOICE_EMAIL_KINDS)[number];

export const INVOICE_EMAIL_LABELS: Record<InvoiceEmailKind, string> = {
  issued: "Invoice sent",
  resent: "Invoice sent again",
  due_today: "Due today notice",
  overdue: "Overdue reminder",
};

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "15 October 2026", the way a letter writes a date. */
export function letterDate(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The message, in both halves. Pure, so the tests pin what a client actually reads.
 *
 * The paragraphs are the firm's wording. The one addition is a short block of the
 * figures - the invoice number, the amount and the date - because "please pay by the
 * due date" is a request somebody can only act on if the date is in front of them.
 */
export function renderInvoiceEmail(
  kind: InvoiceEmailKind,
  facts: InvoiceEmailFacts,
): { subject: string; text: string; html: string } {
  const greeting = `Dear ${facts.name.trim() || "Sir/Madam"},`;
  const signOff = ["--", "Best regards,", "Finance Team", facts.firmName];

  // Paragraphs as runs of text and links, so the two halves are built from one source.
  type Run = string | { link: string; label: string };
  let subject: string;
  let paragraphs: Run[][];

  if (kind === "issued" || kind === "resent") {
    subject = `Invoice ${facts.number} from ${facts.firmName}`;
    paragraphs = [
      ["Thank you for choosing to do business with us."],
      [
        "Please find your invoice details ",
        facts.link ? { link: facts.link, label: "here" } : "here",
        ". We kindly request you to make the payment by the due date.",
      ],
      [
        "If you have any questions or need further information, please do not hesitate to contact us.",
      ],
    ];
  } else if (kind === "due_today") {
    subject = `Payment reminder: invoice ${facts.number} is due today`;
    paragraphs = [
      [`Please note that payment for invoice ${facts.number} is due today.`],
      [
        "We have attached a copy of the invoice to this email for your convenience. Please let us know if you have any questions.",
      ],
    ];
  } else {
    subject = `Payment reminder: invoice ${facts.number} is overdue`;
    paragraphs = [
      [
        `Please note that payment for invoice ${facts.number} was due on ${facts.dueOn} and remains outstanding.`,
      ],
      [
        "We have attached a copy of the invoice to this email for your convenience. If payment has already been made, please let us know so that we can match it; otherwise, please let us know if you have any questions.",
      ],
    ];
  }

  // The figures follow the sentence that points at them: after "your invoice details
  // here" in the invoice itself, after the opening line in a reminder.
  const figuresAfter = kind === "issued" || kind === "resent" ? 2 : 1;
  const figures: Array<[string, string]> = [
    ["Invoice", facts.number],
    ["Amount due", facts.amountDue],
    ["Due date", facts.dueOn],
  ];

  const textRun = (run: Run) => (typeof run === "string" ? run : `${run.label} (${run.link})`);
  const text = [
    greeting,
    ...paragraphs.slice(0, figuresAfter).flatMap((p) => ["", p.map(textRun).join("")]),
    "",
    ...figures.map(([k, v]) => `${k}: ${v}`),
    ...paragraphs.slice(figuresAfter).flatMap((p) => ["", p.map(textRun).join("")]),
    "",
    ...signOff,
  ].join("\n");

  const htmlRun = (run: Run) =>
    typeof run === "string"
      ? escapeHtml(run)
      : `<a href="${escapeHtml(run.link)}" style="color:#255291;font-weight:600">${escapeHtml(run.label)}</a>`;
  const p = (runs: Run[]) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55">${runs.map(htmlRun).join("")}</p>`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px">
    <p style="margin:0 0 16px;font-size:15px">${escapeHtml(greeting)}</p>
    ${paragraphs.slice(0, figuresAfter).map(p).join("\n    ")}
    <table role="presentation" style="margin:0 0 18px;border-collapse:collapse;font-size:14px">
      ${figures
        .map(
          ([k, v]) =>
            `<tr><td style="padding:3px 16px 3px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:3px 0;font-weight:600">${escapeHtml(v)}</td></tr>`,
        )
        .join("")}
    </table>
    ${paragraphs.slice(figuresAfter).map(p).join("\n    ")}
    <p style="margin:24px 0 0;font-size:15px;line-height:1.55">--<br>Best regards,<br>Finance Team<br>${escapeHtml(facts.firmName)}</p>
  </div>
  ${
    facts.pixel
      ? `<img src="${escapeHtml(facts.pixel)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`
      : ""
  }
</body></html>`;

  return { subject, text, html };
}

/** A token nobody can guess or reuse: 32 random bytes as hex, safe in a URL. */
export function mailToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** UTF-8 text as base64, which is how the providers take an attachment. */
export function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Sends one kind of invoice email to each recipient, logs every attempt, and says who
 * it reached. Never throws for a delivery failure: a provider having a bad afternoon
 * is written into the log and reported, and the invoice stays issued.
 */
export async function sendInvoiceEmail(
  env: Env,
  input: {
    invoiceId: string;
    kind: InvoiceEmailKind;
    recipients: Array<{ email: string; full_name: string }>;
    cc: string[];
    replyTo: string | null;
    firmName: string;
    number: string;
    amountDue: string;
    dueOn: string;
    attachment: { filename: string; html: string } | null;
    actorId: string | null;
    automatic: boolean;
  },
): Promise<{ sent_to: string[]; failed: Array<{ email: string; error: string }> }> {
  const base = (env.PORTAL_URL ?? "").trim().replace(/\/+$/, "");
  const sent_to: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];
  const attachments = input.attachment
    ? [
        {
          filename: input.attachment.filename,
          content: base64Utf8(input.attachment.html),
          contentType: "text/html",
        },
      ]
    : undefined;

  for (const recipient of input.recipients) {
    const token = mailToken();
    const message = renderInvoiceEmail(input.kind, {
      name: recipient.full_name,
      number: input.number,
      firmName: input.firmName,
      amountDue: input.amountDue,
      dueOn: input.dueOn,
      link: base ? `${base}/api/invoice-mail/${token}/view` : "",
      pixel: base ? `${base}/api/invoice-mail/${token}/open.gif` : "",
    });

    let error: string | null = null;
    if (!emailConfigured(env)) {
      error = "Email is not set up on this portal.";
    } else {
      try {
        await deliver(env, recipient.email, message.subject, message.text, message.html, input.cc, {
          attachments,
          replyTo: input.replyTo ?? undefined,
          fromName: `${input.firmName} Finance`,
        });
      } catch (err) {
        error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        console.error("Invoice email failed:", error);
      }
    }

    await env.DB.prepare(
      `INSERT INTO invoice_emails
         (id, invoice_id, kind, recipient_email, recipient_name, cc, status, error, token,
          automatic, sent_by, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId(),
        input.invoiceId,
        input.kind,
        recipient.email,
        recipient.full_name || null,
        input.cc.length ? input.cc.join(", ") : null,
        error ? "failed" : "sent",
        error,
        token,
        input.automatic ? 1 : 0,
        input.actorId,
        nowIso(),
      )
      .run();

    if (error) failed.push({ email: recipient.email, error });
    else sent_to.push(recipient.email);
  }

  return { sent_to, failed };
}

/** The smallest transparent GIF there is. */
export const PIXEL = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);
