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
import {
  STANDARD_INVOICE_EMAILS,
  composeInvoiceEmail,
  type InvoiceEmailFacts,
  type InvoiceEmailKind,
  type InvoiceEmailWording,
} from "../shared/invoice-email-wording";

export const INVOICE_EMAIL_KINDS = ["issued", "resent", "due_today", "overdue"] as const;
export type { InvoiceEmailKind, InvoiceEmailFacts, InvoiceEmailWording };

export const INVOICE_EMAIL_LABELS: Record<InvoiceEmailKind, string> = {
  issued: "Invoice sent",
  resent: "Invoice sent again",
  due_today: "Due today notice",
  overdue: "Overdue reminder",
};

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
 * One of the four letters in the firm's standard wording. The wording itself, and how
 * it becomes a message, live in shared/invoice-email-wording.ts so the screen can
 * preview exactly what is sent.
 */
export function renderInvoiceEmail(
  kind: InvoiceEmailKind,
  facts: InvoiceEmailFacts,
): { subject: string; text: string; html: string } {
  return composeInvoiceEmail(STANDARD_INVOICE_EMAILS[kind], facts);
}

/** A token nobody can guess or reuse: 32 random bytes as hex, safe in a URL. */
export function mailToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Bytes as base64, which is how the providers take an attachment. */
export function base64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** UTF-8 text as base64. */
export function base64Utf8(value: string): string {
  return base64Bytes(new TextEncoder().encode(value));
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
    /** The words to send: the standard, the firm's own, or what was edited for this one. */
    wording: InvoiceEmailWording;
    recipients: Array<{ email: string; full_name: string }>;
    cc: string[];
    replyTo: string | null;
    firmName: string;
    number: string;
    amountDue: string;
    dueOn: string;
    /** The invoice as a PDF, or null to send without it. */
    attachment: { filename: string; bytes: Uint8Array } | null;
    /** Files on the invoice shared with the client, chosen to go with this email. */
    files?: Array<{ filename: string; bytes: Uint8Array; contentType: string }>;
    actorId: string | null;
    automatic: boolean;
  },
): Promise<{ sent_to: string[]; failed: Array<{ email: string; error: string }> }> {
  const base = (env.PORTAL_URL ?? "").trim().replace(/\/+$/, "");
  const sent_to: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];
  const attachments = [
    ...(input.attachment
      ? [
          {
            filename: input.attachment.filename,
            content: base64Bytes(input.attachment.bytes),
            contentType: "application/pdf",
          },
        ]
      : []),
    ...(input.files ?? []).map((f) => ({
      filename: f.filename,
      content: base64Bytes(f.bytes),
      contentType: f.contentType,
    })),
  ];
  const fileNames = (input.files ?? []).map((f) => f.filename).join(", ") || null;

  for (const recipient of input.recipients) {
    const token = mailToken();
    const link = base ? `${base}/api/invoice-mail/${token}/view` : "";
    const message = composeInvoiceEmail(input.wording, {
      name: recipient.full_name,
      number: input.number,
      firmName: input.firmName,
      amountDue: input.amountDue,
      dueOn: input.dueOn,
      link,
      pixel: base ? `${base}/api/invoice-mail/${token}/open.gif` : "",
    });

    // What they read, kept for the History - without the tracking address, which is
    // the recipient's to use and nobody else's.
    const stored = composeInvoiceEmail(input.wording, {
      name: recipient.full_name,
      number: input.number,
      firmName: input.firmName,
      amountDue: input.amountDue,
      dueOn: input.dueOn,
      link: "",
      pixel: "",
    }).text;

    let error: string | null = null;
    if (!emailConfigured(env)) {
      error = "Email is not set up on this portal.";
    } else {
      try {
        await deliver(env, recipient.email, message.subject, message.text, message.html, input.cc, {
          attachments: attachments.length ? attachments : undefined,
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
          automatic, sent_by, sent_at, subject, body, attached, files)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        message.subject,
        stored,
        input.attachment ? 1 : 0,
        fileNames,
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
