/**
 * The tools the practice works in, and the certifications it asks people to hold.
 *
 * Three things live here, and they share a file because they are one subject: the
 * firm's catalogue of tools and courses, who holds a login to each, and how far each
 * person has got with each certification.
 *
 * shared/certifications.ts holds the arithmetic and argues for it. What this file is
 * careful about:
 *
 * **The catalogue is the firm's.** Tools and certifications are rows an administrator
 * maintains. Nothing here knows what Xero is, which is why adding Odoo is a screen
 * rather than a release.
 *
 * **No password is ever stored.** A login is recorded so the firm knows who holds
 * what; the password is typed in, sent once, and gone - the same rule as the work
 * email, for the same reason.
 *
 * **A status is worked out, never stored.** Overdue and expired are facts about the
 * calendar. A column holding them would be right on the day it was written and wrong
 * every day after.
 *
 * **Chasing somebody is not private.** A reminder copies the person sending it, and
 * visibly, so the person being chased can see who else read it.
 */

import type { Env } from "../env";
import { requireRole, requireUser } from "../auth";
import {
  hrEventStatement,
  newId,
  notificationStatement,
  nowIso,
  optionalString,
  requireEnum,
  requireString,
} from "../db";
import { Router, badRequest, conflict, json, noContent, notFound, readJson } from "../http";
import { today } from "../dates";
import { MIN_HR_ADMIN_ROLE } from "../../shared/hr";
import { readSettings } from "./settings";
import {
  CERT_PROGRESS,
  certState,
  expiryDate,
  whyNotALink,
  whyNotAName,
  whyNotValidity,
  type CertProgress,
} from "../../shared/certifications";
import {
  describeSize,
  isAcceptedType,
  objectKey,
  whyNotAcceptable,
} from "../../shared/staff-files";
import { sendToPerson } from "../email";

/** Who maintains the catalogue and asks people to take courses. */
const MIN_TRAINING_ADMIN = MIN_HR_ADMIN_ROLE;

function bucket(env: Env): R2Bucket {
  if (!env.FILES) {
    throw badRequest(
      "This portal is not set up to hold attachments yet. A Partner needs to finish the file storage setup.",
    );
  }
  return env.FILES;
}

function readValidity(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const months = Number(raw);
  const refusal = whyNotValidity(Number.isFinite(months) ? months : NaN);
  if (refusal) throw badRequest(refusal);
  return months;
}

function readLink(raw: unknown, field: string): string | null {
  const link = optionalString(raw, field, 500) ?? "";
  const refusal = whyNotALink(link);
  if (refusal) throw badRequest(refusal);
  return link.trim() || null;
}

/** An ISO date, or null. Refused rather than silently dropped. */
function readDate(raw: unknown, field: string): string | null {
  const value = (optionalString(raw, field, 10) ?? "").trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest(`"${value}" is not a date.`);
  }
  return value;
}

