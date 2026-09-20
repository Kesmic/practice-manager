/**
 * Giving somebody their work email address, and telling them about it.
 *
 * shared/staff-email.ts argues for why the portal does not create the mailbox. What is
 * left is the part the portal is good at, and there are four things this file is
 * careful about.
 *
 * **The password is never stored.** It arrives in the request, goes into one message to
 * the person and into one response the screen shows once, and is then gone. Nothing
 * here writes it to D1, and nothing in the portal ever needs to read it again. A
 * temporary password the portal kept would be a password the portal could leak.
 *
 * **It is never sent to the mailbox it opens.** The message goes to a personal address,
 * because somebody who cannot yet read their new mailbox cannot be told about it there.
 * An address on the firm's own domain is refused rather than quietly delivered nowhere.
 *
 * **Two people never share an address.** The database has a unique index on it, and
 * this checks first so the answer is a sentence naming who has it rather than a
 * constraint error.
 *
 * **It is Partner business.** The same grade the rest of the personal record uses.
 */

import type { Env } from "../env";
import { requireRole } from "../auth";
import { hrEventStatement, nowIso, optionalString, requireString } from "../db";
import { Router, badRequest, conflict, json, notFound, readJson } from "../http";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { readSettings } from "./settings";
import { ensureProfile } from "./employees";
import {
  hostAdminUrl,
  hostLabel,
  isConfigured,
  isOnFirmDomain,
  readStaffEmail,
  whyNotAnAddress,
  writeStaffEmail,
  type StaffEmailPolicy,
} from "../../shared/staff-email";
import {
  ADDRESS_PATTERNS,
  EMAIL_HOSTS,
  EMAIL_HOST_SPECS,
} from "../../shared/staff-email";
import { sendToPerson } from "../email";

const SETTING_KEY = "staff_email";

export async function readStaffEmailPolicy(env: Env): Promise<StaffEmailPolicy> {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`)
    .bind(SETTING_KEY)
    .first<{ value: string }>();
  return readStaffEmail(row?.value);
}

/** Who already holds this address, if anybody. */
async function holderOf(
  env: Env,
  address: string,
  exceptUserId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT u.full_name FROM employee_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE lower(p.work_email) = ? AND p.user_id != ?`,
  )
    .bind(address.toLowerCase(), exceptUserId)
    .first<{ full_name: string }>();
  return row?.full_name ?? null;
}

