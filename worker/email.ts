/**
 * Email notifications.
 *
 * Three principles, because email is the part of a system most likely to break
 * something else:
 *
 * 1. **Inert until configured.** With no API key set, nothing is sent and nothing
 *    fails. The in-app inbox is the system of record either way, so the portal
 *    works identically with email off, which is also how it ships.
 * 2. **Never in the request path.** Sending happens in `waitUntil`, after the
 *    response has gone. A slow or broken email provider cannot make posting a
 *    comment slow or make it fail.
 * 3. **Never fatal.** Every failure is logged and swallowed. Losing a notification
 *    is a nuisance; losing a review comment because the mail provider was down
 *    would be unforgivable.
 *
 * Recipients are the people actually involved in a deliverable: whoever is doing
 * it, whoever is reviewing it, whoever created it, and anyone who has commented on
 * it. That last group is what makes "followers" real rather than a separate list
 * somebody has to remember to maintain, and it means a partner who asked one
 * question stays in the loop without subscribing to anything.
 */

import type { Env } from "./env";

/** Whether this deployment can send at all. */
export function emailConfigured(env: Env): boolean {
  return Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM);
}

/**
 * Where links in emails should point. Falls back to the request's own origin,
 * which is right in every case except a deployment reached by more than one name.
 */
function portalUrl(env: Env, fallbackOrigin: string): string {
  const configured = (env.PORTAL_URL ?? "").trim().replace(/\/+$/, "");
  return configured || fallbackOrigin;
}

interface Recipient {
  id: string;
  email: string;
  full_name: string;
}

/**
 * Everyone involved in a deliverable, minus whoever caused the event.
 *
 * Suspended accounts and anyone who has turned email off are excluded here rather
 * than at the send site, so no caller can forget.
 */
async function watchers(
  env: Env,
  taskId: string,
  actorId: string,
): Promise<Recipient[]> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT u.id, u.email, u.full_name
       FROM users u
      WHERE u.status = 'active'
        AND u.email_notifications = 1
        AND u.id != ?1
        AND (
          u.id IN (
            SELECT assignee_id FROM tasks WHERE id = ?2
            UNION SELECT reviewer_id FROM tasks WHERE id = ?2
            UNION SELECT created_by FROM tasks WHERE id = ?2
          )
          OR u.id IN (SELECT author_id FROM task_comments WHERE task_id = ?2)
        )
      ORDER BY u.full_name`,
  )
    .bind(actorId, taskId)
    .all<Recipient>();
  return results;
}

/** Minimal escaping for the values interpolated into the HTML body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Message {
  subject: string;
  /** One line stating what happened. */
  headline: string;
  /** Optional detail, such as the comment itself or the reviewer's note. */
  detail?: string | null;
  /** Where to go to deal with it. */
  link: string;
  linkLabel: string;
  firmName: string;
}

/**
 * Both a plain-text and an HTML body. Plain text is not a courtesy: it is what
 * many corporate mail filters score a message on, and a message with only HTML is
 * likelier to be treated as bulk.
 */
function render(message: Message, recipient: Recipient) {
  const text = [
    `Hello ${recipient.full_name.split(" ")[0]},`,
    "",
    message.headline,
    ...(message.detail ? ["", message.detail] : []),
    "",
    `${message.linkLabel}: ${message.link}`,
    "",
    `${message.firmName} Practice Manager`,
    "You are receiving this because you are involved in this deliverable.",
    "To stop these emails, turn them off under My account in the portal.",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px">
    <p style="margin:0 0 16px;font-size:15px">Hello ${escapeHtml(recipient.full_name.split(" ")[0])},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(message.headline)}</p>
    ${
      message.detail
        ? `<blockquote style="margin:0 0 20px;padding:12px 16px;background:#f8fafc;border-left:3px solid #cbd5e1;font-size:14px;line-height:1.55;white-space:pre-wrap">${escapeHtml(
            message.detail,
          )}</blockquote>`
        : ""
    }
    <p style="margin:0 0 24px">
      <a href="${escapeHtml(message.link)}"
         style="display:inline-block;background:#255291;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:500">
        ${escapeHtml(message.linkLabel)}
      </a>
    </p>
    <hr style="border:0;border-top:1px solid #e2e8f0;margin:0 0 16px">
    <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b">
      ${escapeHtml(message.firmName)} Practice Manager.
      You are receiving this because you are involved in this deliverable.
      To stop these emails, turn them off under My account in the portal.
    </p>
  </div>
</body></html>`;

  return { text, html };
}

/**
 * Hands one message to the provider.
 *
 * Resend's API is the default because its request shape is the simplest of the
 * transactional providers, but the only provider-specific things here are the URL
 * and the body, so swapping is a small change rather than a rewrite.
 */
async function deliver(
  env: Env,
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EMAIL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html }),
  });

  if (!response.ok) {
    // The provider's own message is the useful part: it says whether the domain
    // is unverified, the key is wrong, or the address was rejected.
    const detail = await response.text().catch(() => "");
    throw new Error(`Email provider returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

/**
 * Emails everyone involved in a deliverable. Safe to call unconditionally: it
 * returns immediately when email is not configured, and it never throws.
 *
 * `waitUntil` is required rather than optional so a caller cannot accidentally
 * put a mail round-trip inside the response path.
 */
export async function notifyWatchers(
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
  input: {
    taskId: string;
    taskRef: string;
    actorId: string;
    origin: string;
    firmName: string;
    subject: string;
    headline: string;
    detail?: string | null;
  },
): Promise<void> {
  if (!emailConfigured(env)) return;

  waitUntil(
    (async () => {
      try {
        const recipients = await watchers(env, input.taskId, input.actorId);
        if (!recipients.length) return;

        const message: Message = {
          subject: input.subject,
          headline: input.headline,
          detail: input.detail ?? null,
          link: `${portalUrl(env, input.origin)}/tasks/${input.taskId}`,
          linkLabel: `Open ${input.taskRef}`,
          firmName: input.firmName,
        };

        // Sent one at a time rather than as a single message with many
        // recipients: each carries the person's own name, and nobody learns who
        // else is on the deliverable from a To: header.
        const results = await Promise.allSettled(
          recipients.map((recipient) => {
            const { text, html } = render(message, recipient);
            return deliver(env, recipient.email, message.subject, text, html);
          }),
        );

        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length) {
          console.error(
            `Email: ${failed.length} of ${results.length} failed for ${input.taskRef}.`,
            (failed[0] as PromiseRejectedResult).reason,
          );
        }
      } catch (err) {
        console.error("Email notification failed entirely:", err);
      }
    })(),
  );
}