export function registerTrainingRoutes(router: Router<Env>): void {
  // -------------------------------------------------------------- the catalogue

  /**
   * Every tool and its certifications.
   *
   * Readable by anybody signed in: a person needs to know what the firm uses and where
   * to sign in, and none of it is confidential. Who holds a login is not included here.
   */
  router.get("/api/tools", async ({ request, env }) => {
    await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const [tools, certs] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, name, category, sign_in_url, position FROM practice_tools
          ORDER BY position, lower(name)`,
      ),
      env.DB.prepare(
        `SELECT id, tool_id, name, course_url, validity_months, requires_certificate
           FROM tool_certifications ORDER BY lower(name)`,
      ),
    ]);
    return json({ tools: tools.results, certifications: certs.results });
  });

  router.post("/api/tools", async ({ request, env }) => {
    const actor = await requireRole(env, request, MIN_TRAINING_ADMIN);
    const body = await readJson<Record<string, unknown>>(request);

    const name = requireString(body.name, "name", { max: 120 }).trim();
    const refusal = whyNotAName(name, "tool");
    if (refusal) throw badRequest(refusal);

    const clash = await env.DB.prepare(
      `SELECT name FROM practice_tools WHERE lower(name) = ?`,
    )
      .bind(name.toLowerCase())
      .first<{ name: string }>();
    if (clash) throw conflict(`${clash.name} is already on the list.`);

    const id = newId();
    await env.DB.prepare(
      `INSERT INTO practice_tools (id, name, category, sign_in_url, position, created_at, created_by)
       VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM practice_tools), 0), ?, ?)`,
    )
      .bind(
        id,
        name,
        optionalString(body.category, "category", 60),
        readLink(body.sign_in_url, "sign_in_url"),
        nowIso(),
        actor.id,
      )
      .run();
    return json({ id, name }, 201);
  });

  router.patch("/api/tools/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_TRAINING_ADMIN);
    const body = await readJson<Record<string, unknown>>(request);
    const name = requireString(body.name, "name", { max: 120 }).trim();
    const refusal = whyNotAName(name, "tool");
    if (refusal) throw badRequest(refusal);

    const clash = await env.DB.prepare(
      `SELECT name FROM practice_tools WHERE lower(name) = ? AND id != ?`,
    )
      .bind(name.toLowerCase(), params.id)
      .first<{ name: string }>();
    if (clash) throw conflict(`${clash.name} is already on the list.`);

    const result = await env.DB.prepare(
      `UPDATE practice_tools SET name = ?, category = ?, sign_in_url = ? WHERE id = ?`,
    )
      .bind(
        name,
        optionalString(body.category, "category", 60),
        readLink(body.sign_in_url, "sign_in_url"),
        params.id,
      )
      .run();
    if (!result.meta.changes) throw notFound("That tool does not exist.");
    return json({ ok: true });
  });

  /**
   * Removes a tool, and with it every certification under it and everybody's progress.
   *
   * Said plainly by the screen before it is pressed, because the cascade is the whole
   * point and a surprise here loses a record of who was certified in what.
   */
  router.delete("/api/tools/:id", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_TRAINING_ADMIN);
    const tool = await env.DB.prepare(`SELECT name FROM practice_tools WHERE id = ?`)
      .bind(params.id)
      .first<{ name: string }>();
    if (!tool) throw notFound("That tool does not exist.");

    // The certificates in the bucket go first: the rows naming them are about to
    // cascade away, and after that nothing knows which objects to delete.
    if (env.FILES) {
      const { results } = await env.DB.prepare(
        `SELECT sc.object_key FROM staff_certifications sc
           JOIN tool_certifications tc ON tc.id = sc.certification_id
          WHERE tc.tool_id = ? AND sc.object_key IS NOT NULL`,
      )
        .bind(params.id)
        .all<{ object_key: string }>();
      if (results.length) await env.FILES.delete(results.map((r) => r.object_key));
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM practice_tools WHERE id = ?`).bind(params.id),
      hrEventStatement(env, {
        subjectId: null,
        actorId: actor.id,
        kind: "training:tool_removed",
        detail: `${tool.name} removed from the practice's tools, with its certifications and everybody's progress on them.`,
      }),
    ]);
    return noContent();
  });

  router.post("/api/tools/:id/certifications", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_TRAINING_ADMIN);
    const tool = await env.DB.prepare(`SELECT id FROM practice_tools WHERE id = ?`)
      .bind(params.id)
      .first<{ id: string }>();
    if (!tool) throw notFound("That tool does not exist.");

    const body = await readJson<Record<string, unknown>>(request);
    const name = requireString(body.name, "name", { max: 120 }).trim();
    const refusal = whyNotAName(name, "certification");
    if (refusal) throw badRequest(refusal);

    const id = newId();
    await env.DB.prepare(
      `INSERT INTO tool_certifications
         (id, tool_id, name, course_url, validity_months, requires_certificate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        params.id,
        name,
        readLink(body.course_url, "course_url"),
        readValidity(body.validity_months),
        body.requires_certificate === false ? 0 : 1,
        nowIso(),
      )
      .run();
    return json({ id, name }, 201);
  });

  router.patch("/api/certifications/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_TRAINING_ADMIN);
    const body = await readJson<Record<string, unknown>>(request);
    const name = requireString(body.name, "name", { max: 120 }).trim();
    const refusal = whyNotAName(name, "certification");
    if (refusal) throw badRequest(refusal);

    /*
     * Changing how long a certification lasts does not re-date certificates already
     * issued. Somebody certified under a two-year rule keeps the expiry they were
     * given; the new rule applies to the next person to pass it.
     */
    const result = await env.DB.prepare(
      `UPDATE tool_certifications
          SET name = ?, course_url = ?, validity_months = ?, requires_certificate = ?
        WHERE id = ?`,
    )
      .bind(
        name,
        readLink(body.course_url, "course_url"),
        readValidity(body.validity_months),
        body.requires_certificate === false ? 0 : 1,
        params.id,
      )
      .run();
    if (!result.meta.changes) throw notFound("That certification does not exist.");
    return json({ ok: true });
  });

  router.delete("/api/certifications/:id", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_TRAINING_ADMIN);
    if (env.FILES) {
      const { results } = await env.DB.prepare(
        `SELECT object_key FROM staff_certifications
          WHERE certification_id = ? AND object_key IS NOT NULL`,
      )
        .bind(params.id)
        .all<{ object_key: string }>();
      if (results.length) await env.FILES.delete(results.map((r) => r.object_key));
    }
    const result = await env.DB.prepare(`DELETE FROM tool_certifications WHERE id = ?`)
      .bind(params.id)
      .run();
    if (!result.meta.changes) throw notFound("That certification does not exist.");
    return noContent();
  });

  // ------------------------------------------------------- logins to the tools

  /**
   * Records somebody's login to the practice's account on a tool, and tells them.
   *
   * The portal does not create the account. An administrator invites them at the tool
   * - Xero and QuickBooks both invite a named person into the practice's organisation -
   * and records the username here. The password is typed in, passed on once, and never
   * stored, exactly as the work email does it.
   */
  router.post("/api/employees/:id/tool-logins", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_TRAINING_ADMIN);
    const target = await env.DB.prepare(
      `SELECT u.id, u.email, u.full_name, p.personal_email, p.work_email
         FROM users u LEFT JOIN employee_profiles p ON p.user_id = u.id
        WHERE u.id = ?`,
    )
      .bind(params.id)
      .first<{
        id: string;
        email: string;
        full_name: string;
        personal_email: string | null;
        work_email: string | null;
      }>();
    if (!target) throw notFound("That employee does not exist.");

    const body = await readJson<Record<string, unknown>>(request);
    const toolId = requireString(body.tool_id, "tool_id", { max: 64 });
    const tool = await env.DB.prepare(
      `SELECT name, sign_in_url FROM practice_tools WHERE id = ?`,
    )
      .bind(toolId)
      .first<{ name: string; sign_in_url: string | null }>();
    if (!tool) throw notFound("That tool does not exist.");

    const username = requireString(body.username, "username", { max: 200 }).trim();
    const password = optionalString(body.password, "password", 200) ?? "";
    const notify = body.notify !== false;

    /*
     * Where the message goes. Their work address is right here - unlike the work email
     * itself, a login to Xero is something they can be told about at work.
     */
    const sendTo =
      (optionalString(body.send_to, "send_to", 254) ?? "").trim() ||
      (target.work_email ?? "").trim() ||
      (target.personal_email ?? "").trim() ||
      target.email;

    const settings = await readSettings(env);
    let delivery: { sent: boolean; error?: string } = {
      sent: false,
      error: "No message was requested.",
    };

    if (notify) {
      delivery = await sendToPerson(env, {
        to: { email: sendTo, full_name: target.full_name },
        subject: `Your ${tool.name} login`,
        headline:
          `You have been given a login to ${settings.firm_name}'s ${tool.name} account. ` +
          (password
            ? "Sign in with the details below. You will be asked to choose your own password."
            : "Your password is being sent to you separately."),
        detail:
          `Signs in as: ${username}` +
          (password ? `\nTemporary password: ${password}` : "") +
          (tool.sign_in_url ? `\nSign in at: ${tool.sign_in_url}` : ""),
        link: tool.sign_in_url ?? "",
        linkLabel: tool.sign_in_url ? `Sign in to ${tool.name}` : "",
        firmName: settings.firm_name,
        reason: `you have been given a login to ${settings.firm_name}'s ${tool.name} account`,
      });
    }

    const timestamp = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO staff_tool_logins
           (id, user_id, tool_id, username, issued_at, issued_to, issued_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, tool_id) DO UPDATE SET
           username = excluded.username,
           issued_at = excluded.issued_at,
           issued_to = excluded.issued_to,
           issued_by = excluded.issued_by`,
      ).bind(
        newId(),
        target.id,
        toolId,
        username,
        delivery.sent ? timestamp : null,
        delivery.sent ? sendTo : null,
        actor.id,
        timestamp,
      ),
      hrEventStatement(env, {
        subjectId: target.id,
        actorId: actor.id,
        // The username, never the password.
        kind: "training:login_issued",
        detail:
          `${tool.name} login ${username} recorded` +
          (notify
            ? delivery.sent
              ? `, details sent to ${sendTo}`
              : `, but the message could not be sent (${delivery.error ?? "unknown"})`
            : ", no message sent"),
      }),
    ]);

    return json({
      tool: tool.name,
      username,
      sent_to: delivery.sent ? sendTo : null,
      notified: delivery.sent,
      notify_error: delivery.sent ? null : (delivery.error ?? null),
    });
  });

  router.delete("/api/employees/:id/tool-logins/:toolId", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_TRAINING_ADMIN);
    const result = await env.DB.prepare(
      `DELETE FROM staff_tool_logins WHERE user_id = ? AND tool_id = ?`,
    )
      .bind(params.id, params.toolId)
      .run();
    if (!result.meta.changes) throw notFound("No login is recorded for that tool.");
    await hrEventStatement(env, {
      subjectId: String(params.id),
      actorId: actor.id,
      kind: "training:login_cleared",
      detail:
        "Tool login removed from the record. The account at the tool itself is untouched - remove it there as well.",
    }).run();
    return noContent();
  });

  // ------------------------------------------------ asking somebody to certify

  router.post("/api/employees/:id/certifications", async ({ request, env, params, waitUntil }) => {
    const actor = await requireRole(env, request, MIN_TRAINING_ADMIN);
    const target = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.email, p.work_email, p.personal_email
         FROM users u LEFT JOIN employee_profiles p ON p.user_id = u.id
        WHERE u.id = ?`,
    )
      .bind(params.id)
      .first<{
        id: string;
        full_name: string;
        email: string;
        work_email: string | null;
        personal_email: string | null;
      }>();
    if (!target) throw notFound("That employee does not exist.");

    const body = await readJson<Record<string, unknown>>(request);
    const certId = requireString(body.certification_id, "certification_id", { max: 64 });
    const cert = await env.DB.prepare(
      `SELECT tc.name, tc.course_url, t.name AS tool_name
         FROM tool_certifications tc JOIN practice_tools t ON t.id = tc.tool_id
        WHERE tc.id = ?`,
    )
      .bind(certId)
      .first<{ name: string; course_url: string | null; tool_name: string }>();
    if (!cert) throw notFound("That certification does not exist.");

    const already = await env.DB.prepare(
      `SELECT id FROM staff_certifications WHERE user_id = ? AND certification_id = ?`,
    )
      .bind(target.id, certId)
      .first<{ id: string }>();
    if (already) {
      throw conflict(`${target.full_name} has already been asked to take ${cert.name}.`);
    }

    const dueOn = readDate(body.due_on, "due_on");
    const id = newId();
    const timestamp = nowIso();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO staff_certifications
           (id, user_id, certification_id, progress, assigned_at, assigned_by, due_on, created_at)
         VALUES (?, ?, ?, 'assigned', ?, ?, ?, ?)`,
      ).bind(id, target.id, certId, timestamp, actor.id, dueOn, timestamp),
      notificationStatement(env, {
        userId: target.id,
        taskId: null,
        kind: "training:assigned",
        title: `Take the ${cert.name}`,
        body: dueOn
          ? `${cert.tool_name}. The firm would like this done by ${dueOn}.`
          : `${cert.tool_name}. See My training for the course.`,
      }),
      hrEventStatement(env, {
        subjectId: target.id,
        actorId: actor.id,
        kind: "training:assigned",
        detail: `Asked to take ${cert.name}${dueOn ? `, by ${dueOn}` : ""}.`,
      }),
    ]);

    /*
     * Told by email as well as in the inbox, the way a reminder already is. After the
     * response, and never able to fail it: the assignment is written by now, and a
     * mail provider having a bad afternoon is not a reason to undo it. Whoever asked
     * is copied in, visibly, as on the reminder.
     */
    const settings = await readSettings(env);
    waitUntil(
      sendToPerson(env, {
        to: { email: target.work_email || target.personal_email || target.email, full_name: target.full_name },
        subject: `Please take the ${cert.name}`,
        headline:
          `${actor.full_name} has asked you to complete the ${cert.name}` +
          (dueOn ? `, by ${dueOn}.` : "."),
        detail:
          `Tool: ${cert.tool_name}` +
          (cert.course_url ? `\nCourse: ${cert.course_url}` : "") +
          `\nWhen you have finished, attach your certificate under My training.`,
        link: cert.course_url ?? "",
        linkLabel: cert.course_url ? "Take the course" : "",
        firmName: settings.firm_name,
        reason: `the firm has asked you to complete ${cert.name}`,
        cc: [actor.email],
      }),
    );

    return json({ id }, 201);
  });

  /** Changes where somebody has got to. An administrator's view of it. */
  router.patch("/api/staff-certifications/:id", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_TRAINING_ADMIN);
    const row = await loadAssignment(env, String(params.id));
    const body = await readJson<Record<string, unknown>>(request);

    const progress = body.progress === undefined
      ? row.progress
      : requireEnum(body.progress, "progress", CERT_PROGRESS);
    const dueOn = body.due_on === undefined ? row.due_on : readDate(body.due_on, "due_on");
    const completedOn =
      body.completed_on === undefined
        ? row.completed_on
        : readDate(body.completed_on, "completed_on");

    const settled = settle(progress, completedOn, row.validity_months);

    await env.DB.prepare(
      `UPDATE staff_certifications
          SET progress = ?, due_on = ?, completed_on = ?, expires_on = ?,
              started_at = COALESCE(started_at, ?)
        WHERE id = ?`,
    )
      .bind(
        settled.progress,
        dueOn,
        settled.completed_on,
        settled.expires_on,
        settled.progress === "assigned" ? null : nowIso(),
        params.id,
      )
      .run();

    await hrEventStatement(env, {
      subjectId: row.user_id,
      actorId: actor.id,
      kind: "training:progress",
      detail: `${row.certification_name}: ${settled.progress.replace("_", " ")}${
        settled.completed_on ? ` on ${settled.completed_on}` : ""
      }${settled.expires_on ? `, valid to ${settled.expires_on}` : ""}.`,
    }).run();

    return json({ ok: true, ...settled });
  });

  router.delete("/api/staff-certifications/:id", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_TRAINING_ADMIN);
    const row = await loadAssignment(env, String(params.id));
    if (row.object_key && env.FILES) await env.FILES.delete(row.object_key);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM staff_certifications WHERE id = ?`).bind(params.id),
      hrEventStatement(env, {
        subjectId: row.user_id,
        actorId: actor.id,
        kind: "training:unassigned",
        detail: `No longer asked to take ${row.certification_name}.`,
      }),
    ]);
    return noContent();
  });

  /**
   * Chases somebody, and copies whoever is doing the chasing.
   *
   * Visibly copied rather than blind: the person being chased is entitled to see who
   * else read it, and the person chasing needs something they can point at later.
   */
  router.post("/api/staff-certifications/:id/remind", async ({ request, env, params }) => {
    const actor = await requireRole(env, request, MIN_TRAINING_ADMIN);
    const row = await loadAssignment(env, String(params.id));
    if (row.progress === "certified") {
      throw badRequest(`${row.full_name} has already done ${row.certification_name}.`);
    }

    const settings = await readSettings(env);
    const sendTo = row.work_email || row.personal_email || row.email;
    const state = certState(
      { progress: row.progress, due_on: row.due_on, completed_on: row.completed_on },
      today(),
    );

    const delivery = await sendToPerson(env, {
      to: { email: sendTo, full_name: row.full_name },
      subject: `Reminder: ${row.certification_name}`,
      headline:
        state === "overdue"
          ? `Your ${row.certification_name} was due on ${row.due_on} and is not yet recorded as done.`
          : `A reminder to complete your ${row.certification_name}.` +
            (row.due_on ? ` The firm would like it done by ${row.due_on}.` : ""),
      detail:
        `Tool: ${row.tool_name}` +
        (row.course_url ? `\nCourse: ${row.course_url}` : "") +
        `\nWhen you have finished, attach your certificate under My training.`,
      link: row.course_url ?? "",
      linkLabel: row.course_url ? "Take the course" : "",
      firmName: settings.firm_name,
      reason: `the firm has asked you to complete ${row.certification_name}`,
      // The whole of what was asked for: whoever sent this gets a copy.
      cc: [actor.email],
    });

    if (!delivery.sent) {
      throw badRequest(`The reminder could not be sent: ${delivery.error ?? "unknown error"}`);
    }

    await env.DB.batch([
      env.DB.prepare(`UPDATE staff_certifications SET last_reminded_at = ? WHERE id = ?`)
        .bind(nowIso(), params.id),
      notificationStatement(env, {
        userId: row.user_id,
        taskId: null,
        kind: "training:reminder",
        title: `Reminder: ${row.certification_name}`,
        body: row.due_on ? `Due by ${row.due_on}.` : "See My training.",
      }),
      hrEventStatement(env, {
        subjectId: row.user_id,
        actorId: actor.id,
        kind: "training:reminded",
        detail: `Reminded about ${row.certification_name}, sent to ${sendTo}, copied to ${actor.email}.`,
      }),
    ]);

    return json({ sent_to: sendTo, copied_to: actor.email });
  });

  // ------------------------------------------------------------------ reading

  /** One person's logins and certifications, for an administrator. */
  router.get("/api/employees/:id/training", async ({ request, env, params }) => {
    await requireRole(env, request, MIN_TRAINING_ADMIN);
    return json(await trainingFor(env, String(params.id)));
  });

  /** The same, for the person themselves. */
  router.get("/api/me/training", async ({ request, env }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    return json(await trainingFor(env, actor.id));
  });

  /**
   * The practice at a glance: everybody against every certification.
   *
   * Reviewer grade rather than Partner. A senior associate deciding who can take a
   * piece of Xero work needs to know who is certified in it, and none of this is more
   * sensitive than the staff directory - it is what somebody has passed, not what they
   * are paid.
   */
  router.get("/api/training/overview", async ({ request, env }) => {
    await requireRole(env, request, "senior_associate");
    const [people, certs, rows] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, full_name, role FROM users WHERE status = 'active' ORDER BY full_name`,
      ),
      env.DB.prepare(
        `SELECT tc.id, tc.name, tc.validity_months, t.name AS tool_name, t.position
           FROM tool_certifications tc JOIN practice_tools t ON t.id = tc.tool_id
          ORDER BY t.position, lower(t.name), lower(tc.name)`,
      ),
      env.DB.prepare(
        `SELECT id, user_id, certification_id, progress, due_on, completed_on, expires_on
           FROM staff_certifications`,
      ),
    ]);
    return json({
      people: people.results,
      certifications: certs.results,
      progress: rows.results,
      today: today(),
    });
  });

  // ------------------------------------------------- what the person does themselves

  /** Says they have started, or finished. Their own record only. */
  router.patch("/api/me/certifications/:id", async ({ request, env, params }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const row = await loadAssignment(env, String(params.id));
    if (row.user_id !== actor.id) {
      throw notFound("That certification is not assigned to you.");
    }

    const body = await readJson<Record<string, unknown>>(request);
    const progress = requireEnum(body.progress, "progress", CERT_PROGRESS);

    /*
     * Somebody may say they have started or finished; the certificate is what the
     * firm checks. Where one is required and none is attached, marking it done is
     * refused - otherwise "certified" would mean "said so".
     */
    if (progress === "certified" && row.requires_certificate && !row.object_key) {
      throw badRequest(
        "Attach your certificate first. The firm keeps a copy of what you passed.",
      );
    }

    const settled = settle(progress, readDate(body.completed_on, "completed_on"), row.validity_months);
    await env.DB.prepare(
      `UPDATE staff_certifications
          SET progress = ?, completed_on = ?, expires_on = ?, started_at = COALESCE(started_at, ?)
        WHERE id = ?`,
    )
      .bind(settled.progress, settled.completed_on, settled.expires_on, nowIso(), params.id)
      .run();

    if (settled.progress === "certified" && row.assigned_by) {
      // Whoever asked for it hears that it is done, without having to look.
      await notificationStatement(env, {
        userId: row.assigned_by,
        taskId: null,
        kind: "training:completed",
        title: `${row.full_name} has passed ${row.certification_name}`,
        body: settled.expires_on ? `Valid to ${settled.expires_on}.` : "",
      }).run();
    }

    return json({ ok: true, ...settled });
  });

  /** Attaches the certificate. Theirs only. */
  router.put("/api/me/certifications/:id/certificate", async ({ request, env, params }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const row = await loadAssignment(env, String(params.id));
    if (row.user_id !== actor.id) {
      throw notFound("That certification is not assigned to you.");
    }

    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!isAcceptedType(contentType)) {
      throw badRequest("Attach a PDF or a photograph - PDF, JPEG, PNG, WebP or HEIC.");
    }
    const body = await request.arrayBuffer();
    const refusal = whyNotAcceptable({ type: contentType, size: body.byteLength });
    if (refusal) throw badRequest(refusal);

    const filename = (request.headers.get("x-filename") ?? "").trim() || "certificate";
    const previous = row.object_key;
    const key = objectKey(actor.id, newId());

    await bucket(env).put(key, body, { httpMetadata: { contentType } });
    try {
      await env.DB.prepare(
        `UPDATE staff_certifications
            SET object_key = ?, filename = ?, content_type = ?, size_bytes = ?, uploaded_at = ?
          WHERE id = ?`,
      )
        .bind(key, filename.slice(0, 200), contentType, body.byteLength, nowIso(), params.id)
        .run();
    } catch (err) {
      await bucket(env).delete(key);
      throw err;
    }
    // Last, once the new one is safely recorded.
    if (previous) await bucket(env).delete(previous);

    return json({
      filename,
      content_type: contentType,
      size_bytes: body.byteLength,
      described: describeSize(body.byteLength),
    });
  });

  router.get("/api/me/certifications/:id/certificate", async ({ request, env, params }) => {
    const actor = await requireUser(env, request, {
      allowPasswordPending: true,
      allowProfilePending: true,
    });
    const row = await loadAssignment(env, String(params.id));
    if (row.user_id !== actor.id) {
      throw notFound("That certification is not assigned to you.");
    }
    return await serveCertificate(env, row);
  });

  /**
   * Somebody else's certificate.
   *
   * Reviewer grade, matching the overview: a certificate is evidence of a course
   * passed, which is the kind of thing colleagues are entitled to check.
   */
  router.get("/api/staff-certifications/:id/certificate", async ({ request, env, params }) => {
    await requireRole(env, request, "senior_associate");
    return await serveCertificate(env, await loadAssignment(env, String(params.id)));
  });
}

/** Hands a certificate back, always as a download and never inline. */
async function serveCertificate(env: Env, row: Assignment): Promise<Response> {
  if (!row.object_key) throw notFound("No certificate has been attached.");
  const object = await bucket(env).get(row.object_key);
  if (!object) {
    throw notFound("That certificate is recorded but is not in the store.");
  }
  const safe = (row.filename ?? "certificate").replace(/[^A-Za-z0-9 ._-]/g, "_").slice(0, 100);
  return new Response(object.body, {
    headers: {
      "content-type": row.content_type ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${safe || "certificate"}"`,
      // Never let a file the portal did not write execute in its own origin.
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}

/** One person's tools and certifications, as both screens want them. */
async function trainingFor(env: Env, userId: string) {
  const [tools, logins, certs] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, name, category, sign_in_url FROM practice_tools ORDER BY position, lower(name)`,
    ),
    env.DB.prepare(
      `SELECT tool_id, username, issued_at, issued_to FROM staff_tool_logins WHERE user_id = ?`,
    ).bind(userId),
    env.DB.prepare(
      `SELECT sc.id, sc.certification_id, sc.progress, sc.due_on, sc.completed_on,
              sc.expires_on, sc.filename, sc.size_bytes, sc.uploaded_at, sc.last_reminded_at,
              tc.name AS certification_name, tc.course_url, tc.validity_months,
              tc.requires_certificate, t.name AS tool_name
         FROM staff_certifications sc
         JOIN tool_certifications tc ON tc.id = sc.certification_id
         JOIN practice_tools t ON t.id = tc.tool_id
        WHERE sc.user_id = ?
        ORDER BY t.position, lower(tc.name)`,
    ).bind(userId),
  ]);
  return {
    tools: tools.results,
    logins: logins.results,
    certifications: certs.results,
    today: today(),
  };
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

interface Assignment {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  personal_email: string | null;
  work_email: string | null;
  certification_id: string;
  certification_name: string;
  tool_name: string;
  course_url: string | null;
  validity_months: number | null;
  requires_certificate: number;
  progress: CertProgress;
  due_on: string | null;
  completed_on: string | null;
  assigned_by: string | null;
  object_key: string | null;
  filename: string | null;
  content_type: string | null;
}

async function loadAssignment(env: Env, id: string): Promise<Assignment> {
  const row = await env.DB.prepare(
    `SELECT sc.id, sc.user_id, sc.certification_id, sc.progress, sc.due_on,
            sc.completed_on, sc.assigned_by, sc.object_key, sc.filename, sc.content_type,
            u.full_name, u.email,
            p.personal_email, p.work_email,
            tc.name AS certification_name, tc.course_url, tc.validity_months,
            tc.requires_certificate,
            t.name AS tool_name
       FROM staff_certifications sc
       JOIN users u ON u.id = sc.user_id
       LEFT JOIN employee_profiles p ON p.user_id = sc.user_id
       JOIN tool_certifications tc ON tc.id = sc.certification_id
       JOIN practice_tools t ON t.id = tc.tool_id
      WHERE sc.id = ?`,
  )
    .bind(id)
    .first<Assignment>();
  if (!row) throw notFound("That certification is not assigned to anybody.");
  return row;
}

/**
 * Keeps progress, the completion date and the expiry consistent with each other.
 *
 * Three rules, each of which is a bug if it is left to the caller:
 *
 * - Marked certified with no date given means today. Otherwise a certification could
 *   be complete with no date and never expire.
 * - Moved back off certified drops the dates. A certificate that is no longer claimed
 *   should not leave an expiry behind implying it is.
 * - The expiry is worked out here and stored, so that later changing how long a
 *   certification lasts does not silently re-date everybody already certified.
 */
function settle(
  progress: CertProgress,
  completedOn: string | null,
  validityMonths: number | null,
): { progress: CertProgress; completed_on: string | null; expires_on: string | null } {
  if (progress !== "certified") {
    return { progress, completed_on: null, expires_on: null };
  }
  const done = completedOn ?? today();
  return { progress, completed_on: done, expires_on: expiryDate(done, validityMonths) };
}