export function registerStaffEmailRoutes(router: Router<Env>): void {
  /**
   * The firm's setting. Readable by any administrator, because the screen that creates
   * an account needs it to suggest an address.
   */
  router.get("/api/staff-email", async ({ request, env }) => {
    await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const policy = await readStaffEmailPolicy(env);
    return json({
      policy,
      host_label: hostLabel(policy),
      admin_url: hostAdminUrl(policy),
      configured: isConfigured(policy),
    });
  });

  router.put("/api/staff-email", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const body = await readJson<Record<string, unknown>>(request);

    const host = String(body.host ?? "");
    if (!EMAIL_HOSTS.includes(host as never)) {
      throw badRequest(`"${host}" is not a host this portal knows.`);
    }
    const pattern = String(body.pattern ?? "");
    if (!ADDRESS_PATTERNS.includes(pattern as never)) {
      throw badRequest(`"${pattern}" is not an address pattern.`);
    }

    const policy: StaffEmailPolicy = {
      enabled: body.enabled === true,
      host: host as StaffEmailPolicy["host"],
      host_name: String(body.host_name ?? "").slice(0, 80),
      domain: String(body.domain ?? "")
        .trim()
        .replace(/^@+/, "")
        .toLowerCase()
        .slice(0, 200),
      pattern: pattern as StaffEmailPolicy["pattern"],
    };

    /*
     * Refused rather than saved half-done. Switched on with no domain would offer
     * somebody an address ending in @, which is worse than offering nothing.
     */
    if (policy.enabled && !policy.domain) {
      throw badRequest("Give the email domain, or leave staff email switched off.");
    }
    if (policy.enabled && policy.host === "other" && !policy.host_name.trim()) {
      throw badRequest("Name the host, so staff are told where to sign in.");
    }
    if (policy.domain && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(policy.domain)) {
      throw badRequest(`"${policy.domain}" does not look like a domain.`);
    }

    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
      .bind(SETTING_KEY, writeStaffEmail(policy), nowIso(), actor.id)
      .run();

    return json({
      policy,
      host_label: hostLabel(policy),
      admin_url: hostAdminUrl(policy),
      configured: isConfigured(policy),
    });
  });

  /**
   * Records somebody's work address and hands the details over.
   *
   * One call rather than "save the address" and "send the details" separately: an
   * address recorded but never given to anybody is a note to nobody, and a password
   * sent for an address the portal does not know is a record that does not exist.
   */
  router.post("/api/employees/:id/work-email", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const target = await env.DB.prepare(
      `SELECT id, email, full_name FROM users WHERE id = ?`,
    )
      .bind(params.id)
      .first<{ id: string; email: string; full_name: string }>();
    if (!target) throw notFound("That employee does not exist.");

    const policy = await readStaffEmailPolicy(env);
    if (!isConfigured(policy)) {
      throw badRequest(
        "Staff email is not set up. A Partner sets the host and domain under Portal settings, Staff email.",
      );
    }

    const body = await readJson<{
      address?: unknown;
      password?: unknown;
      send_to?: unknown;
      notify?: unknown;
    }>(request);

    const address = requireString(body.address, "address", { max: 254 }).trim();
    const refusal = whyNotAnAddress(address);
    if (refusal) throw badRequest(refusal);

    const taken = await holderOf(env, address, target.id);
    if (taken) throw conflict(`${taken} already has ${address}.`);

    /*
     * The password is optional. An administrator who would rather hand it over in
     * person can record the address alone, and the message then says the mailbox
     * exists and that the password is coming separately.
     */
    const password = optionalString(body.password, "password", 200) ?? "";
    const notify = body.notify !== false;

    /*
     * Where the message goes. Never the new mailbox - they cannot read it yet - and
     * never anywhere on the firm's domain, which is the same mistake wearing a
     * different address.
     */
    const profile = await env.DB.prepare(
      `SELECT personal_email FROM employee_profiles WHERE user_id = ?`,
    )
      .bind(target.id)
      .first<{ personal_email: string | null }>();
    const sendTo =
      (optionalString(body.send_to, "send_to", 254) ?? "").trim() ||
      (profile?.personal_email ?? "").trim() ||
      target.email;

    let delivery: { sent: boolean; error?: string } = {
      sent: false,
      error: "No message was requested.",
    };

    if (notify) {
      if (whyNotAnAddress(sendTo)) {
        throw badRequest(
          "Give a personal address to send the details to - they cannot read the new mailbox yet.",
        );
      }
      if (isOnFirmDomain(sendTo, policy)) {
        throw badRequest(
          `${sendTo} is on the firm's own domain, so it cannot be used to tell somebody about a mailbox they cannot open yet. Use a personal address.`,
        );
      }
    }

    const settings = await readSettings(env);
    const label = hostLabel(policy);
    // Taken from the shared spec rather than repeated here, so the link somebody is
    // sent and the link the screen shows can never drift apart.
    const signIn = policy.host === "other" ? "" : EMAIL_HOST_SPECS[policy.host].signInAt;
    const signInAt = signIn ? `\nSign in at: ${signIn}` : "";

    if (notify) {
      delivery = await sendToPerson(env, {
        to: { email: sendTo, full_name: target.full_name },
        subject: `Your ${settings.firm_name} email address`,
        headline:
          `Your work email address at ${settings.firm_name} has been set up on ${label}. ` +
          (password
            ? "Sign in with the address and temporary password below. You will be asked to choose your own password straight away."
            : "Your password is being sent to you separately."),
        detail:
          `Email address: ${address}` +
          (password ? `\nTemporary password: ${password}` : "") +
          signInAt,
        link: settings.firm_website || "",
        linkLabel: `${settings.firm_name} website`,
        firmName: settings.firm_name,
        reason: `a work email address has been created for you at ${settings.firm_name}`,
      });
    }

    await ensureProfile(env, target.id);
    const timestamp = nowIso();

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE employee_profiles
            SET work_email = ?, work_email_host = ?, work_email_issued_at = ?,
                work_email_issued_to = ?, updated_at = ?
          WHERE user_id = ?`,
      ).bind(
        address,
        label,
        notify && delivery.sent ? timestamp : null,
        notify && delivery.sent ? sendTo : null,
        timestamp,
        target.id,
      ),
      hrEventStatement(env, {
        subjectId: target.id,
        actorId: actor.id,
        kind: "email:issued",
        /*
         * The address, never the password. An HR trail that recorded the password
         * would keep it long after the person had changed it.
         */
        detail:
          `Work email ${address} recorded on ${label}` +
          (notify
            ? delivery.sent
              ? `, details sent to ${sendTo}`
              : `, but the message could not be sent (${delivery.error ?? "unknown"})`
            : ", no message sent"),
      }),
    ]);

    return json({
      work_email: address,
      host: label,
      sent_to: delivery.sent ? sendTo : null,
      notified: delivery.sent,
      notify_error: delivery.sent ? null : (delivery.error ?? null),
    });
  });

  /** Clears the address, for an account created in error or a mailbox never made. */
  router.delete("/api/employees/:id/work-email", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_HR_ADMIN_ROLE);
    const row = await env.DB.prepare(
      `SELECT work_email FROM employee_profiles WHERE user_id = ?`,
    )
      .bind(params.id)
      .first<{ work_email: string | null }>();
    if (!row?.work_email) throw notFound("No work email is recorded for that person.");

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE employee_profiles
            SET work_email = NULL, work_email_host = NULL, work_email_issued_at = NULL,
                work_email_issued_to = NULL, updated_at = ?
          WHERE user_id = ?`,
      ).bind(nowIso(), params.id),
      hrEventStatement(env, {
        subjectId: String(params.id),
        actorId: actor.id,
        kind: "email:cleared",
        /*
         * Said plainly, because it is the thing somebody reading this later will want
         * to know and the portal genuinely cannot do it.
         */
        detail: `Work email ${row.work_email} removed from the record. The mailbox itself is untouched.`,
      }),
    ]);
    return json({ cleared: true });
  });
}
