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
 * What the Worker can see of the email settings, for the screen that reports it.
 *
 * This exists because of a failure that happened twice: email was doing nothing,
 * silently, and neither the firm nor I could tell which of five possible causes it
 * was without another round trip. Inertness is the right behaviour for a missing
 * setting, but it must be visible somewhere, and the only place that can see the
 * Worker's own environment is the Worker.
 *
 * The key itself is never returned, only whether one is present and how long it is:
 * length is enough to catch a truncated paste, which is a real mistake, without
 * putting the credential on a screen or in a browser's memory.
 */
export function emailDiagnosis(env: Env): {
  configured: boolean;
  provider: string;
  provider_known: boolean;
  from: string;
  from_address: string;
  portal_url: string;
  key_present: boolean;
  key_length: number;
  problems: string[];
} {
  const provider = (env.EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
  const key = env.EMAIL_API_KEY ?? "";
  const from = env.EMAIL_FROM ?? "";
  const parsed = fromAddress(from);
  const problems: string[] = [];

  if (!key) {
    problems.push(
      "EMAIL_API_KEY is not set. Add it as a Secret in Cloudflare under Settings, Variables and Secrets, on the Production side, then deploy again.",
    );
  }
  if (!from) {
    problems.push("EMAIL_FROM is not set. It belongs in wrangler.toml under [vars].");
  } else if (!parsed.email.includes("@")) {
    problems.push(
      `EMAIL_FROM does not contain an email address. It should read like: Kesmic Practice Manager <portal@kesmic.org>`,
    );
  }
  if (!(provider in PROVIDERS)) {
    problems.push(
      `EMAIL_PROVIDER is "${provider}", which is not one of: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  if (!env.PORTAL_URL) {
    problems.push(
      "PORTAL_URL is not set, so links in emails will point at whichever address the portal was reached on. Harmless, but worth setting.",
    );
  }

  return {
    configured: emailConfigured(env),
    provider,
    provider_known: provider in PROVIDERS,
    from,
    from_address: parsed.email,
    portal_url: env.PORTAL_URL ?? "",
    key_present: Boolean(key),
    key_length: key.length,
    problems,
  };
}

/**
 * Sends one message and reports exactly what the provider said.
 *
 * Everything else here swallows failures on purpose, so that a broken mail provider
 * cannot break the portal. That is right for a notification and useless for
 * diagnosis, which is why this one path is allowed to be loud: it returns the
 * provider's HTTP status and its own words, which is the difference between "nothing
 * happens" and "SendGrid says the sender identity is not verified".
 */
export async function sendTestEmail(
  env: Env,
  to: { email: string; full_name: string },
  firmName: string,
  origin: string,
): Promise<{ sent: boolean; status: number | null; detail: string }> {
  if (!emailConfigured(env)) {
    return {
      sent: false,
      status: null,
      detail:
        "Email is not configured on this deployment, so nothing was sent. See the settings above.",
    };
  }

  const now = new Date().toISOString();
  const message: Message = {
    subject: `${firmName} Practice Manager: test message`,
    headline:
      "This is a test message from the portal. If you are reading it, notifications will reach you: assignments, submissions, review points, comments and client enquiries all use this same path.",
    detail: `Sent at ${now}\nProvider: ${(env.EMAIL_PROVIDER ?? "resend").toLowerCase()}\nFrom: ${env.EMAIL_FROM}`,
    link: `${portalUrl(env, origin)}/`,
    linkLabel: "Open the portal",
    firmName,
    reason: "you asked the portal to send you a test message",
  };

  try {
    const { text, html } = render(message, { id: "", ...to });
    await deliver(env, to.email, message.subject, text, html);
    return {
      sent: true,
      status: 202,
      detail: `Accepted by the provider and addressed to ${to.email}. If it does not arrive within a few minutes, look in the spam folder, then in the provider's own activity log: from here on it is out of the portal's hands.`,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const status = Number.parseInt(/returned (\d{3})/.exec(raw)?.[1] ?? "", 10);
    return {
      sent: false,
      status: Number.isFinite(status) ? status : null,
      detail: raw,
    };
  }
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
  /**
   * Why this person is being written to, completing the sentence "You are receiving
   * this because ...". Stating it accurately is what separates a notification from
   * unsolicited mail, so it is required rather than defaulted.
   */
  reason: string;
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
    `You are receiving this because ${message.reason}.`,
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
      You are receiving this because ${escapeHtml(message.reason)}.
      To stop these emails, turn them off under My account in the portal.
    </p>
  </div>
</body></html>`;

  return { text, html };
}

/**
 * Splits "Kesmic Practice Manager <portal@kesmic.org>" into its two parts.
 *
 * Resend and Postmark take the combined form; SendGrid insists on the name and the
 * address as separate fields, so the parse has to happen somewhere.
 */
function fromAddress(value: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { email: value.trim() };
  return { name: match[1] || undefined, email: match[2].trim() };
}

interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * How each supported service wants to be asked. The differences are the URL, the
 * name of the auth header and the field names; everything else about sending is the
 * same, which is why this is a lookup table rather than three code paths.
 *
 * The choice between them is usually not about the services at all. Resend verifies
 * a domain by requiring an MX record on a subdomain, and registrars including Wix
 * refuse to create one, which makes verification impossible without moving DNS
 * elsewhere. Postmark and SendGrid verify with TXT and CNAME records, which Wix does
 * support. See docs/EMAIL.md.
 */
const PROVIDERS: Record<
  string,
  (env: Env, to: string, subject: string, text: string, html: string) => ProviderRequest
> = {
  resend: (env, to, subject, text, html) => ({
    url: "https://api.resend.com/emails",
    headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}` },
    body: { from: env.EMAIL_FROM, to: [to], subject, text, html },
  }),

  postmark: (env, to, subject, text, html) => ({
    url: "https://api.postmarkapp.com/email",
    headers: { "X-Postmark-Server-Token": env.EMAIL_API_KEY ?? "", Accept: "application/json" },
    body: {
      From: env.EMAIL_FROM,
      To: to,
      Subject: subject,
      TextBody: text,
      HtmlBody: html,
      // Postmark separates transactional mail from bulk. These are notifications
      // about someone's own work, so they belong on the transactional stream.
      MessageStream: "outbound",
    },
  }),

  sendgrid: (env, to, subject, text, html) => {
    const from = fromAddress(env.EMAIL_FROM ?? "");
    return {
      url: "https://api.sendgrid.com/v3/mail/send",
      headers: { Authorization: `Bearer ${env.EMAIL_API_KEY}` },
      body: {
        personalizations: [{ to: [{ email: to }] }],
        from: from.name ? { email: from.email, name: from.name } : { email: from.email },
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      },
    };
  },
};

/** The provider named in the environment, or Resend. Unknown names are refused. */
function providerName(env: Env): string {
  const name = (env.EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
  if (!(name in PROVIDERS)) {
    // Thrown rather than silently falling back: sending through the wrong service
    // would fail in a way that looks like a DNS problem and waste an afternoon.
    throw new Error(
      `EMAIL_PROVIDER is "${name}", which is not one of: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  return name;
}

/** Hands one message to whichever service is configured. */
async function deliver(
  env: Env,
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  const name = providerName(env);
  const request = PROVIDERS[name](env, to, subject, text, html);

  const response = await fetch(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...request.headers },
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    // The provider's own message is the useful part: it says whether the domain
    // is unverified, the key is wrong, or the address was rejected.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${name} returned ${response.status}: ${detail.slice(0, 300)}`,
    );
  }
}

/**
 * Emails one named person, for a message that is about them rather than about a
 * deliverable: an invitation to the portal, most obviously.
 *
 * Unlike the other two, this one reports whether it managed to send, because the
 * screen that creates an account needs to say "invitation sent" or "tell them
 * yourself" rather than leaving the administrator guessing. It still cannot throw,
 * and it still cannot fail the request that created the account.
 */
export async function sendToPerson(
  env: Env,
  input: {
    to: { email: string; full_name: string };
    subject: string;
    headline: string;
    detail?: string | null;
    link: string;
    linkLabel: string;
    firmName: string;
    reason: string;
  },
): Promise<{ sent: boolean; error?: string }> {
  if (!emailConfigured(env)) {
    return { sent: false, error: "Email is not set up on this portal." };
  }
  try {
    const recipient = { id: "", email: input.to.email, full_name: input.to.full_name };
    const { text, html } = render(
      {
        subject: input.subject,
        headline: input.headline,
        detail: input.detail ?? null,
        link: input.link,
        linkLabel: input.linkLabel,
        firmName: input.firmName,
        reason: input.reason,
      },
      recipient,
    );
    await deliver(env, recipient.email, input.subject, text, html);
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Invitation email failed:", message);
    return { sent: false, error: message };
  }
}

/**
 * Everyone who can act on an incoming client request: Manager grade and above.
 *
 * Deliberately not "whoever is on duty" or a nominated inbox. A request from a
 * prospective client that nobody sees is the worst outcome here, so it goes to
 * everybody who could accept it, and the first person to look at it marks it as
 * theirs. There is no actor to exclude, because the sender has no account.
 */
async function supervisors(env: Env): Promise<Recipient[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.full_name
       FROM users u
      WHERE u.status = 'active'
        AND u.email_notifications = 1
        AND u.role IN ('manager','partner','admin')
      ORDER BY u.full_name`,
  ).all<Recipient>();
  return results;
}

/**
 * Emails the firm about something that arrived through a public intake link.
 *
 * Same guarantees as everything else here: inert without configuration, sent after
 * the response, and never able to fail the submission. A prospective client must not
 * see an error because the firm's mail provider is having a bad afternoon.
 */
export async function notifyIntake(
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
  input: {
    reference: string;
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
        const recipients = await supervisors(env);
        if (!recipients.length) return;

        const message: Message = {
          subject: input.subject,
          headline: input.headline,
          detail: input.detail ?? null,
          link: `${portalUrl(env, input.origin)}/client-requests`,
          linkLabel: `Open ${input.reference}`,
          firmName: input.firmName,
          reason: "you are at Manager grade or above and client requests come to you",
        };

        const results = await Promise.allSettled(
          recipients.map((recipient) => {
            const { text, html } = render(message, recipient);
            return deliver(env, recipient.email, message.subject, text, html);
          }),
        );

        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length) {
          console.error(
            `Email: ${failed.length} of ${results.length} failed for ${input.reference}.`,
            (failed[0] as PromiseRejectedResult).reason,
          );
        }
      } catch (err) {
        console.error("Client request email failed entirely:", err);
      }
    })(),
  );
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
          reason: "you are involved in this deliverable",
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
